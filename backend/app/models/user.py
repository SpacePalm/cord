from sqlalchemy import String, Boolean, DateTime, Text, func, Index
from sqlalchemy.orm import Mapped, mapped_column, validates
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.database import Base
from datetime import datetime


class User(Base):
    __tablename__ = 'user'
    __table_args__ = (
        # Trigram-индексы для ILIKE-поиска (/api/users/search и админка).
        # Требует pg_trgm (создаётся в main.py на старте).
        Index(
            'idx_user_username_trgm', 'username',
            postgresql_using='gin', postgresql_ops={'username': 'gin_trgm_ops'},
        ),
        Index(
            'idx_user_display_name_trgm', 'display_name',
            postgresql_using='gin', postgresql_ops={'display_name': 'gin_trgm_ops'},
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="user")
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    image_path: Mapped[str] = mapped_column(String, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="online", nullable=False)  # online, idle, dnd, invisible
    status_text: Mapped[str | None] = mapped_column(String(128), nullable=True, default=None)
    theme_json: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    @validates('username')
    def set_display_name(self, key, username):
        self.display_name = username
        return username
    