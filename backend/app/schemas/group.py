import re
from pydantic import BaseModel, ConfigDict, Field, field_validator
from uuid import UUID
from datetime import datetime

# Hex-цвет: #RGB или #RRGGBB. Регистро-нечувствителен. None — «без цвета».
_HEX_COLOR_RE = re.compile(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')


def _validate_color(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if not _HEX_COLOR_RE.match(v):
        raise ValueError('color must be hex like #RGB or #RRGGBB, or null')
    return v.lower()


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
    is_personal: bool = False
    is_dm: bool = False
    created_at: datetime


class ChatCreate(BaseModel):
    name: str
    type: str = 'text'
    color: str | None = None

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

    @field_validator('color')
    @classmethod
    def color_valid(cls, v: str | None) -> str | None:
        return _validate_color(v)


class ChatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    group_id: UUID
    type: str
    color: str | None = None
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
    """Частичное обновление канала. Все поля опциональны — патчатся только переданные.

    Передача `color: null` явно очищает цвет (отсутствие в JSON — поле не трогается).
    Чтобы различать, используем `model_fields_set` в endpoint'е.
    """
    name: str | None = Field(None, min_length=1, max_length=50)
    color: str | None = None

    @field_validator('color')
    @classmethod
    def color_valid(cls, v: str | None) -> str | None:
        return _validate_color(v)


class InviteOut(BaseModel):
    code: str
    expires_at: datetime
    url: str
