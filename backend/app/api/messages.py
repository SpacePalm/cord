"""
Эндпоинты для сообщений.

  GET    /api/chats/{id}/messages              — история (50 за раз, курсор before/after)
  POST   /api/chats/{id}/messages              — отправить (multipart: content + files)
  POST   /api/chats/{id}/messages/forward      — переслать сообщение
  PATCH  /api/chats/{id}/messages/{msg_id}     — редактировать
  DELETE /api/chats/{id}/messages/{msg_id}     — удалить
  GET    /api/chats/{id}/messages/search       — поиск по тексту
  GET    /api/chats/{id}/media                 — вложения канала
  GET    /api/chats/{id}/links                 — ссылки из сообщений

"""

import asyncio
import re
import uuid
import shutil
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.group import Chat, GroupMember, Group
from app.models.message import Message, MessageAttachment, MessageReaction
from app.schemas.message import MessageOut, MessageEdit, MessageForward, MessageBulkForward, MessageBulkDelete, ForwardedFrom, ReplyTo, PollOut, PollOptionOut, EmbedOut, ReactionGroupOut, ReactionUserOut
from app.models.poll import Poll, PollOption, PollVote
from app.cache import get_cached_messages, set_cached_messages, invalidate_messages
from app.ws_manager import manager

router = APIRouter(prefix='/api/chats', tags=['messages'])

MEDIA_ROOT = Path('/app/media')
PAGE_SIZE = 50
URL_RE = re.compile(r'https?://[^\s<>"\']+')


# Helpers

async def _require_chat_member(chat_id: uuid.UUID, user: User, db: AsyncSession) -> Chat:
    chat = await db.get(Chat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail='Chat not found')
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == chat.group_id,
            GroupMember.user_id == user.id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail='Not a member of this group')
    return chat


def _to_out(msg: Message, user_id: uuid.UUID | None = None) -> MessageOut:
    reply = None
    if msg.reply_to_id:
        reply = ReplyTo(
            message_id=msg.reply_to_id,
            author_display_name=msg.reply_to_author or '',
            content=msg.reply_to_content,
        )
    fwd = None
    if msg.forwarded_from_id:
        fwd = ForwardedFrom(
            message_id=msg.forwarded_from_id,
            author_display_name=msg.forwarded_from_author or '',
            content=msg.forwarded_from_content,
            chat_name=msg.forwarded_from_chat or '',
        )
    poll_out = None
    if msg.poll:
        p = msg.poll
        user_voted_id: uuid.UUID | None = None
        options_out: list[PollOptionOut] = []
        for opt in p.options:
            voted = user_id is not None and any(v.user_id == user_id for v in opt.votes)
            if voted:
                user_voted_id = opt.id
            options_out.append(PollOptionOut(
                id=opt.id,
                text=opt.text,
                votes_count=len(opt.votes),
                voted=voted,
            ))
        poll_out = PollOut(
            id=p.id,
            question=p.question,
            options=options_out,
            user_voted_option_id=user_voted_id,
            total_votes=sum(len(opt.votes) for opt in p.options),
        )
    import json as _json
    embeds_out: list[EmbedOut] = []
    if msg.embeds_json:
        try:
            embeds_out = [EmbedOut(**e) for e in _json.loads(msg.embeds_json)]
        except Exception:
            pass

    # Группируем реакции по emoji
    reactions_out: list[ReactionGroupOut] = []
    from sqlalchemy import inspect as sa_inspect
    reactions_loaded = 'reactions' not in sa_inspect(msg).unloaded
    if reactions_loaded and msg.reactions:
        grouped: dict[str, list[ReactionUserOut]] = {}
        for r in msg.reactions:
            u = ReactionUserOut(
                user_id=r.user_id,
                display_name=r.user.display_name or r.user.username,
                image_path=r.user.image_path or '',
            )
            grouped.setdefault(r.emoji, []).append(u)
        reactions_out = [ReactionGroupOut(emoji=e, users=users) for e, users in grouped.items()]

    return MessageOut(
        id=msg.id,
        content=msg.content,
        author_id=msg.user_id,
        author_username=msg.author.username,
        author_display_name=msg.author.display_name,
        author_image_path=msg.author.image_path or '',
        chat_id=msg.chat_id,
        is_edited=msg.is_edited,
        is_pinned=msg.is_pinned,
        created_at=msg.created_at,
        updated_at=msg.updated_at,
        attachments=[a.file_path for a in msg.attachments],
        embeds=embeds_out,
        reply_to=reply,
        forwarded_from=fwd,
        poll=poll_out,
        reactions=reactions_out,
    )


def _save_upload_sync(message_id: uuid.UUID, data: bytes, filename: str) -> str:
    dest_dir = MEDIA_ROOT / 'messages' / str(message_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f'{uuid.uuid4().hex[:8]}_{filename}'
    (dest_dir / safe_name).write_bytes(data)
    return f'/media/messages/{message_id}/{safe_name}'


async def _save_upload(message_id: uuid.UUID, file: UploadFile) -> str:
    data = await file.read()
    return await asyncio.to_thread(_save_upload_sync, message_id, data, file.filename)


async def _load_messages_from_db(
    chat_id: uuid.UUID,
    before: datetime | None,
    after: datetime | None,
    limit: int,
    db: AsyncSession,
) -> list[Message]:
    q = (
        select(Message)
        .where(Message.chat_id == chat_id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
    )
    if before:
        q = q.where(Message.created_at < before).order_by(Message.created_at.desc())
    elif after:
        q = q.where(Message.created_at > after).order_by(Message.created_at.asc())
    else:
        q = q.order_by(Message.created_at.desc())

    q = q.limit(limit)
    result = await db.execute(q)
    rows = result.scalars().all()

    # Для before/desc и начальной страницы — вернуть в хронологическом порядке
    if not after:
        return list(reversed(rows))
    return list(rows)


# GET messages (с кэшем на первую страницу)

@router.get('/{chat_id}/messages', response_model=list[MessageOut])
async def get_messages(
    chat_id: uuid.UUID,
    before: datetime | None = Query(None),
    after: datetime | None = Query(None),
    limit: int = Query(PAGE_SIZE, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_chat_member(chat_id, user, db)

    # Кэш только для первой страницы без курсора
    use_cache = not before and not after and limit == PAGE_SIZE
    if use_cache:
        cached = await get_cached_messages(str(chat_id))
        if cached is not None:
            return [MessageOut.model_validate(m) for m in cached]

    messages = await _load_messages_from_db(chat_id, before, after, limit, db)
    result = [_to_out(m, user.id) for m in messages]

    if use_cache:
        await set_cached_messages(str(chat_id), [m.model_dump(mode='json') for m in result])

    return result


# POST message

@router.post('/{chat_id}/messages', response_model=MessageOut, status_code=201)
async def send_message(
    chat_id: uuid.UUID,
    content: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    reply_to_id: str | None = Form(None),
    poll_question: str | None = Form(None),
    poll_options: list[str] = Form(default=[]),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    chat = await _require_chat_member(chat_id, user, db)
    group_id = chat.group_id
    if chat.type == 'voice':
        raise HTTPException(status_code=400, detail='Cannot send messages to a voice channel')
    has_poll = bool(poll_question and len(poll_options) >= 2)
    if not content and not files and not has_poll:
        raise HTTPException(status_code=400, detail='Message must have content, attachments, or a poll')

    # Загружаем оригинальное сообщение для ответа
    reply_author: str | None = None
    reply_content: str | None = None
    reply_uuid: uuid.UUID | None = None
    if reply_to_id:
        try:
            reply_uuid = uuid.UUID(reply_to_id)
            reply_result = await db.execute(
                select(Message)
                .where(Message.id == reply_uuid)
                .options(selectinload(Message.author))
            )
            reply_msg = reply_result.scalar_one_or_none()
            if reply_msg:
                reply_author = reply_msg.author.display_name or reply_msg.author.username
                reply_content = reply_msg.content
        except ValueError:
            pass

    msg = Message(
        user_id=user.id,
        chat_id=chat_id,
        content=content or None,
        reply_to_id=reply_uuid,
        reply_to_author=reply_author,
        reply_to_content=reply_content,
    )
    db.add(msg)
    await db.flush()
    msg_id = msg.id

    for f in files:
        if f.filename:
            db.add(MessageAttachment(message_id=msg_id, file_path=await _save_upload(msg_id, f)))

    if has_poll:
        poll = Poll(message_id=msg_id, question=poll_question)  # type: ignore[arg-type]
        db.add(poll)
        await db.flush()
        for i, option_text in enumerate(poll_options[:10]):
            if option_text.strip():
                db.add(PollOption(poll_id=poll.id, text=option_text.strip(), position=i))

    await db.commit()
    await invalidate_messages(str(chat_id))

    result = await db.execute(
        select(Message)
        .where(Message.id == msg_id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
    )
    created_msg = result.scalar_one()
    msg_out = _to_out(created_msg, user.id)
    await manager.broadcast(chat_id, {
        "type": "message_created",
        "message": _to_out(created_msg, None).model_dump(mode="json"),
        "group_id": str(group_id),
    })

    # Fetch link embeds in background — update message and notify via WS
    if content and 'http' in content:
        async def _fetch_embeds():
            import json as _json
            from app.opengraph import extract_embeds
            from app.database import AsyncSessionLocal
            embeds = await extract_embeds(content)
            if not embeds:
                return
            async with AsyncSessionLocal() as bg_db:
                r = await bg_db.execute(select(Message).where(Message.id == msg_id))
                m = r.scalar_one_or_none()
                if m:
                    m.embeds_json = _json.dumps(embeds)
                    await bg_db.commit()
                    await invalidate_messages(str(chat_id))
                    # Re-load with relations for broadcast
                    r2 = await bg_db.execute(
                        select(Message).where(Message.id == msg_id)
                        .options(
                            selectinload(Message.author),
                            selectinload(Message.attachments),
                            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
                        )
                    )
                    updated = r2.scalar_one()
                    await manager.broadcast(chat_id, {
                        "type": "message_edited",
                        "message": _to_out(updated, None).model_dump(mode="json"),
                    })
        background_tasks.add_task(_fetch_embeds)

    return msg_out


# POST forward

@router.post('/{chat_id}/messages/forward', response_model=MessageOut, status_code=201)
async def forward_message(
    chat_id: uuid.UUID,
    body: MessageForward,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Цель — должен быть участником
    chat = await _require_chat_member(chat_id, user, db)
    group_id = chat.group_id

    # Получаем оригинальное сообщение
    result = await db.execute(
        select(Message)
        .where(Message.id == body.source_message_id)
        .options(selectinload(Message.author), selectinload(Message.attachments))
    )
    src = result.scalar_one_or_none()
    if not src:
        raise HTTPException(status_code=404, detail='Source message not found')

    # Проверяем доступ к исходному каналу
    src_chat = await db.get(Chat, src.chat_id)
    if src_chat:
        member_check = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == src_chat.group_id,
                GroupMember.user_id == user.id,
            )
        )
        if not member_check.scalar_one_or_none():
            raise HTTPException(status_code=403, detail='No access to source message')

    fwd = Message(
        user_id=user.id,
        chat_id=chat_id,
        content=None,
        forwarded_from_id=src.id,
        forwarded_from_author=src.author.display_name or src.author.username,
        forwarded_from_content=src.content,
        forwarded_from_chat=src_chat.name if src_chat else 'неизвестный канал',
    )
    db.add(fwd)
    await db.flush()
    fwd_id = fwd.id

    # Копируем вложения из оригинала
    for att in src.attachments:
        db.add(MessageAttachment(message_id=fwd_id, file_path=att.file_path))

    await db.commit()
    await invalidate_messages(str(chat_id))

    result = await db.execute(
        select(Message)
        .where(Message.id == fwd_id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
    )
    fwd_msg = result.scalar_one()
    msg_out = _to_out(fwd_msg, user.id)
    await manager.broadcast(chat_id, {
        "type": "message_created",
        "message": _to_out(fwd_msg, None).model_dump(mode="json"),
        "group_id": str(group_id),
    })
    return msg_out


# POST bulk forward

@router.post('/{chat_id}/messages/forward/bulk', response_model=list[MessageOut], status_code=201)
async def forward_messages_bulk(
    chat_id: uuid.UUID,
    body: MessageBulkForward,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    chat = await _require_chat_member(chat_id, user, db)
    group_id = chat.group_id

    if not body.source_message_ids:
        raise HTTPException(status_code=400, detail='No messages to forward')

    # Загружаем все исходные сообщения
    result = await db.execute(
        select(Message)
        .where(Message.id.in_(body.source_message_ids))
        .options(selectinload(Message.author), selectinload(Message.attachments))
        .order_by(Message.created_at.asc())
    )
    sources = result.scalars().all()
    if not sources:
        raise HTTPException(status_code=404, detail='No source messages found')

    # Проверяем доступ к исходным каналам
    src_chat_ids = {s.chat_id for s in sources}
    for src_chat_id in src_chat_ids:
        src_chat = await db.get(Chat, src_chat_id)
        if src_chat:
            member_check = await db.execute(
                select(GroupMember).where(
                    GroupMember.group_id == src_chat.group_id,
                    GroupMember.user_id == user.id,
                )
            )
            if not member_check.scalar_one_or_none():
                raise HTTPException(status_code=403, detail='No access to source message')

    fwd_ids: list[uuid.UUID] = []
    for src in sources:
        src_chat = await db.get(Chat, src.chat_id)
        fwd = Message(
            user_id=user.id,
            chat_id=chat_id,
            content=None,
            forwarded_from_id=src.id,
            forwarded_from_author=src.author.display_name or src.author.username,
            forwarded_from_content=src.content,
            forwarded_from_chat=src_chat.name if src_chat else 'неизвестный канал',
        )
        db.add(fwd)
        await db.flush()
        fwd_ids.append(fwd.id)

        # Копируем вложения из оригинала
        for att in src.attachments:
            db.add(MessageAttachment(message_id=fwd.id, file_path=att.file_path))

    await db.commit()
    await invalidate_messages(str(chat_id))

    result = await db.execute(
        select(Message)
        .where(Message.id.in_(fwd_ids))
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
        .order_by(Message.created_at.asc())
    )
    fwd_msgs = result.scalars().all()
    out = [_to_out(m, user.id) for m in fwd_msgs]
    for m in fwd_msgs:
        await manager.broadcast(chat_id, {
            "type": "message_created",
            "message": _to_out(m, None).model_dump(mode="json"),
            "group_id": str(group_id),
        })
    return out


# DELETE bulk

@router.post('/{chat_id}/messages/delete/bulk', status_code=204)
async def delete_messages_bulk(
    chat_id: uuid.UUID,
    body: MessageBulkDelete,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    chat = await _require_chat_member(chat_id, user, db)

    if not body.message_ids:
        raise HTTPException(status_code=400, detail='No messages to delete')

    group = await db.get(Group, chat.group_id)
    is_owner = group and group.owner_id == user.id

    result = await db.execute(
        select(Message).where(Message.id.in_(body.message_ids), Message.chat_id == chat_id)
    )
    msgs = result.scalars().all()

    for msg in msgs:
        if msg.user_id != user.id and not is_owner and user.role != 'admin':
            raise HTTPException(
                status_code=403,
                detail=f'Cannot delete message {msg.id}',
            )

    deleted_ids: list[str] = []
    for msg in msgs:
        deleted_ids.append(str(msg.id))
        await db.delete(msg)

    await db.commit()
    await invalidate_messages(str(chat_id))

    for mid in deleted_ids:
        await manager.broadcast(chat_id, {
            "type": "message_deleted",
            "chat_id": str(chat_id),
            "message_id": mid,
        })


# PATCH edit

@router.patch('/{chat_id}/messages/{message_id}', response_model=MessageOut)
async def edit_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    body: MessageEdit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_chat_member(chat_id, user, db)

    result = await db.execute(
        select(Message)
        .where(Message.id == message_id, Message.chat_id == chat_id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail='Message not found')
    if msg.user_id != user.id:
        raise HTTPException(status_code=403, detail='Only the author can edit this message')
    if not body.content.strip():
        raise HTTPException(status_code=400, detail='Content cannot be empty')

    msg.content = body.content.strip()
    msg.is_edited = True
    await db.commit()
    await db.refresh(msg)
    await invalidate_messages(str(chat_id))
    msg_out = _to_out(msg, user.id)
    await manager.broadcast(chat_id, {
        "type": "message_edited",
        "message": _to_out(msg, None).model_dump(mode="json"),
    })
    return msg_out


# DELETE

@router.delete('/{chat_id}/messages/{message_id}', status_code=204)
async def delete_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    chat = await _require_chat_member(chat_id, user, db)
    result = await db.execute(
        select(Message).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail='Message not found')

    group = await db.get(Group, chat.group_id)
    is_owner = group and group.owner_id == user.id
    if msg.user_id != user.id and not is_owner and user.role != 'admin':
        raise HTTPException(status_code=403, detail='Cannot delete this message')

    await db.delete(msg)
    await db.commit()
    await invalidate_messages(str(chat_id))
    await manager.broadcast(chat_id, {
        "type": "message_deleted",
        "chat_id": str(chat_id),
        "message_id": str(message_id),
    })


# PIN / UNPIN

@router.post('/{chat_id}/messages/{message_id}/pin', response_model=MessageOut)
async def pin_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_chat_member(chat_id, user, db)
    user_id = user.id
    result = await db.execute(
        select(Message).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail='Message not found')
    msg.is_pinned = True
    await db.commit()
    await invalidate_messages(str(chat_id))
    # Reload with all relations
    result = await db.execute(
        select(Message).where(Message.id == message_id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
    )
    msg = result.scalar_one()
    msg_out = _to_out(msg, user_id)
    await manager.broadcast(chat_id, {
        "type": "message_edited",
        "message": _to_out(msg, None).model_dump(mode="json"),
    })
    return msg_out


@router.delete('/{chat_id}/messages/{message_id}/pin', response_model=MessageOut)
async def unpin_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_chat_member(chat_id, user, db)
    user_id = user.id
    result = await db.execute(
        select(Message).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail='Message not found')
    msg.is_pinned = False
    await db.commit()
    await invalidate_messages(str(chat_id))
    result = await db.execute(
        select(Message).where(Message.id == message_id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
    )
    msg = result.scalar_one()
    msg_out = _to_out(msg, user_id)
    await manager.broadcast(chat_id, {
        "type": "message_edited",
        "message": _to_out(msg, None).model_dump(mode="json"),
    })
    return msg_out


@router.get('/{chat_id}/pinned', response_model=list[MessageOut])
async def get_pinned_messages(
    chat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_chat_member(chat_id, user, db)
    result = await db.execute(
        select(Message)
        .where(Message.chat_id == chat_id, Message.is_pinned == True)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
        .order_by(Message.created_at.desc())
    )
    return [_to_out(m, user.id) for m in result.scalars().all()]



# PUT / DELETE reaction

from pydantic import BaseModel as _BaseModel, Field as _Field

class ReactionBody(_BaseModel):
    emoji: str = _Field(..., max_length=32)


@router.put('/{chat_id}/messages/{message_id}/reactions', response_model=MessageOut)
async def toggle_reaction(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    body: ReactionBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Toggle reaction: if user already reacted with same emoji — remove, otherwise set (replacing previous)."""
    await _require_chat_member(chat_id, user, db)

    # Проверяем что сообщение существует
    msg_result = await db.execute(
        select(Message).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    if not msg_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail='Message not found')

    # Ищем существующую реакцию пользователя
    existing = await db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == user.id,
        )
    )
    existing_reaction = existing.scalar_one_or_none()

    if existing_reaction:
        if existing_reaction.emoji == body.emoji:
            # Тот же эмодзи — убираем реакцию
            await db.delete(existing_reaction)
        else:
            # Другой эмодзи — меняем
            existing_reaction.emoji = body.emoji
    else:
        # Новая реакция
        db.add(MessageReaction(message_id=message_id, user_id=user.id, emoji=body.emoji))

    await db.commit()
    await invalidate_messages(str(chat_id))

    # Перезагружаем сообщение с relations
    result = await db.execute(
        select(Message).where(Message.id == message_id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
    )
    msg = result.scalar_one()
    msg_out = _to_out(msg, user.id)

    await manager.broadcast(chat_id, {
        "type": "message_edited",
        "message": _to_out(msg, None).model_dump(mode="json"),
    })
    return msg_out


# GET search

@router.get('/{chat_id}/messages/search', response_model=list[MessageOut])
async def search_messages(
    chat_id: uuid.UUID,
    q: str = Query(..., min_length=2, description='Поисковый запрос'),
    limit: int = Query(20, ge=1, le=50),
    before: datetime | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_chat_member(chat_id, user, db)

    stmt = (
        select(Message)
        .outerjoin(MessageAttachment, MessageAttachment.message_id == Message.id)
        .where(
            Message.chat_id == chat_id,
            or_(
                Message.content.ilike(f'%{q}%'),
                MessageAttachment.file_path.ilike(f'%{q}%'),
            ),
        )
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
        .order_by(Message.created_at.desc())
        .distinct()
        .limit(limit)
    )
    if before:
        stmt = stmt.where(Message.created_at < before)
    result = await db.execute(stmt)
    return [_to_out(m, user.id) for m in result.scalars().all()]


# GET media (вложения)

@router.get('/{chat_id}/media', response_model=list[MessageOut])
async def get_media(
    chat_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=100),
    before: datetime | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_chat_member(chat_id, user, db)

    # Сообщения у которых есть хотя бы одно вложение
    q = (
        select(Message)
        .where(Message.chat_id == chat_id)
        .join(MessageAttachment, MessageAttachment.message_id == Message.id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
        .order_by(Message.created_at.desc())
        .distinct()
        .limit(limit)
    )
    if before:
        q = q.where(Message.created_at < before)

    result = await db.execute(q)
    return [_to_out(m, user.id) for m in result.scalars().all()]


# GET links (ссылки из текста сообщений)

@router.get('/{chat_id}/links', response_model=list[MessageOut])
async def get_links(
    chat_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=100),
    before: datetime | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_chat_member(chat_id, user, db)

    # Сообщения содержащие http:// или https://
    q = (
        select(Message)
        .where(Message.chat_id == chat_id, Message.content.ilike('%http%'))
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
        )
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    if before:
        q = q.where(Message.created_at < before)

    result = await db.execute(q)
    msgs = result.scalars().all()

    # Оставляем только те, где regex реально находит ссылку
    def has_url(m: Message) -> bool:
        return bool(m.content and URL_RE.search(m.content))

    return [_to_out(m, user.id) for m in msgs if has_url(m)]
