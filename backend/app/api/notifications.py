"""
Эндпоинты для уведомлений о непрочитанных сообщениях.

  POST /api/chats/{chat_id}/read   — отметить чат как прочитанный
  GET  /api/chats/unread           — количество непрочитанных сообщений по чатам
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from sqlalchemy.dialects.postgresql import insert

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.group import Chat, GroupMember
from app.models.message import Message
from app.models.user_chat_state import UserChatState

router = APIRouter(prefix='/api/chats', tags=['notifications'])


@router.post('/{chat_id}/read', status_code=204)
async def mark_chat_read(
    chat_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark chat as read for the current user."""
    # Verify chat exists before inserting
    chat = await db.get(Chat, chat_id)
    if not chat:
        return Response(status_code=204)

    user_id = user.id  # cache before commit expires the ORM object
    stmt = insert(UserChatState).values(
        user_id=user_id,
        chat_id=chat_id,
        last_read_at=func.now(),
    ).on_conflict_do_update(
        index_elements=['user_id', 'chat_id'],
        set_={'last_read_at': func.now()},
    )
    await db.execute(stmt)
    await db.commit()
    from app.cache import invalidate_unread
    await invalidate_unread(str(user_id))
    return Response(status_code=204)


@router.get('/unread')
async def get_unread_counts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Количество непрочитанных сообщений по всем чатам пользователя (кэш Redis 5 сек)."""
    from app.cache import get_cached_unread, set_cached_unread

    user_id = str(user.id)

    # Пробуем кэш
    cached = await get_cached_unread(user_id)
    if cached is not None:
        return cached

    # Считаем из БД
    user_groups = (
        select(GroupMember.group_id)
        .where(GroupMember.user_id == user.id)
        .subquery()
    )

    chats = (
        select(Chat.id.label('chat_id'), Chat.group_id)
        .where(Chat.group_id.in_(select(user_groups.c.group_id)))
        .subquery()
    )

    epoch = datetime(1970, 1, 1)
    stmt = (
        select(
            chats.c.chat_id,
            chats.c.group_id,
            func.count(Message.id).label('count'),
        )
        .select_from(chats)
        .outerjoin(
            UserChatState,
            (UserChatState.chat_id == chats.c.chat_id)
            & (UserChatState.user_id == user.id),
        )
        .outerjoin(
            Message,
            (Message.chat_id == chats.c.chat_id)
            & (Message.created_at > func.coalesce(UserChatState.last_read_at, epoch)),
        )
        .group_by(chats.c.chat_id, chats.c.group_id)
        .having(func.count(Message.id) > 0)
    )

    rows = await db.execute(stmt)
    unread = {}
    for row in rows:
        unread[str(row.chat_id)] = {
            'count': row.count,
            'group_id': str(row.group_id),
        }

    result = {'unread': unread}
    await set_cached_unread(user_id, result)
    return result
