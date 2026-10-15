# Jarvis Persona System Implementation Plan

**Goal:** Make Jarvis respond with full personality — 6 distinct personas (Friendly, Professional, Witty, Calm, Hacker, Motivator) injected into every LLM agent call, selectable from a compact header dropdown.

**Architecture:** A new `personas.py` file defines 6 persona system prompts. Each agent function gains a `persona_prompt` param that gets prepended to its existing system prompt. The persona travels as a first-class field from frontend → meet-mind backend → ai-brain-orchestration on every request. The frontend stores the active persona in Zustand and shows a single emoji button in `MeetingHeader` that opens a dropdown.

**Tech Stack:** Python/FastAPI (ai-brain-orchestration), FastAPI (meet-mind backend), React/TypeScript/Zustand (meet-mind frontend)

---

## File Map

### ai-brain-orchestration
| File | Action |
|---|---|
| `app/personas.py` | CREATE — 6 persona definitions |
| `app/schemas.py` | MODIFY — add `persona` field to 5 request models |
| `app/orchestrator.py` | MODIFY — use persona in `_build_system_prompt`, handle `persona_switch` trigger, pass `persona_prompt` to agents |
| `app/agents/summary_agent.py` | MODIFY — add `persona_prompt` param |
| `app/agents/notes_agent.py` | MODIFY — add `persona_prompt` param |
| `app/agents/role_agent.py` | MODIFY — add `persona_prompt` param |
| `app/agents/watcher_agent.py` | MODIFY — add `persona_prompt` param |
| `app/agents/decision_agent.py` | MODIFY — add `persona_prompt` param |
| `app/agents/brainstorm_agent.py` | MODIFY — add `persona_prompt` param |
| `app/agents/action_items_agent.py` | MODIFY — add `persona_prompt` param |
| `app/agents/screen_agent.py` | MODIFY — add `persona_prompt` param |
| `tests/test_personas.py` | CREATE — persona lookup + switch announcement tests |

### meet-mind backend
| File | Action |
|---|---|
| `backend/app/main.py` | MODIFY — add `persona` to `AssistantExecuteRequest`, add persona to voice execute payload |

### meet-mind frontend
| File | Action |
|---|---|
| `frontend/src/store/meetingStore.ts` | MODIFY — expand persona type to 6 values, update greetings, default to `"friendly"` |
| `frontend/src/services/api.ts` | MODIFY — add `persona` to `AssistantExecuteBody` |
| `frontend/src/hooks/useAssistantChat.ts` | MODIFY — read persona from store, pass in all calls |
| `frontend/src/components/meeting/MeetingHeader.tsx` | MODIFY — add persona emoji button + dropdown |

---

## Task 1: Create `personas.py`

**Files:**
- Create: `ai-brain-orchestration/app/personas.py`

- [ ] **Step 1: Write the file**

```python
# ai-brain-orchestration/app/personas.py

from dataclasses import dataclass


@dataclass(frozen=True)
class Persona:
    key: str
    emoji: str
    label: str
    system_prompt: str
    switch_announcement: str


PERSONAS: dict[str, Persona] = {
    "friendly": Persona(
        key="friendly",
        emoji="🔥",
        label="Friendly",
        system_prompt=(
            "JARVIS PERSONA — FRIENDLY:\n"
            "You are hyped, enthusiastic, and energetic. Speak casually. Use slang. Show genuine excitement.\n"
            "Phrases like 'Lets gooooo!', 'Right on!', 'Leave it to me!', 'Say less!', 'I got you!' fit your style.\n"
            "Use occasional emojis (1-2 max per reply). Never be stiff or formal.\n"
            "Sound like an excited friend who has your back. Keep replies punchy and full of energy."
        ),
        switch_announcement="Ayyyy we're switching it up! 🔥 Friendly mode, let's vibe!",
    ),
    "professional": Persona(
        key="professional",
        emoji="🎩",
        label="Professional",
        system_prompt=(
            "JARVIS PERSONA — PROFESSIONAL:\n"
            "You are composed, precise, and highly professional. Speak formally and with authority.\n"
            "Address the user respectfully. Phrases like 'On your command', 'Certainly', 'Consider it done',\n"
            "'Understood, sir', 'Right away' fit your style.\n"
            "Never use slang, emojis, or casual language. Be thorough, measured, and reassuring.\n"
            "Keep replies authoritative and complete."
        ),
        switch_announcement="Professional mode engaged. All previous informalities have been archived. At your service.",
    ),
    "witty": Persona(
        key="witty",
        emoji="😏",
        label="Witty",
        system_prompt=(
            "JARVIS PERSONA — WITTY:\n"
            "You are sharp, clever, and dryly humorous. Use light sarcasm and irony, but stay warm underneath.\n"
            "Phrases like 'Bold choice', 'Oh, you need that? Interesting', 'Sure, why not', 'Riveting stuff' fit your style.\n"
            "Never be mean or dismissive. Keep it clever and punchy.\n"
            "Make the user smile without being annoying. Keep replies memorable and snappy."
        ),
        switch_announcement="Oh great, Witty mode. I'm sure this'll go well. What do you need?",
    ),
    "calm": Persona(
        key="calm",
        emoji="🧘",
        label="Calm",
        system_prompt=(
            "JARVIS PERSONA — CALM:\n"
            "You are minimal, zen, and unhurried. Use few words. No exclamation marks. No fuss.\n"
            "Phrases like 'Done.', 'On it.', 'Noted.', 'We're good.', 'In flow.' fit your style.\n"
            "Never be loud or enthusiastic. Be steady and soft.\n"
            "Use as few words as possible while still being helpful."
        ),
        switch_announcement="Shifting now. Calm mode. Breathe.",
    ),
    "hacker": Persona(
        key="hacker",
        emoji="💻",
        label="Hacker",
        system_prompt=(
            "JARVIS PERSONA — HACKER:\n"
            "You are a technical, terminal-style assistant. Speak in hacker/dev shorthand.\n"
            "Use CLI-style notation: '[ACK]', '>> executing...', 'status: OK', 'err: none', '[MODE=ON]'.\n"
            "Never use flowery language. Be precise, terse, and structured like terminal output.\n"
            "Keep replies short and formatted like command-line feedback."
        ),
        switch_announcement="[MODE=PREV >> HACKER] Transition complete. Ready.",
    ),
    "motivator": Persona(
        key="motivator",
        emoji="💪",
        label="Motivator",
        system_prompt=(
            "JARVIS PERSONA — MOTIVATOR:\n"
            "You are a high-energy motivational coach. Speak with maximum enthusiasm and belief.\n"
            "Use caps for emphasis occasionally. Phrases like 'YES!', 'Let's GO!', 'You got this!',\n"
            "'Nothing stopping us now!', 'LETS GOOO!' fit your style.\n"
            "Never be negative or subdued. Pump up the energy every single time.\n"
            "Make the user feel unstoppable."
        ),
        switch_announcement="LETS GO LETS GO LETS GO! MOTIVATOR IS IN THE BUILDING! 💪",
    ),
}

DEFAULT_PERSONA = "friendly"


def get_persona(key: str) -> Persona:
    """Return persona by key, falling back to default if key is unrecognised."""
    return PERSONAS.get(key, PERSONAS[DEFAULT_PERSONA])
```

- [ ] **Step 2: Verify file exists**

```bash
python -c "from app.personas import get_persona, PERSONAS; print(list(PERSONAS.keys()))"
```

Expected output: `['friendly', 'professional', 'witty', 'calm', 'hacker', 'motivator']`

- [ ] **Step 3: Commit**

```bash
git add ai-brain-orchestration/app/personas.py
git commit -m "feat: add personas.py with 6 Jarvis persona definitions"
```

---

## Task 2: Test `personas.py`

**Files:**
- Create: `ai-brain-orchestration/tests/test_personas.py`

- [ ] **Step 1: Write the test file**

```python
# ai-brain-orchestration/tests/test_personas.py

import pytest
from app.personas import get_persona, PERSONAS, DEFAULT_PERSONA


def test_all_six_personas_exist():
    expected = {"friendly", "professional", "witty", "calm", "hacker", "motivator"}
    assert set(PERSONAS.keys()) == expected


def test_each_persona_has_required_fields():
    for key, persona in PERSONAS.items():
        assert persona.key == key, f"{key}: key mismatch"
        assert persona.emoji, f"{key}: emoji is empty"
        assert persona.label, f"{key}: label is empty"
        assert len(persona.system_prompt) > 50, f"{key}: system_prompt too short"
        assert persona.switch_announcement, f"{key}: switch_announcement is empty"


def test_get_persona_returns_correct_persona():
    p = get_persona("professional")
    assert p.key == "professional"
    assert p.emoji == "🎩"


def test_get_persona_falls_back_to_default_for_unknown_key():
    p = get_persona("nonexistent_persona_xyz")
    assert p.key == DEFAULT_PERSONA


def test_switch_announcements_are_unique():
    announcements = [p.switch_announcement for p in PERSONAS.values()]
    assert len(announcements) == len(set(announcements)), "switch announcements must be unique"


def test_system_prompts_contain_persona_name():
    for key, persona in PERSONAS.items():
        assert key.upper() in persona.system_prompt.upper(), \
            f"{key}: system_prompt should mention the persona name"
```

- [ ] **Step 2: Run tests**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_personas.py -v
```

Expected: 6 tests PASS

- [ ] **Step 3: Commit**

```bash
git add ai-brain-orchestration/tests/test_personas.py
git commit -m "test: add persona definition tests"
```

---

## Task 3: Add `persona` field to ai-brain-orchestration schemas

**Files:**
- Modify: `ai-brain-orchestration/app/schemas.py`

- [ ] **Step 1: Add `persona` to `ExecuteRequest`**

In `schemas.py`, find the `ExecuteRequest` class (line 13). Add the `persona` field after `screen_ref`:

```python
# After this line:
screen_ref: str | None = Field(default=None, description="Optional screenshot context ref id.")

# Add:
persona: str = Field(default="friendly", description="Jarvis persona key (friendly/professional/witty/calm/hacker/motivator).")
```

- [ ] **Step 2: Add `persona` to remaining request models**

In `schemas.py`, update `FinalizeSummaryRequest`, `ScreenAnalyzeRequest`, `RoleSetRequest`, and `RoleWatchRequest`:

```python
class FinalizeSummaryRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    session_id: str | None = None
    db_transcript: str | None = None
    persona: str = "friendly"   # ADD THIS LINE


class ScreenAnalyzeRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    question: str = Field(default="Describe this screenshot.")
    session_id: str | None = None
    screenshot_base64: str
    mime_type: str = "image/png"
    name: str = "screenshot.png"
    persona: str = "friendly"   # ADD THIS LINE


class RoleSetRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    role_name: str = Field(..., min_length=1, max_length=60)
    role_description: str = Field(..., min_length=20, max_length=1000)
    sensitivity: str = Field(default="smart", pattern="^(major_only|smart|frequent)$")
    context: dict[str, Any] | None = None
    persona: str = "friendly"   # ADD THIS LINE


class RoleWatchRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    transcript_chunk: str
    context: dict[str, Any] | None = None
    persona: str = "friendly"   # ADD THIS LINE
```

- [ ] **Step 3: Verify import still works**

```bash
cd ai-brain-orchestration && python -c "from app.schemas import ExecuteRequest; r = ExecuteRequest(user_id='u', room_id='r', text='hi'); print(r.persona)"
```

Expected: `friendly`

- [ ] **Step 4: Commit**

```bash
git add ai-brain-orchestration/app/schemas.py
git commit -m "feat: add persona field to all AI Brain request schemas"
```

---

## Task 4: Update agents to accept `persona_prompt`

Each agent gets a `persona_prompt: str = ""` parameter. When non-empty, it's prepended to the agent's existing system prompt constant.

**Files:**
- Modify: `ai-brain-orchestration/app/agents/summary_agent.py`
- Modify: `ai-brain-orchestration/app/agents/notes_agent.py`
- Modify: `ai-brain-orchestration/app/agents/role_agent.py`
- Modify: `ai-brain-orchestration/app/agents/decision_agent.py`
- Modify: `ai-brain-orchestration/app/agents/brainstorm_agent.py`
- Modify: `ai-brain-orchestration/app/agents/action_items_agent.py`
- Modify: `ai-brain-orchestration/app/agents/screen_agent.py`
- Modify: `ai-brain-orchestration/app/agents/watcher_agent.py`

- [ ] **Step 1: Update `summary_agent.py`**

Change the `run_summary_agent` function signature and system prompt assembly:

```python
def run_summary_agent(
    llm: BaseChatModel,
    *,
    text: str,
    context: dict[str, object],
    summary_type: str,
    full_transcript: str = "",
    persona_prompt: str = "",
) -> dict[str, object]:
    system = (persona_prompt + "\n\n" + SUMMARY_SYSTEM_PROMPT).strip() if persona_prompt else SUMMARY_SYSTEM_PROMPT
    payload = json.dumps(
        {
            "task": "meeting_summary",
            "summary_type": summary_type,
            "request_text": text,
            "full_meeting_transcript": full_transcript or "(no transcript available)",
            "context": context,
        },
        ensure_ascii=False,
    )
    try:
        res = llm.invoke([SystemMessage(content=system), HumanMessage(content=payload)])
        # ... rest of function unchanged
```

- [ ] **Step 2: Update `notes_agent.py`**

Change `filter_key_points` signature:

```python
def filter_key_points(llm: BaseChatModel, raw_transcript: str, persona_prompt: str = "") -> list[dict[str, str | float]]:
    """Run LLM over the full raw transcript to extract key points grouped by section."""
    if not raw_transcript.strip():
        return []

    system = (persona_prompt + "\n\n" + FILTER_NOTES_PROMPT).strip() if persona_prompt else FILTER_NOTES_PROMPT
    payload = json.dumps({"raw_transcript": raw_transcript}, ensure_ascii=False)
    try:
        res = llm.invoke([
            SystemMessage(content=system),
            HumanMessage(content=payload),
        ])
        # ... rest of function unchanged
```

- [ ] **Step 3: Update `role_agent.py`**

Change `run_role_agent` signature:

```python
def run_role_agent(
    llm: BaseChatModel,
    *,
    text: str,
    role_name: str,
    role_description: str,
    signal_type: str = "on-demand",
    context: dict[str, object],
    persona_prompt: str = "",
) -> dict[str, object]:
    base_system = ROLE_SYSTEM_PROMPT.format(role_name=role_name, role_description=role_description)
    system = (persona_prompt + "\n\n" + base_system).strip() if persona_prompt else base_system
    payload = json.dumps(
        {
            "task": "role_play",
            "signal_type": signal_type,
            "user_text": text,
            "context": context,
        },
        ensure_ascii=False,
    )
    res = llm.invoke([SystemMessage(content=system), HumanMessage(content=payload)])
    # ... rest of function unchanged
```

- [ ] **Step 4: Update `decision_agent.py`**

```python
def run_decision_agent(
    llm: BaseChatModel,
    *,
    text: str,
    context: dict[str, object],
    persona_prompt: str = "",
) -> dict[str, object]:
    system = (persona_prompt + "\n\n" + DECISION_SYSTEM_PROMPT).strip() if persona_prompt else DECISION_SYSTEM_PROMPT
    payload = json.dumps(
        {
            "task": "help_decide",
            "question": text,
            "context": context,
        },
        ensure_ascii=False,
    )
    res = llm.invoke([SystemMessage(content=system), HumanMessage(content=payload)])
    # ... rest of function unchanged
```

- [ ] **Step 5: Update `brainstorm_agent.py`**

```python
def run_brainstorm_agent(
    llm: BaseChatModel,
    *,
    text: str,
    context: dict[str, object],
    persona_prompt: str = "",
) -> dict[str, object]:
    system = (persona_prompt + "\n\n" + BRAINSTORM_SYSTEM_PROMPT).strip() if persona_prompt else BRAINSTORM_SYSTEM_PROMPT
    payload = json.dumps(
        {
            "task": "brainstorm",
            "topic": text,
            "context": context,
        },
        ensure_ascii=False,
    )
    res = llm.invoke([SystemMessage(content=system), HumanMessage(content=payload)])
    # ... rest of function unchanged
```

- [ ] **Step 6: Update `action_items_agent.py`**

The invoke uses `bound_llm` (tool-wrapped). Replace `ACTION_ITEMS_SYSTEM_PROMPT` with `system` in the invoke call:

```python
def run_action_items_agent(
    llm: BaseChatModel,
    *,
    text: str,
    context: dict[str, object],
    persona_prompt: str = "",
) -> dict[str, object]:
    system = (persona_prompt + "\n\n" + ACTION_ITEMS_SYSTEM_PROMPT).strip() if persona_prompt else ACTION_ITEMS_SYSTEM_PROMPT
    payload = json.dumps(
        {
            "task": "extract_action_items",
            "user_text": text,
            "context": context,
        },
        ensure_ascii=False,
    )
    bound_llm = _build_tool_llm(llm)
    res = bound_llm.invoke([SystemMessage(content=system), HumanMessage(content=payload)])  # CHANGED: system replaces ACTION_ITEMS_SYSTEM_PROMPT
    raw = res.content if isinstance(res.content, str) else "{}"
    data = json.loads(raw)
    items = []
    for item in (data.get("items") or []):
        if not isinstance(item, dict):
            continue
        cleaned = {k: v for k, v in item.items()
                   if v and str(v).strip().upper() not in ("TBD", "UNKNOWN", "N/A", "")}
        if cleaned.get("title"):
            items.append(cleaned)

    _post_to_webhook(items)

    return {
        "reply": str(data.get("reply", "")).strip() or "Here are the action items I identified.",
        "items": items,
        "actions": list(data.get("actions") or []),
    }
```

- [ ] **Step 7: Update `screen_agent.py`**

`run_screen_agent` has two system prompts — one for vision, one for fallback (no image). Inject persona into both. The existing signature has `image_base64` (not `image_b64`). Replace only the two `SystemMessage(content=...)` lines inside the function:

```python
def run_screen_agent(
    llm: BaseChatModel,
    *,
    question: str,
    mime_type: str,
    name: str,
    image_base64: str | None,
    prior_context: dict[str, str],
    persona_prompt: str = "",        # ADD
) -> dict[str, object]:
    has_image = bool(image_base64 and len(image_base64.strip()) > 200)

    vision_system = (persona_prompt + "\n\n" + SCREEN_SYSTEM_PROMPT_VISION).strip() if persona_prompt else SCREEN_SYSTEM_PROMPT_VISION
    text_system = (persona_prompt + "\n\n" + SCREEN_SYSTEM_PROMPT_TEXT).strip() if persona_prompt else SCREEN_SYSTEM_PROMPT_TEXT

    if has_image:
        prior = json.dumps(prior_context or {}, ensure_ascii=False)
        text_part = (
            f"User question: {question or 'Describe this screen.'}\n"
            f"Filename hint: {name}\n"
            f"Prior context (JSON): {prior}\n"
            "Analyze the attached image and answer in JSON only."
        )
        messages = [
            SystemMessage(content=vision_system),   # CHANGED
            HumanMessage(
                content=[
                    {"type": "text", "text": text_part},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type or 'image/png'};base64,{image_base64.strip()}",
                        },
                    },
                ]
            ),
        ]
    else:
        payload = json.dumps(
            {
                "task": "screen_analysis",
                "question": question,
                "image": {"name": name, "mime_type": mime_type, "available": False},
                "prior_context": prior_context,
            },
            ensure_ascii=False,
        )
        messages = [
            SystemMessage(content=text_system),   # CHANGED
            HumanMessage(content=payload),
        ]
    # ... rest of function (try/except + return) is unchanged
```

- [ ] **Step 8: Skip `watcher_agent.py`**

`run_watcher_agent` is a binary classifier that returns `{"respond": bool, "signal": "..."}` — it never generates user-visible text. Injecting persona here would corrupt the JSON classification. Leave this file unchanged.

- [ ] **Step 9: Verify imports**

```bash
cd ai-brain-orchestration && python -c "
from app.agents.summary_agent import run_summary_agent
from app.agents.notes_agent import filter_key_points
from app.agents.role_agent import run_role_agent
from app.agents.decision_agent import run_decision_agent
from app.agents.brainstorm_agent import run_brainstorm_agent
print('all agents import OK')
"
```

Expected: `all agents import OK`

- [ ] **Step 10: Commit**

```bash
git add ai-brain-orchestration/app/agents/
git commit -m "feat: add persona_prompt parameter to all AI Brain agents"
```

---

## Task 5: Wire persona into `orchestrator.py`

**Files:**
- Modify: `ai-brain-orchestration/app/orchestrator.py`

- [ ] **Step 1: Add import for `personas`**

At the top of `orchestrator.py`, after the existing imports, add:

```python
from app.personas import get_persona
```

- [ ] **Step 2: Update `_build_system_prompt` to use persona from `req.persona`**

Replace the existing `_build_system_prompt` function (currently reads persona from `req.context`). Change the final `return` statement:

```python
def _build_system_prompt(req: ExecuteRequest) -> str:
    ctx = req.context or {}
    # Use first-class persona field; fall back to context for backward compat
    persona_key = req.persona if req.persona else str(ctx.get("persona", "friendly")).lower()
    persona = get_persona(persona_key)

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
```

- [ ] **Step 3: Add helper to get `persona_prompt` string from a request**

After `_build_system_prompt`, add:

```python
def _persona_prompt(req: ExecuteRequest) -> str:
    """Return the persona system_prompt string for injection into agent calls."""
    return get_persona(req.persona).system_prompt
```

- [ ] **Step 4: Handle `persona_switch` trigger at the top of `run_execute`**

Inside `run_execute`, right after the empty-text check and before the Groq key check, add:

```python
# Persona switch — no LLM needed, just return the canned announcement.
if (req.trigger or "").lower() == "persona_switch":
    persona = get_persona(req.persona)
    return ExecuteResponse(
        reply=persona.switch_announcement,
        intent="PERSONA_SWITCH",
        actions=[],
    )
```

- [ ] **Step 5: Pass `persona_prompt` to the `SUMMARY` agent call**

Find the existing `run_summary_agent(...)` call in `run_execute` (around line 127) and add the kwarg:

```python
out = run_summary_agent(
    _build_llm(settings.model_summary, 0.2),
    text=req.text,
    context={"memory": memory, "context": req.context or {}, "user_name": req.user_name},
    summary_type=summary_type,
    full_transcript=full_transcript,
    persona_prompt=_persona_prompt(req),   # ADD
)
```

- [ ] **Step 6: Pass `persona_prompt` to hardcoded `START_NOTES` and `STOP_NOTES` replies**

For `START_NOTES`, replace the hardcoded string with a persona-voiced reply by making the `reply` go through `_run_general` style — but simpler: just let the LLM generate the acknowledgment. Replace:

```python
# OLD (line ~146):
reply = "Started taking notes. I will keep capturing key points until you say stop."

# NEW — call a lightweight general LLM with persona injected:
ack_req_text = "Acknowledge that you've started taking notes in your persona voice. One sentence."
ack_res = _build_llm(settings.model_general, 0.5).invoke([
    SystemMessage(content=_persona_prompt(req)),
    HumanMessage(content=ack_req_text),
])
reply = (ack_res.content or "").strip() or "Notes active."
```

For `STOP_NOTES` (when no notes captured):

```python
# OLD:
reply = "Stopped notes. No key points were captured during this session."

# NEW:
ack_res = _build_llm(settings.model_general, 0.5).invoke([
    SystemMessage(content=_persona_prompt(req)),
    HumanMessage(content="Acknowledge that you've stopped taking notes, but nothing meaningful was captured. One sentence."),
])
reply = (ack_res.content or "").strip() or "Notes stopped. Nothing captured."
```

For `EXIT_ROLE`:

```python
# OLD:
reply = "I'm stepping out of my role. Back to normal Jarvis mode."

# NEW:
ack_res = _build_llm(settings.model_general, 0.5).invoke([
    SystemMessage(content=_persona_prompt(req)),
    HumanMessage(content="Acknowledge that you've exited the role-play and are back to normal. One sentence."),
])
reply = (ack_res.content or "").strip() or "Role exited. Back to normal."
```

- [ ] **Step 7: Pass `persona_prompt` to `filter_key_points` calls (STOP_NOTES, SHOW_NOTES)**

Find both calls to `filter_key_points(...)` and add the kwarg:

```python
filtered = filter_key_points(_build_llm(settings.model_notes, 0.0), raw, persona_prompt=_persona_prompt(req)) if raw else []
```

- [ ] **Step 8: Pass `persona_prompt` to role, brainstorm, decision, action_items agents**

For `PLAY_ROLE` / `DEVIL_ADVOCATE`, update the lambda:

```python
out = _with_model_fallback(
    lambda model: run_role_agent(
        _build_llm(model, 0.3),
        text=req.text,
        role_name=active_role.name,
        role_description=active_role.description,
        signal_type="entry",
        context={"memory": memory, "context": req.context or {}, "user_name": req.user_name},
        persona_prompt=_persona_prompt(req),   # ADD
    ),
    preferred_model=settings.model_reasoning,
    fallback_model=settings.model_general,
)
```

For `BRAINSTORM`:

```python
out = _with_model_fallback(
    lambda model: run_brainstorm_agent(
        _build_llm(model, 0.5),
        text=req.text,
        context={"memory": memory, "context": req.context or {}, "user_name": req.user_name},
        persona_prompt=_persona_prompt(req),   # ADD
    ),
    preferred_model=settings.model_reasoning,
    fallback_model=settings.model_general,
)
```

For `HELP_DECIDE`:

```python
out = _with_model_fallback(
    lambda model: run_decision_agent(
        _build_llm(model, 0.2),
        text=req.text,
        context={"memory": memory, "context": req.context or {}, "user_name": req.user_name},
        persona_prompt=_persona_prompt(req),   # ADD
    ),
    preferred_model=settings.model_reasoning,
    fallback_model=settings.model_general,
)
```

For `ACTION_ITEMS`:

```python
out = _with_model_fallback(
    lambda model: run_action_items_agent(
        _build_llm(model, 0.1),
        text=req.text,
        context={"memory": memory, "context": req.context or {}, "user_name": req.user_name},
        persona_prompt=_persona_prompt(req),   # ADD
    ),
    preferred_model=settings.model_reasoning,
    fallback_model=settings.model_general,
)
```

- [ ] **Step 9: Pass `persona_prompt` in `run_role_set` and `run_role_watch` handlers**

Find `run_role_set` function in `orchestrator.py` and add `persona_prompt=_persona_prompt(req)` to the `run_role_agent(...)` call inside it.

For `run_role_watch`: it calls `run_watcher_agent` (classifier, no persona) and then `run_role_agent` (user-visible, needs persona). Add `persona_prompt=get_persona(req.persona).system_prompt` only to the `run_role_agent(...)` call. Do NOT pass persona_prompt to `run_watcher_agent`.

- [ ] **Step 10: Verify orchestrator imports cleanly**

```bash
cd ai-brain-orchestration && python -c "from app.orchestrator import run_execute; print('orchestrator OK')"
```

Expected: `orchestrator OK`

- [ ] **Step 11: Run existing orchestrator tests**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_orchestrator.py -v
```

Expected: all previously-passing tests still PASS

- [ ] **Step 12: Commit**

```bash
git add ai-brain-orchestration/app/orchestrator.py
git commit -m "feat: wire persona into orchestrator — all agents now speak in persona voice"
```

---

## Task 6: Update meet-mind backend to forward `persona`

**Files:**
- Modify: `meet-mind/backend/app/main.py`

- [ ] **Step 1: Add `persona` to `AssistantExecuteRequest`**

Find `AssistantExecuteRequest` class (around line 121) and add the field:

```python
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
    persona: str = "friendly"   # ADD THIS LINE
```

- [ ] **Step 2: Add `persona` to the voice execute `payload` dict**

Find `assistant_voice_execute` function (around line 551). The payload dict is manually built. Add persona from a new Form param:

```python
@app.post("/api/assistant/voice/execute")
async def assistant_voice_execute(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    room_id: str = Form(...),
    user_name: str = Form(""),
    session_id: str | None = Form(None),
    response_style: str = Form("auto"),
    persona: str = Form("friendly"),    # ADD THIS LINE
    db: AsyncSession = Depends(get_db),
):
```

Then in the `payload` dict inside the same function, add `"persona": persona`:

```python
payload = {
    "user_id": user_id,
    "room_id": room_id,
    "user_name": user_name,
    "text": text,
    "session_id": session_id,
    "source": "voice",
    "context": {"response_style": response_style},
    "persona": persona,   # ADD THIS LINE
}
```

- [ ] **Step 3: Verify backend starts**

```bash
cd meet-mind/backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
sleep 3 && curl -s http://localhost:8000/api/health | python3 -m json.tool
```

Expected: `{"status": "ok"}` (or similar health response)

Kill the test server after: `pkill -f "uvicorn app.main"` 

- [ ] **Step 4: Commit**

```bash
git add meet-mind/backend/app/main.py
git commit -m "feat: forward persona field from meet-mind backend to AI Brain"
```

---

## Task 7: Update frontend store

**Files:**
- Modify: `meet-mind/frontend/src/store/meetingStore.ts`

- [ ] **Step 1: Expand the `persona` type and update the interface**

Find line 39:
```typescript
persona: 'corporate' | 'friendly' | 'neutral';
```

Replace with:
```typescript
persona: 'friendly' | 'professional' | 'witty' | 'calm' | 'hacker' | 'motivator';
```

- [ ] **Step 2: Update the `setPersona` type in the interface**

Find the `setPersona` declaration (around line 95):
```typescript
setPersona: (p: MeetingState['persona']) => void;
```

This will automatically pick up the new type — no change needed if it references `MeetingState['persona']`.

- [ ] **Step 3: Update the default persona and greetings in the state initializer**

Find line 142:
```typescript
persona: 'neutral',
```

Replace with:
```typescript
persona: 'friendly',
```

Find the `greetings` object (around line 154):
```typescript
const greetings: Record<MeetingState['persona'], string> = {
  corporate: 'Jarvis online. Ready to assist with note-taking, summaries, and action items.',
  friendly: "Hey! Jarvis here — your meeting co-pilot. Ask me anything or say 'Hey Jarvis' to go hands-free!",
  neutral: "I'm Jarvis, your AI meeting assistant. Type or speak to get started.",
};
```

Replace the entire `greetings` object with:
```typescript
const greetings: Record<MeetingState['persona'], string> = {
  friendly: "Hey! Jarvis here — your meeting co-pilot 🔥 Ask me anything or say 'Hey Jarvis' to go hands-free!",
  professional: 'Jarvis online. Ready to assist with note-taking, summaries, and action items. At your service.',
  witty: "Oh look, another meeting. I'm Jarvis — I'll try not to make this painful for you.",
  calm: "Jarvis here. Ready when you are.",
  hacker: "[JARVIS_INIT=OK] >> meeting assistant online. awaiting input.",
  motivator: "LETS GO! Jarvis is IN THE BUILDING! 💪 This is going to be an AMAZING meeting!",
};
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd meet-mind/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `persona`

- [ ] **Step 5: Commit**

```bash
git add meet-mind/frontend/src/store/meetingStore.ts
git commit -m "feat: expand persona type to 6 values with persona-voiced greetings"
```

---

## Task 8: Add `persona` to API client

**Files:**
- Modify: `meet-mind/frontend/src/services/api.ts`

- [ ] **Step 1: Add `persona` to `AssistantExecuteBody`**

Find `AssistantExecuteBody` interface (around line 84):

```typescript
export interface AssistantExecuteBody {
  user_id: string;
  room_id: string;
  user_name?: string;
  text: string;
  session_id?: string | null;
  context?: Record<string, unknown> | null;
  source?: "chat" | "voice";
  command?: string | null;
  trigger?: string | null;
  meeting_phase?: string | null;
  screen_ref?: string | null;
  persona?: string;   // ADD THIS LINE
}
```

- [ ] **Step 2: Add `persona` to `assistantVoiceExecute`**

Find `assistantVoiceExecute` params interface and add:

```typescript
assistantVoiceExecute(params: {
  audio: Blob;
  filename?: string;
  user_id: string;
  room_id: string;
  user_name?: string;
  session_id?: string | null;
  response_style?: "auto" | "short" | "long";
  persona?: string;   // ADD THIS LINE
}): Promise<AssistantVoiceExecuteResponse> {
```

Then inside the function where `FormData` is built, add the persona field:

```typescript
if (params.persona) form.append("persona", params.persona);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd meet-mind/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add meet-mind/frontend/src/services/api.ts
git commit -m "feat: add persona to AssistantExecuteBody and voice execute API params"
```

---

## Task 9: Wire persona in `useAssistantChat`

**Files:**
- Modify: `meet-mind/frontend/src/hooks/useAssistantChat.ts`

- [ ] **Step 1: Read persona from store in `useAssistantChat`**

Inside the `useAssistantChat` function body (around line 183), update the destructure from `useMeetingStore`:

```typescript
const { userName, persona } = useMeetingStore();
```

- [ ] **Step 2: Pass `persona` in text chat `assistantExecute` call**

Find every `api.assistantExecute({...})` call in this hook and add `persona` to the body:

```typescript
api.assistantExecute({
  user_id: assistantUserId,
  room_id: effectiveRoomId,
  user_name: userName,
  text: trimmedText,
  session_id: sessionIdRef.current,
  source: "chat",
  context: { ... },
  persona,   // ADD THIS
})
```

- [ ] **Step 3: Pass `persona` in voice execute call**

Find `api.assistantVoiceExecute({...})` call and add `persona`:

```typescript
api.assistantVoiceExecute({
  audio: audioBlob,
  user_id: assistantUserId,
  room_id: effectiveRoomId,
  user_name: userName,
  session_id: sessionIdRef.current,
  persona,   // ADD THIS
})
```

- [ ] **Step 4: Add `sendPersonaSwitchAnnouncement` function**

After the existing state destructures, add a new exported callback:

```typescript
const sendPersonaSwitchAnnouncement = useCallback(
  async (newPersona: string) => {
    try {
      const res = await api.assistantExecute({
        user_id: assistantUserId,
        room_id: effectiveRoomId,
        user_name: userName,
        text: `__persona_switch_to_${newPersona}__`,
        session_id: sessionIdRef.current,
        trigger: "persona_switch",
        source: "chat",
        persona: newPersona,
      });
      if (res.reply) {
        addAssistantMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: res.reply,
          timestamp: new Date(),
          type: "text",
        });
        playTts(res.reply);
      }
    } catch {
      // Announcement failure is non-critical; silently ignore
    }
  },
  [assistantUserId, effectiveRoomId, userName, addAssistantMessage],
);
```

Return it from the hook:

```typescript
return {
  isChatSending,
  brainStatus,
  sendMessage,
  sendPersonaSwitchAnnouncement,  // ADD
  // ... existing returns
};
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd meet-mind/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add meet-mind/frontend/src/hooks/useAssistantChat.ts
git commit -m "feat: pass persona in all assistant API calls, add sendPersonaSwitchAnnouncement"
```

---

## Task 10: Add persona picker to `MeetingHeader`

**Files:**
- Modify: `meet-mind/frontend/src/components/meeting/MeetingHeader.tsx`

- [ ] **Step 1: Write the updated `MeetingHeader.tsx`**

Replace the entire file content with:

```tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { Copy, Users, Check } from 'lucide-react';
import { useMeetingStore } from '../../store/meetingStore';

type PersonaKey = 'friendly' | 'professional' | 'witty' | 'calm' | 'hacker' | 'motivator';

const PERSONA_OPTIONS: { key: PersonaKey; emoji: string; label: string }[] = [
  { key: 'friendly',     emoji: '🔥', label: 'Friendly' },
  { key: 'professional', emoji: '🎩', label: 'Professional' },
  { key: 'witty',        emoji: '😏', label: 'Witty' },
  { key: 'calm',         emoji: '🧘', label: 'Calm' },
  { key: 'hacker',       emoji: '💻', label: 'Hacker' },
  { key: 'motivator',    emoji: '💪', label: 'Motivator' },
];

interface MeetingHeaderProps {
  onPersonaChange?: (newPersona: PersonaKey) => void;
}

export function MeetingHeader({ onPersonaChange }: MeetingHeaderProps) {
  const { roomId, meetingTitle, startTime, participants, isRecording, persona, setPersona } = useMeetingStore();
  const [elapsed, setElapsed] = useState('00:00');
  const [copied, setCopied] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!startTime) return;
    const iv = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime.getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(iv);
  }, [startTime]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!personaOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setPersonaOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [personaOpen]);

  const copyRoomId = useCallback(async () => {
    if (!roomId) return;
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomId]);

  const handlePersonaSelect = useCallback((key: PersonaKey) => {
    setPersona(key);
    setPersonaOpen(false);
    onPersonaChange?.(key);
  }, [setPersona, onPersonaChange]);

  const activePersona = PERSONA_OPTIONS.find((p) => p.key === persona) ?? PERSONA_OPTIONS[0];
  const participantCount = participants.size + 1;

  return (
    <header style={{ position: 'absolute', top: '1.5rem', left: '1.5rem', right: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 100 }}>
      {/* Logo */}
      <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 900, letterSpacing: '-1px', fontSize: '1.2rem', textTransform: 'uppercase' }}>Meet-Mind-Synthesis</div>

      {/* Centre pill */}
      <div className="room-info-pill">
        <div className="live-dot" />
        <div className="room-timer">{elapsed}</div>
        {isRecording && <>
          <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,.12)' }} />
          <span style={{ fontSize: '.7rem', letterSpacing: 2, color: '#ff4444' }}>● REC</span>
        </>}
        <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,.12)' }} />
        <span style={{ fontSize: '.72rem', letterSpacing: 2, opacity: .7, fontFamily: "'Outfit',sans-serif" }}>
          {meetingTitle || roomId?.slice(0, 8).toUpperCase()}
        </span>
      </div>

      {/* Right actions */}
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 100, padding: '.4rem 1rem', fontSize: '.72rem', opacity: .7 }}>
          <Users size={13} />
          <span>{participantCount}</span>
        </div>

        {/* Persona picker */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setPersonaOpen((v) => !v)}
            title={`Jarvis Persona: ${activePersona.label}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: personaOpen ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.05)',
              border: '1px solid rgba(255,255,255,.1)',
              borderRadius: 100,
              padding: '.4rem .75rem',
              fontSize: '1rem',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            <span role="img" aria-label={activePersona.label}>{activePersona.emoji}</span>
          </button>

          {personaOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              background: '#1a1a2e',
              border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 12,
              padding: '6px 0',
              minWidth: 180,
              boxShadow: '0 8px 32px rgba(0,0,0,.5)',
              zIndex: 200,
            }}>
              <div style={{ padding: '6px 14px 8px', fontSize: '.65rem', letterSpacing: 2, opacity: .5, textTransform: 'uppercase', fontFamily: "'Outfit',sans-serif" }}>
                Jarvis Persona
              </div>
              {PERSONA_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => handlePersonaSelect(opt.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '7px 14px',
                    background: persona === opt.key ? 'rgba(255,255,255,.08)' : 'transparent',
                    border: 'none',
                    color: 'rgba(255,255,255,.85)',
                    fontSize: '.82rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.06)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = persona === opt.key ? 'rgba(255,255,255,.08)' : 'transparent'; }}
                >
                  <span style={{ fontSize: '.7rem', opacity: persona === opt.key ? 1 : 0 }}>●</span>
                  <span role="img" aria-label={opt.label}>{opt.emoji}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={copyRoomId} title="Copy meeting ID"
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 100, padding: '.4rem 1rem', fontSize: '.72rem', color: 'rgba(255,255,255,.7)', cursor: 'pointer' }}>
          {copied ? <Check size={12} style={{ color: '#00ffcc' }} /> : <Copy size={12} />}
          <span style={{ fontFamily: 'monospace' }}>{roomId?.slice(0, 8)}…</span>
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd meet-mind/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add meet-mind/frontend/src/components/meeting/MeetingHeader.tsx
git commit -m "feat: add persona picker dropdown to MeetingHeader"
```

---

## Task 11: Wire persona switch announcement in `MeetingRoom`

The `MeetingHeader` needs to call `sendPersonaSwitchAnnouncement` when persona changes. This is passed via the `onPersonaChange` prop.

**Files:**
- Modify: `meet-mind/frontend/src/pages/MeetingRoom.tsx`

- [ ] **Step 1: Find where `MeetingHeader` is rendered in `MeetingRoom.tsx`**

```bash
grep -n "MeetingHeader\|useAssistantChat\|sendPersona" meet-mind/frontend/src/pages/MeetingRoom.tsx | head -20
```

- [ ] **Step 2: Destructure `sendPersonaSwitchAnnouncement` from the chat hook**

Find the `useAssistantChat(...)` call and add the new return value:

```typescript
const {
  isChatSending,
  brainStatus,
  sendMessage,
  sendPersonaSwitchAnnouncement,  // ADD
  // ... other existing values
} = useAssistantChat({ ... });
```

- [ ] **Step 3: Pass `onPersonaChange` to `MeetingHeader`**

Find the `<MeetingHeader />` JSX and update:

```tsx
<MeetingHeader onPersonaChange={sendPersonaSwitchAnnouncement} />
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd meet-mind/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add meet-mind/frontend/src/pages/MeetingRoom.tsx
git commit -m "feat: wire persona switch announcement from MeetingHeader through MeetingRoom"
```

---

## Task 12: End-to-end smoke test

- [ ] **Step 1: Start ai-brain-orchestration**

```bash
cd ai-brain-orchestration && uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload &
sleep 3 && curl -s http://localhost:8100/api/health
```

Expected: `{"status":"ok","service":"ai-brain-orchestration"}`

- [ ] **Step 2: Test persona_switch trigger**

```bash
curl -s -X POST http://localhost:8100/v1/execute \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test","room_id":"room1","text":"__switch__","trigger":"persona_switch","persona":"professional"}' \
  | python3 -m json.tool
```

Expected: `reply` contains `"Professional mode engaged"` and `intent` is `"PERSONA_SWITCH"`

- [ ] **Step 3: Test friendly persona on notes**

```bash
curl -s -X POST http://localhost:8100/v1/execute \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test2","room_id":"room2","text":"start taking notes","persona":"friendly"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('INTENT:', d.get('intent')); print('REPLY:', d.get('reply'))"
```

Expected: `INTENT: START_NOTES` and reply has hype/energy matching Friendly persona

- [ ] **Step 4: Test professional persona on notes**

```bash
curl -s -X POST http://localhost:8100/v1/execute \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test3","room_id":"room3","text":"start taking notes","persona":"professional"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('REPLY:', d.get('reply'))"
```

Expected: reply is formal, no slang

- [ ] **Step 5: Run full test suite**

```bash
cd ai-brain-orchestration && python -m pytest tests/ -v
```

Expected: all tests PASS

- [ ] **Step 6: Start frontend dev server and verify UI**

```bash
cd meet-mind/frontend && npm run dev &
sleep 5
echo "Open http://localhost:3000 — create a meeting, look for emoji button in header"
```

Manually verify:
- Emoji button appears in MeetingHeader right area
- Clicking it opens a dropdown with 6 personas
- Active persona has a filled dot `●`
- Selecting a persona closes the dropdown, updates the emoji, and Jarvis says the switch announcement in the AssistantPanel

- [ ] **Step 7: Kill dev servers**

```bash
pkill -f "uvicorn app.main" && pkill -f "vite"
```
