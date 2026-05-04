import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, status, Depends, Request, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.models.app_settings import AppSetting
from app.auth import (
    hash_password, verify_password, create_access_token, get_current_user,
    create_session, revoke_session, revoke_all_user_sessions,
    parse_refresh_token, verify_refresh_secret,
)
from app.models.session import Session as AuthSession
from app.rate_limit import RateLimiter
from app import fail2ban

MEDIA_ROOT = Path('/app/media')

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 5 регистраций с одного IP в час — спаму новых аккаунтов не повредит, живому пользователю хватит
register_limiter = RateLimiter(key='register', limit=5, window_seconds=3600)
# 10 попыток логина за 5 минут с одного IP — защита от перебора паролей
login_limiter = RateLimiter(key='login', limit=10, window_seconds=300)
# /refresh: 20/мин/IP — у легитимного юзера access-токен 15 мин, реальный rate
# auto-refresh раз в 15 минут максимум на вкладку. 20/мин с запасом × 5 на 5 вкладок.
refresh_limiter = RateLimiter(key='refresh', limit=20, window_seconds=60)
# /logout: реже, чем refresh, но всё равно нужен лимит — оба эндпоинта делают bcrypt.
logout_limiter = RateLimiter(key='logout', limit=10, window_seconds=60)

# Grace period: если refresh-токен только-только revoked'ился (вкладки
# юзера погнали два refresh'а одновременно), не считаем это steal-detection.
# Атакующий за 10 секунд после первого refresh'а вряд ли успеет — этот
# временной зазор защищает только от race condition, не от настоящей кражи.
REFRESH_REUSE_GRACE_SECONDS = 10

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str = Field(..., max_length=100)
    password: str = Field(..., min_length=6)

class ProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(None, max_length=50)
    email: str | None = Field(None, max_length=100)
    current_password: str | None = None
    new_password: str | None = Field(None, min_length=6)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # access-token TTL в секундах
    user: "UserInfo"


class RefreshRequest(BaseModel):
    # Реальный токен ~97 символов (32 token_id + 1 dot + 64 secret).
    # max_length=200 — отсекает мусор и атаки с гигантскими payload'ами
    # до того как parse_refresh_token доберётся до validation.
    refresh_token: str = Field(..., max_length=200)


class RefreshResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class SessionInfo(BaseModel):
    id: str
    user_agent: str
    ip: str | None
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    is_current: bool

class UserInfo(BaseModel):
    id: str
    username: str
    display_name: str
    email: str
    role: str
    image_path: str = ''
    status: str = 'online'
    status_text: str | None = None
    theme_json: str | None = None
    preferences_json: str | None = None

    model_config = {"from_attributes": True}



def _user_info(u: User) -> UserInfo:
    return UserInfo(
        id=str(u.id),
        username=u.username,
        display_name=u.display_name,
        email=u.email,
        role=u.role,
        image_path=u.image_path or '',
        status=u.status or 'online',
        status_text=u.status_text,
        theme_json=u.theme_json,
        preferences_json=u.preferences_json,
    )


@router.get("/me", response_model=UserInfo)
async def get_profile(current_user: User = Depends(get_current_user)):
    return _user_info(current_user)


class StatusUpdate(BaseModel):
    status: str = Field(..., pattern=r'^(online|idle|dnd|invisible)$')
    status_text: str | None = Field(None, max_length=128)


@router.put("/status", response_model=UserInfo)
async def update_status(
    body: StatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current_user.status = body.status
    current_user.status_text = body.status_text
    await db.commit()
    await db.refresh(current_user)
    return _user_info(current_user)


@router.put("/theme")
async def save_theme(
    body: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Сохраняет тему пользователя в БД."""
    import json
    current_user.theme_json = json.dumps(body)
    await db.commit()
    return {"ok": True}


@router.put("/preferences")
async def save_preferences(
    body: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Сохраняет кросс-девайсные настройки (язык, уведомления, mute чатов).
    Единый JSON-блоб — фронтенд сам знает структуру.
    """
    import json
    current_user.preferences_json = json.dumps(body)
    await db.commit()
    return {"ok": True}


@router.post("/heartbeat")
async def heartbeat(
    current_user: User = Depends(get_current_user),
):
    """Обновляет онлайн-статус через Redis (TTL 120 сек)."""
    from app.cache import set_user_online
    await set_user_online(str(current_user.id))
    return {"ok": True}


@router.patch("/profile", response_model=UserInfo)
async def update_profile(
    body: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.display_name is not None:
        current_user.display_name = body.display_name.strip() or current_user.display_name

    if body.email is not None:
        new_email = body.email.strip()
        if new_email and new_email != current_user.email:
            existing = await db.execute(
                select(User).where(User.email == new_email, User.id != current_user.id)
            )
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=400, detail='Email already taken')
            current_user.email = new_email

    if body.new_password:
        if not body.current_password:
            raise HTTPException(status_code=400, detail='current_password is required to change password')
        if not verify_password(body.current_password, current_user.hashed_password):
            raise HTTPException(status_code=400, detail='Неверный текущий пароль')
        current_user.hashed_password = hash_password(body.new_password)

    await db.commit()
    await db.refresh(current_user)
    return _user_info(current_user)


@router.post("/avatar", response_model=UserInfo)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail='Файл должен быть изображением')

    dest_dir = MEDIA_ROOT / 'avatars' / str(current_user.id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename or 'avatar.png').suffix or '.png'
    dest = dest_dir / f'avatar{ext}'

    with dest.open('wb') as out:
        shutil.copyfileobj(file.file, out)

    current_user.image_path = f'/media/avatars/{current_user.id}/avatar{ext}'
    await db.commit()
    await db.refresh(current_user)
    return _user_info(current_user)
        
@router.post("/register")
async def register(request: RegisterRequest, http_request: Request, db: AsyncSession = Depends(get_db)):
    await register_limiter.check(http_request)
    # Check registration toggle
    reg_row = await db.execute(
        select(AppSetting).where(AppSetting.key == 'registration_enabled')
    )
    reg_setting = reg_row.scalar_one_or_none()
    if reg_setting and reg_setting.value == 'false':
        raise HTTPException(status_code=403, detail='Регистрация временно отключена')

    existing_user = await db.execute(
        User.__table__.select().where((User.username == request.username) | (User.email == request.email))
    )
    if existing_user.scalar():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username or email already exists")
    
    new_user = User(
        username=request.username,
        email=request.email,
        hashed_password=hash_password(request.password)
    )
    db.add(new_user)
    await db.flush()

    # Создаём персональную группу "Saved Messages"
    from app.models.group import Group, GroupMember, Chat
    saved_group = Group(name='Saved Messages', owner_id=new_user.id, image_path='', is_personal=True)
    db.add(saved_group)
    await db.flush()
    db.add(GroupMember(group_id=saved_group.id, user_id=new_user.id, role='owner'))
    db.add(Chat(name='Saved Messages', group_id=saved_group.id, type='text'))

    await db.commit()
    await db.refresh(new_user)

    return {"id": new_user.id, "username": new_user.username, "email": new_user.email}

@router.post("/login")
async def login(request: LoginRequest, http_request: Request, db: AsyncSession = Depends(get_db)):
    await login_limiter.check(http_request)

    ip = fail2ban.get_client_ip(http_request)
    ua = http_request.headers.get('user-agent')

    # 1. IP в блоке? — отказ ещё до похода в БД за пользователем.
    await fail2ban.assert_not_blocked(db, ip=ip)

    user_result = await db.execute(select(User).where(User.email == request.email))
    user = user_result.scalar_one_or_none()

    # 2. Если пользователь существует — проверяем блокировку аккаунта до verify.
    if user is not None:
        await fail2ban.assert_not_blocked(db, ip=ip, user=user)

    password_ok = bool(user) and verify_password(request.password, user.hashed_password)

    if not password_ok:
        # Логируем попытку, эскалируем при необходимости. Коммитим даже на фейле.
        await fail2ban.log_attempt(
            db, ip=ip, username=request.email, success=False,
            user_id=user.id if user else None, user_agent=ua,
        )
        if user is not None:
            user.failed_attempts = (user.failed_attempts or 0) + 1
            user.last_failed_at = datetime.now(timezone.utc)
            settings = await fail2ban.get_settings(db)
            if fail2ban._as_bool(settings.get('auth.enabled'), True):
                await fail2ban.maybe_lock_account(user, settings)
                await fail2ban.maybe_block_ip(db, ip, settings)
        else:
            settings = await fail2ban.get_settings(db)
            if fail2ban._as_bool(settings.get('auth.enabled'), True):
                await fail2ban.maybe_block_ip(db, ip, settings)
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        await fail2ban.log_attempt(
            db, ip=ip, username=request.email, success=False, user_id=user.id, user_agent=ua,
        )
        await db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive")

    # 3. Успех: лог + сброс счётчика.
    await fail2ban.log_attempt(
        db, ip=ip, username=user.email, success=True, user_id=user.id, user_agent=ua,
    )
    user.failed_attempts = 0
    user.locked_until = None

    # Снимаем значения в локальные переменные ДО любого commit — после commit
    # ORM-объект user становится expired и доступ к атрибутам вызовет ленивый
    # запрос в уже завершённой транзакции (MissingGreenlet).
    user_id = user.id
    user_username = user.username
    user_role = user.role

    # Создаём "Saved Messages" если нет (для старых пользователей)
    from app.models.group import Group, GroupMember, Chat
    existing_saved = await db.execute(
        select(Group).where(Group.owner_id == user_id, Group.is_personal == True)
    )
    if not existing_saved.scalar_one_or_none():
        saved_group = Group(name='Saved Messages', owner_id=user_id, image_path='', is_personal=True)
        db.add(saved_group)
        await db.flush()
        db.add(GroupMember(group_id=saved_group.id, user_id=user_id, role='owner'))
        db.add(Chat(name='Saved Messages', group_id=saved_group.id, type='text'))

    # 4. Создаём server-side сессию (refresh-токен). Plaintext получим один раз.
    session, refresh_plaintext = await create_session(db, user_id, ua, ip)
    session_id = session.id

    # Снимаем _user_info ДО commit'а — на этом этапе user-объект ещё не expired,
    # все атрибуты доступны без re-fetch'а. Раньше после commit'а делали
    # db.refresh(user), что добавляло лишний DB roundtrip на каждом логине.
    user_info_dict = _user_info(user).model_dump()

    # Один commit на всё: log_attempt + сброс failed_attempts/locked_until +
    # опциональный saved-group + новая сессия. Раньше commit стоял ВНУТРИ if'а,
    # поэтому для существующих юзеров (с уже созданным Saved Messages) лог входа терялся.
    await db.commit()

    access_token = create_access_token(user_id, user_username, user_role, session_id=str(session_id))
    return {
        "access_token": access_token,
        "refresh_token": refresh_plaintext,
        "token_type": "bearer",
        "expires_in": 60 * 15,  # совпадает с ACCESS_TOKEN_EXPIRE_MINUTES в .env
        "user": user_info_dict,
    }


# ─── Session management endpoints ────────────────────────────────────────

@router.post("/refresh", response_model=RefreshResponse)
async def refresh_tokens(
    body: RefreshRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Обмен refresh-токена на новую пару (access + refresh) с rotation.

    Поток:
    1. Парсим token_id (32 hex) и secret из plaintext-токена
    2. Indexed lookup сессии по token_id — O(1) вместо bcrypt-scan по всем
    3. SELECT FOR UPDATE — сериализуем concurrent refresh от одного клиента
    4. bcrypt-сравнение secret-части
    5. Если revoked, но < 10 сек назад — race condition вкладок, отдаём 401
       без катастрофы. Если > 10 сек — реальный reuse, жжём все сессии юзера
    6. Rotation: revoke старую, создаём новую
    """
    await refresh_limiter.check(http_request)

    parsed = parse_refresh_token(body.refresh_token)
    if not parsed:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    token_id, secret = parsed

    # SELECT FOR UPDATE сериализует concurrent /refresh от одного клиента
    # (например двух вкладок с одинаковым refresh после перезапуска бэка).
    # Второй refresh подождёт пока первый закоммитится, увидит revoked_at и
    # уйдёт в grace-period или steal-detection.
    matched = await db.scalar(
        select(AuthSession)
        .where(AuthSession.token_id == token_id)
        .with_for_update()
    )

    if matched is None or not verify_refresh_secret(secret, matched.refresh_token_hash):
        # Не существует или secret не совпадает (атакующий подсунул мусор)
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if matched.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired")

    # Reuse detection с grace period
    if matched.revoked_at is not None:
        age = (datetime.now(timezone.utc) - matched.revoked_at).total_seconds()
        if age <= REFRESH_REUSE_GRACE_SECONDS:
            # Только что revoked — это race condition между параллельными
            # refresh'ами с разных вкладок. Не паникуем.
            raise HTTPException(status_code=401, detail="Token already used; please retry")
        # Реальный reuse: атакующий или старая копия токена. Жжём всё.
        await revoke_all_user_sessions(db, matched.user_id)
        await db.commit()
        raise HTTPException(status_code=401, detail="Token reuse detected; all sessions revoked")

    user = await db.get(User, matched.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Account inactive")

    # IP-блок чек: если юзер забанен fail2ban'ом — refresh не проходит
    ip = fail2ban.get_client_ip(http_request)
    await fail2ban.assert_not_blocked(db, ip=ip, user=user)

    # Rotation: revoke старую сессию, создаём новую с свежим refresh.
    matched.revoked_at = datetime.now(timezone.utc)
    new_session, new_refresh = await create_session(
        db, user.id,
        http_request.headers.get('user-agent'),
        ip,
    )
    new_session_id = new_session.id
    user_id_local = user.id
    user_username = user.username
    user_role = user.role
    await db.commit()

    new_access = create_access_token(user_id_local, user_username, user_role, session_id=str(new_session_id))
    return RefreshResponse(
        access_token=new_access,
        refresh_token=new_refresh,
        token_type="bearer",
        expires_in=60 * 15,
    )


@router.post("/logout", status_code=204)
async def logout(
    body: RefreshRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Revoke текущую сессию по refresh-токену. Не требует access-токена —
    клиент может вылогиниться даже с истёкшим access. Idempotent: если
    токен невалидный или уже revoked — всё равно 204."""
    await logout_limiter.check(http_request)

    parsed = parse_refresh_token(body.refresh_token)
    if not parsed:
        return  # 204 — невалидный токен молча игнорируем (предотвращает enum)
    token_id, secret = parsed

    sess = await db.scalar(
        select(AuthSession).where(AuthSession.token_id == token_id)
    )
    if sess and sess.revoked_at is None and verify_refresh_secret(secret, sess.refresh_token_hash):
        sess.revoked_at = datetime.now(timezone.utc)
        await db.commit()


@router.get("/sessions", response_model=list[SessionInfo])
async def list_sessions(
    http_request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список активных сессий текущего юзера. Текущая помечается is_current=true
    через session_id из JWT."""
    # Достаём sid из JWT текущего запроса
    auth = http_request.headers.get('authorization', '')
    current_sid: str | None = None
    if auth.startswith('Bearer '):
        try:
            from app.auth import decode_access_token
            payload = decode_access_token(auth[7:])
            current_sid = payload.get('sid') if payload else None
        except Exception:
            pass

    rows = (await db.execute(
        select(AuthSession)
        .where(
            AuthSession.user_id == current_user.id,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > datetime.now(timezone.utc),
        )
        .order_by(AuthSession.last_used_at.desc())
    )).scalars().all()

    return [SessionInfo(
        id=str(s.id),
        user_agent=s.user_agent or '',
        ip=str(s.ip) if s.ip else None,
        created_at=s.created_at,
        last_used_at=s.last_used_at,
        expires_at=s.expires_at,
        is_current=(current_sid is not None and str(s.id) == current_sid),
    ) for s in rows]


@router.delete("/sessions/{session_id}", status_code=204)
async def revoke_one_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke конкретную сессию (logout с одного устройства)."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session id")

    sess = await db.get(AuthSession, sid)
    if not sess or sess.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    if sess.revoked_at is None:
        sess.revoked_at = datetime.now(timezone.utc)
        await db.commit()


@router.delete("/sessions", status_code=204)
async def revoke_all_other_sessions(
    http_request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke все сессии кроме текущей ("logout from all other devices")."""
    auth = http_request.headers.get('authorization', '')
    current_sid: uuid.UUID | None = None
    if auth.startswith('Bearer '):
        try:
            from app.auth import decode_access_token
            payload = decode_access_token(auth[7:])
            sid_str = payload.get('sid') if payload else None
            if sid_str:
                current_sid = uuid.UUID(sid_str)
        except (ValueError, KeyError):
            pass

    await revoke_all_user_sessions(db, current_user.id, except_session_id=current_sid)
    await db.commit()