"""
Эндпоинты для групп (серверов) и каналов.

Группы:
  GET  /api/groups               — список групп текущего пользователя
  POST /api/groups               — создать группу (авто-вступление + дефолтные каналы)
  DELETE /api/groups/{id}        — удалить группу (только владелец / admin)
  POST /api/groups/{id}/join     — вступить в группу
  POST /api/groups/{id}/leave    — покинуть группу
  GET  /api/groups/{id}/members  — список участников
  DELETE /api/groups/{id}/members/{uid} — кикнуть участника
  PATCH /api/groups/{id}         — обновить название группы
  POST /api/groups/{id}/avatar   — загрузить аватар группы
  POST /api/groups/{id}/invite   — создать/обновить инвайт
  PATCH /api/groups/{id}/chats/{cid} — переименовать канал

Каналы:
  GET  /api/groups/{id}/chats          — список каналов группы
  POST /api/groups/{id}/chats          — создать канал (только владелец / admin)
  DELETE /api/groups/{id}/chats/{cid}  — удалить канал (только владелец / admin)

Инвайты:
  GET  /api/invite/{code}       — информация об инвайте (публично)
  POST /api/invite/{code}/join  — вступить по инвайту (авторизация нужна)
"""

import uuid
import secrets
import shutil
from pathlib import Path
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.group import Group, Chat, GroupMember, GroupInvite
from app.schemas.group import (
    GroupCreate, GroupOut, ChatCreate, ChatOut,
    MemberOut, GroupUpdate, ChatUpdate, InviteOut,
)

router = APIRouter(prefix='/api/groups', tags=['groups'])
invite_router = APIRouter(prefix='/api/invite', tags=['invite'])


# Helpers

async def _get_group_or_404(group_id: uuid.UUID, db: AsyncSession) -> Group:
    group = await db.get(Group, group_id)
    if not group or not group.is_active:
        raise HTTPException(status_code=404, detail='Group not found')
    return group


async def _require_member(group_id: uuid.UUID, user: User, db: AsyncSession) -> Group:
    group = await _get_group_or_404(group_id, db)
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user.id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail='Not a member of this group')
    return group


def _require_owner_or_admin(group: Group, user: User) -> None:
    if group.owner_id != user.id and user.role != 'admin':
        raise HTTPException(status_code=403, detail='Only the owner can perform this action')


async def _require_editor_or_above(
    group_id: uuid.UUID, user: User, db: AsyncSession,
) -> Group:
    """Requires user to be owner, editor, or global admin."""
    group = await _get_group_or_404(group_id, db)
    if user.role == 'admin':
        return group
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member or member.role not in ('owner', 'editor'):
        raise HTTPException(status_code=403, detail='Editor or owner role required')
    return group


async def _join_group(group_id: uuid.UUID, user: User, db: AsyncSession) -> None:
    """Вступить в группу (если ещё не участник)."""
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user.id,
        )
    )
    if not result.scalar_one_or_none():
        db.add(GroupMember(group_id=group_id, user_id=user.id))
        await db.commit()


# Groups

@router.get('', response_model=list[GroupOut])
async def list_groups(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user.id, Group.is_active == True)  # noqa: E712
        .order_by(Group.created_at)
    )
    return result.scalars().all()


@router.post('', response_model=GroupOut, status_code=201)
async def create_group(
    body: GroupCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = Group(name=body.name, owner_id=user.id, image_path='')
    db.add(group)
    await db.flush()  # нужен group.id до commit

    # Автоматически добавляем создателя как участника (владелец)
    db.add(GroupMember(group_id=group.id, user_id=user.id, role='owner'))

    # Дефолтные каналы
    db.add(Chat(name='общий', group_id=group.id, type='text'))
    db.add(Chat(name='Голосовой', group_id=group.id, type='voice'))

    await db.commit()
    await db.refresh(group)
    return group


@router.delete('/{group_id}', status_code=204)
async def delete_group(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = await _get_group_or_404(group_id, db)
    if group.is_personal:
        raise HTTPException(status_code=400, detail='Cannot delete personal group')
    _require_owner_or_admin(group, user)
    await db.delete(group)
    await db.commit()


@router.post('/{group_id}/join', status_code=204)
async def join_group(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get_group_or_404(group_id, db)
    await _join_group(group_id, user, db)


@router.post('/{group_id}/leave', status_code=204)
async def leave_group(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = await _get_group_or_404(group_id, db)
    if group.is_personal:
        raise HTTPException(status_code=400, detail='Cannot leave personal group')
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user.id,
        )
    )
    member = result.scalar_one_or_none()
    if member:
        await db.delete(member)
        await db.commit()


# Members

@router.get('/{group_id}/members', response_model=list[MemberOut])
async def list_members(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_member(group_id, user, db)
    from app.cache import get_online_user_ids
    result = await db.execute(
        select(
            GroupMember.user_id,
            User.username,
            User.display_name,
            User.image_path,
            User.status,
            User.status_text,
            GroupMember.role,
            GroupMember.joined_at,
        )
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group_id)
        .order_by(GroupMember.joined_at)
    )
    rows = result.all()
    online_ids = await get_online_user_ids([str(r.user_id) for r in rows])
    return [
        MemberOut(
            user_id=row.user_id,
            username=row.username,
            display_name=row.display_name,
            image_path=row.image_path or '',
            role=row.role,
            joined_at=row.joined_at,
            is_online=str(row.user_id) in online_ids,
            status=row.status or 'online',
            status_text=row.status_text,
        )
        for row in rows
    ]


@router.delete('/{group_id}/members/{target_user_id}', status_code=204)
async def kick_member(
    group_id: uuid.UUID,
    target_user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = await _require_member(group_id, user, db)
    _require_owner_or_admin(group, user)

    if target_user_id == group.owner_id:
        raise HTTPException(status_code=400, detail='Cannot kick the group owner')

    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == target_user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail='Member not found')

    await db.delete(member)
    await db.commit()


@router.patch('/{group_id}/members/{target_user_id}/role', status_code=204)
async def update_member_role(
    group_id: uuid.UUID,
    target_user_id: uuid.UUID,
    role: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(group_id, db)
    _require_owner_or_admin(group, user)

    if role not in ('editor', 'member'):
        raise HTTPException(status_code=422, detail="Role must be 'editor' or 'member'")

    if target_user_id == group.owner_id:
        raise HTTPException(status_code=400, detail="Cannot change the owner's role")

    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == target_user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail='Member not found')

    member.role = role
    await db.commit()


# Group settings

@router.patch('/{group_id}', response_model=GroupOut)
async def update_group(
    group_id: uuid.UUID,
    body: GroupUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = await _require_member(group_id, user, db)
    _require_owner_or_admin(group, user)

    if body.name is not None:
        group.name = body.name.strip()
        if not group.name:
            raise HTTPException(status_code=422, detail='Name cannot be empty')

    await db.commit()
    await db.refresh(group)
    return group


@router.post('/{group_id}/avatar', response_model=GroupOut)
async def upload_group_avatar(
    group_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = await _require_member(group_id, user, db)
    _require_owner_or_admin(group, user)

    ext = Path(file.filename or '').suffix.lower() or '.png'
    dest_dir = Path('/app/media/group_avatars') / str(group_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f'avatar{ext}'

    with dest.open('wb') as f:
        shutil.copyfileobj(file.file, f)

    group.image_path = f'/media/group_avatars/{group_id}/avatar{ext}'
    await db.commit()
    await db.refresh(group)
    return group


# Invites

@router.post('/{group_id}/invite', response_model=InviteOut)
async def create_invite(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_editor_or_above(group_id, user, db)

    # Delete old invites for this group
    await db.execute(
        delete(GroupInvite).where(GroupInvite.group_id == group_id)
    )

    code = secrets.token_urlsafe(8)
    expires_at = _now_utc() + timedelta(hours=24)
    invite = GroupInvite(
        group_id=group_id,
        code=code,
        created_by=user.id,
        expires_at=expires_at,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)

    return InviteOut(code=code, expires_at=expires_at, url=f'/invite/{code}')


def _now_utc():
    from datetime import datetime
    return datetime.now(tz=timezone.utc)


# Chats (channels)

@router.get('/{group_id}/chats', response_model=list[ChatOut])
async def list_chats(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_member(group_id, user, db)
    result = await db.execute(
        select(Chat).where(Chat.group_id == group_id).order_by(Chat.created_at)
    )
    return result.scalars().all()


@router.post('/{group_id}/chats', response_model=ChatOut, status_code=201)
async def create_chat(
    group_id: uuid.UUID,
    body: ChatCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_editor_or_above(group_id, user, db)

    chat = Chat(name=body.name, group_id=group_id, type=body.type)
    db.add(chat)
    await db.commit()
    await db.refresh(chat)
    return chat


@router.patch('/{group_id}/chats/{chat_id}', response_model=ChatOut)
async def rename_chat(
    group_id: uuid.UUID,
    chat_id: uuid.UUID,
    body: ChatUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_editor_or_above(group_id, user, db)

    chat = await db.get(Chat, chat_id)
    if not chat or chat.group_id != group_id:
        raise HTTPException(status_code=404, detail='Chat not found')

    chat.name = body.name.strip()
    await db.commit()
    await db.refresh(chat)
    return chat


@router.delete('/{group_id}/chats/{chat_id}', status_code=204)
async def delete_chat(
    group_id: uuid.UUID,
    chat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_editor_or_above(group_id, user, db)

    chat = await db.get(Chat, chat_id)
    if not chat or chat.group_id != group_id:
        raise HTTPException(status_code=404, detail='Chat not found')

    await db.delete(chat)
    await db.commit()


# Invite router (public + auth)

@invite_router.get('/{code}')
async def resolve_invite(
    code: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(GroupInvite).where(GroupInvite.code == code)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail='Invite not found')

    if invite.expires_at.replace(tzinfo=timezone.utc) < _now_utc():
        raise HTTPException(status_code=404, detail='Invite expired')

    group = await db.get(Group, invite.group_id)
    if not group or not group.is_active:
        raise HTTPException(status_code=404, detail='Group not found')

    count_result = await db.execute(
        select(func.count()).select_from(GroupMember).where(GroupMember.group_id == invite.group_id)
    )
    member_count = count_result.scalar_one()

    return {'group_name': group.name, 'member_count': member_count}


@invite_router.post('/{code}/join', status_code=204)
async def join_by_invite(
    code: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GroupInvite).where(GroupInvite.code == code)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail='Invite not found')

    if invite.expires_at.replace(tzinfo=timezone.utc) < _now_utc():
        raise HTTPException(status_code=410, detail='Invite expired')

    group = await db.get(Group, invite.group_id)
    if not group or not group.is_active:
        raise HTTPException(status_code=404, detail='Group not found')

    await _join_group(invite.group_id, user, db)
