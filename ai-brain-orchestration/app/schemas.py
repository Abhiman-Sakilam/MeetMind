from typing import Any

from pydantic import BaseModel, Field, field_validator


class Attachment(BaseModel):
    kind: str = Field(default="image", description="Attachment kind, e.g. image.")
    mime_type: str = Field(default="", description="MIME type for attachment payload.")
    data_base64: str = Field(default="", description="Base64-encoded payload.")
    name: str = Field(default="", description="Optional attachment name.")


class ExecuteRequest(BaseModel):
    """Text from meet-mind after Whisper; always scoped to one user in one room."""

    user_id: str = Field(..., description="Stable id for this client session / user")
    room_id: str = Field(..., description="Meeting room id")
    user_name: str = Field(default="", description="Display name")
    text: str = Field(..., description="Transcribed command or follow-up utterance")
    session_id: str | None = Field(
        default=None,
        description="Optional id to correlate follow-ups (meet-mind can generate)",
    )
    context: dict[str, Any] | None = Field(
        default=None,
        description="Optional extra context (e.g. recent transcript snippet)",
    )
    source: str | None = Field(
        default="chat",
        description="Input source (chat or voice) to help response style and logging.",
    )
    command: str | None = Field(default=None, description="Optional explicit command tag.")
    trigger: str | None = Field(default=None, description="How this was triggered (wake/button/timer).")
    meeting_phase: str | None = Field(default=None, description="meeting_live or meeting_end.")
    attachments: list[Attachment] | None = Field(
        default=None,
        description="Optional media attachments such as screenshots.",
    )
    screen_ref: str | None = Field(default=None, description="Optional screenshot context ref id.")
    persona: str = Field(default="friendly", description="Jarvis persona key (friendly/professional/witty/calm/hacker/motivator).")


class RoutingInfo(BaseModel):
    route: str
    decided_by: str  # "keyword" | "llm" | "phase"
    matched: str | None = None
    confidence: str = "low"  # "high" | "low"
    reason: str | None = None


class ExecuteResponse(BaseModel):
    reply: str = Field(..., description="Natural language for TTS / UI")
    intent: str | None = Field(default=None, description="Resolved intent label")
    actions: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Structured tool results (empty until tools are wired)",
    )

    @field_validator("actions", mode="before")
    @classmethod
    def _coerce_actions(cls, v: Any) -> list[dict[str, Any]]:
        if not isinstance(v, list):
            return []
        result = []
        for item in v:
            if isinstance(item, dict):
                result.append(item)
            elif isinstance(item, str) and item.strip():
                result.append({"label": item.strip()})
        return result
    ui_event: str | None = Field(
        default=None,
        description="Optional UI hint, e.g. NOTES_OPEN, NOTES_CLOSE, SUMMARY_CARD.",
    )
    notes_state: str | None = Field(default=None, description="on/off for note-taking mode.")
    summary_type: str | None = Field(default=None, description="periodic/final/manual")
    artifacts: dict[str, Any] | None = Field(
        default=None,
        description="Optional extra payload (notes/screenshot metadata).",
    )
    routing: RoutingInfo | None = Field(
        default=None,
        description="Internal routing debug info (route, decided_by, matched, confidence, reason).",
    )


class FinalizeSummaryRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    session_id: str | None = None
    db_transcript: str | None = None
    persona: str = "friendly"


class ScreenAnalyzeRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    question: str = Field(default="Describe this screenshot.")
    session_id: str | None = None
    screenshot_base64: str
    mime_type: str = "image/png"
    name: str = "screenshot.png"
    persona: str = "friendly"


class RawNoteAppendRequest(BaseModel):
    """Lightweight payload: just append raw speech text to notes buffer."""
    user_id: str
    room_id: str
    text: str


class RawNoteAppendResponse(BaseModel):
    ok: bool = True
    chunk_count: int = 0


class TranscriptResponse(BaseModel):
    attributed: str = Field(..., description="Speaker-attributed transcript ([Speaker]: text per line)")
    segments: list[dict[str, Any]] = Field(default_factory=list, description="Raw segment list")


class NotesStateResponse(BaseModel):
    active: bool
    raw_chunk_count: int
    notes: list[dict[str, Any]] = Field(default_factory=list)


class RoleSetRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    role_name: str = Field(..., min_length=1, max_length=60)
    role_description: str = Field(..., min_length=20, max_length=1000)
    sensitivity: str = Field(default="smart", pattern="^(major_only|smart|frequent)$")
    context: dict[str, Any] | None = None
    persona: str = "friendly"


class RoleSetResponse(BaseModel):
    reply: str
    role_name: str
    activated: bool = True


class RoleExitRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""


class RoleExitResponse(BaseModel):
    reply: str
    deactivated: bool = True


class RoleWatchRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    transcript_chunk: str
    context: dict[str, Any] | None = None
    persona: str = "friendly"


class RoleWatchResponse(BaseModel):
    respond: bool
    reply: str = ""
    signal: str | None = None
    role_name: str = ""
    follow_up_questions: list[str] = Field(default_factory=list)


class RoleStateResponse(BaseModel):
    """Current active role for a (user, room) — lets clients re-sync after reload."""
    active: bool
    role_name: str = ""
    role_description: str = ""
    sensitivity: str = ""
