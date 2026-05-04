"""Fail2ban-логика: проверка блокировок, запись попыток, эскалация в блок.

Конфигурация лежит в app_settings под ключами `auth.*` (см. DEFAULTS).
Все функции принимают AsyncSession и не делают commit самостоятельно — вызывающий
код отвечает за транзакцию.

Используется в `auth.py` (login flow) и `admin.py` (UI).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSetting
from app.models.fail2ban import IpBlock, LoginAttempt
from app.models.user import User

# ─── Default settings ─────────────────────────────────────────────────────
# Хранятся в app_settings таблице. Если ключа нет — используется дефолт ниже.
DEFAULTS: dict[str, str] = {
    'auth.enabled': 'true',
    'auth.attempts_per_ip': '10',
    'auth.attempts_per_account': '5',
    'auth.window_seconds': '300',         # 5 мин — окно подсчёта фейлов
    'auth.ip_block_seconds': '3600',      # 1 час — длительность бана IP
    'auth.account_lock_seconds': '1800',  # 30 мин — длительность блокировки аккаунта
    'auth.log_retention_days': '30',      # сколько дней хранить лог попыток
}

SETTING_KEYS = list(DEFAULTS.keys())


# ─── Settings access ──────────────────────────────────────────────────────

async def get_settings(db: AsyncSession) -> dict[str, str]:
    """Возвращает все auth-настройки. Кешируется в Redis на 30 секунд —
    settings меняются редко (только админ через UI), а вызов идёт на каждом
    authenticated запросе через get_current_user → assert_not_blocked.
    Без кеша = SELECT app_settings × N запросов на page reload."""
    from app.cache import get_cached_f2b_settings, set_cached_f2b_settings
    cached = await get_cached_f2b_settings()
    if cached is not None:
        # Заполняем дефолты для отсутствующих ключей (на случай если в кеше старая версия)
        return {k: cached.get(k, v) for k, v in DEFAULTS.items()}

    result = await db.execute(
        select(AppSetting).where(AppSetting.key.in_(SETTING_KEYS))
    )
    found = {s.key: s.value for s in result.scalars().all()}
    merged = {k: found.get(k, v) for k, v in DEFAULTS.items()}
    await set_cached_f2b_settings(merged)
    return merged


async def update_settings(db: AsyncSession, patch: dict[str, str]) -> None:
    """Upsert указанных ключей. Неизвестные ключи игнорируются. Инвалидирует кеш."""
    for key, value in patch.items():
        if key not in DEFAULTS:
            continue
        stmt = pg_insert(AppSetting).values(key=key, value=str(value))
        stmt = stmt.on_conflict_do_update(index_elements=['key'], set_={'value': str(value)})
        await db.execute(stmt)
    # Сбрасываем кеш чтобы изменения админа применились мгновенно.
    from app.cache import invalidate_f2b_settings
    await invalidate_f2b_settings()


def _as_int(s: str | None, default: int) -> int:
    try:
        return int(s) if s is not None else default
    except (TypeError, ValueError):
        return default


def _as_bool(s: str | None, default: bool) -> bool:
    if s is None:
        return default
    return s.strip().lower() in ('true', '1', 'yes', 'on')


# ─── IP / Account block checks ────────────────────────────────────────────

async def get_active_ip_block(db: AsyncSession, ip: str) -> IpBlock | None:
    """Возвращает активный блок IP или None. Истёкшие блоки считаются неактивными
    и не возвращаются (но физически в таблице остаются для истории)."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(IpBlock).where(
            IpBlock.ip == ip,
            (IpBlock.expires_at.is_(None)) | (IpBlock.expires_at > now),
        )
    )
    return result.scalar_one_or_none()


async def get_active_account_lock(user: User) -> bool:
    """Заблокирован ли аккаунт в данный момент."""
    if user.locked_until is None:
        return False
    return user.locked_until > datetime.now(timezone.utc)


# ─── Logging attempts ─────────────────────────────────────────────────────

async def log_attempt(
    db: AsyncSession,
    *,
    ip: str,
    username: str,
    success: bool,
    user_id=None,
    user_agent: str | None = None,
) -> None:
    """Записывает попытку входа. Не коммитит."""
    db.add(LoginAttempt(
        ip=ip,
        username_attempted=(username or '')[:100],
        success=success,
        user_id=user_id,
        user_agent=(user_agent or '')[:500] or None,
    ))


# ─── Escalation: block IP / lock account on threshold ────────────────────

async def maybe_block_ip(db: AsyncSession, ip: str, settings: dict[str, str]) -> bool:
    """Если за окно с этого IP было N+ фейлов — создаёт IpBlock. Возвращает True
    если блок создан (или уже был) сейчас."""
    threshold = _as_int(settings.get('auth.attempts_per_ip'), 10)
    window = _as_int(settings.get('auth.window_seconds'), 300)
    block_seconds = _as_int(settings.get('auth.ip_block_seconds'), 3600)

    since = datetime.now(timezone.utc) - timedelta(seconds=window)
    count_result = await db.execute(
        select(func.count(LoginAttempt.id)).where(
            LoginAttempt.ip == ip,
            LoginAttempt.success.is_(False),
            LoginAttempt.created_at > since,
        )
    )
    count = count_result.scalar() or 0
    if count < threshold:
        return False

    expires = datetime.now(timezone.utc) + timedelta(seconds=block_seconds)
    # Upsert — если IP уже заблокирован, обновляем счётчик/expires.
    stmt = pg_insert(IpBlock).values(
        ip=ip,
        reason=f'Auto: {count} failed attempts in {window}s',
        expires_at=expires,
        blocked_by='auto',
        attempts_count=count,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=['ip'],
        set_={
            'reason': stmt.excluded.reason,
            'expires_at': stmt.excluded.expires_at,
            'attempts_count': stmt.excluded.attempts_count,
            'blocked_at': func.now(),
        },
    )
    await db.execute(stmt)
    return True


async def maybe_lock_account(user: User, settings: dict[str, str]) -> bool:
    """Если у пользователя N+ фейлов — выставляет locked_until. True если заблокировали."""
    threshold = _as_int(settings.get('auth.attempts_per_account'), 5)
    lock_seconds = _as_int(settings.get('auth.account_lock_seconds'), 1800)

    if user.failed_attempts < threshold:
        return False
    user.locked_until = datetime.now(timezone.utc) + timedelta(seconds=lock_seconds)
    return True


# ─── Helpers ──────────────────────────────────────────────────────────────

def get_client_ip(request: Request) -> str:
    """Извлекает IP клиента с учётом возможного прокси.

    Если развёрнуто за nginx с `proxy_set_header X-Forwarded-For $remote_addr`,
    то форвард-заголовок имеет приоритет. Иначе — request.client.host.
    """
    fwd = request.headers.get('x-forwarded-for')
    if fwd:
        # Может быть «client, proxy1, proxy2» — берём первый.
        return fwd.split(',')[0].strip()
    return request.client.host if request.client else '0.0.0.0'


# Сообщение об ошибке при заблокированном IP / аккаунте — отдельная константа,
# фронт может матчить по detail-полю и редиректить на /blocked страницу.
BLOCKED_DETAIL = 'blocked_by_security'


async def assert_not_blocked(
    db: AsyncSession,
    *,
    ip: str,
    user: Optional[User] = None,
) -> None:
    """Бросает 403 с detail=BLOCKED_DETAIL если IP в блоке или user заблокирован.
    Не делает ничего если fail2ban глобально выключен в настройках.

    Hot-path оптимизация: 99.9% запросов от незаблокированных IP. Сначала
    проверяем Redis-кеш статуса блокировки (TTL 10с). Если там '0' (не забанен)
    — не лезем в БД. Если '1' — лезем в БД за деталями блока (для expires_at
    в response). Если кеш пуст — БД-запрос + кешируем результат.
    """
    from app.cache import get_cached_ip_block_status, set_cached_ip_block_status

    settings = await get_settings(db)  # cached в Redis
    if not _as_bool(settings.get('auth.enabled'), True):
        return

    cached_status = await get_cached_ip_block_status(ip)
    if cached_status is False:
        # Кеш говорит «не забанен» — пропускаем DB-запрос. ip_block только при
        # account check ниже, который тоже сначала смотрит in-memory.
        pass
    elif cached_status is True:
        # Кеш говорит «забанен» — нужны детали (expires_at) из БД для response
        block = await get_active_ip_block(db, ip)
        if block:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={'code': BLOCKED_DETAIL, 'kind': 'ip',
                        'expires_at': block.expires_at.isoformat() if block.expires_at else None},
            )
        # Расхождение кеша и БД (блок мог истечь) — обновляем кеш
        await set_cached_ip_block_status(ip, False)
    else:
        # Кеша нет — лезем в БД и кешируем результат
        block = await get_active_ip_block(db, ip)
        await set_cached_ip_block_status(ip, block is not None)
        if block:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={'code': BLOCKED_DETAIL, 'kind': 'ip',
                        'expires_at': block.expires_at.isoformat() if block.expires_at else None},
            )

    # Account-lock check — in-memory (user.locked_until уже загружен), без DB
    if user is not None and await get_active_account_lock(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={'code': BLOCKED_DETAIL, 'kind': 'account',
                    'expires_at': user.locked_until.isoformat() if user.locked_until else None},
        )
