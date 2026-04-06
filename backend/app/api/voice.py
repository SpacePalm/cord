import logging
import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from livekit.api import AccessToken, VideoGrants, LiveKitAPI, ListParticipantsRequest

from app.auth import get_current_user
from app.database import get_db
from app.models.user import User
from app.models.group import Chat, GroupMember
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


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

    return {
        "token": token.to_jwt(),
        "url": settings.livekit_public_url,
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
