import logging
import time
import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from livekit.api import AccessToken, VideoGrants, LiveKitAPI, ListParticipantsRequest

from sqlalchemy import select as sa_select

from app.auth import get_current_user
from app.database import get_db
from app.models.user import User
from app.models.group import Chat, GroupMember
from app.config import settings
from app.cache import get_call_started, set_call_started, clear_call_started
from app.ws_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


async def _broadcast_voice_participants(
    channel_id: str, db: AsyncSession,
):
    """Fetch current participants from LiveKit and broadcast to all group members via WS."""
    room_name = str(channel_id)
    chat = await db.get(Chat, _uuid.UUID(channel_id))
    if not chat:
        return

    # Get participants from LiveKit
    participants = []
    async with LiveKitAPI(
        url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    ) as lk:
        try:
            resp = await lk.room.list_participants(
                ListParticipantsRequest(room=room_name)
            )
            user_ids = [_uuid.UUID(p.identity) for p in resp.participants if p.identity]
            users_map: dict[str, str] = {}
            if user_ids:
                rows = await db.execute(
                    sa_select(User.id, User.image_path).where(User.id.in_(user_ids))
                )
                users_map = {str(r.id): r.image_path or "" for r in rows}
            participants = [
                {
                    "identity": p.identity,
                    "name": p.name or p.identity,
                    "image_path": users_map.get(p.identity, ""),
                }
                for p in resp.participants
            ]
        except Exception as e:
            logger.warning("Failed to fetch participants for broadcast: %s", e)
            return

    # Broadcast to all chats in the group
    group_chats = await db.execute(
        sa_select(Chat.id).where(Chat.group_id == chat.group_id)
    )
    chat_ids = [row[0] for row in group_chats.all()]
    await manager.broadcast_to_many(chat_ids, {
        "type": "voice_participants",
        "channel_id": channel_id,
        "participants": participants,
    })


@router.post("/token")
async def get_voice_token(
    channel_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Генерирует LiveKit токен для подключения к голосовому каналу."""

    # Проверяем что канал существует и является голосовым
    chat = await db.get(Chat, _uuid.UUID(channel_id))
    if not chat or chat.type != "voice":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice channel not found")

    # Проверяем что пользователь состоит в группе
    member = await db.get(GroupMember, (chat.group_id, user.id))
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this group")

    # Имя комнаты = ID канала (уникально)
    room_name = str(channel_id)

    import json
    token = (
        AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(str(user.id))
        .with_name(user.display_name or user.username)
        .with_metadata(json.dumps({"image_path": user.image_path or ""}))
        .with_grants(VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
        ))
    )

    # Инициализируем время старта конференции (NX — только если ещё нет)
    now_ms = int(time.time() * 1000)
    await set_call_started(channel_id, now_ms)
    call_started = await get_call_started(channel_id) or now_ms

    # Broadcast updated participant list to group (slight delay for LiveKit to register)
    import asyncio
    async def _delayed_broadcast():
        await asyncio.sleep(2)
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as bg_db:
            await _broadcast_voice_participants(channel_id, bg_db)
    asyncio.create_task(_delayed_broadcast())

    return {
        "token": token.to_jwt(),
        "url": settings.livekit_public_url,
        "call_started_at": call_started,
    }


@router.get("/participants")
async def list_participants(
    channel_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список участников голосового канала."""

    chat = await db.get(Chat, _uuid.UUID(channel_id))
    if not chat or chat.type != "voice":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice channel not found")

    member = await db.get(GroupMember, (chat.group_id, user.id))
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this group")

    room_name = str(channel_id)

    async with LiveKitAPI(
        url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    ) as lk:
        try:
            resp = await lk.room.list_participants(
                ListParticipantsRequest(room=room_name)
            )
        except Exception as e:
            logger.warning("Failed to list participants for room %s: %s", room_name, e)
            return []

    # Подтягиваем аватарки из БД
    user_ids = [_uuid.UUID(p.identity) for p in resp.participants if p.identity]
    users_map: dict[str, str] = {}
    if user_ids:
        from sqlalchemy import select
        rows = await db.execute(
            select(User.id, User.image_path).where(User.id.in_(user_ids))
        )
        users_map = {str(r.id): r.image_path or "" for r in rows}

    return [
        {
            "identity": p.identity,
            "name": p.name or p.identity,
            "image_path": users_map.get(p.identity, ""),
        }
        for p in resp.participants
    ]


@router.post("/leave")
async def leave_voice(
    channel_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Вызывается при выходе из канала. Если комната пуста — сбрасывает таймер."""

    chat = await db.get(Chat, _uuid.UUID(channel_id))
    if not chat or chat.type != "voice":
        return {"ok": True}

    room_name = str(channel_id)
    participant_count = 0

    async with LiveKitAPI(
        url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    ) as lk:
        try:
            resp = await lk.room.list_participants(
                ListParticipantsRequest(room=room_name)
            )
            # -1 потому что текущий пользователь ещё может числиться
            participant_count = len([
                p for p in resp.participants if p.identity != str(user.id)
            ])
        except Exception as e:
            logger.warning("Failed to check room %s on leave: %s", room_name, e)

    if participant_count == 0:
        await clear_call_started(channel_id)

    await _broadcast_voice_participants(channel_id, db)
    return {"ok": True}
