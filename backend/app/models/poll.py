from sqlalchemy import String, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.database import Base


class Poll(Base):
    __tablename__ = 'poll'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('message.id', ondelete='CASCADE'), unique=True, nullable=False
    )
    question: Mapped[str] = mapped_column(String(500), nullable=False)

    options: Mapped[list['PollOption']] = relationship(
        back_populates='poll',
        cascade='all, delete-orphan',
        order_by='PollOption.position',
    )
    votes: Mapped[list['PollVote']] = relationship(
        back_populates='poll',
        cascade='all, delete-orphan',
    )
    message: Mapped['Message'] = relationship('Message', back_populates='poll')  # type: ignore[name-defined]


class PollOption(Base):
    __tablename__ = 'poll_option'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    poll_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('poll.id', ondelete='CASCADE'), nullable=False
    )
    text: Mapped[str] = mapped_column(String(500), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    poll: Mapped['Poll'] = relationship(back_populates='options')
    votes: Mapped[list['PollVote']] = relationship(back_populates='option', cascade='all, delete-orphan')


class PollVote(Base):
    __tablename__ = 'poll_vote'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    poll_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('poll.id', ondelete='CASCADE'), nullable=False
    )
    option_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('poll_option.id', ondelete='CASCADE'), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('user.id', ondelete='CASCADE'), nullable=False
    )

    poll: Mapped['Poll'] = relationship(back_populates='votes')
    option: Mapped['PollOption'] = relationship(back_populates='votes')

    __table_args__ = (
        UniqueConstraint('poll_id', 'user_id', name='uq_poll_user_vote'),
    )
