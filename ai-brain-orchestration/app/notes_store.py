from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from threading import RLock
from time import time

_logger = logging.getLogger(__name__)
_REDIS_TTL = 86400  # 24 h


def _state_to_dict(state: "NotesState") -> dict:
    return {
        "version": 2,
        "active": state.active,
        "updated_at": state.updated_at,
        "sessions": [
            {
                "id": s.id,
                "title": s.title,
                "raw_chunks": list(s.raw_chunks),
                "filtered_notes": list(s.filtered_notes),
                "started_at": s.started_at,
                "stopped_at": s.stopped_at,
            }
            for s in state.sessions
        ],
    }


def _state_from_dict(data: dict) -> "NotesState":
    # Legacy (v1) payload: had top-level raw_chunks / filtered_notes
    if "sessions" not in data and ("raw_chunks" in data or "filtered_notes" in data):
        return NotesState(
            active=bool(data.get("active", False)),
            sessions=[NoteSession(
                id="legacy",
                title=None,
                raw_chunks=list(data.get("raw_chunks", [])),
                filtered_notes=list(data.get("filtered_notes", [])),
                started_at=float(data.get("updated_at", time())),
                stopped_at=float(data.get("updated_at", time())) if not data.get("active") else None,
            )],
            updated_at=float(data.get("updated_at", time())),
        )

    sessions = []
    for s in data.get("sessions", []) or []:
        try:
            sessions.append(NoteSession(
                id=str(s.get("id", "")),
                title=s.get("title"),
                raw_chunks=list(s.get("raw_chunks", [])),
                filtered_notes=list(s.get("filtered_notes", [])),
                started_at=float(s.get("started_at", time())),
                stopped_at=(float(s["stopped_at"]) if s.get("stopped_at") is not None else None),
            ))
        except (TypeError, ValueError, KeyError) as exc:
            _logger.warning("Skipping malformed session entry %r: %s", s, exc)
    return NotesState(
        active=bool(data.get("active", False)),
        sessions=sessions,
        updated_at=float(data.get("updated_at", time())),
    )


@dataclass
class NoteSession:
    id: str = ""
    title: str | None = None
    raw_chunks: list[str] = field(default_factory=list)
    filtered_notes: list[dict[str, str | float]] = field(default_factory=list)
    started_at: float = field(default_factory=time)
    stopped_at: float | None = None


@dataclass
class NotesState:
    active: bool = False
    sessions: list[NoteSession] = field(default_factory=list)
    updated_at: float = field(default_factory=time)

    @property
    def notes(self) -> list[dict[str, str | float]]:
        """Aggregate notes across all sessions for backward compatibility.

        Prefers filtered_notes when present; falls back to raw_chunks for the active session."""
        out: list[dict[str, str | float]] = []
        for s in self.sessions:
            if s.filtered_notes:
                out.extend(s.filtered_notes)
            else:
                out.extend({"text": c, "ts": s.started_at} for c in s.raw_chunks if c.strip())
        return out

    def raw_transcript(self) -> str:
        """Raw transcript of the last session — used by filter_key_points() at stop/show time."""
        if not self.sessions:
            return ""
        s = self.sessions[-1]
        return " ".join(c.strip() for c in s.raw_chunks if c.strip())

    def get_active_session(self) -> "NoteSession | None":
        if not self.sessions or not self.active:
            return None
        return self.sessions[-1]


class NotesStore:
    """In-memory notes state partitioned by user + room, with optional Redis write-through."""

    def __init__(self):
        self._lock = RLock()
        self._states: dict[str, NotesState] = {}

    @staticmethod
    def _key(user_id: str, room_id: str) -> str:
        return f"notes::{user_id}::{room_id}"

    def _redis_save(self, key: str, state: NotesState) -> None:
        from app.redis_client import get_redis
        r = get_redis()
        if r is None:
            return
        try:
            r.set(key, json.dumps(_state_to_dict(state)), ex=_REDIS_TTL)
        except Exception as exc:
            _logger.debug("Redis notes save failed: %s", exc)

    def _redis_load(self, key: str) -> NotesState | None:
        from app.redis_client import get_redis
        r = get_redis()
        if r is None:
            return None
        try:
            raw = r.get(key)
            if raw:
                return _state_from_dict(json.loads(raw))
        except Exception as exc:
            _logger.debug("Redis notes load failed: %s", exc)
        return None

    def _get_state(self, key: str) -> NotesState:
        # Redis (when configured) is authoritative: re-read on every access so
        # writes from other workers are visible instead of serving a stale local
        # cache. The local dict is only a within-request convenience / fallback;
        # when Redis is unset/unreachable _redis_load returns None and we keep the
        # pure in-memory behaviour.
        loaded = self._redis_load(key)
        if loaded is not None:
            self._states[key] = loaded
            return loaded
        return self._states.setdefault(key, NotesState())

    def _new_session_id(self) -> str:
        return uuid.uuid4().hex

    def start(self, user_id: str, room_id: str) -> NotesState:
        key = self._key(user_id, room_id)
        with self._lock:
            state = self._get_state(key)
            now = time()
            if state.active:
                return state
            state.sessions.append(NoteSession(
                id=self._new_session_id(),
                title=None,
                raw_chunks=[],
                filtered_notes=[],
                started_at=now,
                stopped_at=None,
            ))
            state.active = True
            state.updated_at = now
            self._redis_save(key, state)
            return state

    def stop(self, user_id: str, room_id: str) -> NotesState:
        key = self._key(user_id, room_id)
        with self._lock:
            state = self._get_state(key)
            now = time()
            if state.sessions and state.sessions[-1].stopped_at is None:
                state.sessions[-1].stopped_at = now
            state.active = False
            state.updated_at = now
            self._redis_save(key, state)
            return state

    def append_raw(self, user_id: str, room_id: str, text: str) -> NotesState:
        key = self._key(user_id, room_id)
        with self._lock:
            state = self._get_state(key)
            stripped = text.strip()
            if stripped:
                if not state.sessions or state.sessions[-1].stopped_at is not None:
                    # No active session — start one implicitly so chunks aren't dropped
                    state.sessions.append(NoteSession(
                        id=self._new_session_id(),
                        title=None,
                        raw_chunks=[],
                        filtered_notes=[],
                        started_at=time(),
                        stopped_at=None,
                    ))
                    state.active = True
                state.sessions[-1].raw_chunks.append(stripped)
            state.updated_at = time()
            self._redis_save(key, state)
            return state

    def set_filtered(self, user_id: str, room_id: str, notes: list[dict[str, str | float]]) -> NotesState:
        key = self._key(user_id, room_id)
        with self._lock:
            state = self._get_state(key)
            if state.sessions:
                state.sessions[-1].filtered_notes = notes
            state.updated_at = time()
            self._redis_save(key, state)
            return state

    def set_session_title(self, user_id: str, room_id: str, title: str) -> NotesState:
        key = self._key(user_id, room_id)
        with self._lock:
            state = self._get_state(key)
            if state.sessions:
                state.sessions[-1].title = title
            state.updated_at = time()
            self._redis_save(key, state)
            return state

    def get(self, user_id: str, room_id: str) -> NotesState:
        key = self._key(user_id, room_id)
        with self._lock:
            return self._get_state(key)

    def clear(self, user_id: str, room_id: str) -> None:
        key = self._key(user_id, room_id)
        with self._lock:
            self._states.pop(key, None)
        from app.redis_client import get_redis
        r = get_redis()
        if r:
            try:
                r.delete(key)
            except Exception:
                pass
