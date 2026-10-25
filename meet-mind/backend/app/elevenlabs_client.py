"""ElevenLabs cloud STT (Scribe) and TTS. API key stays server-side."""
from __future__ import annotations

import httpx

from app.config import settings

_BASE_URL = "https://api.elevenlabs.io/v1"
# Biases Scribe toward the assistant name (Scribe has no free-text prompt).
_KEYTERMS = ["Jarvis", "Hey Jarvis"]

_client: httpx.AsyncClient | None = None


class ElevenLabsError(Exception):
    """ElevenLabs request failed (auth, quota, network, or bad audio)."""


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=_BASE_URL,
            headers={"xi-api-key": settings.elevenlabs_api_key},
            timeout=httpx.Timeout(30.0, connect=5.0),
        )
    return _client


async def aclose() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _raise_for_status(res: httpx.Response, what: str) -> None:
    if res.is_success:
        return
    if res.status_code == 401:
        raise ElevenLabsError(f"ElevenLabs {what}: invalid ELEVENLABS_API_KEY")
    if res.status_code == 429:
        raise ElevenLabsError(f"ElevenLabs {what}: rate limit or quota exceeded")
    raise ElevenLabsError(f"ElevenLabs {what} failed (HTTP {res.status_code}): {res.text[:200]}")


async def transcribe(audio_bytes: bytes, suffix: str = ".webm") -> str:
    data = {
        "model_id": settings.elevenlabs_stt_model,
        "language_code": "en",
        "tag_audio_events": "false",
        "keyterms": _KEYTERMS,
    }
    files = {"file": (f"audio{suffix}", audio_bytes)}
    try:
        res = await _get_client().post("/speech-to-text", data=data, files=files)
    except httpx.HTTPError as e:
        raise ElevenLabsError(f"ElevenLabs STT unreachable: {e!s}") from e
    _raise_for_status(res, "STT")
    return (res.json().get("text") or "").strip()


async def synthesize(text: str) -> bytes:
    """Return MP3 bytes for `text`."""
    try:
        res = await _get_client().post(
            f"/text-to-speech/{settings.elevenlabs_voice_id}",
            params={"output_format": "mp3_44100_64"},
            json={"text": text, "model_id": settings.elevenlabs_tts_model},
        )
    except httpx.HTTPError as e:
        raise ElevenLabsError(f"ElevenLabs TTS unreachable: {e!s}") from e
    _raise_for_status(res, "TTS")
    return res.content
