import json
import uuid
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, UploadFile, File, Form, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import logging

from app.assistant_client import (
    AssistantBrainError,
    forward_execute,
    forward_notes_append_raw,
    forward_role_exit,
    forward_role_set,
    forward_role_state,
    forward_role_watch,
    forward_screen_analyze,
    forward_summary_finalize,
    ping_brain,
)
from app.models import Command, Note, ActionItem, Decision, Transcript, Meeting, Participant, User
from app.config import settings
from app.database import init_db, get_db
from app.stt import (
    STTError,
    is_model_loaded,
    runtime_stt_info,
    transcribe_audio_bytes,
    warmup_model,
)
from app.tts import TTSError, is_tts_available, tts_media_type, tts_status, synthesize as tts_synthesize, warmup_tts
from app import elevenlabs_client
from app.auth import get_current_user
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded


# ---------------------------------------------------------------------------
# WebSocket Room Manager
# ---------------------------------------------------------------------------

class RoomManager:
    """Manages WebSocket connections grouped by room."""

    def __init__(self):
        self.rooms: dict[str, dict[str, WebSocket]] = {}
        self.user_meta: dict[str, dict] = {}
        # At most one screen sharer per room: room_id -> (user_id, user_name)
        self.screen_share_owner: dict[str, tuple[str, str] | None] = {}
        # Which authenticated account owns each (room_id, client user_id) slot
        self.slot_owner: dict[tuple[str, str], str] = {}

    def is_taken_by_other(self, room_id: str, user_id: str, sub: str) -> bool:
        owner = self.slot_owner.get((room_id, user_id))
        return owner is not None and owner != sub

    async def connect(self, room_id: str, user_id: str, ws: WebSocket, sub: str = ""):
        await ws.accept()
        self.rooms.setdefault(room_id, {})[user_id] = ws
        if sub:
            self.slot_owner[(room_id, user_id)] = sub

    def disconnect(self, room_id: str, user_id: str, ws: WebSocket | None = None):
        """Remove a connection. Pass ws from the connection's own handler: a stale socket
        then can't evict a newer one, and only that handler releases slot ownership."""
        room = self.rooms.get(room_id)
        current = room.get(user_id) if room else None
        if ws is not None and current is not None and current is not ws:
            return
        if room:
            room.pop(user_id, None)
            if not room:
                del self.rooms[room_id]
        self.user_meta.pop(user_id, None)
        if ws is not None:
            self.slot_owner.pop((room_id, user_id), None)

    async def broadcast(self, room_id: str, message: dict, exclude: str | None = None):
        room = self.rooms.get(room_id, {})
        dead: list[str] = []
        for uid, ws in room.items():
            if uid == exclude:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(uid)
        for uid in dead:
            self.disconnect(room_id, uid)

    async def send_to(self, room_id: str, user_id: str, message: dict):
        ws = self.rooms.get(room_id, {}).get(user_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(room_id, user_id)

    def get_users_in_room(self, room_id: str) -> list[dict]:
        room = self.rooms.get(room_id, {})
        return [
            {"userId": uid, **(self.user_meta.get(uid, {}))}
            for uid in room
        ]

    def get_screen_share_sync_payload(self, room_id: str) -> dict:
        owner = self.screen_share_owner.get(room_id)
        if owner:
            return {"activeUserId": owner[0], "activeUserName": owner[1]}
        return {"activeUserId": None, "activeUserName": None}

    def clear_screen_share_if_user(self, room_id: str, user_id: str) -> bool:
        owner = self.screen_share_owner.get(room_id)
        if owner and owner[0] == user_id:
            self.screen_share_owner[room_id] = None
            return True
        return False


manager = RoomManager()


def _identity(current_user: dict) -> tuple[str, str]:
    """Server-authoritative identity from the verified JWT (sub + display name)."""
    uid = (current_user or {}).get("sub") or ""
    name = (current_user or {}).get("name") or (current_user or {}).get("email") or "user"
    return uid, name


async def _require_meeting(db: AsyncSession, room_name: str) -> Meeting:
    result = await db.execute(select(Meeting).where(Meeting.room_name == room_name))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


async def _require_membership(db: AsyncSession, room_name: str, current_user: dict) -> Meeting:
    """Ensure the authenticated user owns or has joined this meeting (else 403)."""
    meeting = await _require_meeting(db, room_name)
    uid = (current_user or {}).get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")
    if meeting.owner_id and meeting.owner_id == uid:
        return meeting
    pq = await db.execute(
        select(Participant.id).where(
            Participant.meeting_id == meeting.id, Participant.user_id == uid
        )
    )
    if pq.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Not a participant of this meeting")
    return meeting


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class CreateMeetingRequest(BaseModel):
    title: str = "Untitled Meeting"

class JoinMeetingRequest(BaseModel):
    userName: str


class AssistantExecuteRequest(BaseModel):
    """Forwarded to ai-brain-orchestration POST /v1/execute (snake_case)."""

    user_id: str
    room_id: str
    user_name: str = ""
    text: str
    session_id: str | None = None
    context: dict | None = None
    source: str | None = "chat"
    command: str | None = None
    trigger: str | None = None
    meeting_phase: str | None = None
    screen_ref: str | None = None
    persona: str = "friendly"


class AssistantSummaryFinalizeRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    session_id: str | None = None
    db_transcript: str | None = None


# ---------------------------------------------------------------------------
# App Lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Docker DNS / networking can be briefly unavailable on boot.
    # Retry DB init so backend does not fail permanently on first attempt.
    max_attempts = 10
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            await init_db()
            last_error = None
            break
        except Exception as e:
            last_error = e
            if attempt == max_attempts:
                raise
            print(f"[startup] DB init attempt {attempt}/{max_attempts} failed: {e}. Retrying in 2s...")
            await asyncio.sleep(2)
    if last_error:
        raise last_error

    # Pre-warm STT and TTS in background so models are ready before first request.
    # If models are already cached on disk this completes in seconds.
    async def _warmup():
        try:
            await warmup_model()
            print("[startup] STT model ready.", flush=True)
        except Exception as e:
            print(f"[startup] STT warmup failed (will retry on first request): {e}", flush=True)
        try:
            await asyncio.to_thread(warmup_tts)
            print("[startup] TTS model ready.", flush=True)
        except Exception as e:
            print(f"[startup] TTS warmup failed (will retry on first request): {e}", flush=True)

    asyncio.create_task(_warmup())
    yield
    await elevenlabs_client.aclose()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

# Rate limiting (per client IP) — protects the expensive LLM/STT/TTS/vision routes.
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ---------------------------------------------------------------------------
# REST Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": settings.app_name}


@app.post("/api/meetings")
async def create_meeting(body: CreateMeetingRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    uid, name = _identity(current_user)
    room_name = uuid.uuid4().hex[:12]
    meeting = Meeting(id=str(uuid.uuid4()), room_name=room_name, title=body.title, owner_id=uid or None)
    db.add(meeting)
    # The creator is automatically a member of their own meeting.
    db.add(Participant(id=str(uuid.uuid4()), meeting_id=meeting.id, name=name, user_id=uid or None))
    await db.commit()
    await db.refresh(meeting)
    return {
        "id": meeting.id,
        "roomName": meeting.room_name,
        "title": meeting.title,
        "status": meeting.status,
        "createdAt": meeting.created_at.isoformat() if meeting.created_at else None,
    }


@app.get("/api/meetings/{room_name}")
async def get_meeting(room_name: str, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    result = await db.execute(select(Meeting).where(Meeting.room_name == room_name))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {
        "id": meeting.id,
        "roomName": meeting.room_name,
        "title": meeting.title,
        "status": meeting.status,
        "createdAt": meeting.created_at.isoformat() if meeting.created_at else None,
        "participants": manager.get_users_in_room(room_name),
    }


@app.post("/api/meetings/{room_name}/join")
async def join_meeting(
    room_name: str,
    body: JoinMeetingRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    meeting = await _require_meeting(db, room_name)
    uid, name = _identity(current_user)

    # Idempotent membership: don't create a duplicate participant row on rejoin.
    already = False
    if uid:
        existing = await db.execute(
            select(Participant.id).where(
                Participant.meeting_id == meeting.id, Participant.user_id == uid
            )
        )
        already = existing.scalar_one_or_none() is not None
    if not already:
        db.add(Participant(
            id=str(uuid.uuid4()),
            meeting_id=meeting.id,
            name=body.userName or name,
            user_id=uid or None,
        ))
        await db.commit()

    return {
        "id": meeting.id,
        "roomName": meeting.room_name,
        "title": meeting.title,
        "status": meeting.status,
    }


@app.post("/api/meetings/{room_name}/end")
async def end_meeting(room_name: str, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from sqlalchemy import update as sa_update

    await _require_membership(db, room_name, current_user)
    now = datetime.now(timezone.utc)

    # Atomic update — only transitions from non-completed states (eliminates TOCTOU race).
    stmt = (
        sa_update(Meeting)
        .where(Meeting.room_name == room_name, Meeting.status != "completed")
        .values(status="completed", ended_at=now)
        .execution_options(synchronize_session="fetch")
    )
    await db.execute(stmt)
    await db.commit()

    result = await db.execute(select(Meeting).where(Meeting.room_name == room_name))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Compute duration if not set yet.
    if meeting.ended_at and meeting.created_at and not meeting.duration_minutes:
        delta = meeting.ended_at - meeting.created_at
        meeting.duration_minutes = max(1, int(delta.total_seconds() / 60))
        await db.commit()

    return {
        "id": meeting.id,
        "roomName": meeting.room_name,
        "status": meeting.status,
        "durationMinutes": meeting.duration_minutes,
    }


@app.get("/api/turn-config")
async def turn_config(current_user: dict = Depends(get_current_user)):
    """Provide TURN/STUN configuration to the frontend."""
    servers: list[dict] = [
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
    ]
    if settings.turn_username and settings.turn_credential:
        for url in [
            "turn:global.relay.metered.ca:80",
            "turn:global.relay.metered.ca:80?transport=tcp",
            "turn:global.relay.metered.ca:443",
            "turns:global.relay.metered.ca:443?transport=tcp",
        ]:
            servers.append({
                "urls": url,
                "username": settings.turn_username,
                "credential": settings.turn_credential,
            })
    return {"iceServers": servers}


@app.get("/api/meetings")
async def list_meetings(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
    page: int = 1,
    limit: int = 20,
    status: str | None = None,
    search: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
):
    """List meetings the user owns or joined, with optional pagination, status filter, date range, and transcript keyword search."""
    from datetime import datetime, timezone

    page = max(1, page)
    limit = min(max(1, limit), 100)
    offset = (page - 1) * limit

    uid, _ = _identity(current_user)
    member_subq = select(Participant.meeting_id).where(Participant.user_id == uid).scalar_subquery()
    query = select(Meeting).where(or_(Meeting.owner_id == uid, Meeting.id.in_(member_subq)))

    if status:
        query = query.where(Meeting.status == status)

    if from_date:
        try:
            dt = datetime.fromisoformat(from_date).replace(tzinfo=timezone.utc)
            query = query.where(Meeting.created_at >= dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid from_date format; use ISO 8601")

    if to_date:
        try:
            dt = datetime.fromisoformat(to_date).replace(tzinfo=timezone.utc)
            query = query.where(Meeting.created_at <= dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid to_date format; use ISO 8601")

    if search:
        # Match on room name, title, or any transcript segment containing the keyword
        keyword = f"%{search}%"
        transcript_match = select(Transcript.meeting_id).where(
            Transcript.text.ilike(keyword)
        ).scalar_subquery()
        query = query.where(
            or_(
                Meeting.room_name.ilike(keyword),
                Meeting.title.ilike(keyword),
                Meeting.id.in_(transcript_match),
            )
        )

    count_q = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    query = query.order_by(Meeting.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    meetings = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": max(1, (total + limit - 1) // limit),
        "meetings": [
            {
                "id": m.id,
                "roomName": m.room_name,
                "title": m.title,
                "status": m.status,
                "createdAt": m.created_at.isoformat() if m.created_at else None,
                "endedAt": m.ended_at.isoformat() if m.ended_at else None,
                "durationMinutes": m.duration_minutes,
            }
            for m in meetings
        ],
    }


@app.get("/api/assistant/brain-health")
async def assistant_brain_health(current_user: dict = Depends(get_current_user)):
    """Diagnostic: reachability of AI Brain from meet-mind (uses AI_BRAIN_BASE_URL)."""
    try:
        return await ping_brain()
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 503, detail=str(e))


@app.get("/api/assistant/stt-status")
async def assistant_stt_status(current_user: dict = Depends(get_current_user)):
    rt = runtime_stt_info()
    cloud = settings.stt_provider == "elevenlabs"
    return {
        "status": "ok",
        "provider": settings.stt_provider,
        "model": settings.elevenlabs_stt_model if cloud else settings.stt_model_name,
        "device": "elevenlabs" if cloud else settings.stt_device,
        "compute_type": settings.stt_compute_type,
        "initial_prompt_set": bool(settings.stt_initial_prompt.strip()),
        "loaded": is_model_loaded(),
        "runtime_device": rt["runtime_device"],
        "runtime_compute_type": rt["runtime_compute_type"],
    }


@app.post("/api/assistant/stt-warmup")
async def assistant_stt_warmup(current_user: dict = Depends(get_current_user)):
    try:
        return await warmup_model()
    except STTError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"STT warmup failed: {e}") from e


@app.get("/api/assistant/tts-status")
async def assistant_tts_status(current_user: dict = Depends(get_current_user)):
    return {"available": is_tts_available(), **tts_status()}


@app.post("/api/assistant/tts-warmup")
async def assistant_tts_warmup(current_user: dict = Depends(get_current_user)):
    try:
        return await asyncio.to_thread(warmup_tts)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"TTS warmup failed: {e}") from e


class NotesAppendRawRequest(BaseModel):
    user_id: str
    room_id: str
    text: str


class RoleSetProxyRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    role_name: str
    role_description: str
    sensitivity: str = "smart"
    context: dict | None = None


class RoleExitProxyRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""


class RoleWatchProxyRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    transcript_chunk: str
    context: dict | None = None


@app.post("/api/role/set")
async def role_set_proxy(body: RoleSetProxyRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    await _require_membership(db, body.room_id, current_user)
    uid, name = _identity(current_user)
    data = {**body.model_dump(), "user_id": uid, "user_name": name}
    try:
        return await forward_role_set(data)
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))


@app.post("/api/role/exit")
async def role_exit_proxy(body: RoleExitProxyRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    await _require_membership(db, body.room_id, current_user)
    uid, name = _identity(current_user)
    data = {**body.model_dump(), "user_id": uid, "user_name": name}
    try:
        return await forward_role_exit(data)
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))


@app.post("/api/role/watch")
async def role_watch_proxy(body: RoleWatchProxyRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    await _require_membership(db, body.room_id, current_user)
    uid, name = _identity(current_user)
    data = {**body.model_dump(), "user_id": uid, "user_name": name}
    try:
        return await forward_role_watch(data)
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))


@app.get("/api/role/state")
async def role_state_proxy(room_id: str, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Current active role — lets the UI re-sync after a page reload."""
    await _require_membership(db, room_id, current_user)
    uid, _ = _identity(current_user)
    try:
        return await forward_role_state(uid, room_id)
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))


@app.post("/api/assistant/notes/append-raw")
async def assistant_notes_append_raw(body: NotesAppendRawRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Lightweight: store raw speech chunk for notes. No LLM, instant.
    Also persists to transcripts table for meeting-wide summary."""
    if not (body.text or "").strip():
        return {"ok": True, "chunk_count": 0}
    if len(body.text) > 8000:
        raise HTTPException(status_code=413, detail="text payload exceeds 8000 character limit")

    meeting = await _require_membership(db, body.room_id, current_user)
    uid, name = _identity(current_user)
    seg = Transcript(meeting_id=meeting.id, speaker_name=name, text=body.text.strip())
    db.add(seg)
    await db.commit()

    try:
        return await forward_notes_append_raw({**body.model_dump(), "user_id": uid})
    except AssistantBrainError as e:
        # Keep notes ingestion resilient: local transcript persistence already succeeded.
        return {
            "ok": True,
            "chunk_count": 1,
            "warning": f"AI brain unavailable, stored locally only: {str(e)}",
        }


class TTSSynthRequest(BaseModel):
    # Cloud TTS bills per character; the UI only speaks the first 1-2 sentences.
    text: str = Field(max_length=1000)
    speaker_wav: str | None = Field(default=None, max_length=512)


@app.post("/api/assistant/tts")
@limiter.limit("30/minute")
async def assistant_tts_synthesize(request: Request, body: TTSSynthRequest, current_user: dict = Depends(get_current_user)):
    """Synthesize text to speech, return audio (MP3 from ElevenLabs, WAV from local Coqui)."""
    if not (body.text or "").strip():
        raise HTTPException(status_code=400, detail="Empty text")
    try:
        wav_bytes = await tts_synthesize(body.text, body.speaker_wav)
    except TTSError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"TTS error: {e}") from e
    if wav_bytes is None:
        raise HTTPException(status_code=501, detail="TTS not available. Set TTS_MODEL_NAME in config.")
    from fastapi.responses import Response
    return Response(content=wav_bytes, media_type=tts_media_type())


@app.post("/api/assistant/execute")
@limiter.limit("30/minute")
async def assistant_execute(request: Request, body: AssistantExecuteRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Proxy: browser → meet-mind → ai-brain-orchestration (OpenAI key stays on brain)."""
    if not (body.text or "").strip():
        return {
            "reply": "I didn't catch that. Could you repeat?",
            "intent": "EMPTY_INPUT",
            "actions": [],
        }
    if len(body.text) > 8000:
        raise HTTPException(status_code=413, detail="text payload exceeds 8000 character limit")

    meeting = await _require_membership(db, body.room_id, current_user)
    uid, name = _identity(current_user)
    seg = Transcript(meeting_id=meeting.id, speaker_name=name, text=body.text.strip())
    db.add(seg)
    await db.commit()

    payload = {**body.model_dump(exclude_none=True), "user_id": uid, "user_name": name}
    try:
        out = await forward_execute(payload)
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))

    await _persist_ai_artifacts(db, meeting.id, body.text, out)

    return out


@app.post("/api/assistant/voice/execute")
@limiter.limit("30/minute")
async def assistant_voice_execute(
    request: Request,
    file: UploadFile = File(...),
    user_id: str = Form(...),
    room_id: str = Form(...),
    user_name: str = Form(""),
    session_id: str | None = Form(None),
    response_style: str = Form("auto"),
    persona: str = Form("friendly"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Voice path: upload audio -> STT (ElevenLabs Scribe or local Whisper) -> brain execute.
    Identity is server-authoritative (JWT) so per-user context is stable across reconnects.
    """
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded audio is empty")
    if len(audio_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large")
    _ALLOWED_AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp4", "audio/flac"}
    if file.content_type and file.content_type.split(";")[0].strip() not in _ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported audio content type")
    suffix = ".webm"
    if file.filename and "." in file.filename:
        suffix = "." + file.filename.rsplit(".", 1)[1].lower()
    try:
        text = await transcribe_audio_bytes(audio_bytes, suffix)
    except STTError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Speech-to-text error: {e!s}",
        ) from e

    if not text:
        raise HTTPException(status_code=422, detail="No speech detected")

    meeting = await _require_membership(db, room_id, current_user)
    uid, name = _identity(current_user)
    seg = Transcript(meeting_id=meeting.id, speaker_name=name, text=text.strip())
    db.add(seg)
    await db.commit()

    try:
        payload = {
            "user_id": uid,
            "room_id": room_id,
            "user_name": name,
            "text": text,
            "session_id": session_id,
            "source": "voice",
            "context": {"response_style": response_style},
            "persona": persona,
        }
        out = await forward_execute(payload)
        await _persist_ai_artifacts(db, meeting.id, text, out)
        return {"transcript": text, **out}
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))


@app.post("/api/assistant/summary/finalize")
@limiter.limit("30/minute")
async def assistant_summary_finalize(request: Request, body: AssistantSummaryFinalizeRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    meeting = await _require_membership(db, body.room_id, current_user)
    uid, name = _identity(current_user)
    payload = {**body.model_dump(exclude_none=True), "user_id": uid, "user_name": name}
    if meeting:
        transcripts_q = await db.execute(
            select(Transcript).where(Transcript.meeting_id == meeting.id).order_by(Transcript.created_at)
        )
        segments = transcripts_q.scalars().all()
        if segments:
            db_text = " ".join(
                f"[{seg.speaker_name or 'user'}]: {seg.text}" for seg in segments if seg.text
            )
            payload["db_transcript"] = db_text
        elif (body.db_transcript or "").strip():
            payload["db_transcript"] = body.db_transcript.strip()
    try:
        out = await forward_summary_finalize(payload)
        if meeting:
            await _persist_ai_artifacts(db, meeting.id, "final meeting summary", out)
            topics = out.get("artifacts", {}).get("topics") if isinstance(out.get("artifacts"), dict) else out.get("topics")
            keywords = out.get("artifacts", {}).get("keywords") if isinstance(out.get("artifacts"), dict) else out.get("keywords")
            if isinstance(topics, list) or isinstance(keywords, list):
                meeting.topics = topics if isinstance(topics, list) else meeting.topics
                meeting.keywords = keywords if isinstance(keywords, list) else meeting.keywords
                await db.commit()
        return out
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))


@app.post("/api/assistant/screen/analyze")
@limiter.limit("30/minute")
async def assistant_screen_analyze(
    request: Request,
    file: UploadFile = File(...),
    user_id: str = Form(...),
    room_id: str = Form(...),
    user_name: str = Form(""),
    question: str = Form("Describe this screenshot."),
    session_id: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    await _require_membership(db, room_id, current_user)
    uid, name = _identity(current_user)
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Screenshot is empty")
    if len(image_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large")
    _ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
    if file.content_type and file.content_type.split(";")[0].strip() not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported image content type")
    import base64

    payload = {
        "user_id": uid,
        "room_id": room_id,
        "user_name": name,
        "question": question,
        "session_id": session_id,
        "screenshot_base64": base64.b64encode(image_bytes).decode("ascii"),
        "mime_type": file.content_type or "image/png",
        "name": file.filename or "screenshot.png",
    }
    try:
        return await forward_screen_analyze(payload)
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))


# ---------------------------------------------------------------------------
# AI Artifact Persistence
# ---------------------------------------------------------------------------

_persist_logger = logging.getLogger("ai_persist")


async def _persist_ai_artifacts(
    db: AsyncSession,
    meeting_id: str,
    original_text: str,
    brain_response: dict,
) -> None:
    """Persist AI brain response artifacts to the appropriate DB tables."""
    try:
        intent = (brain_response.get("intent") or "").upper()
        reply = brain_response.get("reply", "")
        artifacts = brain_response.get("artifacts") or {}

        db.add(Command(
            meeting_id=meeting_id,
            command_type=intent or "GENERAL",
            original_text=original_text,
            parameters=artifacts if artifacts else None,
            response=reply,
        ))

        if intent in ("ACTION_ITEMS", "ADD_ACTION_ITEM"):
            from datetime import datetime as _dt
            for item in (artifacts.get("items") or []):
                if not isinstance(item, dict) or not item.get("title"):
                    continue
                due_raw = item.get("due_date")
                due_val = None
                if isinstance(due_raw, str) and due_raw.strip():
                    try:
                        due_val = _dt.fromisoformat(due_raw.strip())
                    except ValueError:
                        due_val = None
                db.add(ActionItem(
                    meeting_id=meeting_id,
                    title=item["title"],
                    assigned_to=item.get("assigned_to") or None,
                    due_date=due_val,
                    status="pending",
                ))

        if intent in ("STOP_NOTES", "SHOW_NOTES"):
            session_id = str(artifacts.get("session_id") or "").strip() or None
            session_title = str(artifacts.get("session_title") or "").strip() or None
            for note in (artifacts.get("notes") or []):
                text = ""
                if isinstance(note, dict):
                    text = str(note.get("text", "")).strip()
                elif isinstance(note, str):
                    text = note.strip()
                if text:
                    section = ""
                    if isinstance(note, dict):
                        section = str(note.get("section", "")).strip()
                    note_type = f"key_point:{section}" if section else "key_point"
                    db.add(Note(
                        meeting_id=meeting_id,
                        content=text,
                        type=note_type,
                        session_id=session_id,
                        session_title=session_title,
                    ))

        if intent == "HELP_DECIDE":
            db.add(Decision(
                meeting_id=meeting_id,
                title=original_text[:500],
                options=artifacts.get("options"),
                analysis=reply,
                chosen_option=artifacts.get("recommendation"),
            ))

        if intent in ("GET_SUMMARY", "SUMMARY_FINAL", "SUMMARY_NOW", "SUMMARY_PERIODIC"):
            # Persist summary text as a Note so it survives restarts and is retrievable
            if reply.strip():
                summary_type = brain_response.get("summary_type") or "manual"
                db.add(Note(
                    meeting_id=meeting_id,
                    content=reply.strip(),
                    type=f"summary:{summary_type}",
                ))

        await db.commit()
    except Exception:
        _persist_logger.exception("Failed to persist AI artifacts for meeting %s", meeting_id)
        await db.rollback()


@app.get("/api/meetings/{room_name}/intelligence")
async def get_meeting_intelligence(room_name: str, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Fetch all AI-generated artifacts for a meeting."""
    meeting = await _require_membership(db, room_name, current_user)

    mid = meeting.id

    commands_q = await db.execute(
        select(Command).where(Command.meeting_id == mid).order_by(Command.executed_at)
    )
    notes_q = await db.execute(
        select(Note).where(Note.meeting_id == mid).order_by(Note.created_at)
    )
    actions_q = await db.execute(
        select(ActionItem).where(ActionItem.meeting_id == mid).order_by(ActionItem.created_at)
    )
    decisions_q = await db.execute(
        select(Decision).where(Decision.meeting_id == mid).order_by(Decision.created_at)
    )
    transcripts_q = await db.execute(
        select(Transcript).where(Transcript.meeting_id == mid).order_by(Transcript.created_at)
    )

    return {
        "meeting_id": mid,
        "room_name": room_name,
        "topics": meeting.topics if isinstance(meeting.topics, list) else [],
        "keywords": meeting.keywords if isinstance(meeting.keywords, list) else [],
        "commands": [
            {
                "id": c.id,
                "type": c.command_type,
                "text": c.original_text,
                "response": c.response,
                "at": c.executed_at.isoformat() if c.executed_at else None,
            }
            for c in commands_q.scalars().all()
        ],
        # Only real meeting notes belong in the Notes panel. Summary rows are
        # stored in the same table (type="summary:*") for persistence/email/PDF,
        # but must NOT leak into the notes list or they render as raw markdown.
        "notes": [
            {
                "id": n.id,
                "content": n.content,
                "type": n.type,
                "section": n.type.removeprefix("key_point:") if n.type and n.type.startswith("key_point:") else "",
                "session_id": n.session_id,
                "session_title": n.session_title,
                "at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in notes_q.scalars().all()
            if not (n.type and n.type.startswith("summary:"))
        ],
        "action_items": [
            {
                "id": a.id,
                "title": a.title,
                "assigned_to": a.assigned_to,
                "due_date": a.due_date.isoformat() if a.due_date else None,
                "status": a.status,
                "at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in actions_q.scalars().all()
        ],
        "decisions": [
            {
                "id": d.id,
                "title": d.title,
                "options": d.options,
                "analysis": d.analysis,
                "chosen": d.chosen_option,
                "at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in decisions_q.scalars().all()
        ],
        "transcripts": [
            {
                "id": t.id,
                "speaker": t.speaker_name,
                "text": t.text,
                "at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in transcripts_q.scalars().all()
        ],
    }


@app.patch("/api/meetings/{room_name}/action_items/{action_item_id}")
async def update_action_item_status(
    room_name: str,
    action_item_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update the completion status of a single action item."""
    status = (body or {}).get("status")
    if status not in ("pending", "completed"):
        raise HTTPException(status_code=400, detail="status must be 'pending' or 'completed'")

    meeting = await _require_membership(db, room_name, current_user)

    item_q = await db.execute(
        select(ActionItem).where(ActionItem.id == action_item_id, ActionItem.meeting_id == meeting.id)
    )
    item = item_q.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Action item not found in this meeting")

    item.status = status
    await db.commit()
    await db.refresh(item)
    return {
        "id": item.id,
        "title": item.title,
        "status": item.status,
        "updated_at": item.created_at.isoformat() if item.created_at else None,
    }


# ---------------------------------------------------------------------------
# PDF Export
# ---------------------------------------------------------------------------

@app.get("/api/meetings/{room_name}/export/pdf")
async def export_meeting_pdf(room_name: str, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Generate and download a PDF meeting report."""
    from app.pdf_export import generate_meeting_pdf

    meeting = await _require_membership(db, room_name, current_user)

    mid = meeting.id
    notes_q = await db.execute(select(Note).where(Note.meeting_id == mid).order_by(Note.created_at))
    actions_q = await db.execute(select(ActionItem).where(ActionItem.meeting_id == mid).order_by(ActionItem.created_at))
    decisions_q = await db.execute(select(Decision).where(Decision.meeting_id == mid).order_by(Decision.created_at))
    transcripts_q = await db.execute(select(Transcript).where(Transcript.meeting_id == mid).order_by(Transcript.created_at))

    notes = [{"content": n.content, "type": n.type, "section": n.type.removeprefix("key_point:") if n.type and n.type.startswith("key_point:") else ""} for n in notes_q.scalars().all()]
    action_items = [{"title": a.title, "assigned_to": a.assigned_to, "status": a.status} for a in actions_q.scalars().all()]
    decisions = [{"title": d.title, "options": d.options, "analysis": d.analysis, "chosen": d.chosen_option} for d in decisions_q.scalars().all()]
    transcripts = [{"speaker": t.speaker_name, "text": t.text} for t in transcripts_q.scalars().all()]

    try:
        pdf_bytes = await asyncio.to_thread(
            generate_meeting_pdf,
            room_name=room_name,
            title=meeting.title or room_name,
            created_at=meeting.created_at.isoformat() if meeting.created_at else None,
            ended_at=meeting.ended_at.isoformat() if meeting.ended_at else None,
            notes=notes,
            action_items=action_items,
            decisions=decisions,
            transcripts=transcripts,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in room_name)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="meeting-{safe_name}.pdf"'},
    )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/register", status_code=201)
async def auth_register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    from app.auth import hash_password
    result = await db.execute(select(User).where(User.email == body.email.lower().strip()))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=body.email.lower().strip(),
        display_name=body.display_name.strip() or None,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"id": user.id, "email": user.email, "display_name": user.display_name}


@app.post("/api/auth/login")
async def auth_login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    from app.auth import create_access_token, verify_password
    result = await db.execute(select(User).where(User.email == body.email.lower().strip()))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user.id, user.email, user.display_name or "")
    return {"access_token": token, "token_type": "bearer", "display_name": user.display_name}


@app.get("/api/auth/me")
async def auth_me(current_user: dict = Depends(get_current_user)):
    return current_user


class GoogleAuthRequest(BaseModel):
    credential: str  # Google ID token (JWT) returned by Google Identity Services


@app.post("/api/auth/google")
async def auth_google(body: GoogleAuthRequest, db: AsyncSession = Depends(get_db)):
    """Verify a Google ID token, upsert the user, and issue a MeetMind JWT."""
    from app.auth import create_access_token

    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    if not (body.credential or "").strip():
        raise HTTPException(status_code=400, detail="Missing Google credential")

    def _verify() -> dict:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        return google_id_token.verify_oauth2_token(
            body.credential, google_requests.Request(), settings.google_client_id
        )

    try:
        info = await asyncio.to_thread(_verify)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {e}") from e

    email = (info.get("email") or "").lower().strip()
    if not email or not info.get("email_verified", False):
        raise HTTPException(status_code=401, detail="Google account email is not verified")
    name = info.get("name") or info.get("given_name") or email.split("@")[0]

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        user = User(
            email=email,
            display_name=name,
            hashed_password="!google-oauth-no-password",  # unusable for password login
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif not user.hashed_password.startswith("!"):
        # Password signup never verified the email; Google just did. Drop that password so
        # whoever registered this address first (possibly not its owner) can't keep access.
        user.hashed_password = "!google-oauth-no-password"
        await db.commit()

    token = create_access_token(user.id, user.email, user.display_name or name)
    return {"access_token": token, "token_type": "bearer", "display_name": user.display_name or name}


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


@app.post("/api/auth/forgot-password")
@limiter.limit("5/minute")
async def auth_forgot_password(
    request: Request, body: ForgotPasswordRequest, background: BackgroundTasks, db: AsyncSession = Depends(get_db)
):
    """Email a single-use reset link. Always answers the same way so it can't reveal which emails exist."""
    from app.auth import create_password_reset_token
    from app.email_service import send_password_reset_email

    result = await db.execute(select(User).where(User.email == body.email.lower().strip()))
    user = result.scalar_one_or_none()
    if user:
        token = create_password_reset_token(user.id, user.hashed_password)
        link = f"{settings.frontend_url.rstrip('/')}/reset-password?token={token}"
        background.add_task(send_password_reset_email, to_address=user.email, link=link)
    return {"ok": True}


@app.post("/api/auth/reset-password")
@limiter.limit("10/minute")
async def auth_reset_password(request: Request, body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    from app.auth import decode_password_reset_token, hash_password, reset_token_matches

    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    payload = decode_password_reset_token(body.token)
    user = await db.get(User, payload["sub"]) if payload else None
    if not user or not reset_token_matches(payload, user.hashed_password):
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired")
    user.hashed_password = hash_password(body.password)
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Email Summary Delivery
# ---------------------------------------------------------------------------

class SendSummaryEmailRequest(BaseModel):
    to: list[str]


@app.post("/api/meetings/{room_name}/send-summary", status_code=202)
async def send_meeting_summary_email(
    room_name: str,
    body: SendSummaryEmailRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Email the meeting summary + action items to the given addresses."""
    from app.email_service import send_summary_email

    meeting = await _require_membership(db, room_name, current_user)

    mid = meeting.id
    notes_q = await db.execute(select(Note).where(Note.meeting_id == mid).order_by(Note.created_at))
    actions_q = await db.execute(select(ActionItem).where(ActionItem.meeting_id == mid).order_by(ActionItem.created_at))
    decisions_q = await db.execute(select(Decision).where(Decision.meeting_id == mid).order_by(Decision.created_at))

    all_notes = notes_q.scalars().all()
    summaries = [n.content for n in all_notes if n.type and n.type.startswith("summary:")]
    summary_text = summaries[-1] if summaries else ""

    action_items = [{"title": a.title, "assigned_to": a.assigned_to, "status": a.status} for a in actions_q.scalars().all()]
    decisions = [{"title": d.title, "chosen": d.chosen_option} for d in decisions_q.scalars().all()]

    try:
        await send_summary_email(
            to_addresses=body.to,
            room_name=room_name,
            title=meeting.title or room_name,
            summary=summary_text,
            action_items=action_items,
            decisions=decisions,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Email delivery failed: {e}")

    return {"ok": True, "sent_to": body.to}


# ---------------------------------------------------------------------------
# WebSocket Signaling
# ---------------------------------------------------------------------------

@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_signaling(websocket: WebSocket, room_id: str, user_id: str, token: str | None = None):
    from app.auth import decode_token
    from app.config import settings as _settings
    from app.database import async_session

    # Enforced auth: a valid JWT is always required, and the user must be a
    # member (owner or participant) of this room. Fails closed if JWT_SECRET unset.
    if not _settings.jwt_secret:
        await websocket.close(code=1011)
        return
    if not token:
        await websocket.close(code=1008)
        return
    try:
        claims = decode_token(token)
    except Exception:
        await websocket.close(code=1008)
        return
    sub = (claims or {}).get("sub")
    async with async_session() as _db:
        mq = await _db.execute(select(Meeting).where(Meeting.room_name == room_id))
        _meeting = mq.scalar_one_or_none()
        if not _meeting:
            await websocket.close(code=1008)
            return
        is_member = bool(sub) and _meeting.owner_id == sub
        if not is_member and sub:
            pq = await _db.execute(
                select(Participant.id).where(
                    Participant.meeting_id == _meeting.id, Participant.user_id == sub
                )
            )
            is_member = pq.scalar_one_or_none() is not None
        if not is_member:
            await websocket.close(code=1008)
            return
    # user_id is a client-chosen per-tab id; never let one account take over another's connection.
    if manager.is_taken_by_other(room_id, user_id, sub):
        await websocket.close(code=1008)
        return
    await manager.connect(room_id, user_id, websocket, sub)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue
            msg_type = data.get("type")

            if msg_type == "join":
                peer_id = data.get("peerId")
                user_name = data.get("userName", "Anonymous")

                manager.user_meta[user_id] = {
                    "peerId": peer_id,
                    "userName": user_name,
                }

                await manager.broadcast(
                    room_id,
                    {
                        "type": "peer_joined",
                        "from": user_id,
                        "peerId": peer_id,
                        "userName": user_name,
                    },
                    exclude=user_id,
                )

                existing = manager.get_users_in_room(room_id)
                for u in existing:
                    if u["userId"] != user_id:
                        await manager.send_to(room_id, user_id, {
                            "type": "peer_joined",
                            "from": u["userId"],
                            "peerId": u.get("peerId"),
                            "userName": u.get("userName", "Participant"),
                        })

                await manager.send_to(
                    room_id,
                    user_id,
                    {
                        "type": "screen_share_sync",
                        "data": manager.get_screen_share_sync_payload(room_id),
                    },
                )

            elif msg_type == "screen_share_start":
                user_name = data.get("userName") or manager.user_meta.get(user_id, {}).get("userName", "Participant")
                current = manager.screen_share_owner.get(room_id)
                if current and current[0] != user_id:
                    await manager.send_to(
                        room_id,
                        user_id,
                        {
                            "type": "screen_share_denied",
                            "data": {
                                "activeUserId": current[0],
                                "activeUserName": current[1],
                                "reason": "Another participant is already presenting.",
                            },
                        },
                    )
                else:
                    manager.screen_share_owner[room_id] = (user_id, user_name)
                    await manager.broadcast(
                        room_id,
                        {
                            "type": "screen_share_sync",
                            "data": manager.get_screen_share_sync_payload(room_id),
                        },
                    )

            elif msg_type == "screen_share_stop":
                if manager.clear_screen_share_if_user(room_id, user_id):
                    await manager.broadcast(
                        room_id,
                        {
                            "type": "screen_share_sync",
                            "data": manager.get_screen_share_sync_payload(room_id),
                        },
                    )

            elif msg_type == "screen_share_takeover":
                payload = data.get("data") or {}
                target = payload.get("targetUserId")
                current = manager.screen_share_owner.get(room_id)
                if not current or not target or current[0] != target:
                    continue
                requester_name = manager.user_meta.get(user_id, {}).get("userName", "Someone")
                await manager.send_to(
                    room_id,
                    target,
                    {
                        "type": "screen_share_revoke",
                        "from": user_id,
                        "data": {
                            "byUserId": user_id,
                            "byUserName": requester_name,
                        },
                    },
                )

            elif msg_type in ("offer", "answer", "candidate"):
                target = data.get("to")
                if target:
                    await manager.send_to(room_id, target, {
                        "type": msg_type,
                        "from": user_id,
                        "data": data.get("data"),
                    })

            elif msg_type == "media_state":
                await manager.broadcast(room_id, {
                    "type": "media_state",
                    "from": user_id,
                    "data": data.get("data"),
                }, exclude=user_id)

            elif msg_type == "chat":
                await manager.broadcast(room_id, {
                    "type": "chat",
                    "from": user_id,
                    "data": data.get("data"),
                    "userName": manager.user_meta.get(user_id, {}).get("userName", "Anonymous"),
                }, exclude=user_id)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Error for {user_id} in {room_id}: {e}")
    finally:
        peer_id = manager.user_meta.get(user_id, {}).get("peerId")
        cleared = manager.clear_screen_share_if_user(room_id, user_id)
        manager.disconnect(room_id, user_id, websocket)
        await manager.broadcast(room_id, {
            "type": "peer_left",
            "from": user_id,
            "peerId": peer_id,
        })
        if cleared:
            await manager.broadcast(
                room_id,
                {
                    "type": "screen_share_sync",
                    "data": manager.get_screen_share_sync_payload(room_id),
                },
            )
