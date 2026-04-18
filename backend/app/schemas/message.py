from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class ReplyTo(BaseModel):
    message_id: UUID
    author_display_name: str
    content: str | None


class ForwardedFrom(BaseModel):
    message_id: UUID
    author_display_name: str
    content: str | None
    chat_name: str


class PollOptionOut(BaseModel):
    id: UUID
    text: str
    votes_count: int
    voted: bool


class PollOut(BaseModel):
    id: UUID
    question: str
    options: list[PollOptionOut]
    user_voted_option_id: UUID | None
    total_votes: int


class EmbedOut(BaseModel):
    url: str
    title: str
    description: str = ''
    image: str | None = None
    site_name: str | None = None


class ReactionUserOut(BaseModel):
    user_id: UUID
    display_name: str
    image_path: str


class ReactionGroupOut(BaseModel):
    emoji: str
    users: list[ReactionUserOut]


class MessageOut(BaseModel):
    id: UUID
    content: str | None
    author_id: UUID
    author_username: str
    author_display_name: str
    author_image_path: str
    chat_id: UUID
    is_edited: bool
    is_pinned: bool
    created_at: datetime
    updated_at: datetime
    attachments: list[str]
    embeds: list[EmbedOut] = []
    reply_to: ReplyTo | None = None
    forwarded_from: ForwardedFrom | None = None
    poll: PollOut | None = None
    reactions: list[ReactionGroupOut] = []


class MessageEdit(BaseModel):
    content: str


class MessageForward(BaseModel):
    source_message_id: UUID


class MessageBulkForward(BaseModel):
    source_message_ids: list[UUID]


class MessageBulkDelete(BaseModel):
    message_ids: list[UUID]
