import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, status, Depends, Request, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.models.app_settings import AppSetting
from app.auth import hash_password, verify_password, create_access_token, get_current_user
from app.rate_limit import RateLimiter
from app import fail2ban

MEDIA_ROOT = Path('/app/media')

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 5 регистраций с одного IP в час — спаму новых аккаунтов не повредит, живому пользователю хватит
register_limiter = RateLimiter(key='register', limit=5, window_seconds=3600)
# 10 попыток логина за 5 минут с одного IP — защита от перебора паролей
login_limiter = RateLimiter(key='login', limit=10, window_seconds=300)

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
    token_type: str = "bearer"
    user: "UserInfo"

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
        await db.commit()
        # Обновляем объект user, чтобы _user_info() ниже не ломался на expired-атрибутах
        await db.refresh(user)

    token = create_access_token(user_id, user_username, user_role)
    return {"access_token": token, "token_type": "bearer", "user": _user_info(user).model_dump()}