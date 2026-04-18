"""
Простой rate limiter на Redis.

Использует fixed window + INCR. Для продакшена этого достаточно: Redis одноатомарный,
счётчик сбрасывается по TTL. При недоступности Redis запрос пропускается
(fail-open) — безопасность не должна полностью блокировать сервис при проблемах с кэшем.

Использование:
    from fastapi import Request
    from app.rate_limit import RateLimiter

    login_limiter = RateLimiter(key='login', limit=10, window_seconds=300)

    @router.post('/login')
    async def login(request: Request, ...):
        await login_limiter.check(request)
        ...
"""

import logging
from dataclasses import dataclass

from fastapi import HTTPException, Request, status

from app.cache import get_redis

logger = logging.getLogger(__name__)


def _client_ip(request: Request) -> str:
    # Учитываем nginx / reverse proxy: X-Forwarded-For содержит цепочку, берём первый
    fwd = request.headers.get('x-forwarded-for')
    if fwd:
        return fwd.split(',')[0].strip()
    real = request.headers.get('x-real-ip')
    if real:
        return real.strip()
    return request.client.host if request.client else 'unknown'


@dataclass
class RateLimiter:
    key: str           # логический префикс, например 'login'
    limit: int         # максимум запросов в окне
    window_seconds: int  # длина окна

    async def check(self, request: Request) -> None:
        ip = _client_ip(request)
        redis_key = f'cord:rl:{self.key}:{ip}'
        try:
            r = await get_redis()
            # INCR + EXPIRE атомарно через pipeline. EXPIRE ставится только если ключа не было.
            pipe = r.pipeline()
            pipe.incr(redis_key)
            pipe.expire(redis_key, self.window_seconds, nx=True)
            count, _ = await pipe.execute()
        except Exception as exc:
            # fail-open: при недоступности Redis не ломаем сервис
            logger.warning('rate_limit redis error for %s: %s', self.key, exc)
            return

        if count > self.limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f'Too many requests. Try again in {self.window_seconds} seconds.',
                headers={'Retry-After': str(self.window_seconds)},
            )
