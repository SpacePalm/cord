import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import engine, Base, AsyncSessionLocal
from app.api import auth, groups, messages, admin, polls, media, voice, notifications
from app.api.groups import invite_router
from app.models import poll as _poll_models  # noqa: F401 — registers Poll tables
from app.models import user_chat_state as _user_chat_state_models  # noqa: F401 — registers UserChatState table
from app.config import settings

app = FastAPI(title='Cord API')
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CORS — в dev разрешаем всё; в prod заменить origins на конкретные домены
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(auth.router)
app.include_router(groups.router)
app.include_router(invite_router)
app.include_router(messages.router)
app.include_router(polls.router)
app.include_router(media.router)
app.include_router(voice.router)
app.include_router(notifications.router)
app.include_router(admin.router)

# ---------------------------------------------------------------------------
# Static files
# Аватары — публичные, раздаются напрямую.
# Вложения сообщений (/media/messages/) защищены через /api/media/messages/
# ---------------------------------------------------------------------------
MEDIA_ROOT = Path('/app/media')
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
(MEDIA_ROOT / 'avatars').mkdir(exist_ok=True)
(MEDIA_ROOT / 'group_avatars').mkdir(exist_ok=True)
app.mount('/media/avatars', StaticFiles(directory=str(MEDIA_ROOT / 'avatars')), name='avatars')
app.mount('/media/group_avatars', StaticFiles(directory=str(MEDIA_ROOT / 'group_avatars')), name='group_avatars')


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event('startup')
async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@app.on_event('startup')
async def create_superuser():
    async with AsyncSessionLocal() as session:
        from app.models.user import User
        from app.auth import hash_password

        result = await session.execute(
            User.__table__.select().where(User.email == settings.admin_email)
        )
        if not result.scalar():
            superuser = User(
                username=settings.admin_username,
                email=settings.admin_email,
                hashed_password=hash_password(settings.admin_password),
                role='admin',
            )
            session.add(superuser)
            await session.commit()
            logger.info('Superuser created')


@app.get('/')
async def health():
    return {'status': 'ok'}
