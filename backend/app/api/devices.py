"""
Регистрация device-токенов для APNs-пушей.

  POST   /api/devices/register         — upsert токена (привязка к текущему юзеру)
  DELETE /api/devices/register/{token} — снять токен (логаут / 410 от APNs на клиенте)

Клиент перерегистрирует токен на каждом запуске/логине (токен может меняться),
поэтому register — идемпотентный upsert по `token`.
"""
import uuid

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete as sa_delete, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.device_token import DeviceToken

router = APIRouter(prefix='/api/devices', tags=['push'])

# Разрешённые окружения APNs — всё прочее нормализуем в 'sandbox' (безопасный дефолт).
_ALLOWED_ENVS = {'sandbox', 'production'}


class DeviceRegisterRequest(BaseModel):
    # Контракт с iOS (§1): { token, platform:"ios", apns_env:"sandbox"|"production" }.
    # На проводе — snake_case `apns_env` (Swift-сторона кодирует camelCase→snake).
    token: str = Field(min_length=1, max_length=200)
    platform: str = 'ios'
    apns_env: str = 'sandbox'


@router.post('/register', status_code=204)
async def register_device(
    body: DeviceRegisterRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upsert токена по `token`. При конфликте — переназначаем владельца на
    текущего юзера (перелогин на том же устройстве) и обновляем last_seen_at/env.
    """
    user_id = user.id  # снимаем до commit (expire_on_commit).
    env = body.apns_env if body.apns_env in _ALLOWED_ENVS else 'sandbox'
    platform = (body.platform or 'ios')[:10]

    stmt = insert(DeviceToken).values(
        user_id=user_id,
        token=body.token,
        platform=platform,
        apns_env=env,
        last_seen_at=func.now(),
    ).on_conflict_do_update(
        index_elements=['token'],
        set_={
            'user_id': user_id,
            'apns_env': env,
            'platform': platform,
            'last_seen_at': func.now(),
        },
    )
    await db.execute(stmt)
    await db.commit()
    return Response(status_code=204)


@router.delete('/register/{token}', status_code=204)
async def unregister_device(
    token: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Снять токен. Скоупим по текущему юзеру — нельзя удалить чужую привязку."""
    await db.execute(
        sa_delete(DeviceToken).where(
            DeviceToken.token == token,
            DeviceToken.user_id == user.id,
        )
    )
    await db.commit()
    return Response(status_code=204)
