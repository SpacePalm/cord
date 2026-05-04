from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.config import settings

# Pool config: дефолт SQLAlchemy = pool_size=5 + max_overflow=10 = 15. Для
# Cord этого мало: get_current_user на каждом запросе делает 1-3 query, плюс
# сам handler ещё 1-5. На page reload ~10 concurrent fetch'ей × ~3 query =
# 30 одновременных подключений. Без запаса — wait'ы и видимый лаг (300-700мс).
#
# 20 base + 30 overflow = до 50 одновременных коннекшенов. Postgres по
# дефолту разрешает 100, остаётся запас под другие сервисы.
# pool_recycle=3600 — раз в час обновляем коннекшены чтобы не упереться в
# серверный idle timeout.
# pool_pre_ping=True — проверяем коннекшен перед использованием (защита от
# stale connections после рестарта Postgres).
engine = create_async_engine(
    settings.database_url,
    pool_size=20,
    max_overflow=30,
    pool_recycle=3600,
    pool_pre_ping=True,
)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session