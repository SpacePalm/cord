"""Модели для fail2ban-функционала: лог попыток входа + список заблокированных IP.

LoginAttempt — append-only таблица. Очищается фоновой задачей по retention из
настроек (по умолчанию 15 дней).

IpBlock — текущие активные блокировки. expires_at < now() считается истёкшим
и игнорируется при логине, но запись остаётся для истории до ручной чистки.
"""

from sqlalchemy import String, Boolean, DateTime, ForeignKey, Index, func, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, INET
import uuid
from datetime import datetime

from app.database import Base


class LoginAttempt(Base):
    __tablename__ = 'login_attempt'
    __table_args__ = (
        # Хот-путь: посчитать фейлы с IP за последние N секунд.
        Index('idx_login_attempt_ip_created', 'ip', 'created_at'),
        # Для группировки в админке и подсчёта по аккаунту.
        Index('idx_login_attempt_username_created', 'username_attempted', 'created_at'),
        # Только для свежих записей (фильтрация в админке).
        Index('idx_login_attempt_created', 'created_at'),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # INET вместо VARCHAR — нативный тип PG, занимает меньше, валидирует формат.
    ip: Mapped[str] = mapped_column(INET, nullable=False)
    # Логин может быть несуществующим (атакующий тыкает наугад) — храним как
    # текст, не FK. Ограничиваем длиной на случай длинных payload'ов.
    username_attempted: Mapped[str] = mapped_column(String(100), nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # User-Agent — обрезаем до 500. Полезно для аналитики (бот/реальный браузер).
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    # Если попытка относилась к существующему пользователю — связываем для UI.
    # SET NULL при удалении пользователя — чтобы лог переживал чистку.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey('user.id', ondelete='SET NULL'), nullable=True, default=None,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )


class IpBlock(Base):
    __tablename__ = 'ip_block'

    # IP — primary key. INET для нативной проверки.
    ip: Mapped[str] = mapped_column(INET, primary_key=True)
    reason: Mapped[str] = mapped_column(String(255), nullable=False, default='')
    # NULL = вечный бан. Авто-баны всегда с datetime, ручные могут быть null.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    # 'auto' (превышен порог) или 'manual' (админ через UI).
    blocked_by: Mapped[str] = mapped_column(String(20), nullable=False, default='auto')
    attempts_count: Mapped[int] = mapped_column(default=0, nullable=False)
    blocked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        Index('idx_ip_block_expires', text('expires_at NULLS LAST')),
    )
