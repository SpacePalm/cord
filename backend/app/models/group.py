from typing import Literal
from sqlalchemy import String, Boolean, DateTime, ForeignKey, func, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.database import Base
from datetime import datetime


class GroupMember(Base):
    """Связь пользователь ↔ группа (many-to-many)."""
    __tablename__ = 'group_member'
    __table_args__ = (
        # Compound PK = (group_id, user_id) — эффективен для WHERE group_id=...,
        # но запросы "мои группы" (WHERE user_id=?) делают seq scan. Отдельный индекс.
        Index('idx_group_member_user', 'user_id'),
    )

    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('group.id', ondelete='CASCADE'), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('user.id', ondelete='CASCADE'), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False, default='member')
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Group(Base):
    __tablename__ = 'group'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # unique=True убран — в реальном Discord имена серверов не уникальны глобально
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('user.id', ondelete='CASCADE'), nullable=False
    )
    image_path: Mapped[str] = mapped_column(String, default='')
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_personal: Mapped[bool] = mapped_column(Boolean, default=False)
    # Direct Message: "группа" из 2 участников без UI-атрибутов сервера.
    # Используем Group как носитель чатов (text + опционально voice), чтобы
    # переиспользовать WebSocket, права, сообщения, реакции без изменений.
    is_dm: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    chats: Mapped[list['Chat']] = relationship(back_populates='group', cascade='all, delete-orphan')


class Chat(Base):
    __tablename__ = 'chat'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # unique=True убран — разные группы могут иметь канал с одинаковым именем
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('group.id', ondelete='CASCADE'), nullable=False
    )
    type: Mapped[Literal['text', 'voice']] = mapped_column(String(10), nullable=False)
    # Цветной индикатор в сайдбаре. Hex `#RRGGBB`/`#RGB` либо NULL (без индикации).
    # Хранится строкой а не enum'ом — даём пользователю произвольный цвет.
    color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped['Group'] = relationship('Group', back_populates='chats')


class GroupInvite(Base):
    __tablename__ = 'group_invite'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('group.id', ondelete='CASCADE'), nullable=False
    )
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('user.id', ondelete='CASCADE'), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
