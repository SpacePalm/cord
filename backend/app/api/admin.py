"""
Admin-only endpoints.
All endpoints require role == 'admin'.

GET  /api/admin/settings              — get app settings
PATCH /api/admin/settings             — update settings
GET  /api/admin/users                 — list all users (search ?q=)
PATCH /api/admin/users/{id}           — update user (role, is_active)
DELETE /api/admin/users/{id}          — delete user
GET  /api/admin/groups                — list all groups with stats
DELETE /api/admin/groups/{id}         — delete group
GET  /api/admin/groups/{id}/members   — list group members
DELETE /api/admin/groups/{id}/members/{uid} — kick member
GET  /api/admin/stats                 — disk + db stats
POST /api/admin/cleanup/messages      — delete old messages
POST /api/admin/cleanup/attachments   — delete orphaned files
"""

import os
from pathlib import Path
from datetime import datetime, timedelta, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete as sa_delete
from typing import Optional

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.group import Group, Chat, GroupMember
from app.models.message import Message, MessageAttachment
from app.models.app_settings import AppSetting

router = APIRouter(prefix='/api/admin', tags=['admin'])


async def _require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != 'admin':
        raise HTTPException(status_code=403, detail='Admin access required')
    return user


# Schemas

class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str
    display_name: str
    email: str
    role: str
    is_active: bool
    image_path: str
    created_at: datetime


class AdminUserUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None


class AdminGroupOut(BaseModel):
    id: uuid.UUID
    name: str
    owner_id: uuid.UUID
    owner_username: str
    image_path: str
    member_count: int
    channel_count: int
    created_at: datetime


class AdminMemberOut(BaseModel):
    user_id: uuid.UUID
    username: str
    display_name: str
    image_path: str
    joined_at: datetime


class AppSettingsOut(BaseModel):
    registration_enabled: bool


class AppSettingsUpdate(BaseModel):
    registration_enabled: Optional[bool] = None


class CleanupMessagesBody(BaseModel):
    days: int = 30  # delete messages older than N days


# Helpers

def _dir_size(path: Path) -> int:
    return sum(f.stat().st_size for f in path.rglob('*') if f.is_file()) if path.exists() else 0


# Settings endpoints

@router.get('/settings', response_model=AppSettingsOut)
async def get_settings(
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AppSetting).where(AppSetting.key == 'registration_enabled'))
    setting = result.scalar_one_or_none()
    enabled = True
    if setting is not None:
        enabled = setting.value != 'false'
    return AppSettingsOut(registration_enabled=enabled)


@router.patch('/settings', response_model=AppSettingsOut)
async def update_settings(
    body: AppSettingsUpdate,
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    if body.registration_enabled is not None:
        result = await db.execute(select(AppSetting).where(AppSetting.key == 'registration_enabled'))
        setting = result.scalar_one_or_none()
        if setting:
            setting.value = 'true' if body.registration_enabled else 'false'
        else:
            db.add(AppSetting(key='registration_enabled', value='true' if body.registration_enabled else 'false'))
        await db.commit()

    result = await db.execute(select(AppSetting).where(AppSetting.key == 'registration_enabled'))
    setting = result.scalar_one_or_none()
    enabled = True
    if setting is not None:
        enabled = setting.value != 'false'
    return AppSettingsOut(registration_enabled=enabled)


# Users endpoints

@router.get('/users', response_model=list[AdminUserOut])
async def list_users(
    q: Optional[str] = None,
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(User)
    if q:
        pattern = f'%{q}%'
        stmt = stmt.where(
            (User.username.ilike(pattern)) | (User.email.ilike(pattern))
        )
    stmt = stmt.order_by(User.created_at.desc())
    result = await db.execute(stmt)
    users = result.scalars().all()
    return [AdminUserOut.model_validate(u) for u in users]


@router.patch('/users/{user_id}', response_model=AdminUserOut)
async def update_user(
    user_id: uuid.UUID,
    body: AdminUserUpdate,
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail='User not found')

    # Cannot change own role or deactivate self
    if user.id == admin.id:
        if body.role is not None:
            raise HTTPException(status_code=400, detail='Cannot change your own role')
        if body.is_active is not None and not body.is_active:
            raise HTTPException(status_code=400, detail='Cannot deactivate yourself')

    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active

    await db.commit()
    await db.refresh(user)
    return AdminUserOut.model_validate(user)


@router.delete('/users/{user_id}', status_code=204)
async def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail='Cannot delete yourself')

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail='User not found')

    await db.delete(user)
    await db.commit()


# Groups endpoints

@router.get('/groups', response_model=list[AdminGroupOut])
async def list_groups(
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Get all groups with owner username, member count, channel count
    result = await db.execute(select(Group))
    groups = result.scalars().all()

    out = []
    for group in groups:
        # Owner username
        owner_result = await db.execute(select(User).where(User.id == group.owner_id))
        owner = owner_result.scalar_one_or_none()
        owner_username = owner.username if owner else 'unknown'

        # Member count
        member_count_result = await db.execute(
            select(func.count()).select_from(GroupMember).where(GroupMember.group_id == group.id)
        )
        member_count = member_count_result.scalar() or 0

        # Channel count
        channel_count_result = await db.execute(
            select(func.count()).select_from(Chat).where(Chat.group_id == group.id)
        )
        channel_count = channel_count_result.scalar() or 0

        out.append(AdminGroupOut(
            id=group.id,
            name=group.name,
            owner_id=group.owner_id,
            owner_username=owner_username,
            image_path=group.image_path or '',
            member_count=member_count,
            channel_count=channel_count,
            created_at=group.created_at,
        ))

    return out


@router.delete('/groups/{group_id}', status_code=204)
async def delete_group(
    group_id: uuid.UUID,
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail='Group not found')

    await db.delete(group)
    await db.commit()


@router.get('/groups/{group_id}/members', response_model=list[AdminMemberOut])
async def list_group_members(
    group_id: uuid.UUID,
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group_id)
    )
    rows = result.all()

    out = []
    for member, user in rows:
        out.append(AdminMemberOut(
            user_id=user.id,
            username=user.username,
            display_name=user.display_name,
            image_path=user.image_path or '',
            joined_at=member.joined_at,
        ))
    return out


@router.delete('/groups/{group_id}/members/{target_user_id}', status_code=204)
async def kick_group_member(
    group_id: uuid.UUID,
    target_user_id: uuid.UUID,
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Check group exists
    group_result = await db.execute(select(Group).where(Group.id == group_id))
    group = group_result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail='Group not found')

    # Cannot kick owner
    if group.owner_id == target_user_id:
        raise HTTPException(status_code=400, detail='Cannot kick the group owner')

    result = await db.execute(
        select(GroupMember).where(
            (GroupMember.group_id == group_id) & (GroupMember.user_id == target_user_id)
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail='Member not found')

    await db.delete(member)
    await db.commit()


# Stats endpoint

@router.get('/stats')
async def get_stats(
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    media_root = Path('/app/media')
    avatars_path = media_root / 'avatars'
    group_avatars_path = media_root / 'group_avatars'
    messages_path = media_root / 'messages'

    total_bytes = _dir_size(media_root)
    avatars_bytes = _dir_size(avatars_path)
    group_avatars_bytes = _dir_size(group_avatars_path)
    message_files_bytes = _dir_size(messages_path)

    users_count = (await db.execute(select(func.count()).select_from(User))).scalar() or 0
    groups_count = (await db.execute(select(func.count()).select_from(Group))).scalar() or 0
    messages_count = (await db.execute(select(func.count()).select_from(Message))).scalar() or 0
    attachments_count = (await db.execute(select(func.count()).select_from(MessageAttachment))).scalar() or 0

    return {
        'disk': {
            'total_bytes': total_bytes,
            'avatars_bytes': avatars_bytes,
            'group_avatars_bytes': group_avatars_bytes,
            'message_files_bytes': message_files_bytes,
        },
        'db': {
            'users': users_count,
            'groups': groups_count,
            'messages': messages_count,
            'attachments': attachments_count,
        },
    }


# Cleanup endpoints

@router.post('/cleanup/messages')
async def cleanup_messages(
    body: CleanupMessagesBody,
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=body.days)
    stmt = sa_delete(Message).where(Message.created_at < cutoff)
    result = await db.execute(stmt)
    await db.commit()
    return {'deleted': result.rowcount}


@router.post('/cleanup/attachments')
async def cleanup_attachments(
    admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    messages_dir = Path('/app/media/messages')

    # Get all known file paths from DB
    result = await db.execute(select(MessageAttachment.file_path))
    known_paths = set(result.scalars().all())

    deleted_count = 0

    if messages_dir.exists():
        for file in messages_dir.rglob('*'):
            if file.is_file():
                # Compute db_path: /media/ + relative path from /app/media
                db_path = '/media/' + str(file.relative_to(Path('/app/media')))
                if db_path not in known_paths:
                    file.unlink()
                    deleted_count += 1

        # Clean up empty directories
        for dirpath in sorted(messages_dir.rglob('*'), reverse=True):
            if dirpath.is_dir():
                try:
                    dirpath.rmdir()  # only removes if empty
                except OSError:
                    pass

    return {'deleted': deleted_count}
