from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass, field
from threading import RLock

_logger = logging.getLogger(__name__)

_REDIS_TTL = 86400  # 24 h


def _estimate_tokens(text: str) -> int:
    return max(1, int(len(text.split()) * 1.3))


def _compress_text(text: str, max_chars: int = 220) -> str:
    compact = " ".join(text.split())
    if len(compact) <= max_chars:
        return compact
    return compact[: max_chars - 3].rstrip() + "..."


@dataclass
class ActiveRole:
    name: str
    description: str
    sensitivity: str = "smart"  # "major_only" | "smart" | "frequent"
    activated_at: float = field(default_factory=time.time)
    # Initialised to activation time so the watcher cannot interject immediately
    # after the entry introduction (cooldown applies from activation).
    last_proactive_at: float = field(default_factory=time.time)
    last_chunk_hash: str = ""
    # Ring buffer of recent chunk hashes — alternating chunks (A, B, A) no longer re-fire.
    recent_chunk_hashes: list[str] = field(default_factory=list)
    # Last few in-character interjections so the role can avoid repeating itself.
    recent_replies: list[str] = field(default_factory=list)


@dataclass
class SessionState:
    summary: str = ""
    turns: list[dict[str, str]] = field(default_factory=list)
    active_role: ActiveRole | None = None


class SessionStore:
    """In-memory session memory keyed by user_id + room_id, with optional Redis write-through."""

    def __init__(self, max_tokens: int = 2500, keep_last_turns: int = 8):
        self.max_tokens = max_tokens
        self.keep_last_turns = keep_last_turns
        self._lock = RLock()
        self._sessions: dict[str, SessionState] = {}

    @staticmethod
    def _key(user_id: str, room_id: str) -> str:
        return f"session::{user_id}::{room_id}"

    def _redis_save(self, key: str, state: SessionState) -> None:
        from app.redis_client import get_redis
        r = get_redis()
        if r is None:
            return
        try:
            r.set(key, json.dumps({
                "summary": state.summary,
                "turns": state.turns,
                "active_role": asdict(state.active_role) if state.active_role else None,
            }), ex=_REDIS_TTL)
        except Exception as exc:
            _logger.debug("Redis session save failed: %s", exc)

    def _redis_load(self, key: str) -> SessionState | None:
        from app.redis_client import get_redis
        r = get_redis()
        if r is None:
            return None
        try:
            raw = r.get(key)
            if raw:
                data = json.loads(raw)
                role_data = data.get("active_role")
                active_role = ActiveRole(**role_data) if role_data else None
                return SessionState(
                    summary=data.get("summary", ""),
                    turns=data.get("turns", []),
                    active_role=active_role,
                )
        except Exception as exc:
            _logger.debug("Redis session load failed: %s", exc)
        return None

    def _get_state(self, key: str) -> SessionState:
        # When Redis is configured it is the source of truth: re-read on every
        # access so writes from other Uvicorn workers are seen (no stale local
        # cache). The local dict is only a within-request convenience / fallback.
        # When Redis is unset/unreachable, _redis_load returns None and we keep
        # the pure in-memory behaviour.
        loaded = self._redis_load(key)
        if loaded is not None:
            self._sessions[key] = loaded
            return loaded
        return self._sessions.setdefault(key, SessionState())

    def append_turn(self, user_id: str, room_id: str, role: str, text: str) -> None:
        key = self._key(user_id, room_id)
        with self._lock:
            state = self._get_state(key)
            state.turns.append({"role": role, "text": text})
            self.summarize_if_needed(user_id, room_id)
            self._redis_save(key, state)

    def get_context_window(self, user_id: str, room_id: str) -> dict[str, object]:
        key = self._key(user_id, room_id)
        with self._lock:
            state = self._get_state(key)
            return {
                "summary": state.summary,
                "recent_turns": list(state.turns[-self.keep_last_turns :]),
            }

    def clear(self, user_id: str, room_id: str) -> None:
        key = self._key(user_id, room_id)
        with self._lock:
            self._sessions.pop(key, None)
        from app.redis_client import get_redis
        r = get_redis()
        if r:
            try:
                r.delete(key)
            except Exception:
                pass

    def summarize_if_needed(self, user_id: str, room_id: str) -> None:
        key = self._key(user_id, room_id)
        state = self._sessions.setdefault(key, SessionState())

        total = _estimate_tokens(state.summary)
        for turn in state.turns:
            total += _estimate_tokens(turn["text"])
        if total <= self.max_tokens or len(state.turns) <= self.keep_last_turns:
            return

        head = state.turns[: -self.keep_last_turns]
        tail = state.turns[-self.keep_last_turns :]

        compressed_lines = []
        for t in head:
            prefix = "User" if t["role"] == "user" else "Assistant"
            compressed_lines.append(f"- {prefix}: {_compress_text(t['text'])}")

        compressed = "\n".join(compressed_lines)
        if state.summary:
            state.summary = f"{state.summary}\n{compressed}".strip()
        else:
            state.summary = compressed
        state.turns = tail

    def set_role(self, user_id: str, room_id: str, role: ActiveRole) -> None:
        key = self._key(user_id, room_id)
        with self._lock:
            state = self._get_state(key)
            state.active_role = role
            self._redis_save(key, state)

    def get_role(self, user_id: str, room_id: str) -> ActiveRole | None:
        key = self._key(user_id, room_id)
        with self._lock:
            return self._get_state(key).active_role

    def clear_role(self, user_id: str, room_id: str) -> None:
        key = self._key(user_id, room_id)
        with self._lock:
            state = self._get_state(key)
            state.active_role = None
            self._redis_save(key, state)

    def update_proactive(self, user_id: str, room_id: str, chunk_hash: str, reply: str = "") -> None:
        key = self._key(user_id, room_id)
        with self._lock:
            state = self._get_state(key)
            if state.active_role:
                role = state.active_role
                role.last_proactive_at = time.time()
                role.last_chunk_hash = chunk_hash
                role.recent_chunk_hashes = (role.recent_chunk_hashes + [chunk_hash])[-8:]
                if reply:
                    role.recent_replies = (role.recent_replies + [reply])[-3:]
                self._redis_save(key, state)
