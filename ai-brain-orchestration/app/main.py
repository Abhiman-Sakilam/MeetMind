import hmac
import logging
from typing import Annotated

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.orchestrator import (
    handle_role_exit,
    handle_role_get,
    handle_role_set,
    handle_role_watch,
    run_execute,
    NOTES_STORE,
    SESSION_STORE,
    TRANSCRIPT_STORE,
)

from app.schemas import (
    ExecuteRequest,
    ExecuteResponse,
    FinalizeSummaryRequest,
    NotesStateResponse,
    RawNoteAppendRequest,
    RawNoteAppendResponse,
    RoleExitRequest,
    RoleExitResponse,
    RoleSetRequest,
    RoleSetResponse,
    RoleStateResponse,
    RoleWatchRequest,
    RoleWatchResponse,
    ScreenAnalyzeRequest,
    TranscriptResponse,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Rate limiting via slowapi. It is an optional dependency: if it is not installed
# we degrade gracefully to a no-op limiter so the service keeps running unchanged
# (the in-memory fallback elsewhere stays the only behavioural difference).
# get_remote_address tolerates running behind a proxy without crashing.
_RATE_LIMIT = "60/minute"  # per client IP, applied to expensive LLM/vision endpoints
try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.util import get_remote_address

    limiter = Limiter(key_func=get_remote_address, default_limits=[])
    _SLOWAPI_AVAILABLE = True
except Exception:  # slowapi not installed — fall back to no-op decorators
    RateLimitExceeded = None  # type: ignore[assignment]
    _SLOWAPI_AVAILABLE = False

    class _NoopLimiter:
        def limit(self, *_args, **_kwargs):
            def _decorator(func):
                return func
            return _decorator

    limiter = _NoopLimiter()  # type: ignore[assignment]
    logger.info("slowapi not installed — rate limiting disabled (no-op limiter).")

app = FastAPI(
    title="AI Brain Orchestration",
    description="Text-in agentic layer for MeetMind (Groq via LangChain). Whisper/TTS stay on meet-mind.",
    version="0.1.0",
)

if _SLOWAPI_AVAILABLE:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_service_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = (settings.ai_brain_service_token or "").strip()
    if not expected:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=403, detail="Invalid token")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-brain-orchestration"}


@app.post("/v1/execute", response_model=ExecuteResponse)
@limiter.limit(_RATE_LIMIT)
def execute(
    request: Request,
    body: ExecuteRequest,
    _: Annotated[None, Depends(verify_service_token)],
) -> ExecuteResponse:
    return run_execute(body)


@app.post("/v1/summary/finalize", response_model=ExecuteResponse)
@limiter.limit(_RATE_LIMIT)
def summary_finalize(
    request: Request,
    body: FinalizeSummaryRequest,
    _: Annotated[None, Depends(verify_service_token)],
) -> ExecuteResponse:
    if body.db_transcript:
        existing = TRANSCRIPT_STORE.get_full_transcript(body.user_id, body.room_id)
        if body.db_transcript.strip() not in existing:
            TRANSCRIPT_STORE.append(
                body.user_id, body.room_id,
                body.db_transcript.strip(),
                speaker="meeting_db",
            )
    req = ExecuteRequest(
        user_id=body.user_id,
        room_id=body.room_id,
        user_name=body.user_name,
        text="Provide a final polished meeting summary from the full transcript. Clean wording/grammar/tenses, structure it clearly, and include decisions plus action items.",
        session_id=body.session_id,
        source="chat",
        trigger="meeting_end",
        meeting_phase="meeting_end",
    )
    return run_execute(req)


@app.post("/v1/screen/analyze", response_model=ExecuteResponse)
@limiter.limit(_RATE_LIMIT)
def screen_analyze(
    request: Request,
    body: ScreenAnalyzeRequest,
    _: Annotated[None, Depends(verify_service_token)],
) -> ExecuteResponse:
    req = ExecuteRequest(
        user_id=body.user_id,
        room_id=body.room_id,
        user_name=body.user_name,
        text=body.question,
        session_id=body.session_id,
        source="voice",
        trigger="wake",
        command="screen_capture_analyze",
        attachments=[
            {
                "kind": "image",
                "mime_type": body.mime_type,
                "data_base64": body.screenshot_base64,
                "name": body.name,
            }
        ],
        screen_ref="latest",
    )
    return run_execute(req)


@app.post("/v1/notes/append-raw", response_model=RawNoteAppendResponse)
def notes_append_raw(
    body: RawNoteAppendRequest,
    _: Annotated[None, Depends(verify_service_token)],
) -> RawNoteAppendResponse:
    """Ultra-fast path: store raw speech chunk for notes — no LLM, instant return."""
    text = (body.text or "").strip()
    if not text:
        return RawNoteAppendResponse(ok=True, chunk_count=0)
    NOTES_STORE.append_raw(body.user_id, body.room_id, text)
    TRANSCRIPT_STORE.append(body.user_id, body.room_id, text, speaker="user")
    state = NOTES_STORE.get(body.user_id, body.room_id)
    return RawNoteAppendResponse(ok=True, chunk_count=sum(len(s.raw_chunks) for s in state.sessions))


@app.get("/v1/transcript/{user_id}/{room_id}", response_model=TranscriptResponse)
def get_transcript(
    user_id: str,
    room_id: str,
    _: Annotated[None, Depends(verify_service_token)],
) -> TranscriptResponse:
    return TranscriptResponse(
        attributed=TRANSCRIPT_STORE.get_attributed_transcript(user_id, room_id),
        segments=TRANSCRIPT_STORE.get_segments(user_id, room_id),
    )


@app.get("/v1/notes/{user_id}/{room_id}", response_model=NotesStateResponse)
def get_notes(
    user_id: str,
    room_id: str,
    _: Annotated[None, Depends(verify_service_token)],
) -> NotesStateResponse:
    state = NOTES_STORE.get(user_id, room_id)
    return NotesStateResponse(
        active=state.active,
        raw_chunk_count=sum(len(s.raw_chunks) for s in state.sessions),
        notes=state.notes,
    )


@app.delete("/v1/session/{user_id}/{room_id}", status_code=204)
def delete_session(
    user_id: str,
    room_id: str,
    _: Annotated[None, Depends(verify_service_token)],
) -> None:
    """Clear all in-memory state for a meeting room (call at meeting end)."""
    SESSION_STORE.clear(user_id, room_id)
    TRANSCRIPT_STORE.clear(user_id, room_id)
    NOTES_STORE.clear(user_id, room_id)


@app.post("/v1/transcribe")
async def transcribe(
    _: Annotated[None, Depends(verify_service_token)],
    file: UploadFile = File(...),
) -> None:
    raise HTTPException(
        status_code=501,
        detail="Transcription is handled by the meet-mind Whisper/ASR pipeline, not this service.",
    )


@app.post("/v1/role/set", response_model=RoleSetResponse)
def role_set(
    body: RoleSetRequest,
    _: Annotated[None, Depends(verify_service_token)],
) -> RoleSetResponse:
    return handle_role_set(body)


@app.post("/v1/role/exit", response_model=RoleExitResponse)
def role_exit(
    body: RoleExitRequest,
    _: Annotated[None, Depends(verify_service_token)],
) -> RoleExitResponse:
    return handle_role_exit(body)


@app.post("/v1/role/watch", response_model=RoleWatchResponse)
@limiter.limit(_RATE_LIMIT)
def role_watch(
    request: Request,
    body: RoleWatchRequest,
    _: Annotated[None, Depends(verify_service_token)],
) -> RoleWatchResponse:
    return handle_role_watch(body)


@app.get("/v1/role/state", response_model=RoleStateResponse)
def role_state(
    user_id: str,
    room_id: str,
    _: Annotated[None, Depends(verify_service_token)],
) -> RoleStateResponse:
    return handle_role_get(user_id, room_id)
