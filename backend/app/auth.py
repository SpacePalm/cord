from passlib.context import CryptContext
import jwt
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, status, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.user import User
from app.config import settings

import bcrypt

_bearer = HTTPBearer()


SECRET_KEY = settings.jwt_secret
ALGORITHM = settings.jwt_algorithm
ACCESS_TOKEN_EXPIRE_MINUTES = settings.jwt_expire_minutes

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())

def create_access_token(user_id: str, username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

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