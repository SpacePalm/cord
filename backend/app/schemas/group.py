from pydantic import BaseModel, ConfigDict, Field, field_validator
from uuid import UUID
from datetime import datetime


class GroupCreate(BaseModel):
    name: str

    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('Name cannot be empty')
        return v


class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    owner_id: UUID
    image_path: str
    created_at: datetime


class ChatCreate(BaseModel):
    name: str
    type: str = 'text'

    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('Name cannot be empty')
        return v

    @field_validator('type')
    @classmethod
    def type_valid(cls, v: str) -> str:
        if v not in ('text', 'voice'):
            raise ValueError("type must be 'text' or 'voice'")
        return v


class ChatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    group_id: UUID
    type: str
    created_at: datetime


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: UUID
    username: str
    display_name: str
    image_path: str
    role: str = 'member'
    joined_at: datetime
    is_online: bool = False
    status: str = 'online'
    status_text: str | None = None


class GroupUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)


class ChatUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)


class InviteOut(BaseModel):
    code: str
    expires_at: datetime
    url: str
