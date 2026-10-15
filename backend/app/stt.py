from __future__ import annotations

import asyncio
import logging
import os
import sys
import tempfile
import threading
from pathlib import Path
from threading import Lock

from faster_whisper import WhisperModel

from app.config import settings

logger = logging.getLogger(__name__)

_MODEL: WhisperModel | None = None
_MODEL_LOCK = Lock()
_loaded_device: str | None = None
_loaded_compute_type: str | None = None


class STTError(Exception):
    """Speech-to-text failed (model load, decode, or inference)."""


def _download_root() -> str | None:
    for key in ("STT_DOWNLOAD_ROOT", "HF_HOME"):
        raw = (os.environ.get(key) or "").strip()
        if not raw:
            continue
        p = Path(raw)
        try:
            p.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            logger.warning("STT: could not create download root %s: %s", p, e)
        return str(p)
    return None


def _cpu_compute_fallback(gpu_compute: str) -> str:
    if gpu_compute in ("float16", "float32", "bfloat16"):
        return "int8"
    return gpu_compute or "int8"


def _hub_token_configured() -> bool:
    return bool(
        (os.environ.get("HF_TOKEN") or "").strip()
        or (os.environ.get("HUGGING_FACE_HUB_TOKEN") or "").strip()
    )


def _ensure_hf_hub_logging() -> None:
    """Surface Hub download steps in Docker logs (tqdm bars are often disabled without a TTY)."""
    log = logging.getLogger("huggingface_hub")
    log.setLevel(logging.INFO)
    if log.handlers:
        return
    h = logging.StreamHandler(sys.stdout)
    h.setLevel(logging.INFO)
    h.setFormatter(logging.Formatter("[HF] %(message)s"))
    log.addHandler(h)
    log.propagate = False


def _start_load_heartbeat() -> threading.Event:
    """
    Periodic line in `docker logs` while WhisperModel() blocks on download / GPU init.
    Without this, the process looks idle for many minutes.
    """
    stop = threading.Event()

    def tick() -> None:
        n = 0
        while True:
            if stop.wait(30.0):
                break
            n += 1
            print(
                f"[STT] Heartbeat #{n}: still downloading from Hugging Face and/or loading "
                f"weights into GPU RAM (large models are multi-GB). This is normal.",
                flush=True,
            )

    threading.Thread(target=tick, name="stt-load-heartbeat", daemon=True).start()
    return stop


def _load_whisper_model() -> WhisperModel:
    """
    Load Whisper once. If settings ask for CUDA but the runtime has no GPU (e.g. CPU-only
    Docker image while .env still says cuda), fall back to CPU so voice still works.
    """
    global _loaded_device, _loaded_compute_type
    download_root = _download_root()
    device = settings.stt_device
    compute_type = settings.stt_compute_type
    common = {
        "model_size_or_path": settings.stt_model_name,
        "download_root": download_root,
    }

    auth = _hub_token_configured()
    cache_hint = download_root or "(default HF cache)"
    print(
        f"[STT] Loading model {settings.stt_model_name!r} on {device} ({compute_type}); "
        f"cache={cache_hint}; hub_token={'configured' if auth else 'NOT SET — expect throttling'}. "
        f"If this is the first run, Hugging Face download is starting now (can take many minutes).",
        flush=True,
    )
    if not auth:
        print(
            "[STT] Fix: put HF_TOKEN in meet-mind/.env (same folder as docker-compose.yml), then "
            "`docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --force-recreate backend`",
            flush=True,
        )

    _ensure_hf_hub_logging()
    print(
        "[STT] You should see [HF] lines and/or [STT] Heartbeat every ~30s while work is in progress.",
        flush=True,
    )
    hb_done = _start_load_heartbeat()
    try:
        if device != "cuda":
            m = WhisperModel(device=device, compute_type=compute_type, **common)
            _loaded_device = device
            _loaded_compute_type = compute_type
            print(f"[STT] Model ready on {_loaded_device} ({_loaded_compute_type}).", flush=True)
            return m

        try:
            m = WhisperModel(device="cuda", compute_type=compute_type, **common)
            _loaded_device = "cuda"
            _loaded_compute_type = compute_type
            print(f"[STT] Model ready on {_loaded_device} ({_loaded_compute_type}).", flush=True)
            return m
        except Exception as e:
            logger.warning(
                "STT: CUDA load failed (%s). Falling back to CPU int8. "
                "For GPU, use docker compose -f docker-compose.yml -f docker-compose.gpu.yml "
                "and NVIDIA Container Toolkit.",
                e,
            )
            cpu_ct = _cpu_compute_fallback(compute_type)
            try:
                m = WhisperModel(
                    device="cpu",
                    compute_type=cpu_ct,
                    **common,
                )
                _loaded_device = "cpu"
                _loaded_compute_type = cpu_ct
                print(
                    f"[STT] Model ready on {_loaded_device} ({_loaded_compute_type}) after CUDA fallback.",
                    flush=True,
                )
                return m
            except Exception as e2:
                raise STTError(
                    f"Could not load speech model on CUDA ({e!s}) or CPU fallback ({e2!s}). "
                    "Try STT_MODEL_NAME=distil-medium.en, more RAM, or fix HF_HOME disk space."
                ) from e2
    finally:
        hb_done.set()


def _get_model() -> WhisperModel:
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    with _MODEL_LOCK:
        if _MODEL is None:
            try:
                _MODEL = _load_whisper_model()
            except STTError:
                raise
            except Exception as e:
                raise STTError(
                    f"Could not load Whisper model '{settings.stt_model_name}' "
                    f"on device={settings.stt_device}: {e!s}"
                ) from e
    return _MODEL


async def warmup_model() -> dict[str, str]:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _get_model)
    return {
        "status": "ok",
        "model": settings.stt_model_name,
        "device": _loaded_device or settings.stt_device,
        "compute_type": _loaded_compute_type or settings.stt_compute_type,
    }


def is_model_loaded() -> bool:
    return _MODEL is not None


def runtime_stt_info() -> dict[str, str | bool | None]:
    return {
        "configured_device": settings.stt_device,
        "configured_compute_type": settings.stt_compute_type,
        "runtime_device": _loaded_device,
        "runtime_compute_type": _loaded_compute_type,
    }


async def transcribe_audio_bytes(audio_bytes: bytes, suffix: str = ".webm") -> str:
    if not audio_bytes:
        return ""
    try:
        loop = asyncio.get_event_loop()
        model = await loop.run_in_executor(None, _get_model)
    except STTError:
        raise
    except Exception as e:
        raise STTError(f"Model unavailable: {e!s}") from e

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(audio_bytes)
        tmp_path = Path(tmp.name)
    try:
        try:
            initial_prompt = settings.stt_initial_prompt.strip() or None

            def _run_transcribe() -> str:
                # Consume the generator fully inside the worker thread.
                # model.transcribe() returns a lazy generator — iterating it outside
                # the thread that created it causes CTranslate2 state corruption on
                # subsequent calls (first call succeeds, rest return empty).
                segs, _ = model.transcribe(
                    str(tmp_path),
                    beam_size=5,
                    language="en",
                    vad_filter=False,
                    no_speech_threshold=0.95,
                    condition_on_previous_text=False,
                    initial_prompt=initial_prompt,
                )
                return " ".join(s.text.strip() for s in segs if s.text and s.text.strip())

            loop = asyncio.get_event_loop()
            transcript = await loop.run_in_executor(None, _run_transcribe)
        except STTError:
            raise
        except Exception as e:
            raise STTError(
                f"Could not decode or transcribe audio ({suffix}). "
                f"Ensure the recording is valid WebM/Opus and ffmpeg is installed. ({e!s})"
            ) from e
        return transcript.strip()
    finally:
        tmp_path.unlink(missing_ok=True)
