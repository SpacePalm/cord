"""
Redis-клиент и хелперы для кэширования сообщений.

Стратегия:
  - Ключ cord:msgs:{chat_id} хранит JSON первой страницы (50 сообщений)
  - TTL = 60 секунд
  - При любой записи в канал (POST / PATCH / DELETE) ключ инвалидируется
  - Запросы с cursor (before/after) всегда идут в БД — только первая страница кэшируется
"""

import hashlib
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


# ─── Fail2ban cache ──────────────────────────────────────────────────────
# get_current_user вызывается на КАЖДОМ authenticated запросе, и оттуда идёт
# assert_not_blocked, который без кеша делает 2 SQL-запроса (settings + ip_block).
# При page reload с 8 concurrent fetch'ами это 16 лишних SQL → видимый лаг.
#
# Кешируем оба:
# - settings: TTL 30с, инвалидируется при PATCH /admin/auth/settings
# - ip_block status: TTL 10с per-IP, инвалидируется при POST/DELETE /admin/auth/blocks
#
# Fail-open: любая ошибка Redis возвращает None, вызывающий код идёт в БД.

F2B_SETTINGS_TTL = 30
F2B_SETTINGS_KEY = "cord:f2b:settings"
F2B_BLOCK_TTL = 10
F2B_BLOCK_KEY = "cord:f2b:block:{ip}"  # value: "1" если забанен, "0" если нет


async def get_cached_f2b_settings() -> dict[str, str] | None:
    try:
        r = await get_redis()
        raw = await r.get(F2B_SETTINGS_KEY)
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.warning("Redis f2b settings read error: %s", exc)
    return None


async def set_cached_f2b_settings(settings: dict[str, str]) -> None:
    try:
        r = await get_redis()
        await r.setex(F2B_SETTINGS_KEY, F2B_SETTINGS_TTL, json.dumps(settings))
    except Exception as exc:
        logger.warning("Redis f2b settings write error: %s", exc)


async def invalidate_f2b_settings() -> None:
    try:
        r = await get_redis()
        await r.delete(F2B_SETTINGS_KEY)
    except Exception as exc:
        logger.warning("Redis f2b settings invalidate error: %s", exc)


async def get_cached_ip_block_status(ip: str) -> bool | None:
    """True/False = забанен/не забанен (cached). None = нет данных в кеше."""
    try:
        r = await get_redis()
        raw = await r.get(F2B_BLOCK_KEY.format(ip=ip))
        if raw is not None:
            return raw == "1"
    except Exception as exc:
        logger.warning("Redis f2b block read error: %s", exc)
    return None


async def set_cached_ip_block_status(ip: str, blocked: bool) -> None:
    try:
        r = await get_redis()
        await r.setex(F2B_BLOCK_KEY.format(ip=ip), F2B_BLOCK_TTL, "1" if blocked else "0")
    except Exception as exc:
        logger.warning("Redis f2b block write error: %s", exc)


async def invalidate_ip_block_status(ip: str) -> None:
    try:
        r = await get_redis()
        await r.delete(F2B_BLOCK_KEY.format(ip=ip))
    except Exception as exc:
        logger.warning("Redis f2b block invalidate error: %s", exc)


# ─── Admin auth panel cache ──────────────────────────────────────────────
# Админ-панель безопасности часто перечитывает одни и те же таблицы:
#   - /log  и /log/grouped  при скролле / переключении вкладки;
#   - /blocks и /locked-users  при инвалидации после mutate'ов (react-query).
# TTL короткий, чтобы свежие попытки/блоки попадали в выдачу за разумное время,
# но достаточный, чтобы скролл и переоткрытие вкладки не били каждый раз в БД.
#
# Логи — без явной инвалидации (новые записи появляются с лагом TTL).
# Blocks/locked — инвалидируются при mutate-эндпоинтах.

ADMIN_LOG_TTL = 10
ADMIN_LOG_GROUPED_TTL = 15
ADMIN_BLOCKS_TTL = 20
ADMIN_LOCKED_TTL = 20

ADMIN_LOG_KEY = "cord:f2b:log:{hash}"
ADMIN_LOG_GROUPED_KEY = "cord:f2b:log_grouped:{hash}"
ADMIN_BLOCKS_KEY = "cord:f2b:blocks:{only_active}"
ADMIN_LOCKED_KEY = "cord:f2b:locked"

# Префиксы для bulk-инвалидации через SCAN+DEL.
ADMIN_LOG_PREFIX = "cord:f2b:log:"
ADMIN_LOG_GROUPED_PREFIX = "cord:f2b:log_grouped:"
ADMIN_BLOCKS_PREFIX = "cord:f2b:blocks:"


def _params_hash(params: dict[str, Any]) -> str:
    payload = json.dumps(params, sort_keys=True, default=str)
    return hashlib.sha1(payload.encode()).hexdigest()[:16]


async def _get_json(key: str) -> Any | None:
    try:
        r = await get_redis()
        raw = await r.get(key)
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.warning("Redis read error (%s): %s", key, exc)
    return None


async def _set_json(key: str, value: Any, ttl: int) -> None:
    try:
        r = await get_redis()
        await r.setex(key, ttl, json.dumps(value, default=str))
    except Exception as exc:
        logger.warning("Redis write error (%s): %s", key, exc)


async def _delete_prefix(prefix: str) -> None:
    """Удаляет все ключи с заданным префиксом (SCAN+DEL).
    Безопасно для prod: SCAN не блокирует БД, в отличие от KEYS."""
    try:
        r = await get_redis()
        cursor = 0
        while True:
            cursor, keys = await r.scan(cursor=cursor, match=f"{prefix}*", count=100)
            if keys:
                await r.delete(*keys)
            if cursor == 0:
                break
    except Exception as exc:
        logger.warning("Redis prefix invalidate error (%s): %s", prefix, exc)


async def get_cached_admin_log(params: dict[str, Any]) -> list[dict] | None:
    return await _get_json(ADMIN_LOG_KEY.format(hash=_params_hash(params)))


async def set_cached_admin_log(params: dict[str, Any], data: list[dict]) -> None:
    await _set_json(ADMIN_LOG_KEY.format(hash=_params_hash(params)), data, ADMIN_LOG_TTL)


async def get_cached_admin_log_grouped(params: dict[str, Any]) -> list[dict] | None:
    return await _get_json(ADMIN_LOG_GROUPED_KEY.format(hash=_params_hash(params)))


async def set_cached_admin_log_grouped(params: dict[str, Any], data: list[dict]) -> None:
    await _set_json(ADMIN_LOG_GROUPED_KEY.format(hash=_params_hash(params)), data, ADMIN_LOG_GROUPED_TTL)


async def get_cached_admin_blocks(only_active: bool) -> list[dict] | None:
    return await _get_json(ADMIN_BLOCKS_KEY.format(only_active=int(only_active)))


async def set_cached_admin_blocks(only_active: bool, data: list[dict]) -> None:
    await _set_json(ADMIN_BLOCKS_KEY.format(only_active=int(only_active)), data, ADMIN_BLOCKS_TTL)


async def invalidate_admin_blocks() -> None:
    await _delete_prefix(ADMIN_BLOCKS_PREFIX)
    # Группированный лог содержит is_blocked — тоже надо сбросить.
    await _delete_prefix(ADMIN_LOG_GROUPED_PREFIX)


async def get_cached_admin_locked() -> list[dict] | None:
    return await _get_json(ADMIN_LOCKED_KEY)


async def set_cached_admin_locked(data: list[dict]) -> None:
    await _set_json(ADMIN_LOCKED_KEY, data, ADMIN_LOCKED_TTL)


async def invalidate_admin_locked() -> None:
    try:
        r = await get_redis()
        await r.delete(ADMIN_LOCKED_KEY)
    except Exception as exc:
        logger.warning("Redis admin locked invalidate error: %s", exc)


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


# ─── Search results cache ────────────────────────────────────────────────
#
# Короткий TTL — свежие сообщения/пользователи успевают попасть в выдачу за ~минуту.
# Ключ включает user_id, чтобы результаты одного юзера не утекали к другому.
# Fail-open: при ошибке Redis кэш просто пропускается, запрос идёт в БД как обычно.

SEARCH_TTL = 30
SEARCH_KEY = "cord:search:{kind}:{user_id}:{hash}"


def _search_key(kind: str, user_id: str, params: dict[str, Any]) -> str:
    payload = json.dumps(params, sort_keys=True, default=str)
    digest = hashlib.sha1(payload.encode()).hexdigest()[:16]
    return SEARCH_KEY.format(kind=kind, user_id=user_id, hash=digest)


async def get_cached_search(kind: str, user_id: str, params: dict[str, Any]) -> list[dict] | None:
    try:
        r = await get_redis()
        raw = await r.get(_search_key(kind, user_id, params))
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.warning("Redis search cache read error (%s): %s", kind, exc)
    return None


async def set_cached_search(
    kind: str, user_id: str, params: dict[str, Any], data: list[dict], ttl: int = SEARCH_TTL
) -> None:
    try:
        r = await get_redis()
        await r.setex(
            _search_key(kind, user_id, params),
            ttl,
            json.dumps(data, default=str),
        )
    except Exception as exc:
        logger.warning("Redis search cache write error (%s): %s", kind, exc)
