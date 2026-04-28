"""
Личные закладки сообщений.

  POST   /api/messages/{id}/bookmark   — добавить
  DELETE /api/messages/{id}/bookmark   — убрать
  GET    /api/me/bookmarks             — глобальный список (пагинация по created_at desc)
  GET    /api/chats/{id}/bookmarks     — id закладок в чате (для иконки на сообщении)

В отличие от пинов закладки приватные: каждый пользователь имеет свой набор.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.group import Chat, GroupMember
from app.models.message import Message, MessageReaction
from app.models.bookmark import MessageBookmark
from app.models.poll import Poll
from app.schemas.message import MessageOut


message_bookmarks_router = APIRouter(prefix='/api/messages', tags=['bookmarks'])
me_bookmarks_router = APIRouter(prefix='/api/me', tags=['bookmarks'])
chat_bookmarks_router = APIRouter(prefix='/api/chats', tags=['bookmarks'])


async def _ensure_message_visible(message_id: uuid.UUID, user: User, db: AsyncSession) -> Message:
    """Проверка, что пользователь имеет доступ к сообщению (через членство в группе)."""
    msg = await db.get(Message, message_id, options=[
        selectinload(Message.attachments),
        selectinload(Message.reactions),
        selectinload(Message.author),
    ])
    if not msg:
        raise HTTPException(status_code=404, detail='Message not found')
    chat = await db.get(Chat, msg.chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail='Chat not found')
    is_member = await db.scalar(
        select(GroupMember).where(
            GroupMember.group_id == chat.group_id,
            GroupMember.user_id == user.id,
        )
    )
    if not is_member:
        raise HTTPException(status_code=403, detail='Not a member of this group')
    return msg


@message_bookmarks_router.post('/{message_id}/bookmark', status_code=204)
async def add_bookmark(
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _ensure_message_visible(message_id, user, db)
    # Идемпотентно: повторный POST не падает.
    stmt = pg_insert(MessageBookmark).values(
        user_id=user.id, message_id=message_id,
    ).on_conflict_do_nothing(index_elements=['user_id', 'message_id'])
    await db.execute(stmt)
    await db.commit()


@message_bookmarks_router.delete('/{message_id}/bookmark', status_code=204)
async def remove_bookmark(
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await db.execute(
        delete(MessageBookmark).where(
            MessageBookmark.user_id == user.id,
            MessageBookmark.message_id == message_id,
        )
    )
    await db.commit()


class BookmarkChatInfo(BaseModel):
    id: uuid.UUID
    name: str
    group_id: uuid.UUID


class BookmarkOut(BaseModel):
    bookmarked_at: datetime
    message: MessageOut
    chat: BookmarkChatInfo


@me_bookmarks_router.get('/bookmarks', response_model=list[BookmarkOut])
async def list_my_bookmarks(
    before: datetime | None = Query(None, description='cursor: вернуть закладки старше этого момента'),
    limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Список закладок пользователя в обратном хронологическом порядке.

    Пагинация курсором по `created_at` (поле bookmarked_at в ответе).
    Сообщения загружаются вместе с базовыми связями для рендеринга.
    """
    from app.api.messages import _to_out  # отложенный импорт — избегаем циклической зависимости

    # У MessageBookmark нет ORM-связи с Message, поэтому грузим в два шага.
    stmt = (
        select(MessageBookmark)
        .where(MessageBookmark.user_id == user.id)
        .order_by(MessageBookmark.created_at.desc())
        .limit(limit)
    )
    if before:
        stmt = stmt.where(MessageBookmark.created_at < before)

    bookmarks = (await db.execute(stmt)).scalars().all()
    if not bookmarks:
        return []

    msg_ids = [b.message_id for b in bookmarks]
    msgs_stmt = (
        select(Message)
        .where(Message.id.in_(msg_ids))
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions).selectinload(MessageReaction.user),
            selectinload(Message.poll).selectinload(Poll.options),
        )
    )
    msgs = (await db.execute(msgs_stmt)).scalars().all()
    msg_by_id = {m.id: m for m in msgs}

    # Тащим имена и group_id чатов одним запросом.
    chat_ids = list({m.chat_id for m in msgs})
    chats_stmt = select(Chat).where(Chat.id.in_(chat_ids))
    chat_by_id = {c.id: c for c in (await db.execute(chats_stmt)).scalars().all()}

    out: list[BookmarkOut] = []
    for b in bookmarks:
        m = msg_by_id.get(b.message_id)
        if not m:
            continue  # сообщение удалено — закладка повиснет до явной чистки
        chat = chat_by_id.get(m.chat_id)
        if not chat:
            continue
        out.append(BookmarkOut(
            bookmarked_at=b.created_at,
            message=_to_out(m, user.id),
            chat=BookmarkChatInfo(id=chat.id, name=chat.name, group_id=chat.group_id),
        ))
    return out


@chat_bookmarks_router.get('/{chat_id}/bookmarks', response_model=list[uuid.UUID])
async def list_chat_bookmark_ids(
    chat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """ID сообщений из текущего чата, которые пользователь добавил в закладки.

    Лёгкий эндпоинт: фронт зовёт его при открытии чата, чтобы знать какие
    сообщения подсветить иконкой ⭐.
    """
    chat = await db.get(Chat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail='Chat not found')
    is_member = await db.scalar(
        select(GroupMember).where(
            GroupMember.group_id == chat.group_id,
            GroupMember.user_id == user.id,
        )
    )
    if not is_member:
        raise HTTPException(status_code=403, detail='Not a member of this group')

    stmt = (
        select(MessageBookmark.message_id)
        .join(Message, Message.id == MessageBookmark.message_id)
        .where(
            MessageBookmark.user_id == user.id,
            Message.chat_id == chat_id,
        )
    )
    return [row[0] for row in (await db.execute(stmt)).all()]
