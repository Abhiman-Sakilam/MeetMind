from typing import Self

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings

_STT_INITIAL_PROMPT_DEFAULT = (
    "Meeting AI assistant named Jarvis. Users say Hey Jarvis or Jarvis. "
    "Jarvis, can you summarize? Hey Jarvis, what should we do?"
)


class Settings(BaseSettings):
    app_name: str = "MeetMind API"
    database_url: str = "postgresql+asyncpg://meetmind:meetmind@localhost:5432/meetmind"
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    turn_username: str = ""
    turn_credential: str = ""
    # Proxy to Tasks/ai-brain-orchestration (pattern A)
    ai_brain_base_url: str = ""
    ai_brain_service_token: str = ""
    # Local STT (faster-whisper). distil-medium.en balances quality vs CPU cost; use distil-large-v3 for best names/commands.
    stt_model_name: str = "distil-medium.en"
    # faster-whisper uses "cpu" or "cuda" (not "gpu")
    stt_device: str = "cpu"
    stt_compute_type: str = "int8"
    # Biases Whisper toward the assistant name (override via STT_INITIAL_PROMPT)
    stt_initial_prompt: str = _STT_INITIAL_PROMPT_DEFAULT
    # TTS — Coqui TTS. Set to empty string to disable.
    # Lightweight default: tts_models/en/vctk/vits (~100MB, fast, multi-speaker).
    # For higher quality: tts_models/multilingual/multi-dataset/xtts_v2 (~2GB, GPU recommended).
    tts_model_name: str = "tts_models/en/vctk/vits"
    tts_device: str = "cpu"
    # Email delivery (optional). Leave blank to disable email features.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = True
    # JWT auth. Set JWT_SECRET to a random string to enable protected routes.
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days
    # Google Sign-In (OAuth2 Web client ID). Empty disables the Google login endpoint.
    google_client_id: str = ""

    @field_validator("jwt_secret", mode="before")
    @classmethod
    def validate_jwt_secret(cls, v: object) -> object:
        if isinstance(v, str) and v and len(v) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return v

    @field_validator("stt_device", mode="before")
    @classmethod
    def normalize_stt_device(cls, v: object) -> object:
        if isinstance(v, str) and v.strip().lower() == "gpu":
            return "cuda"
        return v

    @model_validator(mode="after")
    def empty_stt_prompt_means_default(self) -> Self:
        if not self.stt_initial_prompt.strip():
            self.stt_initial_prompt = _STT_INITIAL_PROMPT_DEFAULT
        if not self.jwt_secret:
            # No secret configured: use a random per-process one (logins reset on restart)
            # rather than a guessable default. Set JWT_SECRET to keep sessions across restarts.
            import secrets
            self.jwt_secret = secrets.token_urlsafe(48)
        return self

    class Config:
        env_file = ".env"


settings = Settings()
