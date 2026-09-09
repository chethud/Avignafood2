from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import os


def _normalize_database_url(url: str) -> str:
    """Render/Heroku give postgres:// — SQLAlchemy + psycopg2 need postgresql+psycopg2://."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+psycopg2" not in url and "+asyncpg" not in url:
        return "postgresql+psycopg2://" + url[len("postgresql://") :]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg2://avighnya:avighnya@localhost:5432/avighnya"
    secret_key: str = "change-me-in-production-avighnya-foods-secret"
    access_token_expire_minutes: int = 60 * 12
    # Empty CORS_ORIGINS on Render (Blueprint sync:false) must not wipe this default
    cors_origins: str = (
        "http://localhost:3000,http://localhost:3001,https://avignafood2.vercel.app"
    )

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_db_url(cls, v: object) -> object:
        if isinstance(v, str) and v:
            return _normalize_database_url(v)
        return v

    @field_validator("cors_origins", mode="before")
    @classmethod
    def empty_cors_uses_default(cls, v: object) -> object:
        if v is None or (isinstance(v, str) and not v.strip()):
            return "http://localhost:3000,http://localhost:3001,https://avignafood2.vercel.app"
        return v

    @model_validator(mode="after")
    def require_remote_database_on_render(self) -> "Settings":
        # Render sets RENDER=true; without DATABASE_URL we would hit localhost and crash obscurely
        on_render = os.getenv("RENDER") == "true" or bool(os.getenv("RENDER_SERVICE_ID"))
        if on_render and ("localhost" in self.database_url or "127.0.0.1" in self.database_url):
            raise ValueError(
                "DATABASE_URL is missing or still points at localhost. "
                "On Render: create a PostgreSQL database, then set DATABASE_URL on this web service "
                "to the database Internal Database URL, and redeploy."
            )
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
