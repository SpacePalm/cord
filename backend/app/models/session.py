"""Refresh-token sessions.

Каждая успешная аутентификация создаёт строку в этой таблице. Refresh-токен
выдаётся в plaintext один раз, в БД хранится bcrypt-hash для возможности revoke.

Pattern из RFC 6749/6819:
- access_token (JWT, 15 мин) — носится в Authorization header
- refresh_token (opaque, 30 дней) — лежит в localStorage, посылается только
  на /api/auth/refresh для получения новой пары
- rotation: при каждом /refresh выдаётся новый refresh_token, старый
  инвалидируется (revoked_at = now)
- steal-detection: попытка использовать уже-revoked refresh = revoke ВСЕ
  активные сессии этого юзера (RFC 6819 §5.2.2.3)
"""
from sqlalchemy import String, DateTime, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import UUID, INET
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
import uuid

from app.database import Base


class Session(Base):
    __tablename__ = 'session'
    __table_args__ = (
        # Hot path: lookup активных сессий юзера для UI
        Index('idx_session_user_active', 'user_id', 'revoked_at', 'expires_at'),
        # Очистка истёкших — сворачивается в индекс по expires_at
        Index('idx_session_expires', 'expires_at'),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('user.id', ondelete='CASCADE'), nullable=False,
    )
    # Несекретный 32-hex префикс refresh-токена. Лежит в самом токене на клиенте,
    # дублируется здесь как unique-индекс для O(1) lookup на /refresh и /logout.
    # Без него пришлось бы перебирать ВСЕ активные сессии и bcrypt-сравнивать
    # каждую — DoS-вектор и узкое место по CPU.
    token_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    # bcrypt-hash секретной части refresh-токена. Plaintext выдаётся один раз
    # при создании/rotation. Формат токена на клиенте: "{token_id}.{secret}".
    refresh_token_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[str] = mapped_column(String(500), nullable=False, default='')
    ip: Mapped[str | None] = mapped_column(INET, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
    )
    # Не null = revoked. После revoke сессия не удаляется сразу — оставляем
    # для steal-detection (если кто-то попытается ещё раз использовать
    # старый refresh, мы это увидим и сожжём всё).
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )
