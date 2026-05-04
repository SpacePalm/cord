import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import engine, Base, AsyncSessionLocal
from app.api import auth, groups, messages, admin, polls, media, voice, notifications, ws, users, dms
from app.api import admin_fail2ban
from app.api.groups import invite_router
from app.api.messages import search_router
from app.models import poll as _poll_models  # noqa: F401 — registers Poll tables
from app.models import user_chat_state as _user_chat_state_models  # noqa: F401 — registers UserChatState table
from app.models import fail2ban as _fail2ban_models  # noqa: F401 — registers LoginAttempt + IpBlock
from app.models import session as _session_models  # noqa: F401 — registers Session (refresh tokens)
from app.config import settings

app = FastAPI(title='Cord API')
logger = logging.getLogger(__name__)

# Cord использует Bearer-токены в Authorization-header, не cookies.
# allow_credentials=True требуется только для cookie-auth и при этом несовместим
# с allow_origins=["*"] по CORS-RFC (браузер отвергает preflight). Поскольку
# у нас весь auth через JS-fetch с Authorization-header, credentials отключены.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(',')],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Routers
app.include_router(auth.router)
app.include_router(groups.router)
app.include_router(invite_router)
app.include_router(messages.router)
app.include_router(polls.router)
app.include_router(media.router)
app.include_router(voice.router)
app.include_router(notifications.router)
app.include_router(admin.router)
app.include_router(admin_fail2ban.router)
app.include_router(users.router)
app.include_router(dms.router)
app.include_router(search_router)
app.include_router(ws.router)

# Static files
# Аватары — публичные, раздаются напрямую.
# Вложения сообщений (/media/messages/) защищены через /api/media/messages/
MEDIA_ROOT = Path('/app/media')
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
(MEDIA_ROOT / 'avatars').mkdir(exist_ok=True)
(MEDIA_ROOT / 'group_avatars').mkdir(exist_ok=True)
app.mount('/media/avatars', StaticFiles(directory=str(MEDIA_ROOT / 'avatars')), name='avatars')
app.mount('/media/group_avatars', StaticFiles(directory=str(MEDIA_ROOT / 'group_avatars')), name='group_avatars')


# Startup

# Runtime-миграции: индексы + FTS-инфраструктура.
# create_all не добавляет индексы/колонки к существующим таблицам, поэтому
# досоздаём их вручную (все операторы идемпотентны).
_RUNTIME_MIGRATIONS: list[str] = [
    # ─── Индексы ────────────────────────────────────────────────────
    # GIN trigram по content — fallback для поиска нередких слов.
    "CREATE INDEX IF NOT EXISTS idx_message_content_trgm "
    "ON message USING gin (content gin_trgm_ops) WHERE content IS NOT NULL",
    # Composite для пагинации истории: WHERE chat_id=? ORDER BY created_at.
    "CREATE INDEX IF NOT EXISTS idx_message_chat_created "
    "ON message (chat_id, created_at)",
    # GIN trigram по username/display_name — для /api/users/search и админки.
    'CREATE INDEX IF NOT EXISTS idx_user_username_trgm '
    'ON "user" USING gin (username gin_trgm_ops)',
    'CREATE INDEX IF NOT EXISTS idx_user_display_name_trgm '
    'ON "user" USING gin (display_name gin_trgm_ops)',
    # Compound PK (group_id, user_id) неэффективен для запросов "мои группы".
    "CREATE INDEX IF NOT EXISTS idx_group_member_user "
    "ON group_member (user_id)",

    # ─── Full-Text Search ────────────────────────────────────────────
    # tsvector-колонка для русского полнотекстового поиска.
    # to_tsvector в PG STABLE (не IMMUTABLE), поэтому generated column
    # работает только через trigger, а не через GENERATED ALWAYS AS.
    "ALTER TABLE message ADD COLUMN IF NOT EXISTS content_tsv tsvector",
    # Trigger для авто-обновления tsvector при INSERT/UPDATE content.
    # CREATE OR REPLACE TRIGGER — PG 14+.
    "DROP TRIGGER IF EXISTS msg_tsv_update ON message",
    "CREATE TRIGGER msg_tsv_update BEFORE INSERT OR UPDATE OF content ON message "
    "FOR EACH ROW EXECUTE FUNCTION "
    "tsvector_update_trigger(content_tsv, 'pg_catalog.russian', content)",
    # Бэкфилл существующих строк (идемпотентно: только где NULL).
    # На больших БД может занять время — сделать разово вручную и закомментить.
    "UPDATE message SET content_tsv = to_tsvector('pg_catalog.russian', coalesce(content, '')) "
    "WHERE content_tsv IS NULL",
    # GIN-индекс по tsvector — основной для FTS-запросов.
    "CREATE INDEX IF NOT EXISTS idx_message_content_tsv "
    "ON message USING gin (content_tsv)",

    # ─── DM (Direct Messages) ────────────────────────────────────────
    'ALTER TABLE "group" ADD COLUMN IF NOT EXISTS is_dm BOOLEAN NOT NULL DEFAULT FALSE',
    # Индекс для быстрой выборки моих DM: WHERE is_dm=true AND id IN (мои группы).
    'CREATE INDEX IF NOT EXISTS idx_group_is_dm ON "group" (is_dm) WHERE is_dm = TRUE',

    # ─── User preferences ────────────────────────────────────────────
    # Кросс-девайсные настройки юзера (язык, уведомления, mute чатов).
    'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS preferences_json TEXT',

    # ─── Fail2ban: блокировки аккаунтов ──────────────────────────────
    'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMP WITH TIME ZONE',
    'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE',
    # Индекс для быстрой выборки заблокированных аккаунтов в админке.
    'CREATE INDEX IF NOT EXISTS idx_user_locked_until ON "user" (locked_until) WHERE locked_until IS NOT NULL',

    # ─── Channel color tag ───────────────────────────────────────────
    # Цветной индикатор канала в сайдбаре. Hex или NULL.
    'ALTER TABLE chat ADD COLUMN IF NOT EXISTS color VARCHAR(9)',

    # ─── Cleanup: bookmarks ──────────────────────────────────────────
    # Функция отменена (дублировала Saved Messages). Сносим таблицу,
    # если осталась с прошлых запусков. IF EXISTS — безопасно.
    'DROP TABLE IF EXISTS message_bookmark CASCADE',

    # ─── Refresh tokens: token_id для O(1) lookup ────────────────────
    # Без token_id сервер был вынужден bcrypt-сравнивать со всеми активными
    # сессиями на каждом /refresh — DoS-вектор. С индексом по token_id —
    # один SELECT + одна bcrypt-проверка.
    "ALTER TABLE session ADD COLUMN IF NOT EXISTS token_id VARCHAR(32)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_session_token_id ON session (token_id)",
    # Сессии созданные до миграции имеют token_id=NULL и refresh-токены без
    # точки в формате — они не работают (parse возвращает None → 401).
    # Удаляем чтобы не висели до природного истечения через 4 месяца.
    "DELETE FROM session WHERE token_id IS NULL",
]


@app.on_event('startup')
async def start_ws_pubsub_listener():
    """Redis pub/sub listener для WS broadcast-ов между воркерами.
    Без него при `uvicorn --workers N>1` события не доходят до ws,
    которые физически подключены к другому процессу.
    """
    from app.ws_manager import manager as ws_manager
    await ws_manager.start_listener()


@app.on_event('startup')
async def schedule_session_cleanup():
    """Раз в сутки чистит старые сессии (expired/revoked > 90 дней).

    Запускается через 60 сек после старта чтобы не тормозить boot.
    На failure ретраит через час, иначе спит 24h.
    Безопасно при нескольких воркерах: DELETE WHERE идемпотентен,
    параллельные запуски максимум продублируют SQL.
    """
    import asyncio
    from app.auth import cleanup_old_sessions

    async def loop():
        await asyncio.sleep(60)
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    deleted = await cleanup_old_sessions(db)
                    await db.commit()
                    if deleted:
                        logger.info('session cleanup: deleted %d old rows', deleted)
                # День до следующей итерации.
                await asyncio.sleep(24 * 3600)
            except Exception as exc:
                logger.warning('session cleanup failed: %r', exc)
                # На ошибке — ретрай через час, не ждём сутки.
                await asyncio.sleep(3600)

    asyncio.create_task(loop())


@app.on_event('startup')
async def check_security_defaults():
    """Loud warning if default secrets remain in production config.
    A default JWT secret allows anyone to forge tokens, including admin ones.
    """
    warnings: list[str] = []
    if settings.jwt_secret == 'change-me-in-production':
        warnings.append('CORD_JWT_SECRET is not set — tokens can be forged!')
    if settings.admin_password == 'admin123':
        warnings.append('CORD_ADMIN_PASSWORD is not set — default admin password in use!')
    if warnings:
        banner = '=' * 70
        logger.warning('\n%s\nSECURITY WARNING\n%s\n%s\n%s',
                       banner, banner, '\n'.join(f'  • {w}' for w in warnings), banner)


# Magic number для pg_advisory_lock — случайное 32-битное int, одинаковое для
# всех запусков. Любой воркер, который стартует первым, берёт этот лок;
# остальные ждут на нём. Это сериализует миграции и создание superuser'а при
# uvicorn --workers >1, иначе одновременный CREATE EXTENSION / INSERT user
# даёт UniqueViolationError из-за race condition на pg_extension_name_index
# или user.display_name UNIQUE.
_STARTUP_LOCK_KEY = 0x636F7264  # "cord"


@app.on_event('startup')
async def run_startup_migrations():
    """Сериализованные миграции + создание superuser под advisory lock.
    Все воркеры дойдут до этой точки; один держит lock, остальные блокируются,
    потом видят что всё сделано (IF NOT EXISTS / EXISTS check) и отпускают.
    """
    from sqlalchemy import text
    async with engine.begin() as conn:
        # Блокирующий advisory lock, освобождается автоматически при закрытии соединения.
        await conn.execute(text('SELECT pg_advisory_lock(:k)'), {'k': _STARTUP_LOCK_KEY})
        try:
            # Расширение pg_trgm — нужно до создания GIN trigram-индексов.
            await conn.execute(text('CREATE EXTENSION IF NOT EXISTS pg_trgm'))
            # Базовые таблицы (новые — будут созданы, существующие — пропущены)
            await conn.run_sync(Base.metadata.create_all)
            # Индексы и FTS — каждая операция в своём try, чтобы одна ошибка
            # не блокировала остальные.
            for stmt in _RUNTIME_MIGRATIONS:
                try:
                    await conn.execute(text(stmt))
                except Exception as exc:
                    logger.warning('migration failed: %s... → %s', stmt[:60], exc)

            # Создание superuser тут же под тем же локом. exists-check + insert
            # в одной транзакции, что эквивалентно атомарной idempotent-операции.
            from app.models.user import User
            from app.auth import hash_password
            row = (await conn.execute(
                text('SELECT id FROM "user" WHERE email = :e'),
                {'e': settings.admin_email},
            )).first()
            if not row:
                await conn.execute(
                    User.__table__.insert().values(
                        username=settings.admin_username,
                        display_name=settings.admin_username,
                        email=settings.admin_email,
                        hashed_password=hash_password(settings.admin_password),
                        role='admin',
                    )
                )
                logger.info('Superuser created')
        finally:
            await conn.execute(text('SELECT pg_advisory_unlock(:k)'), {'k': _STARTUP_LOCK_KEY})


@app.get('/')
async def health():
    return {'status': 'ok'}
