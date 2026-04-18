from sqlalchemy import Text, DateTime, func, ForeignKey, Boolean, String, UniqueConstraint, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TSVECTOR
import uuid
from app.database import Base
from datetime import datetime


class Message(Base):
    __tablename__ = 'message'
    __table_args__ = (
        # Горячий путь истории: WHERE chat_id = ? ORDER BY created_at — B-tree composite
        Index('idx_message_chat_created', 'chat_id', 'created_at'),
        # Глобальный поиск /api/search/messages — ILIKE '%q%' по content через GIN+trigram.
        # Требует расширение pg_trgm (создаётся в main.py на старте).
        Index(
            'idx_message_content_trgm',
            'content',
            postgresql_using='gin',
            postgresql_ops={'content': 'gin_trgm_ops'},
            postgresql_where=text('content IS NOT NULL'),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('user.id', ondelete='CASCADE'), nullable=False
    )
    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('chat.id', ondelete='CASCADE'), nullable=False
    )
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_edited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    embeds_json: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Ответ на сообщение — денормализованные данные оригинала
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    reply_to_author: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reply_to_content: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Пересланное сообщение — денормализованные данные оригинала
    forwarded_from_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    forwarded_from_author: Mapped[str | None] = mapped_column(String(100), nullable=True)
    forwarded_from_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    forwarded_from_chat: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # tsvector для full-text search. Поддерживается триггером msg_tsv_update
    # (см. _RUNTIME_MIGRATIONS в main.py) — обновляется автоматически на INSERT/UPDATE content.
    content_tsv: Mapped[str | None] = mapped_column(TSVECTOR, nullable=True)

    attachments: Mapped[list['MessageAttachment']] = relationship(
        back_populates='message', cascade='all, delete-orphan'
    )
    author: Mapped['User'] = relationship('User', foreign_keys=[user_id])  # type: ignore[name-defined]
    poll: Mapped['Poll | None'] = relationship('Poll', back_populates='message', uselist=False)  # type: ignore[name-defined]
    reactions: Mapped[list['MessageReaction']] = relationship(
        back_populates='message', cascade='all, delete-orphan'
    )


class MessageAttachment(Base):
    __tablename__ = 'message_attachment'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('message.id', ondelete='CASCADE'), nullable=False
    )
    file_path: Mapped[str] = mapped_column(Text, nullable=False)

    message: Mapped['Message'] = relationship(back_populates='attachments')


class MessageReaction(Base):
    __tablename__ = 'message_reaction'
    __table_args__ = (
        # Один пользователь — одна реакция на сообщение
        UniqueConstraint('message_id', 'user_id', name='uq_reaction_message_user'),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('message.id', ondelete='CASCADE'), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('user.id', ondelete='CASCADE'), nullable=False
    )
    emoji: Mapped[str] = mapped_column(String(32), nullable=False)

    message: Mapped['Message'] = relationship(back_populates='reactions')
    user: Mapped['User'] = relationship('User')  # type: ignore[name-defined]
