"""Optional Redis client. Returns None when REDIS_URL is not configured."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import redis as redis_module

_logger = logging.getLogger(__name__)
_client: "redis_module.Redis | None" = None
_initialized = False


def get_redis() -> "redis_module.Redis | None":
    global _client, _initialized
    if _initialized:
        return _client
    _initialized = True

    from app.config import settings

    if not settings.redis_url:
        return None

    try:
        import redis

        _client = redis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=2)
        _client.ping()
        _logger.info("Redis connected: %s", settings.redis_url)
    except Exception as exc:
        _logger.warning("Redis unavailable (%s) — falling back to in-memory stores", exc)
        _client = None
    return _client
