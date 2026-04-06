import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.models.app_settings import AppSetting
from app.auth import hash_password, verify_password, create_access_token, get_current_user

MEDIA_ROOT = Path('/app/media')

router = APIRouter(prefix="/api/auth", tags=["auth"])

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

    model_config = {"from_attributes": True}



def _user_info(u: User) -> UserInfo:
    return UserInfo(
        id=str(u.id),
        username=u.username,
        display_name=u.display_name,
        email=u.email,
        role=u.role,
        image_path=u.image_path or '',
    )


@router.get("/me", response_model=UserInfo)
async def get_profile(current_user: User = Depends(get_current_user)):
    return _user_info(current_user)


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
        current_user.email = body.email.strip() or current_user.email

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
async def register(request: RegisterRequest, db: AsyncSession = Depends(get_db)):
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
    await db.commit()
    await db.refresh(new_user)
    
    return {"id": new_user.id, "username": new_user.username, "email": new_user.email}

@router.post("/login")
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    user_result = await db.execute(select(User).where(User.email == request.email))
    user = user_result.scalar_one_or_none()
    
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive")
    
    token = create_access_token(user.id, user.username, user.role)
    return {"access_token": token, "token_type": "bearer"}