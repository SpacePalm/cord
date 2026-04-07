"""
Redis-клиент и хелперы для кэширования сообщений.

Стратегия:
  - Ключ cord:msgs:{chat_id} хранит JSON первой страницы (50 сообщений)
  - TTL = 60 секунд
  - При любой записи в канал (POST / PATCH / DELETE) ключ инвалидируется
  - Запросы с cursor (before/after) всегда идут в БД — только первая страница кэшируется
"""

import json
import logging
from typing import Any

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

_client: aioredis.Redis | None = None

MESSAGES_TTL = 60  # секунды
PAGE_KEY = "cord:msgs:{chat_id}"


async def get_redis() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _client


# Messages cache

def _key(chat_id: str) -> str:
    return PAGE_KEY.format(chat_id=chat_id)


async def get_cached_messages(chat_id: str) -> list[dict[str, Any]] | None:
    try:
        r = await get_redis()
        raw = await r.get(_key(chat_id))
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.warning("Redis read error: %s", exc)
    return None


async def set_cached_messages(chat_id: str, messages: list[dict[str, Any]]) -> None:
    try:
        r = await get_redis()
        await r.setex(_key(chat_id), MESSAGES_TTL, json.dumps(messages, default=str))
    except Exception as exc:
        logger.warning("Redis write error: %s", exc)


async def invalidate_messages(chat_id: str) -> None:
    try:
        r = await get_redis()
        await r.delete(_key(chat_id))
    except Exception as exc:
        logger.warning("Redis invalidate error: %s", exc)


# Online presence

ONLINE_TTL = 120  # секунды
ONLINE_KEY = "cord:online:{user_id}"


async def set_user_online(user_id: str) -> None:
    try:
        r = await get_redis()
        await r.setex(ONLINE_KEY.format(user_id=user_id), ONLINE_TTL, "1")
    except Exception as exc:
        logger.warning("Redis online set error: %s", exc)


async def is_user_online(user_id: str) -> bool:
    try:
        r = await get_redis()
        return await r.exists(ONLINE_KEY.format(user_id=user_id)) > 0
    except Exception as exc:
        logger.warning("Redis online check error: %s", exc)
        return False


async def get_online_user_ids(user_ids: list[str]) -> set[str]:
    """Проверяет список user_id и возвращает set тех, кто онлайн."""
    if not user_ids:
        return set()
    try:
        r = await get_redis()
        pipe = r.pipeline()
        for uid in user_ids:
            pipe.exists(ONLINE_KEY.format(user_id=uid))
        results = await pipe.execute()
        return {uid for uid, exists in zip(user_ids, results) if exists}
    except Exception as exc:
        logger.warning("Redis online batch check error: %s", exc)
        return set()


# Unread counts cache

UNREAD_TTL = 5  # секунды
UNREAD_KEY = "cord:unread:{user_id}"


async def get_cached_unread(user_id: str) -> dict | None:
    try:
        r = await get_redis()
        raw = await r.get(UNREAD_KEY.format(user_id=user_id))
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.warning("Redis unread read error: %s", exc)
    return None


async def set_cached_unread(user_id: str, data: dict) -> None:
    try:
        r = await get_redis()
        await r.setex(UNREAD_KEY.format(user_id=user_id), UNREAD_TTL, json.dumps(data, default=str))
    except Exception as exc:
        logger.warning("Redis unread write error: %s", exc)


async def invalidate_unread(user_id: str) -> None:
    try:
        r = await get_redis()
        await r.delete(UNREAD_KEY.format(user_id=user_id))
    except Exception as exc:
        logger.warning("Redis unread invalidate error: %s", exc)


# Call start time

CALL_KEY = "cord:call:{channel_id}"


async def get_call_started(channel_id: str) -> int | None:
    """Возвращает unix-ms старта конференции или None."""
    try:
        r = await get_redis()
        val = await r.get(CALL_KEY.format(channel_id=channel_id))
        return int(val) if val else None
    except Exception as exc:
        logger.warning("Redis call_started read error: %s", exc)
        return None


async def set_call_started(channel_id: str, ts_ms: int) -> None:
    """Ставит время старта, только если ключа ещё нет (NX)."""
    try:
        r = await get_redis()
        await r.set(CALL_KEY.format(channel_id=channel_id), str(ts_ms), nx=True)
    except Exception as exc:
        logger.warning("Redis call_started write error: %s", exc)


async def clear_call_started(channel_id: str) -> None:
    try:
        r = await get_redis()
        await r.delete(CALL_KEY.format(channel_id=channel_id))
    except Exception as exc:
        logger.warning("Redis call_started clear error: %s", exc)
