"""
Centralized application settings — single source of truth for all env vars.
"""
import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str

    # Auth / JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # Logging
    LOG_LEVEL: str = "INFO"

    # Schema management
    # Normal operation is Alembic-only. These legacy switches exist only for
    # controlled repair of old local databases that predate the migrations.
    RUN_CREATE_ALL_ON_STARTUP: bool = False
    RUN_STARTUP_SCHEMA_REPAIR: bool = False
    RUN_STARTUP_DATA_MAINTENANCE: bool = True

    # CORS
    CORS_ALLOW_ORIGINS: str = ""

    # Uploads
    UPLOAD_DIR: str = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "uploads"
    )
    MAX_UPLOAD_SIZE_MB: int = 10

    # OLT Proxy (Phase 2)
    OLT_PROXY_ENABLED: bool = False
    OLT_PROXY_URL: str = ""
    OLT_PROXY_TOKEN: str = ""
    OLT_PROXY_TIMEOUT_SEC: int = 10

    # Ingest pipeline (Pi → backend). Auth uses the same OLT_PROXY_TOKEN above
    # — there is one shared secret between Pi and backend.
    INGEST_RATE_LIMIT_PER_MIN: int = 120
    ALLOW_LEGACY_INGEST_TOKEN: bool = False

    model_config = SettingsConfigDict(
        env_file=os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", ".env"
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
