"""Админ-эндпоинты для fail2ban: настройки, лог попыток, блоки IP, локи аккаунтов."""
from __future__ import annotations

import ipaddress
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models.fail2ban import IpBlock, LoginAttempt
from app.models.user import User
from app import fail2ban

router = APIRouter(prefix='/api/admin/auth', tags=['admin'])


def _require_admin(user: User) -> None:
    if user.role != 'admin':
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Admin only')


# ─── Settings ─────────────────────────────────────────────────────────────

class Fail2banSettings(BaseModel):
    enabled: bool = True
    attempts_per_ip: int = 10
    attempts_per_account: int = 5
    window_seconds: int = 300
    ip_block_seconds: int = 3600
    account_lock_seconds: int = 1800
    log_retention_days: int = 30


class Fail2banSettingsPatch(BaseModel):
    enabled: bool | None = None
    attempts_per_ip: int | None = Field(None, ge=1, le=10000)
    attempts_per_account: int | None = Field(None, ge=1, le=10000)
    window_seconds: int | None = Field(None, ge=10, le=86400)
    ip_block_seconds: int | None = Field(None, ge=10, le=2592000)
    account_lock_seconds: int | None = Field(None, ge=10, le=2592000)
    log_retention_days: int | None = Field(None, ge=1, le=365)


def _settings_dict_to_model(d: dict[str, str]) -> Fail2banSettings:
    def _i(k: str, default: int) -> int:
        try: return int(d.get(k, default))
        except (TypeError, ValueError): return default
    return Fail2banSettings(
        enabled=fail2ban._as_bool(d.get('auth.enabled'), True),
        attempts_per_ip=_i('auth.attempts_per_ip', 10),
        attempts_per_account=_i('auth.attempts_per_account', 5),
        window_seconds=_i('auth.window_seconds', 300),
        ip_block_seconds=_i('auth.ip_block_seconds', 3600),
        account_lock_seconds=_i('auth.account_lock_seconds', 1800),
        log_retention_days=_i('auth.log_retention_days', 30),
    )


@router.get('/settings', response_model=Fail2banSettings)
async def get_auth_settings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    return _settings_dict_to_model(await fail2ban.get_settings(db))


@router.patch('/settings', response_model=Fail2banSettings)
async def update_auth_settings(
    body: Fail2banSettingsPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    patch: dict[str, str] = {}
    if body.enabled is not None:                 patch['auth.enabled'] = 'true' if body.enabled else 'false'
    if body.attempts_per_ip is not None:         patch['auth.attempts_per_ip'] = str(body.attempts_per_ip)
    if body.attempts_per_account is not None:    patch['auth.attempts_per_account'] = str(body.attempts_per_account)
    if body.window_seconds is not None:          patch['auth.window_seconds'] = str(body.window_seconds)
    if body.ip_block_seconds is not None:        patch['auth.ip_block_seconds'] = str(body.ip_block_seconds)
    if body.account_lock_seconds is not None:    patch['auth.account_lock_seconds'] = str(body.account_lock_seconds)
    if body.log_retention_days is not None:      patch['auth.log_retention_days'] = str(body.log_retention_days)
    await fail2ban.update_settings(db, patch)
    await db.commit()
    return _settings_dict_to_model(await fail2ban.get_settings(db))


# ─── Log ──────────────────────────────────────────────────────────────────

class LogEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    ip: str
    username_attempted: str
    success: bool
    user_agent: str | None
    user_id: str | None
    created_at: datetime


@router.get('/log', response_model=list[LogEntry])
async def list_log(
    ip: str | None = Query(None),
    username: str | None = Query(None),
    success: bool | None = Query(None),
    after: datetime | None = Query(None),
    before: datetime | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0, le=100000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    if ip:
        # INET-колонка отвергает невалидные строки → 500. Нормализуем заранее.
        try:
            ipaddress.ip_address(ip.strip())
        except ValueError:
            return []
    stmt = select(LoginAttempt).order_by(LoginAttempt.created_at.desc())
    if ip:        stmt = stmt.where(LoginAttempt.ip == ip)
    if username:  stmt = stmt.where(LoginAttempt.username_attempted.ilike(f'%{username}%'))
    if success is not None: stmt = stmt.where(LoginAttempt.success.is_(success))
    if after:     stmt = stmt.where(LoginAttempt.created_at >= after)
    if before:    stmt = stmt.where(LoginAttempt.created_at < before)
    stmt = stmt.offset(offset).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return [LogEntry(
        id=str(r.id), ip=str(r.ip), username_attempted=r.username_attempted,
        success=r.success, user_agent=r.user_agent,
        user_id=str(r.user_id) if r.user_id else None,
        created_at=r.created_at,
    ) for r in rows]


# ─── Log grouped by IP ───────────────────────────────────────────────────

class GroupedAttempt(BaseModel):
    username: str
    count: int
    last_at: datetime


class GroupedIp(BaseModel):
    ip: str
    total: int
    failed: int
    succeeded: int
    distinct_users: int
    last_at: datetime
    is_blocked: bool
    block_expires_at: datetime | None
    by_user: list[GroupedAttempt]


@router.get('/log/grouped', response_model=list[GroupedIp])
async def list_log_grouped(
    after: datetime | None = Query(None, description='По умолчанию — 7 дней назад'),
    limit: int = Query(50, ge=1, le=200, description='Сколько IP вернуть'),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    if after is None:
        after = datetime.now(timezone.utc) - timedelta(days=7)

    # Агрегация по IP: total, failed, succeeded, distinct usernames, last_at.
    # COUNT(*) FILTER — нативный PG-синтаксис, эффективнее чем CASE WHEN.
    stmt = (
        select(
            LoginAttempt.ip,
            func.count().label('total'),
            func.count().filter(LoginAttempt.success.is_(False)).label('failed'),
            func.count().filter(LoginAttempt.success.is_(True)).label('succeeded'),
            func.count(func.distinct(LoginAttempt.username_attempted)).label('distinct_users'),
            func.max(LoginAttempt.created_at).label('last_at'),
        )
        .where(LoginAttempt.created_at >= after)
        .group_by(LoginAttempt.ip)
        .order_by(func.max(LoginAttempt.created_at).desc())
        .limit(limit)
    )
    agg = (await db.execute(stmt)).all()
    if not agg:
        return []

    ips = [str(r.ip) for r in agg]

    # Активные IP-блоки одним запросом.
    now = datetime.now(timezone.utc)
    block_result = await db.execute(
        select(IpBlock).where(IpBlock.ip.in_(ips))
    )
    blocks_by_ip = {str(b.ip): b for b in block_result.scalars().all()}

    # По каждому IP — топ usernames. Делаем одним запросом (ip, username, count, max).
    per_user_stmt = (
        select(
            LoginAttempt.ip,
            LoginAttempt.username_attempted,
            func.count().label('count'),
            func.max(LoginAttempt.created_at).label('last_at'),
        )
        .where(LoginAttempt.ip.in_(ips), LoginAttempt.created_at >= after)
        .group_by(LoginAttempt.ip, LoginAttempt.username_attempted)
        .order_by(LoginAttempt.ip, func.count().desc())
    )
    per_user = (await db.execute(per_user_stmt)).all()
    by_ip: dict[str, list[GroupedAttempt]] = {}
    for r in per_user:
        by_ip.setdefault(str(r.ip), []).append(GroupedAttempt(
            username=r.username_attempted, count=r.count, last_at=r.last_at,
        ))

    out: list[GroupedIp] = []
    for r in agg:
        ip_str = str(r.ip)
        block = blocks_by_ip.get(ip_str)
        is_blocked = block is not None and (block.expires_at is None or block.expires_at > now)
        out.append(GroupedIp(
            ip=ip_str,
            total=r.total or 0,
            failed=r.failed or 0,
            succeeded=r.succeeded or 0,
            distinct_users=r.distinct_users or 0,
            last_at=r.last_at,
            is_blocked=is_blocked,
            block_expires_at=block.expires_at if block else None,
            by_user=by_ip.get(ip_str, []),
        ))
    return out


# ─── IP blocks ────────────────────────────────────────────────────────────

class IpBlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    ip: str
    reason: str
    expires_at: datetime | None
    blocked_by: str
    attempts_count: int
    blocked_at: datetime


class IpBlockCreate(BaseModel):
    ip: str
    reason: str = ''
    duration_seconds: int | None = Field(None, ge=10, le=10 * 365 * 24 * 3600,
                                         description='Если null — вечный бан')

    @field_validator('ip')
    @classmethod
    def _v(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('ip required')
        try:
            ipaddress.ip_address(v)
        except ValueError as exc:
            raise ValueError('invalid ip address') from exc
        return v


@router.get('/blocks', response_model=list[IpBlockOut])
async def list_blocks(
    only_active: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    stmt = select(IpBlock).order_by(IpBlock.blocked_at.desc())
    if only_active:
        now = datetime.now(timezone.utc)
        stmt = stmt.where((IpBlock.expires_at.is_(None)) | (IpBlock.expires_at > now))
    rows = (await db.execute(stmt)).scalars().all()
    return [IpBlockOut(
        ip=str(r.ip), reason=r.reason, expires_at=r.expires_at,
        blocked_by=r.blocked_by, attempts_count=r.attempts_count, blocked_at=r.blocked_at,
    ) for r in rows]


@router.post('/blocks', response_model=IpBlockOut, status_code=201)
async def create_block(
    body: IpBlockCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    expires = (datetime.now(timezone.utc) + timedelta(seconds=body.duration_seconds)
               if body.duration_seconds else None)
    stmt = pg_insert(IpBlock).values(
        ip=body.ip, reason=body.reason or 'Manual block',
        expires_at=expires, blocked_by='manual', attempts_count=0,
    ).on_conflict_do_update(
        index_elements=['ip'],
        set_={
            'reason': body.reason or 'Manual block',
            'expires_at': expires,
            'blocked_by': 'manual',
            'blocked_at': func.now(),
        },
    ).returning(IpBlock)
    result = await db.execute(stmt)
    row = result.scalar_one()
    await db.commit()
    return IpBlockOut(
        ip=str(row.ip), reason=row.reason, expires_at=row.expires_at,
        blocked_by=row.blocked_by, attempts_count=row.attempts_count, blocked_at=row.blocked_at,
    )


@router.delete('/blocks/{ip}', status_code=204)
async def delete_block(
    ip: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        raise HTTPException(status_code=400, detail='invalid ip address')
    await db.execute(delete(IpBlock).where(IpBlock.ip == ip))
    await db.commit()


# ─── Locked accounts ──────────────────────────────────────────────────────

class LockedUserOut(BaseModel):
    user_id: str
    username: str
    email: str
    failed_attempts: int
    last_failed_at: datetime | None
    locked_until: datetime


@router.get('/locked-users', response_model=list[LockedUserOut])
async def list_locked_users(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(User).where(User.locked_until.isnot(None), User.locked_until > now)
        .order_by(User.locked_until.desc())
    )).scalars().all()
    return [LockedUserOut(
        user_id=str(u.id), username=u.username, email=u.email,
        failed_attempts=u.failed_attempts or 0,
        last_failed_at=u.last_failed_at,
        locked_until=u.locked_until,
    ) for u in rows]


@router.delete('/locked-users/{user_id}', status_code=204)
async def unlock_account(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail='User not found')
    target.locked_until = None
    target.failed_attempts = 0
    await db.commit()


# ─── Cleanup (вызывается из cron / админ-кнопкой) ─────────────────────────

@router.post('/log/cleanup', status_code=200)
async def cleanup_log(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Удаляет записи лога старше log_retention_days. Возвращает кол-во удалённых."""
    _require_admin(user)
    settings = await fail2ban.get_settings(db)
    days = fail2ban._as_int(settings.get('auth.log_retention_days'), 30)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = await db.execute(
        delete(LoginAttempt).where(LoginAttempt.created_at < cutoff)
    )
    await db.commit()
    return {'deleted': result.rowcount or 0}
