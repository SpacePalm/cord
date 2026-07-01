"""APNs (Apple Push Notification service) клиент — HTTP/2 + token-based auth.

Прямой httpx(HTTP/2) + PyJWT(ES256) + cryptography, без сторонних APNs-либ
(все три уже в зависимостях; httpx[http2] тянет пакет h2).

Гейт: весь модуль — no-op, если не сконфигурирован APNs-ключ (dev без ключа).
JWT-провайдер кэширует подписанный токен ≤50 мин (APNs требует свежее ≤1ч).
Отправка возвращает статус: 'ok' | 'gone' (мёртвый токен, удалить) | 'error'.
"""
import asyncio
import json
import logging
import time

import httpx
import jwt

from app.config import settings

logger = logging.getLogger(__name__)

_APNS_HOST_PROD = 'https://api.push.apple.com'
_APNS_HOST_SANDBOX = 'https://api.sandbox.push.apple.com'

# APNs JWT живёт ≤1ч; обновляем с запасом (не переподписываем на каждый пуш).
_JWT_TTL_SECONDS = 50 * 60


def push_enabled() -> bool:
    """True только если сконфигурированы ВСЕ обязательные APNs-параметры."""
    return bool(
        settings.apns_auth_key
        and settings.apns_key_id
        and settings.apns_team_id
        and settings.apns_topic
    )


def _normalized_key() -> str:
    """Содержимое .p8. В env перевод строк часто хранят экранированным (\\n) —
    восстанавливаем реальные переносы, иначе cryptography не распарсит PEM.
    """
    return settings.apns_auth_key.replace('\\n', '\n')


class _ApnsJwtProvider:
    """Кэширует подписанный ES256-JWT, пересоздаёт по TTL. Потокобезопасно
    (asyncio.Lock) — параллельные пуши не подпишут N токенов зря."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._issued_at: float = 0.0
        self._lock = asyncio.Lock()

    async def get(self, now: float) -> str:
        async with self._lock:
            if self._token is None or (now - self._issued_at) >= _JWT_TTL_SECONDS:
                self._token = jwt.encode(
                    {'iss': settings.apns_team_id, 'iat': int(now)},
                    _normalized_key(),
                    algorithm='ES256',
                    headers={'kid': settings.apns_key_id},
                )
                self._issued_at = now
            return self._token


_jwt_provider = _ApnsJwtProvider()

# Единый HTTP/2 клиент — переиспользуем соединения к APNs между пушами.
_client: httpx.AsyncClient | None = None
_client_lock = asyncio.Lock()


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        async with _client_lock:
            if _client is None:
                _client = httpx.AsyncClient(http2=True, timeout=httpx.Timeout(10.0))
    return _client


def _host_for(env: str) -> str:
    return _APNS_HOST_PROD if env == 'production' else _APNS_HOST_SANDBOX


# Причины из тела ответа APNs, означающие «токен мёртв, удаляем из БД».
_DEAD_REASONS = {'BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'}


async def send_push(token: str, env: str, payload: dict) -> str:
    """Отправить один alert-пуш на одно устройство.

    Возвращает: 'ok' (200), 'gone' (токен мёртв — вызывающий обязан удалить),
    'error' (временная/иная ошибка — best-effort, без ретрая в v1).
    """
    if not push_enabled():
        return 'error'

    try:
        jwt_token = await _jwt_provider.get(time.time())
    except Exception as exc:
        logger.warning('[APNS] JWT sign failed: %r', exc)
        return 'error'

    host = _host_for(env or settings.apns_env)
    url = f'{host}/3/device/{token}'
    headers = {
        'authorization': f'bearer {jwt_token}',
        'apns-topic': settings.apns_topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
    }

    try:
        client = await _get_client()
        resp = await client.post(url, headers=headers, content=json.dumps(payload))
    except Exception as exc:
        logger.warning('[APNS] send failed token=%s… err=%r', token[:8], exc)
        return 'error'

    if resp.status_code == 200:
        return 'ok'

    reason = ''
    try:
        reason = (resp.json() or {}).get('reason', '')
    except Exception:
        pass

    if resp.status_code == 410 or reason in _DEAD_REASONS:
        logger.info('[APNS] dead token=%s… status=%s reason=%s', token[:8], resp.status_code, reason)
        return 'gone'

    logger.warning('[APNS] non-200 token=%s… status=%s reason=%s', token[:8], resp.status_code, reason)
    return 'error'
