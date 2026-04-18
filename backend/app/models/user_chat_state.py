from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.database import Base
from datetime import datetime

class UserChatState(Base):
    __tablename__ = 'user_chat_state'
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('user.id', ondelete='CASCADE'), primary_key=True)
    chat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('chat.id', ondelete='CASCADE'), primary_key=True)
    last_read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
