from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
import uuid
from datetime import datetime

from app.database import Base


class MessageBookmark(Base):
    """Личные закладки пользователя на сообщения.

    В отличие от пинов (общие на чат, видны всем), закладки — приватные.
    Один пользователь может закладывать одно сообщение только один раз.
    """
    __tablename__ = 'message_bookmark'

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('user.id', ondelete='CASCADE'), primary_key=True,
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('message.id', ondelete='CASCADE'), primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
