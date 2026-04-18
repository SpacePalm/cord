"""
Публичные (для авторизованных) эндпоинты по пользователям.

  GET /api/users/search?q=foo  — поиск пользователей, с которыми есть общая группа
"""

import uuid

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import and_, func as sa_func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.cache import get_cached_search, set_cached_search
from app.database import get_db
from app.models.group import GroupMember
from app.models.user import User
from app.rate_limit import RateLimiter

router = APIRouter(prefix='/api/users', tags=['users'])

# Тот же лимит что и у messages search — 60 req/min на IP.
_user_search_limiter = RateLimiter(key='search', limit=60, window_seconds=60)


class UserShortOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str
    display_name: str
    image_path: str = ''
    status: str = 'online'


@router.get('/search', response_model=list[UserShortOut])
async def search_users(
    http_request: Request,
    q: str = Query(..., min_length=2, max_length=50),
    limit: int = Query(10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Поиск пользователей с учётом приватности (Telegram-style):

    1. **Контакты** — пользователи, с которыми есть хотя бы одна общая группа
       (обычная, личная или DM). Ищутся по подстроке с multi-word AND.

    2. **Незнакомцы** — остальные активные пользователи. Показываются только
       если запрос ТОЧНО совпадает с username (без учёта регистра, с опциональным @).

    Это предотвращает «просмотр базы» — нельзя набрать «a» и увидеть всех
    пользователей с буквой a. Чтобы связаться с незнакомцем, нужно знать
    его username целиком.

    Кэшируется в Redis на 30с по (user_id, q, limit).
    """
    await _user_search_limiter.check(http_request)
    cache_params = {'q': q.strip().lower(), 'limit': limit}
    cached = await get_cached_search('users', str(current_user.id), cache_params)
    if cached is not None:
        return [UserShortOut.model_validate(d) for d in cached]

    def _escape(w: str) -> str:
        return w.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')

    # Multi-word AND для поиска среди контактов: «ivan petrov» → оба слова
    # должны матчиться в username ИЛИ display_name.
    words = [w for w in q.split() if w]
    word_conditions = [
        or_(
            User.username.ilike(f'%{_escape(w)}%', escape='\\'),
            User.display_name.ilike(f'%{_escape(w)}%', escape='\\'),
        )
        for w in words
    ]

    # Подзапрос: все юзеры-контакты (общие группы любого типа)
    my_group_ids = select(GroupMember.group_id).where(
        GroupMember.user_id == current_user.id
    )
    contact_user_ids = select(GroupMember.user_id).where(
        GroupMember.group_id.in_(my_group_ids),
        GroupMember.user_id != current_user.id,
    )

    # Нормализация запроса для exact-lookup: убираем @, пробелы, регистр
    exact_q = q.strip().lstrip('@').lower()

    stmt = (
        select(User)
        .where(
            User.id != current_user.id,
            User.is_active.is_(True),
            or_(
                # Контакт: хотя бы одна общая группа + подстрочный матч
                and_(User.id.in_(contact_user_ids), *word_conditions) if word_conditions
                    else User.id.in_(contact_user_ids),
                # Незнакомец: точное совпадение username (без @, case-insensitive)
                sa_func.lower(User.username) == exact_q,
            ),
        )
        .limit(limit)
    )
    result = await db.execute(stmt)
    users = result.scalars().all()
    outs = [UserShortOut.model_validate(u) for u in users]
    await set_cached_search('users', str(current_user.id), cache_params, [o.model_dump(mode='json') for o in outs])
    return outs
