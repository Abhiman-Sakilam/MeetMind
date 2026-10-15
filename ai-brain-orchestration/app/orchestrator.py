import functools
import json
import logging
import re
import time

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq

from app.personas import get_persona
from datetime import datetime

from app.agents.action_items_agent import run_action_items_agent
from app.agents.add_action_item_agent import run_add_action_item_agent
from app.agents.brainstorm_agent import run_brainstorm_agent
from app.agents.decision_agent import run_decision_agent
from app.agents.notes_agent import filter_key_points, generate_session_title
from app.agents.role_agent import run_role_agent
from app.agents.screen_agent import run_screen_agent
from app.agents.summary_agent import run_summary_agent
from app.agents.watcher_agent import chunk_hash, run_watcher_agent
from app.config import settings
from app.schemas import (
    ExecuteRequest,
    ExecuteResponse,
    RoleExitRequest,
    RoleExitResponse,
    RoleSetRequest,
    RoleSetResponse,
    RoleWatchRequest,
    RoleWatchResponse,
    RoutingInfo,
)
from app.notes_store import NotesStore
from app.screen_context_store import ScreenContextStore
from app.session_store import ActiveRole, SessionStore
from app.transcript_store import TranscriptStore

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Jarvis, an AI assistant embedded inside MeetMind — a meeting productivity app.
Your ONLY purpose is to help with the current meeting and its content.

SCOPE RULES (strictly enforce):
- You MAY help with: questions about the current meeting, note-taking, summaries, action items, brainstorming meeting topics, role-playing to explore ideas discussed in the meeting, decisions being made IN this meeting.
- You MUST REFUSE requests about: news, politics, weather, celebrities, sports, coding help unrelated to the meeting, general knowledge, or anything not about this specific meeting.
- When refusing: say "I'm a meeting assistant — I can only help with topics related to this meeting." Do not apologize or elaborate.
- You MAY answer questions about anything stated earlier in THIS meeting using the provided meeting_transcript (e.g. something the user mentioned before and now asks about). This is in scope.
- IMPORTANT: You have NO access to the internet or real-time information. Do not pretend otherwise.

TONE: Use the persona from context.persona if provided (corporate = formal and concise, friendly = warm and conversational, neutral = balanced).

RESPONSE FORMAT: Output a single raw JSON object with keys:
  reply (string), intent (string or null), actions (array of objects, empty if none).
Do not include markdown, code fences, or any text outside the JSON."""

ROUTER_PROMPT = """You are the Jarvis Intent Router for MeetMind, a meeting assistant app.

Return JSON with exactly one key `route` chosen from:
SUMMARY_NOW, SUMMARY_PERIODIC, SUMMARY_FINAL, START_NOTES, STOP_NOTES, SHOW_NOTES,
SCREEN_CAPTURE_ANALYZE, PLAY_ROLE, BRAINSTORM, HELP_DECIDE, DEVIL_ADVOCATE, ACTION_ITEMS, GENERAL.

CRITICAL ROUTING RULES — read carefully:
- SUMMARY_NOW: ONLY when the user explicitly asks for a recap/summary OF THIS MEETING (e.g. "summarize the meeting", "what have we covered so far").
- HELP_DECIDE: ONLY when the user is choosing between specific options CURRENTLY being discussed in the meeting (e.g. "help me decide between option A and B"). NOT for sentences that merely contain the word "decision" about external topics.
- GENERAL: Use this for any question about external topics (news, people, politics, world events), general knowledge, or anything not specifically about the current meeting's content. When in doubt, use GENERAL.
- BRAINSTORM: Only when user explicitly wants creative idea generation for meeting topics.
- ACTION_ITEMS: Only when user explicitly wants to list or assign tasks from this meeting.
- PLAY_ROLE / DEVIL_ADVOCATE: Only when user asks Jarvis to take a specific role or challenge ideas.

Examples:
- "Can you talk about Trump's decisions?" → GENERAL (external topic, not a meeting decision)
- "Summarize the meeting" → SUMMARY_NOW
- "Help me decide between option A and B" → HELP_DECIDE
- "What are today's action items?" → ACTION_ITEMS

Also allowed: CANCEL (user retracts/aborts a request, e.g. "never mind"), REPEAT (user asks to hear the last answer again, e.g. "say that again"), ADD_ACTION_ITEM (user dictates a NEW task/reminder to add, e.g. "add a match with Virat tomorrow at 8am to action items").
Return JSON: {"route": <ROUTE>, "confidence": "high"|"low", "reason": <short why>}."""

SESSION_STORE = SessionStore(
    max_tokens=settings.context_max_tokens,
    keep_last_turns=settings.context_keep_last_turns,
)
NOTES_STORE = NotesStore()
SCREEN_STORE = ScreenContextStore()
TRANSCRIPT_STORE = TranscriptStore()


def _style_hint(req: ExecuteRequest) -> str:
    style = (req.context or {}).get("response_style")
    if style == "short":
        return "User requested short style."
    if style == "long":
        return "User requested detailed style."
    lower = req.text.lower()
    long_cues = ("in detail", "deep dive", "step by step", "thoroughly", "elaborate")
    short_cues = ("briefly", "short answer", "tl;dr", "one line")
    if any(cue in lower for cue in long_cues):
        return "User asked for detailed response."
    if any(cue in lower for cue in short_cues):
        return "User asked for concise response."
    return "Use adaptive length."


def run_execute(req: ExecuteRequest) -> ExecuteResponse:
    if not (req.text or "").strip():
        return ExecuteResponse(
            reply="I didn't catch that. Could you repeat?",
            intent="EMPTY_INPUT",
            actions=[],
        )
    if not settings.groq_api_key:
        return ExecuteResponse(
            reply="I'm not configured yet: set GROQ_API_KEY on the AI Brain service.",
            intent="UNKNOWN",
            actions=[],
        )

    # Persona switch — return the canned announcement directly, no LLM needed.
    if (req.trigger or "").lower() == "persona_switch":
        persona = get_persona(req.persona)
        return ExecuteResponse(
            reply=persona.switch_announcement,
            intent="PERSONA_SWITCH",
            actions=[],
        )

    # Do not treat meeting-end summary triggers as spoken meeting content.
    if (req.meeting_phase or "").lower() != "meeting_end" and (req.trigger or "").lower() != "meeting_end":
        TRANSCRIPT_STORE.append(req.user_id, req.room_id, req.text, speaker=req.user_name or "user")

    memory = SESSION_STORE.get_context_window(req.user_id, req.room_id)
    route, routing_info = _route_intent(_build_llm(settings.model_router, 0.0), req, memory)
    logger.info(
        "route=%s decided_by=%s matched=%s",
        routing_info.route, routing_info.decided_by, routing_info.matched,
    )
    resp = _dispatch_route(route, req, memory)
    resp.routing = routing_info
    return resp


def _dispatch_route(route: str, req: ExecuteRequest, memory: dict[str, object]) -> ExecuteResponse:
    try:
        if route in {"SUMMARY_NOW", "SUMMARY_PERIODIC", "SUMMARY_FINAL"}:
            summary_type = (
                "final"
                if route == "SUMMARY_FINAL" or (req.meeting_phase or "").lower() == "meeting_end"
                else "periodic" if route == "SUMMARY_PERIODIC" else "manual"
            )
            full_transcript = TRANSCRIPT_STORE.get_attributed_transcript(req.user_id, req.room_id)
            out = run_summary_agent(
                _build_llm(settings.model_summary, 0.2),
                text=req.text,
                context={"memory": memory, "context": req.context or {}, "user_name": req.user_name},
                summary_type=summary_type,
                full_transcript=full_transcript,
                persona_prompt=_persona_prompt(req),
            )
            reply = str(out.get("reply", "")).strip() or "Here is your meeting summary."
            _append_conversation(req, reply)
            return ExecuteResponse(
                reply=reply,
                intent=str(out.get("intent", "GET_SUMMARY")),
                actions=list(out.get("actions") or []),
                ui_event="SUMMARY_CARD",
                summary_type=summary_type,
                artifacts={
                    "topics": out.get("topics", []),
                    "keywords": out.get("keywords", []),
                },
            )

        if route == "START_NOTES":
            NOTES_STORE.start(req.user_id, req.room_id)
            ack_res = _build_plain_llm(settings.model_general, 0.5).invoke([
                SystemMessage(content=_persona_prompt(req)),
                HumanMessage(content="Acknowledge that you've started taking notes. One sentence, in character."),
            ])
            reply = (ack_res.content or "").strip() or "Notes active."
            _append_conversation(req, reply)
            return ExecuteResponse(
                reply=reply,
                intent="START_NOTES",
                actions=[],
                ui_event="NOTES_OPEN",
                notes_state="on",
                artifacts={"notes": NOTES_STORE.get(req.user_id, req.room_id).notes},
            )

        if route == "STOP_NOTES":
            state = NOTES_STORE.get(req.user_id, req.room_id)
            active_session = state.get_active_session()
            session_id = active_session.id if active_session else ""
            raw = state.raw_transcript()
            llm_notes = _build_llm(settings.model_notes, 0.0)
            filtered = filter_key_points(llm_notes, raw, _persona_prompt(req)) if raw else []
            NOTES_STORE.set_filtered(req.user_id, req.room_id, filtered)
            session_title = generate_session_title(llm_notes, filtered) if filtered else "Notes Session"
            NOTES_STORE.set_session_title(req.user_id, req.room_id, session_title)
            NOTES_STORE.stop(req.user_id, req.room_id)
            state = NOTES_STORE.get(req.user_id, req.room_id)
            if filtered:
                reply = _format_notes_reply(filtered)
            else:
                ack_res = _build_plain_llm(settings.model_general, 0.5).invoke([
                    SystemMessage(content=_persona_prompt(req)),
                    HumanMessage(content="Acknowledge that you've stopped taking notes but nothing meaningful was captured. One sentence, in character."),
                ])
                reply = (ack_res.content or "").strip() or "Notes stopped. Nothing captured."
            _append_conversation(req, reply)
            return ExecuteResponse(
                reply=reply,
                intent="STOP_NOTES",
                actions=[],
                ui_event="NOTES_CLOSE",
                notes_state="off",
                artifacts={
                    "notes": filtered,
                    "raw_chunk_count": sum(len(s.raw_chunks) for s in state.sessions),
                    "cleaned": True,
                    "session_id": session_id,
                    "session_title": session_title,
                },
            )

        if route == "SHOW_NOTES":
            state = NOTES_STORE.get(req.user_id, req.room_id)
            raw = state.raw_transcript()
            logger.info("SHOW_NOTES: user=%s room=%s raw_chunks=%d raw_len=%d",
                        req.user_id, req.room_id, sum(len(s.raw_chunks) for s in state.sessions), len(raw))
            if raw:
                filtered = filter_key_points(_build_llm(settings.model_notes, 0.0), raw, _persona_prompt(req))
                logger.info("SHOW_NOTES: filtered=%d items", len(filtered))
                NOTES_STORE.set_filtered(req.user_id, req.room_id, filtered)
                reply = _format_notes_reply(filtered)
            else:
                filtered = []
                reply = "No notes were captured yet. Make sure you said 'start taking notes' first and spoke while note mode was active."
            _append_conversation(req, reply)
            return ExecuteResponse(
                reply=reply,
                intent="SHOW_NOTES",
                actions=[],
                ui_event="NOTES_OPEN",
                notes_state="on" if state.active else "off",
                artifacts={
                    "notes": filtered,
                    "raw_chunk_count": sum(len(s.raw_chunks) for s in state.sessions),
                    "session_id": state.get_active_session().id if state.get_active_session() else "",
                },
            )

        if route == "SCREEN_CAPTURE_ANALYZE":
            return _handle_screen(req, _build_screen_llm())

        if route == "EXIT_ROLE":
            SESSION_STORE.clear_role(req.user_id, req.room_id)
            ack_res = _build_plain_llm(settings.model_general, 0.5).invoke([
                SystemMessage(content=_persona_prompt(req)),
                HumanMessage(content="Acknowledge that you've exited the role-play and are back to normal. One sentence, in character."),
            ])
            reply = (ack_res.content or "").strip() or "Role exited. Back to normal."
            _append_conversation(req, reply)
            return ExecuteResponse(
                reply=reply,
                intent="EXIT_ROLE",
                actions=[],
                ui_event="ROLE_EXITED",
            )

        if route in ("PLAY_ROLE", "DEVIL_ADVOCATE"):
            if route == "DEVIL_ADVOCATE":
                role_name = "Devil's Advocate"
                role_description = (
                    "A constructive challenger who questions every assumption, "
                    "pokes holes in ideas, and steelman-then-attacks proposals."
                )
            else:
                role_name = _extract_role_name(req.text)
                role_description = _auto_role_description(role_name, memory)

            # Switch to the new role when a different one is requested — silently
            # keeping the old role while reporting ROLE_ACTIVATED confused users.
            existing = SESSION_STORE.get_role(req.user_id, req.room_id)
            if not existing or existing.name.lower() != role_name.lower():
                SESSION_STORE.set_role(
                    req.user_id,
                    req.room_id,
                    ActiveRole(name=role_name, description=role_description, sensitivity="smart"),
                )
            active_role = SESSION_STORE.get_role(req.user_id, req.room_id)

            out = _with_model_fallback(
                lambda model: run_role_agent(
                    _build_llm(model, 0.3),
                    text=req.text,
                    role_name=active_role.name,
                    role_description=active_role.description,
                    signal_type="entry",
                    context={"memory": memory, "context": req.context or {}, "user_name": req.user_name},
                    persona_prompt=_persona_prompt(req),
                ),
                preferred_model=settings.model_reasoning,
                fallback_model=settings.model_general,
            )
            reply = str(out.get("reply", "")).strip() or "Here is my perspective."
            _append_conversation(req, reply)
            return ExecuteResponse(
                reply=reply,
                intent=route,
                actions=list(out.get("actions") or []),
                ui_event="ROLE_ACTIVATED",
                artifacts={
                    "role": out.get("role", role_name),
                    "role_activated": {
                        "name": active_role.name,
                        "description": active_role.description,
                        "sensitivity": active_role.sensitivity,
                    },
                },
            )

        if route == "BRAINSTORM":
            out = _with_model_fallback(
                lambda model: run_brainstorm_agent(
                    _build_llm(model, 0.5),
                    text=req.text,
                    context={"memory": memory, "context": req.context or {}, "user_name": req.user_name},
                    persona_prompt=_persona_prompt(req),
                ),
                preferred_model=settings.model_reasoning,
                fallback_model=settings.model_general,
            )
            reply = str(out.get("reply", "")).strip() or "Here are some ideas."
            _append_conversation(req, reply)
            return ExecuteResponse(
                reply=reply,
                intent="BRAINSTORM",
                actions=list(out.get("actions") or []),
            )

        if route == "HELP_DECIDE":
            out = _with_model_fallback(
                lambda model: run_decision_agent(
                    _build_llm(model, 0.2),
                    text=req.text,
                    context={"memory": memory, "context": req.context or {}, "user_name": req.user_name},
                    persona_prompt=_persona_prompt(req),
                ),
                preferred_model=settings.model_reasoning,
                fallback_model=settings.model_general,
            )
            reply = str(out.get("reply", "")).strip() or "Here is my analysis."
            _append_conversation(req, reply)
            return ExecuteResponse(
                reply=reply,
                intent="HELP_DECIDE",
                actions=list(out.get("actions") or []),
                artifacts={
                    "options": out.get("options", []),
                    "recommendation": out.get("recommendation", ""),
                },
            )

        if route == "ADD_ACTION_ITEM":
            out = run_add_action_item_agent(req.text, datetime.now())
            reply = str(out.get("reply", "")).strip() or "Added to your action items."
            _append_conversation(req, reply)
            return ExecuteResponse(
                reply=reply,
                intent="ADD_ACTION_ITEM",
                actions=[],
                ui_event="ACTION_ITEMS",
                artifacts={"items": out.get("items", [])},
            )

        if route == "ACTION_ITEMS":
            full_transcript = TRANSCRIPT_STORE.get_attributed_transcript(req.user_id, req.room_id)
            notes_state = NOTES_STORE.get(req.user_id, req.room_id)
            notes_text = notes_state.raw_transcript() if notes_state else ""
            out = _with_model_fallback(
                lambda model: run_action_items_agent(
                    _build_llm(model, 0.1),
                    text=req.text,
                    context={"memory": memory, "context": req.context or {}, "user_name": req.user_name},
                    persona_prompt=_persona_prompt(req),
                    full_transcript=full_transcript,
                    notes_text=notes_text,
                ),
                preferred_model=settings.model_reasoning,
                fallback_model=settings.model_general,
            )
            reply = str(out.get("reply", "")).strip() or "Here are the action items."
            _append_conversation(req, reply)
            return ExecuteResponse(
                reply=reply,
                intent="ACTION_ITEMS",
                actions=list(out.get("actions") or []),
                artifacts={"items": out.get("items", [])},
                ui_event="ACTION_ITEMS",
            )

        if route == "CANCEL":
            # Abort the pending ask only. Does NOT exit an active role-play —
            # that is EXIT_ROLE's job ("exit role", "be yourself").
            reply = "Okay, cancelled. What next?"
            _append_conversation(req, reply)
            return ExecuteResponse(reply=reply, intent="CANCEL", actions=[], ui_event="CANCELLED")

        if route == "REPEAT":
            turns = memory.get("recent_turns") or []
            last = next((t["text"] for t in reversed(turns) if t.get("role") == "assistant"), "")
            reply = last or "I don't have anything to repeat yet."
            return ExecuteResponse(reply=reply, intent="REPEAT", actions=[])

        # Auto-note: just store raw chunk, no LLM needed (instant).
        notes_state_obj = NOTES_STORE.get(req.user_id, req.room_id)
        if notes_state_obj.active and req.text.strip():
            NOTES_STORE.append_raw(req.user_id, req.room_id, req.text)
            return ExecuteResponse(
                reply="",
                intent="APPEND_NOTE_RAW",
                actions=[],
                ui_event="NOTES_RAW_CHUNK",
                notes_state="on",
                artifacts={"raw_chunk": req.text.strip(), "chunk_count": sum(len(s.raw_chunks) for s in notes_state_obj.sessions)},
            )

        return _run_general(req, _build_llm(settings.model_general, 0.4), memory)
    except Exception as e:
        logger.exception("LangChain execute failed: %s", e)
        return ExecuteResponse(
            reply="Sorry, I hit an error processing that. Try again in a moment.",
            intent="UNKNOWN",
            actions=[],
        )


def _append_conversation(req: ExecuteRequest, reply: str) -> None:
    if (req.meeting_phase or "").lower() == "meeting_end":
        return
    SESSION_STORE.append_turn(req.user_id, req.room_id, "user", req.text)
    SESSION_STORE.append_turn(req.user_id, req.room_id, "assistant", reply)


def _normalize(text: str) -> str:
    return re.sub(r"[^\w\s]", " ", text.lower())


def _extract_role_name(text: str) -> str:
    patterns = [
        r"act\s+as\s+(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
        r"play\s+(?:the\s+role\s+of\s+|as\s+)?(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
        r"pretend\s+you\s+are\s+(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
        r"think\s+like\s+(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
        r"speak\s+as\s+(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
        r"be\s+(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
    ]
    for p in patterns:
        m = re.search(p, text, flags=re.IGNORECASE)
        if m:
            name = m.group(1).strip()[:60]
            # Title-case plain lowercase names; preserve acronyms ("CISO" stays "CISO").
            return name.title() if name == name.lower() else name
    return "Role Player"


def _auto_role_description(role_name: str, memory: dict[str, object]) -> str:
    context_summary = str(memory.get("summary", ""))[:200]
    base = (
        f"A {role_name} providing expert perspective on the topics discussed in this meeting. "
        f"Focus on what a {role_name} would uniquely observe, challenge, or question based on their domain expertise."
    )
    if context_summary:
        base += f" Meeting context so far: {context_summary}"
    return base[:1000]


# Strong, explicit multi-word phrases only. Weak/ambiguous cues (e.g. "be a",
# a passing "next steps") are intentionally NOT here — they go to the LLM router.
_STRONG_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("START_NOTES", ("start taking notes", "start notes", "begin notes",
                     "take notes", "note this down", "start tracking notes")),
    ("STOP_NOTES", ("stop taking notes", "stop notes", "end notes",
                    "finish notes", "stop tracking notes")),
    ("SHOW_NOTES", ("show notes", "show me the notes", "show me my notes",
                    "read the notes", "view notes", "display notes")),
    ("SCREEN_CAPTURE_ANALYZE", ("analyze the screen", "look at the screen",
                                "look at my screen", "read my screen",
                                "screen capture", "take a screenshot")),
    ("DEVIL_ADVOCATE", ("devils advocate", "devil s advocate",
                        "play devils advocate", "play devil s advocate",
                        "poke holes", "argue against")),
    ("BRAINSTORM", ("brainstorm", "generate ideas", "come up with ideas",
                    "give me ideas", "suggest ideas")),
    ("HELP_DECIDE", ("help me decide", "help us decide", "which option",
                     "compare options", "pros and cons")),
    ("ADD_ACTION_ITEM", ("add a reminder", "create a reminder", "remind me to",
                         "add an action item", "add action item",
                         "to the action items", "to action items",
                         "on the action items", "put it on the list")),
    ("ACTION_ITEMS", ("action items", "list the tasks", "task list",
                      "todo list", "to do list", "assign tasks")),
    ("EXIT_ROLE", ("exit role", "stop role", "end role", "leave role",
                   "stop acting", "stop playing", "be yourself")),
    ("PLAY_ROLE", ("act as", "play the role", "pretend you are", "roleplay",
                   "role play", "take the role", "speak as")),
    ("CANCEL", ("never mind", "nevermind", "cancel that", "scrap that",
                "forget it", "cancel it")),
    ("REPEAT", ("say that again", "repeat that", "come again",
                "what did you say", "repeat please")),
]

_LLM_ALLOWED = {
    "SUMMARY_NOW", "SUMMARY_PERIODIC", "SUMMARY_FINAL",
    "START_NOTES", "STOP_NOTES", "SHOW_NOTES", "SCREEN_CAPTURE_ANALYZE",
    "PLAY_ROLE", "BRAINSTORM", "HELP_DECIDE", "DEVIL_ADVOCATE",
    "ACTION_ITEMS", "ADD_ACTION_ITEM", "CANCEL", "REPEAT", "GENERAL",
}


def _keyword_route(text: str) -> tuple[str | None, str | None]:
    """Return (route, matched_phrase) for a strong word-boundary phrase, else (None, None)."""
    lower = _normalize(text)
    for route, phrases in _STRONG_KEYWORDS:
        for phrase in phrases:
            if re.search(rf"\b{re.escape(phrase)}\b", lower):
                return route, phrase
    return None, None


def _llm_route(llm: BaseChatModel, req: ExecuteRequest, memory: dict[str, object]) -> tuple[str, str]:
    """LLM classification fallback. Returns (route, reason)."""
    payload = json.dumps(
        {
            "text": req.text,
            "source": req.source or "chat",
            "trigger": req.trigger,
            "meeting_phase": req.meeting_phase,
            "context": req.context or {},
            "memory": memory,
        },
        ensure_ascii=False,
    )
    try:
        res = llm.invoke([SystemMessage(content=ROUTER_PROMPT), HumanMessage(content=payload)])
        raw = res.content if isinstance(res.content, str) else "{}"
        data = json.loads(raw)
        route = str(data.get("route", "GENERAL")).strip().upper()
        reason = str(data.get("reason", "")).strip()[:200]
        return (route if route in _LLM_ALLOWED else "GENERAL"), reason
    except Exception as exc:
        # Router LLM call or JSON parse failed — surface it instead of failing
        # silently, then keep the safe GENERAL fallback so the request still works.
        logger.warning("Router classification failed, defaulting to GENERAL: %s", exc)
        return "GENERAL", "router error"


def _route_intent(
    llm: BaseChatModel, req: ExecuteRequest, memory: dict[str, object]
) -> tuple[str, RoutingInfo]:
    # meeting_end is an unambiguous signal — beats any keyword in the request text
    # (e.g. the finalize prompt contains "action items" which would otherwise hijack the route).
    if (req.meeting_phase or "").lower() == "meeting_end":
        return "SUMMARY_FINAL", RoutingInfo(
            route="SUMMARY_FINAL", decided_by="phase", confidence="high"
        )

    kw_route, matched = _keyword_route(req.text)
    if kw_route:
        return kw_route, RoutingInfo(
            route=kw_route, decided_by="keyword", matched=matched, confidence="high"
        )

    route, reason = _llm_route(llm, req, memory)
    return route, RoutingInfo(route=route, decided_by="llm", confidence="low", reason=reason)


def _build_system_prompt(req: ExecuteRequest) -> str:
    persona = get_persona(req.persona)
    ctx = req.context or {}
    meeting_title = ctx.get("meeting_title", "")
    participants = ctx.get("participants", [])
    duration_min = ctx.get("duration_min")
    notes_active = ctx.get("notes_active", False)

    meeting_lines = []
    if meeting_title:
        meeting_lines.append(f"Meeting: {meeting_title}")
    if participants:
        names = ", ".join(str(p) for p in participants[:10])
        meeting_lines.append(f"Participants: {names}")
    if duration_min is not None:
        meeting_lines.append(f"Duration so far: {int(duration_min)} min")
    meeting_lines.append(f"Notes mode: {'active' if notes_active else 'inactive'}")

    meeting_block = "CURRENT MEETING CONTEXT:\n" + "\n".join(meeting_lines) if meeting_lines else ""

    active_role = SESSION_STORE.get_role(req.user_id, req.room_id)
    if active_role:
        role_block = (
            f"\n\nACTIVE ROLE: You are currently playing {active_role.name}. "
            f"{active_role.description}. "
            "Stay in character even for non-role requests until explicitly told to exit."
        )
    else:
        role_block = ""

    return (
        persona.system_prompt
        + "\n\n"
        + SYSTEM_PROMPT
        + (f"\n\n{meeting_block}" if meeting_block else "")
        + role_block
    )


def _persona_prompt(req: ExecuteRequest) -> str:
    """Return the persona system_prompt string for injection into agent calls."""
    return get_persona(req.persona).system_prompt


def _run_general(req: ExecuteRequest, llm: BaseChatModel, memory: dict[str, object]) -> ExecuteResponse:
    meeting_transcript = TRANSCRIPT_STORE.get_attributed_transcript(req.user_id, req.room_id)
    user_content = json.dumps(
        {
            "user_id": req.user_id,
            "room_id": req.room_id,
            "user_name": req.user_name,
            "session_id": req.session_id,
            "source": req.source or "chat",
            "response_style_hint": _style_hint(req),
            "text": req.text,
            "context": req.context or {},
            "memory": memory,
            "meeting_transcript": meeting_transcript[-8000:],
        },
        ensure_ascii=False,
    )
    response = llm.invoke(
        [
            SystemMessage(content=_build_system_prompt(req)),
            HumanMessage(content=user_content),
        ]
    )
    raw = response.content if isinstance(response.content, str) else "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        reply = raw.strip() or "Okay."
        _append_conversation(req, reply)
        return ExecuteResponse(reply=reply, intent="GENERAL", actions=[])
    reply = str(data.get("reply", "")).strip() or "Okay."
    _append_conversation(req, reply)
    return ExecuteResponse(
        reply=reply,
        intent=data.get("intent"),
        actions=list(data.get("actions") or []),
    )


def _format_notes_reply(notes: list[dict[str, str | float]]) -> str:
    if not notes:
        return "No key points were captured."

    sections: dict[str, list[str]] = {}
    for item in notes:
        text = str(item.get("text", "")).strip()
        section = str(item.get("section", "")).strip()
        if not text:
            continue
        sections.setdefault(section, []).append(text)

    if not sections:
        return "No key points were captured."

    body_lines = ["Here are your notes:\n"]
    for heading, points in sections.items():
        if heading:
            body_lines.append(f"**{heading}**")
        for pt in points:
            body_lines.append(f"• {pt}")
        body_lines.append("")
    return "\n".join(body_lines).strip()


def _handle_screen(req: ExecuteRequest, llm: BaseChatModel) -> ExecuteResponse:
    attachment = (req.attachments or [None])[0]
    image_b64 = attachment.data_base64 if attachment else ""
    mime_type = attachment.mime_type if attachment else "image/png"
    name = attachment.name if attachment else "screenshot.png"

    current = SCREEN_STORE.get(req.user_id, req.room_id, req.session_id)
    if image_b64:
        SCREEN_STORE.update(
            req.user_id,
            req.room_id,
            req.session_id,
            image_base64=image_b64,
            mime_type=mime_type,
            name=name,
            question=req.text,
        )
    elif current.last_image_base64:
        image_b64 = current.last_image_base64
        mime_type = current.mime_type
        name = current.name

    out = run_screen_agent(
        llm,
        question=req.text,
        mime_type=mime_type,
        name=name,
        image_base64=image_b64 or None,
        prior_context={"last_question": current.last_question, "last_answer": current.last_answer},
    )
    reply = str(out.get("reply", "")).strip() or "I analyzed the latest screenshot context."
    SCREEN_STORE.update(
        req.user_id,
        req.room_id,
        req.session_id,
        image_base64=image_b64,
        mime_type=mime_type,
        name=name,
        question=req.text,
        answer=reply,
    )
    _append_conversation(req, reply)
    return ExecuteResponse(
        reply=reply,
        intent=str(out.get("intent", "SCREEN_ANALYSIS")),
        actions=list(out.get("actions") or []),
        artifacts={"screen_ref": req.screen_ref or "latest", "has_image": bool(image_b64)},
    )


@functools.lru_cache(maxsize=16)
def _build_llm(model: str, temperature: float) -> BaseChatModel:
    return ChatGroq(
        api_key=settings.groq_api_key,
        model=model,
        temperature=temperature,
        model_kwargs={"response_format": {"type": "json_object"}},
    )


def _build_plain_llm(model: str, temperature: float) -> BaseChatModel:
    """Plain-text LLM — no json_object constraint. Use for short acknowledgment replies."""
    return ChatGroq(
        api_key=settings.groq_api_key,
        model=model,
        temperature=temperature,
    )


@functools.lru_cache(maxsize=1)
def _build_screen_llm() -> BaseChatModel:
    """Vision path: no forced json_object — screen agent parses JSON from model output."""
    return ChatGroq(
        api_key=settings.groq_api_key,
        model=settings.model_screen,
        temperature=0.2,
    )


def handle_role_set(body: RoleSetRequest) -> RoleSetResponse:
    role = ActiveRole(
        name=body.role_name,
        description=body.role_description,
        sensitivity=body.sensitivity,
    )
    SESSION_STORE.set_role(body.user_id, body.room_id, role)
    memory = SESSION_STORE.get_context_window(body.user_id, body.room_id)
    out = _with_model_fallback(
        lambda model: run_role_agent(
            _build_llm(model, 0.3),
            text="You are entering this meeting now. Introduce yourself in character briefly.",
            role_name=body.role_name,
            role_description=body.role_description,
            signal_type="entry",
            context={"memory": memory, "context": body.context or {}, "user_name": body.user_name},
            persona_prompt=get_persona(body.persona).system_prompt,
        ),
        preferred_model=settings.model_reasoning,
        fallback_model=settings.model_general,
    )
    return RoleSetResponse(reply=str(out["reply"]), role_name=body.role_name)


def handle_role_get(user_id: str, room_id: str) -> "RoleStateResponse":
    from app.schemas import RoleStateResponse

    role = SESSION_STORE.get_role(user_id, room_id)
    if not role:
        return RoleStateResponse(active=False)
    return RoleStateResponse(
        active=True,
        role_name=role.name,
        role_description=role.description,
        sensitivity=role.sensitivity,
    )


def handle_role_exit(body: RoleExitRequest) -> RoleExitResponse:
    SESSION_STORE.clear_role(body.user_id, body.room_id)
    return RoleExitResponse(reply="I'm stepping out of my role. Back to normal Jarvis mode.")


def handle_role_watch(body: RoleWatchRequest) -> RoleWatchResponse:
    role = SESSION_STORE.get_role(body.user_id, body.room_id)
    if not role:
        return RoleWatchResponse(respond=False)

    now = time.time()
    if now - role.last_proactive_at < 60:
        return RoleWatchResponse(respond=False)

    h = chunk_hash(body.transcript_chunk)
    if h == role.last_chunk_hash or h in role.recent_chunk_hashes:
        return RoleWatchResponse(respond=False)

    watcher_out = run_watcher_agent(
        _build_llm(settings.model_router, 0.0),
        chunk=body.transcript_chunk,
        role_name=role.name,
        role_description=role.description,
        sensitivity=role.sensitivity,
    )

    if not watcher_out["respond"]:
        return RoleWatchResponse(respond=False)

    memory = SESSION_STORE.get_context_window(body.user_id, body.room_id)
    role_out = _with_model_fallback(
        lambda model: run_role_agent(
            _build_llm(model, 0.3),
            text=body.transcript_chunk,
            role_name=role.name,
            role_description=role.description,
            signal_type=str(watcher_out.get("signal") or "on-demand"),
            context={
                "memory": memory,
                "context": body.context or {},
                # Feed back recent interjections so the role doesn't repeat itself.
                "your_recent_interjections": role.recent_replies,
            },
            persona_prompt=get_persona(body.persona).system_prompt,
        ),
        preferred_model=settings.model_reasoning,
        fallback_model=settings.model_general,
    )

    SESSION_STORE.update_proactive(body.user_id, body.room_id, h, reply=str(role_out.get("reply", "")))

    return RoleWatchResponse(
        respond=True,
        reply=str(role_out["reply"]),
        signal=str(watcher_out.get("signal") or ""),
        role_name=role.name,
        follow_up_questions=list(role_out.get("follow_up_questions") or []),
    )


def _with_model_fallback(callable_fn, *, preferred_model: str, fallback_model: str):
    try:
        return callable_fn(preferred_model)
    except Exception as e:
        if "model_decommissioned" not in str(e):
            raise
        logger.warning(
            "Model '%s' decommissioned, retrying with fallback '%s'",
            preferred_model,
            fallback_model,
        )
        return callable_fn(fallback_model)
