from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://cord:cord@db:5432/cord"
    master_key: str = ""  # Fernet key, must be set via env

    jwt_secret: str = "change-me-in-production"  # VUI_JWT_SECRET
    jwt_algorithm: str = "HS256"
    # Access-токен короткий: фронт обновляет его через refresh-токен (30 дней).
    # 15 минут — индустриальный стандарт. Раньше было 1440 (24h) — больше не
    # требуется, потому что refresh-rotation покрывает длинные сессии.
    jwt_expire_minutes: int = 15

    admin_username: str = "admin"
    admin_email: str = "admin@admin.com"
    admin_password: str = "admin123"

    cors_origins: str = "*"  # comma-separated origins, e.g. "https://example.com,https://app.example.com"

    redis_url: str = "redis://redis:6379"

    livekit_url: str = "http://livekit:7880"
    livekit_public_url: str = "ws://localhost:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "secret"

    model_config = {"env_prefix": "CORD_"}

settings = Settings()

