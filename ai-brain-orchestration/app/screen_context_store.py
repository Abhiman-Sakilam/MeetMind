from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from threading import RLock
from time import time

_logger = logging.getLogger(__name__)
_REDIS_TTL = 86400  # 24 h


@dataclass
class ScreenContext:
    last_image_base64: str = ""
    mime_type: str = "image/png"
    name: str = "screenshot.png"
    last_question: str = ""
    last_answer: str = ""
    updated_at: float = field(default_factory=time)


class ScreenContextStore:
    """Per-session screenshot context for follow-up questions, with optional Redis write-through."""

    def __init__(self):
        self._lock = RLock()
        self._contexts: dict[str, ScreenContext] = {}

    @staticmethod
    def _key(user_id: str, room_id: str, session_id: str | None) -> str:
        return f"screen::{user_id}::{room_id}::{session_id or 'default'}"

    def _redis_save(self, key: str, ctx: ScreenContext) -> None:
        from app.redis_client import get_redis
        r = get_redis()
        if r is None:
            return
        try:
            # Skip persisting raw image bytes to Redis to avoid large payloads.
            r.set(
                key,
                json.dumps({
                    "mime_type": ctx.mime_type,
                    "name": ctx.name,
                    "last_question": ctx.last_question,
                    "last_answer": ctx.last_answer,
                    "updated_at": ctx.updated_at,
                }),
                ex=_REDIS_TTL,
            )
        except Exception as exc:
            _logger.debug("Redis screen save failed: %s", exc)

    def _redis_load(self, key: str) -> ScreenContext | None:
        from app.redis_client import get_redis
        r = get_redis()
        if r is None:
            return None
        try:
            raw = r.get(key)
            if raw:
                d = json.loads(raw)
                return ScreenContext(
                    last_image_base64="",  # images are not persisted to Redis
                    mime_type=d.get("mime_type", "image/png"),
                    name=d.get("name", "screenshot.png"),
                    last_question=d.get("last_question", ""),
                    last_answer=d.get("last_answer", ""),
                    updated_at=d.get("updated_at", time()),
                )
        except Exception as exc:
            _logger.debug("Redis screen load failed: %s", exc)
        return None

    def _get_ctx(self, key: str) -> ScreenContext:
        # Redis (when configured) is authoritative for the *metadata* only, and is
        # re-read on every access so other workers' updates are visible (no stale
        # cache). The screenshot image itself is intentionally NOT persisted to
        # Redis (large payload), so image follow-ups only work within the single
        # process that captured the image: we keep the locally-cached
        # last_image_base64 instead of clobbering it with the empty Redis value.
        # When Redis is unset/unreachable _redis_load returns None -> pure in-memory.
        loaded = self._redis_load(key)
        if loaded is not None:
            local = self._contexts.get(key)
            if local is not None and local.last_image_base64:
                loaded.last_image_base64 = local.last_image_base64
                loaded.mime_type = local.mime_type or loaded.mime_type
                loaded.name = local.name or loaded.name
            self._contexts[key] = loaded
            return loaded
        return self._contexts.setdefault(key, ScreenContext())

    def update(
        self,
        user_id: str,
        room_id: str,
        session_id: str | None,
        image_base64: str,
        mime_type: str,
        name: str,
        question: str,
        answer: str = "",
    ) -> ScreenContext:
        key = self._key(user_id, room_id, session_id)
        with self._lock:
            ctx = self._get_ctx(key)
            ctx.last_image_base64 = image_base64
            ctx.mime_type = mime_type or "image/png"
            ctx.name = name or "screenshot.png"
            ctx.last_question = question
            if answer:
                ctx.last_answer = answer
            ctx.updated_at = time()
            self._redis_save(key, ctx)
            return ctx

    def get(self, user_id: str, room_id: str, session_id: str | None) -> ScreenContext:
        key = self._key(user_id, room_id, session_id)
        with self._lock:
            return self._get_ctx(key)
