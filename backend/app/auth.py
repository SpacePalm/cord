from passlib.context import CryptContext
import jwt
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, status, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sql_update, delete as sql_delete, or_, and_
from app.database import get_db
from app.models.user import User
from app.models.session import Session as AuthSession
from app.config import settings

import bcrypt

_bearer = HTTPBearer()


SECRET_KEY = settings.jwt_secret
ALGORITHM = settings.jwt_algorithm
ACCESS_TOKEN_EXPIRE_MINUTES = settings.jwt_expire_minutes

# Refresh-токены и access-токены — две разные сущности:
# - access (JWT, короткий): носится в Authorization header, проверяется на каждом запросе
# - refresh (opaque, длинный): лежит у клиента, обменивается на новый access через /refresh
# 30 дней — стандарт для consumer-приложений (Telegram, Discord). Можно вынести в settings.
REFRESH_TOKEN_EXPIRE_DAYS = 30


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: str, username: str, role: str, session_id: str | None = None) -> str:
    """JWT, который получает клиент. session_id вшит в payload — это позволяет
    при revoke сессии обнаруживать «зомби» access-токены (если жёстко надо)."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "exp": expire,
    }
    if session_id is not None:
        payload["sid"] = str(session_id)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def generate_refresh_token() -> tuple[str, str, str]:
    """Возвращает (token_id, plaintext, bcrypt_hash).

    Формат plaintext: "{token_id}.{secret}". Клиент носит весь plaintext,
    сервер при /refresh парсит token_id для индексированного lookup'а,
    потом bcrypt-сравнивает только secret-часть.

    32 hex (token_id) — 128 бит энтропии для unique-lookup, не секрет.
    48 url-safe (secret) — ~286 бит энтропии, секретная часть.
    Суммарно >414 бит — outside any feasible bruteforce.
    """
    token_id = secrets.token_hex(16)
    secret = secrets.token_urlsafe(48)
    plaintext = f"{token_id}.{secret}"
    hashed = bcrypt.hashpw(secret.encode(), bcrypt.gensalt()).decode()
    return token_id, plaintext, hashed


def parse_refresh_token(plaintext: str) -> tuple[str, str] | None:
    """Возвращает (token_id, secret) или None если формат невалидный."""
    if not plaintext or '.' not in plaintext:
        return None
    token_id, _, secret = plaintext.partition('.')
    # Базовая валидация формата чтобы не делать bcrypt на мусоре.
    if len(token_id) != 32 or not all(c in '0123456789abcdef' for c in token_id) or not secret:
        return None
    return token_id, secret


def verify_refresh_secret(secret: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(secret.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False


async def create_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    user_agent: str | None,
    ip: str | None,
) -> tuple[AuthSession, str]:
    """Создаёт запись Session и возвращает её + plaintext refresh-токен.
    Не коммитит — вызывающий код отвечает за транзакцию.

    Заодно ограничивает количество одновременных сессий юзера: если их >20,
    самые старые revoke'аются (FIFO). Это защита от credential-stuffing'а
    и от случайного распухания таблицы при автоматизированных клиентах,
    забывающих logout.
    """
    token_id, plaintext, hashed = generate_refresh_token()
    sess = AuthSession(
        user_id=user_id,
        token_id=token_id,
        refresh_token_hash=hashed,
        user_agent=(user_agent or '')[:500],
        ip=ip,
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(sess)
    await db.flush()

    # Cap: оставляем максимум 20 активных сессий на юзера. Старые revoke'аем.
    # 20 — щедрый лимит: типичный юзер имеет 3-5 устройств. Атакующий ботнет
    # с тысячами IP отсечётся, ему придётся постоянно ротейтить сессии.
    overflow = (await db.execute(
        select(AuthSession).where(
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > datetime.now(timezone.utc),
        )
        .order_by(AuthSession.created_at.desc())
        .offset(20)
    )).scalars().all()
    for old in overflow:
        old.revoked_at = datetime.now(timezone.utc)

    return sess, plaintext


async def revoke_session(db: AsyncSession, session_id: uuid.UUID) -> None:
    await db.execute(
        sql_update(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )


async def revoke_all_user_sessions(db: AsyncSession, user_id: uuid.UUID, except_session_id: uuid.UUID | None = None) -> None:
    """Используется в steal-detection: если кто-то предъявил уже-revoked refresh,
    жжём все активные сессии (атакующий или сам юзер потеряют доступ)."""
    stmt = (
        sql_update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
    if except_session_id is not None:
        stmt = stmt.where(AuthSession.id != except_session_id)
    await db.execute(stmt)


# Сколько дней хранить «закрытые» сессии (expired или revoked) после момента
# их закрытия. 90 дней — security-хвост для investigations: если юзер придёт
# через 2 месяца «меня хакнули», у нас ещё есть данные о подозрительных сессиях.
# После cutoff'а строка удаляется и steal-detection на этот токен больше не
# срабатывает (атакующий и так получит 401 — токена нет в БД, lookup не найдёт).
SESSION_RETAIN_DAYS = 90


async def cleanup_old_sessions(db: AsyncSession, retain_days: int = SESSION_RETAIN_DAYS) -> int:
    """Удаляет сессии, у которых либо `expires_at`, либо `revoked_at` старше
    retain_days назад. Idempotent — безопасно гнать на нескольких воркерах
    параллельно (max-эффект: дубль SQL-запроса).

    Не коммитит — вызывающий код может объединить с другими операциями.
    Возвращает количество удалённых строк.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=retain_days)
    result = await db.execute(
        sql_delete(AuthSession).where(
            or_(
                AuthSession.expires_at < cutoff,
                and_(AuthSession.revoked_at.isnot(None), AuthSession.revoked_at < cutoff),
            )
        )
    )
    return result.rowcount or 0

def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None

async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(creds.credentials)
        if not payload or "sub" not in payload:
            raise credentials_exception
        user_id = payload["sub"]
    except jwt.PyJWTError:
        raise credentials_exception

    user = await db.get(User, uuid.UUID(user_id))
    if not user:
        raise credentials_exception
    # Деактивированный пользователь (например, админ отключил аккаунт) не должен
    # использовать ранее выданный токен до истечения срока действия JWT.
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Account is inactive')

    # Fail2ban: если IP клиента (или сам аккаунт) забанен — отдаём 403 с
    # `blocked_by_security`, фронт по этому коду делает logout и редирект на
    # /blocked. Эффективно «выкидывает» юзера из сессии, как только админ
    # создаёт IpBlock — на следующем же authenticated-запросе.
    # ⚠ Если админ забанит свой собственный IP — он тоже потеряет доступ
    # к /api/admin/auth/* до снятия блока (через консоль/SQL/другой IP).
    from app import fail2ban  # локальный импорт — fail2ban тянет много, не нужно при импорте auth.py
    ip = fail2ban.get_client_ip(request)
    await fail2ban.assert_not_blocked(db, ip=ip, user=user)

    return user