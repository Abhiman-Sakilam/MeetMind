import logging
import os

from pydantic_settings import BaseSettings, SettingsConfigDict

_logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    groq_api_key: str = ""
    model_general: str = "llama-3.3-70b-versatile"
    model_router: str = "llama-3.1-8b-instant"
    model_summary: str = "llama-3.3-70b-versatile"
    model_notes: str = "llama-3.1-8b-instant"
    model_reasoning: str = "llama-3.3-70b-versatile"
    # Vision-capable Groq model for /v1/screen/analyze (must accept image_url in messages).
    model_screen: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    ai_brain_service_token: str = ""
    context_max_tokens: int = 2500
    context_keep_last_turns: int = 8
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173", "http://localhost:8000"]

    # Optional Redis URL. If set, all in-memory stores write through to Redis for persistence.
    # Falls back to pure in-memory if not set (no Redis required for local dev).
    redis_url: str = ""
    # Optional webhook URL to POST action items to an external task system.
    # If blank, action items are only returned in the response JSON.
    tasks_webhook_url: str = ""


settings = Settings()

_env = os.getenv("ENVIRONMENT", "local").lower()
if not settings.ai_brain_service_token and _env not in ("local", "dev", "development"):
    _logger.warning(
        "AI_BRAIN_SERVICE_TOKEN is empty in a non-local environment (%s). "
        "Any client can call the brain API without authentication. "
        "Set AI_BRAIN_SERVICE_TOKEN in .env or environment variables.",
        _env,
    )
