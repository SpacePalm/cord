
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

    file_path = MEDIA_ROOT / 'messages' / str(message_id) / filename
    exists = await asyncio.to_thread(file_path.exists)
    if not exists:
        raise HTTPException(status_code=404, detail='File not found')

    return FileResponse(path=file_path, filename=filename, media_type=None)
