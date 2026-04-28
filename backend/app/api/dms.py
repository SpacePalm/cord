"""
Direct Messages — личная переписка 1-к-1.

Реализованы как Group с флагом is_dm=true: 2 участника в GroupMember,
один text Chat, опционально voice Chat (создаётся по запросу на звонок).

Эндпоинты:
  POST /api/dms/with/{user_id}  — открыть или создать DM с пользователем (идемпотентно)
  GET  /api/dms                 — список моих DM с последним сообщением и непрочитанным
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import and_, func as sa_func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.cache import get_online_user_ids
from app.database import get_db
from app.models.group import Chat, Group, GroupMember
from app.models.message import Message
from app.models.user import User
from app.models.user_chat_state import UserChatState
from app.ws_manager import manager

router = APIRouter(prefix='/api/dms', tags=['dms'])


class DMPeer(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str
    display_name: str
    image_path: str = ''
    # Выбранный пользователем статус: online/idle/dnd/invisible
    status: str = 'online'
    # Фактическое наличие в сети (heartbeat в Redis последние 2 минуты).
    # В UI серую точку показываем когда is_online=false ИЛИ status='invisible'.
    is_online: bool = False


class DMOut(BaseModel):
    """Одна DM-беседа для списка в сайдбаре."""
    group_id: uuid.UUID
    chat_id: uuid.UUID
    peer: DMPeer
    last_message: str | None
    last_message_at: datetime | None
    unread_count: int


class DMOpenResponse(BaseModel):
    """Ответ на «открыть DM» — достаточно для перехода в чат."""
    group_id: uuid.UUID
    chat_id: uuid.UUID
    peer: DMPeer
    is_new: bool


async def _find_dm_between(db: AsyncSession, user_a: uuid.UUID, user_b: uuid.UUID) -> Group | None:
    """
    Ищет существующую DM-группу между двумя пользователями.
    Критерий: is_dm=true AND оба user_id присутствуют в group_member.
    """
    # Подзапрос: группы, где состоит user_a
    ma = select(GroupMember.group_id).where(GroupMember.user_id == user_a)
    # Подзапрос: группы, где состоит user_b
    mb = select(GroupMember.group_id).where(GroupMember.user_id == user_b)

    stmt = (
        select(Group)
        .where(
            Group.is_dm.is_(True),
            Group.id.in_(ma),
            Group.id.in_(mb),
        )
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


def _peer_from_user(u: User, is_online: bool = False) -> DMPeer:
    return DMPeer(
        id=u.id,
        username=u.username,
        display_name=u.display_name or u.username,
        image_path=u.image_path or '',
        status=u.status or 'online',
        is_online=is_online,
    )


@router.post('/with/{user_id}', response_model=DMOpenResponse)
async def open_or_create_dm(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Открывает DM с заданным пользователем. Если DM уже существует — возвращает её.
    Иначе создаёт Group(is_dm=true) с двумя GroupMember'ами и одним text Chat.
    Идемпотентно: повторный вызов от того же инициатора не плодит дубликаты.
    """
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail='Cannot open DM with yourself')

    peer = await db.get(User, user_id)
    if not peer or not peer.is_active:
        raise HTTPException(status_code=404, detail='User not found')

    # Снимаем значения до любых commit/flush — ORM-объект станет expired и
    # lazy-load атрибутов в async-сессии не сработает (MissingGreenlet).
    peer_id = peer.id
    peer_username = peer.username
    peer_display_name = peer.display_name or peer.username
    peer_image_path = peer.image_path or ''
    peer_status = peer.status or 'online'
    caller_username = current_user.username
    caller_id = current_user.id

    peer_is_online = str(peer_id) in (await get_online_user_ids([str(peer_id)]))

    def _mk_peer() -> DMPeer:
        return DMPeer(
            id=peer_id,
            username=peer_username,
            display_name=peer_display_name,
            image_path=peer_image_path,
            status=peer_status,
            is_online=peer_is_online,
        )

    # Идемпотентность: проверяем существующую DM
    existing = await _find_dm_between(db, caller_id, user_id)
    if existing:
        existing_id = existing.id
        text_chat = (await db.execute(
            select(Chat).where(Chat.group_id == existing_id, Chat.type == 'text').limit(1)
        )).scalar_one_or_none()
        if not text_chat:
            # Aномалия: DM-группа без text-чата. Восстанавливаем.
            text_chat = Chat(name='direct', group_id=existing_id, type='text')
            db.add(text_chat)
            await db.commit()
            await db.refresh(text_chat)
        return DMOpenResponse(
            group_id=existing_id,
            chat_id=text_chat.id,
            peer=_mk_peer(),
            is_new=False,
        )

    # Создаём новую DM-группу
    # Владельцем ставим инициатора (формально — у DM нет понятия владельца, но поле обязательное).
    dm_group = Group(
        name=f'DM: {caller_username} ↔ {peer_username}',
        owner_id=caller_id,
        image_path='',
        is_personal=False,
        is_dm=True,
    )
    db.add(dm_group)
    await db.flush()

    db.add(GroupMember(group_id=dm_group.id, user_id=caller_id, role='member'))
    db.add(GroupMember(group_id=dm_group.id, user_id=peer_id, role='member'))

    text_chat = Chat(name='direct', group_id=dm_group.id, type='text')
    db.add(text_chat)
    # Снимаем id до commit — после commit ORM-объект станет expired.
    dm_group_id = dm_group.id
    await db.commit()
    await db.refresh(text_chat)

    return DMOpenResponse(
        group_id=dm_group_id,
        chat_id=text_chat.id,
        peer=_mk_peer(),
        is_new=True,
    )


@router.get('', response_model=list[DMOut])
async def list_my_dms(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Список всех DM текущего пользователя с:
    — данными собеседника
    — последним сообщением (контент + дата)
    — счётчиком непрочитанных
    Сортировка: по last_message_at DESC, без сообщений — по created_at группы.
    """
    # Все мои DM-группы
    my_dm_groups = (
        select(Group.id)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(Group.is_dm.is_(True), GroupMember.user_id == current_user.id)
    )

    # Для каждой DM-группы: собеседник, text-чат, последнее сообщение, unread
    # Собеседник = член группы, не я
    peers_stmt = (
        select(GroupMember.group_id, User)
        .join(User, User.id == GroupMember.user_id)
        .where(
            GroupMember.group_id.in_(my_dm_groups),
            GroupMember.user_id != current_user.id,
        )
    )
    peers_by_group: dict[uuid.UUID, User] = {}
    for row in (await db.execute(peers_stmt)).all():
        peers_by_group[row.group_id] = row.User

    # Text-чат каждой DM-группы
    chats_stmt = (
        select(Chat).where(
            Chat.group_id.in_(my_dm_groups),
            Chat.type == 'text',
        )
    )
    text_chats: dict[uuid.UUID, Chat] = {
        c.group_id: c for c in (await db.execute(chats_stmt)).scalars().all()
    }

    # Для каждого text-чата — последнее сообщение
    chat_ids = [c.id for c in text_chats.values()]
    last_msg_by_chat: dict[uuid.UUID, Message] = {}
    if chat_ids:
        # Получаем id последнего сообщения для каждого чата через оконный подзапрос
        row_number = sa_func.row_number().over(
            partition_by=Message.chat_id,
            order_by=Message.created_at.desc(),
        ).label('rn')
        ranked = (
            select(Message, row_number)
            .where(Message.chat_id.in_(chat_ids))
            .subquery()
        )
        # SQLAlchemy не позволяет select(Message) из subquery напрямую — выбираем aliased
        from sqlalchemy.orm import aliased
        M = aliased(Message, ranked)
        last_stmt = select(M).where(ranked.c.rn == 1)
        for m in (await db.execute(last_stmt)).scalars().all():
            last_msg_by_chat[m.chat_id] = m

    # Unread-статус пользователя по этим чатам
    ucs_stmt = (
        select(UserChatState).where(
            UserChatState.user_id == current_user.id,
            UserChatState.chat_id.in_(chat_ids or [uuid.UUID(int=0)]),
        )
    )
    ucs_map: dict[uuid.UUID, UserChatState] = {
        s.chat_id: s for s in (await db.execute(ucs_stmt)).scalars().all()
    }

    # Счётчик непрочитанных на чат
    unread_counts: dict[uuid.UUID, int] = {}
    if chat_ids:
        epoch = datetime(1970, 1, 1)
        # Точный подсчёт с учётом last_read_at:
        for cid in chat_ids:
            last_read = ucs_map.get(cid).last_read_at if cid in ucs_map else epoch
            last_read = last_read or epoch
            r = await db.execute(
                select(sa_func.count(Message.id))
                .where(
                    Message.chat_id == cid,
                    Message.created_at > last_read,
                    Message.user_id != current_user.id,  # свои сообщения не непрочитанные
                )
            )
            unread_counts[cid] = r.scalar() or 0

    # Реальный онлайн-статус всех собеседников одним запросом в Redis
    peer_ids = [str(p.id) for p in peers_by_group.values()]
    online_ids = await get_online_user_ids(peer_ids) if peer_ids else set()

    # Сборка результата
    out: list[DMOut] = []
    for group_id, peer in peers_by_group.items():
        chat = text_chats.get(group_id)
        if not chat:
            continue
        last_msg = last_msg_by_chat.get(chat.id)
        out.append(DMOut(
            group_id=group_id,
            chat_id=chat.id,
            peer=_peer_from_user(peer, is_online=str(peer.id) in online_ids),
            last_message=(last_msg.content[:100] if last_msg and last_msg.content else None),
            last_message_at=last_msg.created_at if last_msg else None,
            unread_count=unread_counts.get(chat.id, 0),
        ))

    # Сортировка: с активностью — по времени последнего, без — просто в конец.
    # datetime.min — naive, а last_message_at приходит из БД как aware (timestamptz).
    # Прямое сравнение naive↔aware кидает TypeError, поэтому fallback тоже делаем aware.
    _EPOCH = datetime.min.replace(tzinfo=timezone.utc)
    out.sort(key=lambda d: (d.last_message_at or _EPOCH), reverse=True)
    return out


class DMCallResponse(BaseModel):
    """Данные для старта voice-сессии в DM."""
    voice_chat_id: uuid.UUID
    peer: DMPeer


@router.post('/{group_id}/call', response_model=DMCallResponse)
async def initiate_dm_call(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Инициирует звонок в DM: создаёт voice-чат в DM-группе если его нет,
    шлёт собеседнику WebSocket-событие 'incoming_call' для показа уведомления.
    Клиент далее открывает voice-канал обычным способом через /api/voice/token.
    """
    group = await db.get(Group, group_id)
    if not group or not group.is_dm:
        raise HTTPException(status_code=404, detail='DM not found')

    # Права: я должен быть участником
    my_membership = (await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == current_user.id,
        )
    )).scalar_one_or_none()
    if not my_membership:
        raise HTTPException(status_code=403, detail='Not a member of this DM')

    # Собеседник
    peer_row = (await db.execute(
        select(User)
        .join(GroupMember, GroupMember.user_id == User.id)
        .where(
            GroupMember.group_id == group_id,
            GroupMember.user_id != current_user.id,
        )
    )).scalar_one_or_none()
    if not peer_row:
        raise HTTPException(status_code=404, detail='DM peer not found')

    # Сохраняем всё что понадобится после commit в локальные переменные —
    # после commit ORM-объекты "expire", доступ к их атрибутам вызовет ленивый
    # запрос к БД в уже завершённой транзакции (MissingGreenlet).
    peer_id = peer_row.id
    peer_username = peer_row.username
    peer_display_name = peer_row.display_name or peer_row.username
    peer_image_path = peer_row.image_path or ''
    peer_status = peer_row.status or 'online'
    caller_id = current_user.id
    caller_username = current_user.username
    caller_display_name = current_user.display_name or current_user.username
    caller_image_path = current_user.image_path or ''

    # Voice-чат создаём лениво — только когда реально звонят
    voice_chat = (await db.execute(
        select(Chat).where(Chat.group_id == group_id, Chat.type == 'voice')
    )).scalar_one_or_none()
    if not voice_chat:
        voice_chat = Chat(name='call', group_id=group_id, type='voice')
        db.add(voice_chat)
        await db.commit()
        await db.refresh(voice_chat)
        # Подписываем обоих на новый чат в WS-менеджере, чтобы voice_participants events приходили
        manager.subscribe_all_members(voice_chat.id, [caller_id, peer_id])

    voice_chat_id = voice_chat.id

    # Шлём WS-событие конкретному получателю — личная доставка
    await manager.send_to_user(peer_id, {
        'type': 'incoming_call',
        'group_id': str(group_id),
        'voice_chat_id': str(voice_chat_id),
        'caller': {
            'id': str(caller_id),
            'username': caller_username,
            'display_name': caller_display_name,
            'image_path': caller_image_path,
        },
    })

    peer_online = str(peer_id) in (await get_online_user_ids([str(peer_id)]))
    return DMCallResponse(
        voice_chat_id=voice_chat_id,
        peer=DMPeer(
            id=peer_id,
            username=peer_username,
            display_name=peer_display_name,
            image_path=peer_image_path,
            status=peer_status,
            is_online=peer_online,
        ),
    )


@router.post('/{group_id}/call/cancel', status_code=204)
async def cancel_dm_call(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Отменить исходящий звонок (caller передумал / повесил трубку до того как
    собеседник принял). Шлёт собеседнику WS-событие `call_cancelled`, чтобы
    у него остановился рингтон и пропал оверлей входящего.
    """
    group = await db.get(Group, group_id)
    if not group or not group.is_dm:
        raise HTTPException(status_code=404, detail='DM not found')

    mine = (await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == current_user.id,
        )
    )).scalar_one_or_none()
    if not mine:
        raise HTTPException(status_code=403, detail='Not a member of this DM')

    other = (await db.execute(
        select(GroupMember.user_id).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id != current_user.id,
        )
    )).scalar_one_or_none()
    if not other:
        return

    caller_id = current_user.id
    caller_username = current_user.username
    caller_display_name = current_user.display_name or current_user.username

    await manager.send_to_user(other, {
        'type': 'call_cancelled',
        'group_id': str(group_id),
        'caller': {
            'id': str(caller_id),
            'username': caller_username,
            'display_name': caller_display_name,
        },
    })


@router.post('/{group_id}/call/decline', status_code=204)
async def decline_dm_call(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Отклонить входящий звонок — уведомляет инициатора WS-событием `call_declined`,
    чтобы он мог покинуть LiveKit-комнату и показать "собеседник отклонил".
    """
    group = await db.get(Group, group_id)
    if not group or not group.is_dm:
        raise HTTPException(status_code=404, detail='DM not found')

    # Я должен быть участником
    mine = (await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == current_user.id,
        )
    )).scalar_one_or_none()
    if not mine:
        raise HTTPException(status_code=403, detail='Not a member of this DM')

    # Найти «другого» участника (инициатора звонка)
    other = (await db.execute(
        select(GroupMember.user_id).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id != current_user.id,
        )
    )).scalar_one_or_none()
    if not other:
        return  # некому слать — молча ок

    # Снимаем поля до любых await с зависимостями user
    decliner_id = current_user.id
    decliner_username = current_user.username
    decliner_display_name = current_user.display_name or current_user.username

    await manager.send_to_user(other, {
        'type': 'call_declined',
        'group_id': str(group_id),
        'decliner': {
            'id': str(decliner_id),
            'username': decliner_username,
            'display_name': decliner_display_name,
        },
    })
