"""APNs device tokens for push notifications.

Один hex-токен = одно устройство. Регистрируется upsert'ом по `token`
(`POST /api/devices/register`), удаляется на логауте
(`DELETE /api/devices/register/{token}`) или бэком при 410/BadDeviceToken
от APNs (мёртвое устройство).

Зеркалит структуру `session.py`: UUID PK, FK на user с CASCADE, server-default
таймстемпы. `token` — unique, чтобы один и тот же токен при перелогине
переезжал на нового владельца (on_conflict по `token`).
"""
from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
import uuid

from app.database import Base


class DeviceToken(Base):
    __tablename__ = 'device_token'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('user.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    # APNs device-token (hex). Unique — один токен на одно устройство; при
    # перелогине другого юзера на том же устройстве строка переезжает к нему
    # (upsert on_conflict по token). index=True + unique → уникальный индекс.
    token: Mapped[str] = mapped_column(String(200), nullable=False, unique=True, index=True)
    platform: Mapped[str] = mapped_column(String(10), nullable=False, default='ios')
    # sandbox (dev/Xcode) | production (TestFlight/AppStore) — выбирает APNs-хост.
    apns_env: Mapped[str] = mapped_column(String(12), nullable=False, default='sandbox')
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    # Обновляется при каждой перерегистрации (клиент шлёт на запуске/логине).
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
