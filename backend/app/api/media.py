
import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.message import Message
from app.models.group import Chat, GroupMember

router = APIRouter(prefix='/api/media', tags=['media'])

MEDIA_ROOT = Path('/app/media')


@router.get('/messages/{message_id}/{filename}')
async def serve_message_file(
    message_id: uuid.UUID,
    filename: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg_result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    msg = msg_result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail='Message not found')

    chat = await db.get(Chat, msg.chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail='Chat not found')

    member_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == chat.group_id,
            GroupMember.user_id == user.id,
        )
    )
    if not member_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail='Not a member of this group')

    # Защита от path traversal: нормализуем путь и проверяем что он внутри
    # подкаталога именно этого message_id. Без этого filename типа '..%2Fescape'
    # (URL-декодируется в `../escape`) мог бы вывести за пределы директории
    # сообщения в соседнее message или даже выше.
    message_dir = (MEDIA_ROOT / 'messages' / str(message_id)).resolve()
    try:
        file_path = (message_dir / filename).resolve()
    except (ValueError, OSError):
        raise HTTPException(status_code=400, detail='Invalid filename')

    if not str(file_path).startswith(str(message_dir) + '/') and file_path != message_dir:
        raise HTTPException(status_code=400, detail='Invalid filename')

    exists = await asyncio.to_thread(file_path.exists)
    if not exists or not file_path.is_file():
        raise HTTPException(status_code=404, detail='File not found')

    return FileResponse(path=file_path, filename=file_path.name, media_type=None)
