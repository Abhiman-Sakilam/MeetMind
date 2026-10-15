"""Text-to-Speech module — Coqui XTTS v2 (Phase 4).

Currently a stub: returns None when TTS is not configured.
Wire this after installing TTS: `pip install TTS` and setting TTS_MODEL_NAME.
"""
from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path
from threading import Lock

from app.config import settings

logger = logging.getLogger(__name__)

_TTS_MODEL = None
_TTS_LOCK = Lock()
_TTS_LOADED = False
_TTS_LAST_ERROR = ""


class TTSError(Exception):
    """Text-to-speech synthesis failed."""


def is_tts_available() -> bool:
    return bool(getattr(settings, "tts_model_name", "").strip())


def _load_tts_model():
    global _TTS_MODEL, _TTS_LOADED, _TTS_LAST_ERROR
    model_name = getattr(settings, "tts_model_name", "").strip()
    if not model_name:
        logger.info("[TTS] No TTS_MODEL_NAME configured — TTS is disabled.")
        _TTS_LOADED = True
        _TTS_LAST_ERROR = ""
        return None

    try:
        from TTS.api import TTS as CoquiTTS  # type: ignore[import-untyped]
        device = getattr(settings, "tts_device", "cpu")
        logger.info("[TTS] Loading model %s on %s...", model_name, device)
        model = CoquiTTS(model_name=model_name).to(device)
        _TTS_LOADED = True
        _TTS_LAST_ERROR = ""
        logger.info("[TTS] Model ready.")
        return model
    except ImportError:
        logger.warning("[TTS] Coqui TTS not installed. Run: pip install TTS")
        _TTS_LOADED = True
        _TTS_LAST_ERROR = "Coqui TTS package not installed."
        return None
    except Exception as e:
        logger.exception("[TTS] Failed to load model: %s", e)
        # Allow retry on next request instead of getting stuck forever.
        _TTS_LOADED = False
        _TTS_LAST_ERROR = str(e)
        return None


def _get_model():
    global _TTS_MODEL
    with _TTS_LOCK:
        if not _TTS_LOADED:
            _TTS_MODEL = _load_tts_model()
    return _TTS_MODEL


async def synthesize(text: str, speaker_wav: str | None = None) -> bytes | None:
    """Synthesize text to WAV bytes. Returns None if TTS is not available."""
    model = _get_model()
    if model is None:
        return None

    if not text.strip():
        return None

    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        tmp_path = Path(tmp.name)

    try:
        kwargs: dict = {"text": text, "file_path": str(tmp_path)}
        if speaker_wav:
            kwargs["speaker_wav"] = speaker_wav
        elif hasattr(model, "speakers") and model.speakers:
            kwargs["speaker"] = model.speakers[0]

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: model.tts_to_file(**kwargs))
        return tmp_path.read_bytes()
    except Exception as e:
        raise TTSError(f"TTS synthesis failed: {e}") from e
    finally:
        tmp_path.unlink(missing_ok=True)


def tts_status() -> dict[str, str]:
    """Return current TTS status without triggering model load."""
    model_name = getattr(settings, "tts_model_name", "").strip()
    if not model_name:
        status = "disabled"
    elif _TTS_LOADED:
        status = "ok" if _TTS_MODEL is not None else "error"
    else:
        status = "not_loaded"
    return {
        "status": status,
        "model": model_name,
        "device": getattr(settings, "tts_device", "cpu"),
        "last_error": _TTS_LAST_ERROR,
    }


def warmup_tts() -> dict[str, str]:
    model = _get_model()
    return {
        "status": "ok" if model is not None else "disabled",
        "model": getattr(settings, "tts_model_name", ""),
        "device": getattr(settings, "tts_device", "cpu"),
        "last_error": _TTS_LAST_ERROR,
    }
