from passlib.context import CryptContext
import jwt
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, status, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sql_update
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


def generate_refresh_token() -> tuple[str, str]:
    """Возвращает (plaintext, bcrypt_hash). Plaintext отдаётся клиенту один раз."""
    plaintext = secrets.token_urlsafe(48)  # 64 chars, 384 bits энтропии
    return plaintext, bcrypt.hashpw(plaintext.encode(), bcrypt.gensalt()).decode()


def verify_refresh_token(plaintext: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plaintext.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False


async def create_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    user_agent: str | None,
    ip: str | None,
) -> tuple[AuthSession, str]:
    """Создаёт запись Session и возвращает её + plaintext refresh-токен.
    Не коммитит — вызывающий код отвечает за транзакцию."""
    plaintext, hashed = generate_refresh_token()
    sess = AuthSession(
        user_id=user_id,
        refresh_token_hash=hashed,
        user_agent=(user_agent or '')[:500],
        ip=ip,
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(sess)
    await db.flush()  # чтобы получить sess.id
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