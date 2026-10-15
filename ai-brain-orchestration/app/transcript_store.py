from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from threading import RLock
from time import time

_logger = logging.getLogger(__name__)
_REDIS_TTL = 86400  # 24 h


@dataclass
class TranscriptSegment:
    speaker: str
    text: str
    ts: float


@dataclass
class MeetingTranscript:
    segments: list[TranscriptSegment] = field(default_factory=list)
    updated_at: float = field(default_factory=time)


class TranscriptStore:
    """Accumulates ALL speech during a meeting for summary and notes, with optional Redis write-through."""

    def __init__(self):
        self._lock = RLock()
        self._transcripts: dict[str, MeetingTranscript] = {}

    @staticmethod
    def _key(user_id: str, room_id: str) -> str:
        return f"transcript::{user_id}::{room_id}"

    def _redis_save(self, key: str, t: MeetingTranscript) -> None:
        from app.redis_client import get_redis
        r = get_redis()
        if r is None:
            return
        try:
            payload = json.dumps(
                [{"speaker": s.speaker, "text": s.text, "ts": s.ts} for s in t.segments]
            )
            r.set(key, payload, ex=_REDIS_TTL)
        except Exception as exc:
            _logger.debug("Redis transcript save failed: %s", exc)

    def _redis_load(self, key: str) -> MeetingTranscript | None:
        from app.redis_client import get_redis
        r = get_redis()
        if r is None:
            return None
        try:
            raw = r.get(key)
            if raw:
                segs = json.loads(raw)
                t = MeetingTranscript()
                for s in segs:
                    t.segments.append(TranscriptSegment(speaker=s["speaker"], text=s["text"], ts=s["ts"]))
                t.updated_at = t.segments[-1].ts if t.segments else time()
                return t
        except Exception as exc:
            _logger.debug("Redis transcript load failed: %s", exc)
        return None

    def _get_transcript(self, key: str) -> MeetingTranscript:
        # Redis (when configured) is authoritative: re-read on every access so
        # appends from other workers are visible instead of serving a stale local
        # cache. The local dict is only a within-request convenience / fallback;
        # when Redis is unset/unreachable _redis_load returns None and we keep the
        # pure in-memory behaviour.
        loaded = self._redis_load(key)
        if loaded is not None:
            self._transcripts[key] = loaded
            return loaded
        return self._transcripts.setdefault(key, MeetingTranscript())

    def append(self, user_id: str, room_id: str, text: str, speaker: str = "user") -> None:
        stripped = text.strip()
        if not stripped:
            return
        key = self._key(user_id, room_id)
        with self._lock:
            t = self._get_transcript(key)
            t.segments.append(TranscriptSegment(speaker=speaker, text=stripped, ts=time()))
            t.updated_at = time()
            self._redis_save(key, t)

    def get_full_transcript(self, user_id: str, room_id: str) -> str:
        key = self._key(user_id, room_id)
        with self._lock:
            t = self._get_transcript(key)
            return " ".join(seg.text for seg in t.segments)

    def get_attributed_transcript(self, user_id: str, room_id: str) -> str:
        """Return transcript with speaker labels: '[Speaker]: text\\n' per segment."""
        key = self._key(user_id, room_id)
        with self._lock:
            t = self._get_transcript(key)
            if not t.segments:
                return ""
            lines = []
            for seg in t.segments:
                speaker = seg.speaker if seg.speaker and seg.speaker != "user" else "Participant"
                lines.append(f"[{speaker}]: {seg.text}")
            return "\n".join(lines)

    def get_segments(self, user_id: str, room_id: str) -> list[dict[str, str | float]]:
        key = self._key(user_id, room_id)
        with self._lock:
            t = self._get_transcript(key)
            return [{"speaker": s.speaker, "text": s.text, "ts": s.ts} for s in t.segments]

    def clear(self, user_id: str, room_id: str) -> None:
        key = self._key(user_id, room_id)
        with self._lock:
            self._transcripts.pop(key, None)
        from app.redis_client import get_redis
        r = get_redis()
        if r:
            try:
                r.delete(key)
            except Exception:
                pass
