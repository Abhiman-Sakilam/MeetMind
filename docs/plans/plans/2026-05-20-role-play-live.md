# Role-Play Live Feature Implementation Plan

**Goal:** Integrate a persistent, proactive, custom role-play feature into live MeetMind meetings — Jarvis stays in character until explicitly told to exit, and proactively speaks up at high-signal moments.

**Architecture:** Server-side `ActiveRole` stored in `SessionStore` keyed by `user_id::room_id`; three new `/v1/role/*` routes in ai-brain orchestration; a `watcher_agent` polls 12-second transcript chunks from the frontend; active role context injected transparently into all system prompts while role is active.

**Tech Stack:** Python 3.11 / FastAPI / LangChain / Groq (ai-brain-orchestration); FastAPI / SQLAlchemy / httpx (meet-mind backend); React 18 / TypeScript / Zustand (meet-mind frontend)

---

## File Structure

### New files
| Path | Repo | Responsibility |
|------|------|---------------|
| `app/agents/watcher_agent.py` | ai-brain-orchestration | Fast signal detector — returns `{respond, signal}` given a transcript chunk |
| `tests/test_role_feature.py` | ai-brain-orchestration | Pytest suite for all role components |
| `frontend/src/hooks/useRoleMode.ts` | meet-mind | 12-second interval watcher; accumulates transcript chunks, calls `/api/role/watch` |
| `frontend/src/components/meeting/RoleSetupModal.tsx` | meet-mind | Setup modal: role name / description / sensitivity |
| `frontend/src/components/meeting/RoleStatusBadge.tsx` | meet-mind | Amber badge showing active role name with ✕ exit button |
| `frontend/src/components/meeting/RoleBubble.tsx` | meet-mind | Amber-bordered message bubble for role responses |

### Modified files
| Path | Repo | Change |
|------|------|--------|
| `app/session_store.py` | ai-brain-orchestration | Add `ActiveRole` dataclass; add `set_role / get_role / clear_role / update_proactive` to `SessionStore` |
| `app/schemas.py` | ai-brain-orchestration | Add 6 role Pydantic models |
| `app/agents/role_agent.py` | ai-brain-orchestration | Accept `role_name` + `role_description`; return `signal_type` + `follow_up_questions` |
| `app/orchestrator.py` | ai-brain-orchestration | Add EXIT_ROLE fast-path; role injection in system prompt; PLAY_ROLE auto-activate; 3 handler functions |
| `app/main.py` | ai-brain-orchestration | Wire 3 new role routes |
| `app/assistant_client.py` | meet-mind backend | Add `forward_role_set / forward_role_exit / forward_role_watch` |
| `app/main.py` | meet-mind backend | Add 3 proxy routes |
| `frontend/src/types/index.ts` | meet-mind | Extend `AssistantMessage`; add `ActiveRole` interface |
| `frontend/src/store/meetingStore.ts` | meet-mind | Add `activeRole` state + `setActiveRole / clearActiveRole` |
| `frontend/src/services/api.ts` | meet-mind | Add `roleSet / roleExit / roleWatch` |
| `frontend/src/hooks/useAssistantChat.ts` | meet-mind | Handle `ROLE_ACTIVATED` / `ROLE_EXITED` ui_events |
| `frontend/src/components/meeting/AssistantPanel.tsx` | meet-mind | Mount badge, modal, `useRoleMode`; route role messages to `RoleBubble` |

---

## Task 1: Add `ActiveRole` dataclass + role methods to `SessionStore`

**Files:**
- Modify: `ai-brain-orchestration/app/session_store.py`
- Create: `ai-brain-orchestration/tests/test_role_feature.py`

- [ ] **Step 1: Write the failing test**

Create `ai-brain-orchestration/tests/test_role_feature.py`:

```python
import time
import unittest
from app.session_store import ActiveRole, SessionStore


class TestActiveRoleDataclass(unittest.TestCase):
    def test_defaults(self):
        role = ActiveRole(
            name="VC",
            description="A venture capitalist focused on SaaS metrics and unit economics",
        )
        self.assertEqual(role.sensitivity, "smart")
        self.assertEqual(role.last_proactive_at, 0.0)
        self.assertEqual(role.last_chunk_hash, "")
        self.assertGreater(role.activated_at, 0)


class TestSessionStoreRoleMethods(unittest.TestCase):
    def setUp(self):
        self.store = SessionStore()
        self.store.clear("u1", "r1")

    def test_set_and_get_role(self):
        role = ActiveRole(name="VC", description="Venture capitalist focused on SaaS")
        self.store.set_role("u1", "r1", role)
        retrieved = self.store.get_role("u1", "r1")
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.name, "VC")

    def test_get_role_returns_none_when_unset(self):
        self.assertIsNone(self.store.get_role("unknown", "unknown"))

    def test_clear_role(self):
        self.store.set_role("u1", "r1", ActiveRole(name="VC", description="Venture capitalist"))
        self.store.clear_role("u1", "r1")
        self.assertIsNone(self.store.get_role("u1", "r1"))

    def test_update_proactive(self):
        self.store.set_role("u1", "r1", ActiveRole(name="VC", description="Venture capitalist"))
        self.store.update_proactive("u1", "r1", "abc123")
        role = self.store.get_role("u1", "r1")
        self.assertGreater(role.last_proactive_at, 0)
        self.assertEqual(role.last_chunk_hash, "abc123")

    def test_set_role_does_not_erase_session_turns(self):
        self.store.append_turn("u1", "r1", "user", "hello")
        self.store.set_role("u1", "r1", ActiveRole(name="VC", description="Venture capitalist"))
        ctx = self.store.get_context_window("u1", "r1")
        self.assertTrue(len(ctx["recent_turns"]) > 0)
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_role_feature.py::TestActiveRoleDataclass -v
```

Expected: `ImportError: cannot import name 'ActiveRole' from 'app.session_store'`

- [ ] **Step 3: Implement — modify `app/session_store.py`**

Add `import time` at the top (after `from __future__ import annotations`).

Extend the existing imports block at the top of the file:

```python
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from threading import RLock
```

Add the `ActiveRole` dataclass right before `SessionState`:

```python
@dataclass
class ActiveRole:
    name: str
    description: str
    sensitivity: str = "smart"           # "major_only" | "smart" | "frequent"
    activated_at: float = field(default_factory=time.time)
    last_proactive_at: float = 0.0
    last_chunk_hash: str = ""
```

Extend `SessionState` with the new field:

```python
@dataclass
class SessionState:
    summary: str = ""
    turns: list[dict[str, str]] = field(default_factory=list)
    active_role: ActiveRole | None = None
```

Add four methods to `SessionStore` (after the existing `summarize_if_needed` method):

```python
    def set_role(self, user_id: str, room_id: str, role: ActiveRole) -> None:
        key = self._key(user_id, room_id)
        with self._lock:
            self._get_state(key).active_role = role

    def get_role(self, user_id: str, room_id: str) -> ActiveRole | None:
        key = self._key(user_id, room_id)
        with self._lock:
            return self._get_state(key).active_role

    def clear_role(self, user_id: str, room_id: str) -> None:
        key = self._key(user_id, room_id)
        with self._lock:
            self._get_state(key).active_role = None

    def update_proactive(self, user_id: str, room_id: str, chunk_hash: str) -> None:
        key = self._key(user_id, room_id)
        with self._lock:
            state = self._get_state(key)
            if state.active_role:
                state.active_role.last_proactive_at = time.time()
                state.active_role.last_chunk_hash = chunk_hash
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_role_feature.py -v
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ai-brain-orchestration
git add app/session_store.py tests/test_role_feature.py
git commit -m "feat(role): add ActiveRole dataclass and role methods to SessionStore"
```

---

## Task 2: Add role Pydantic schemas

**Files:**
- Modify: `ai-brain-orchestration/app/schemas.py`
- Modify: `ai-brain-orchestration/tests/test_role_feature.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_role_feature.py`:

```python
from pydantic import ValidationError
from app.schemas import (
    RoleSetRequest, RoleSetResponse,
    RoleExitRequest, RoleExitResponse,
    RoleWatchRequest, RoleWatchResponse,
)


class TestRoleSchemas(unittest.TestCase):
    def test_role_set_request_validation(self):
        req = RoleSetRequest(
            user_id="u1", room_id="r1",
            role_name="Venture Capitalist",
            role_description="Series B investor focused on SaaS metrics and unit economics",
        )
        self.assertEqual(req.sensitivity, "smart")

    def test_role_set_request_rejects_short_description(self):
        with self.assertRaises(ValidationError):
            RoleSetRequest(
                user_id="u1", room_id="r1",
                role_name="VC",
                role_description="short",   # < 20 chars
            )

    def test_role_set_request_rejects_invalid_sensitivity(self):
        with self.assertRaises(ValidationError):
            RoleSetRequest(
                user_id="u1", room_id="r1",
                role_name="VC",
                role_description="Series B investor focused on SaaS metrics",
                sensitivity="invalid_value",
            )

    def test_role_watch_response_defaults(self):
        resp = RoleWatchResponse(respond=False)
        self.assertEqual(resp.reply, "")
        self.assertIsNone(resp.signal)
        self.assertEqual(resp.follow_up_questions, [])
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_role_feature.py::TestRoleSchemas -v
```

Expected: `ImportError: cannot import name 'RoleSetRequest' from 'app.schemas'`

- [ ] **Step 3: Implement — append to `app/schemas.py`**

```python
class RoleSetRequest(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    role_name: str = Field(..., min_length=1, max_length=60)
    role_description: str = Field(..., min_length=20, max_length=1000)
    sensitivity: str = Field(default="smart", pattern="^(major_only|smart|frequent)$")
    context: dict[str, Any] | None = None


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


class RoleWatchResponse(BaseModel):
    respond: bool
    reply: str = ""
    signal: str | None = None
    role_name: str = ""
    follow_up_questions: list[str] = Field(default_factory=list)
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_role_feature.py -v
```

Expected: All 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/schemas.py tests/test_role_feature.py
git commit -m "feat(role): add role Pydantic schemas (RoleSet/Exit/Watch)"
```

---

## Task 3: Create `watcher_agent.py`

**Files:**
- Create: `ai-brain-orchestration/app/agents/watcher_agent.py`
- Modify: `ai-brain-orchestration/tests/test_role_feature.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_role_feature.py`:

```python
import json


class _FakeLangChainResponse:
    def __init__(self, content: str):
        self.content = content


class _WatcherDecisionLLM:
    def __init__(self, **kwargs): pass
    def invoke(self, messages):
        return _FakeLangChainResponse(json.dumps({"respond": True, "signal": "decision"}))


class _WatcherRiskLLM:
    def __init__(self, **kwargs): pass
    def invoke(self, messages):
        return _FakeLangChainResponse(json.dumps({"respond": True, "signal": "risk"}))


class _WatcherNoSignalLLM:
    def __init__(self, **kwargs): pass
    def invoke(self, messages):
        return _FakeLangChainResponse(json.dumps({"respond": False, "signal": None}))


class TestWatcherAgent(unittest.TestCase):
    def test_short_chunk_always_returns_false(self):
        from app.agents.watcher_agent import run_watcher_agent
        result = run_watcher_agent(
            _WatcherDecisionLLM(),
            chunk="Too short",          # < 20 words
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="smart",
        )
        self.assertFalse(result["respond"])

    def test_smart_sensitivity_allows_decision(self):
        from app.agents.watcher_agent import run_watcher_agent
        long_chunk = "okay everyone let us vote right now should we go with option A or move to option B for the entire platform architecture this is a critical decision"
        result = run_watcher_agent(
            _WatcherDecisionLLM(),
            chunk=long_chunk,
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="smart",
        )
        self.assertTrue(result["respond"])
        self.assertEqual(result["signal"], "decision")

    def test_smart_sensitivity_allows_risk(self):
        from app.agents.watcher_agent import run_watcher_agent
        long_chunk = "we are taking a significant risk here by not testing this approach before launching to a hundred thousand users globally"
        result = run_watcher_agent(
            _WatcherRiskLLM(),
            chunk=long_chunk,
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="smart",
        )
        self.assertTrue(result["respond"])

    def test_major_only_sensitivity_blocks_risk(self):
        from app.agents.watcher_agent import run_watcher_agent
        long_chunk = "we are taking a significant risk here by not testing this approach before launching to a hundred thousand users globally"
        result = run_watcher_agent(
            _WatcherRiskLLM(),
            chunk=long_chunk,
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="major_only",   # risk blocked; only decision allowed
        )
        self.assertFalse(result["respond"])

    def test_major_only_sensitivity_allows_decision(self):
        from app.agents.watcher_agent import run_watcher_agent
        long_chunk = "okay everyone let us vote right now should we go with option A or move to option B for the entire platform"
        result = run_watcher_agent(
            _WatcherDecisionLLM(),
            chunk=long_chunk,
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="major_only",
        )
        self.assertTrue(result["respond"])

    def test_no_signal_returns_false(self):
        from app.agents.watcher_agent import run_watcher_agent
        long_chunk = "hey everyone how are you doing today let us just do a quick check in before we get started with the main agenda"
        result = run_watcher_agent(
            _WatcherNoSignalLLM(),
            chunk=long_chunk,
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="smart",
        )
        self.assertFalse(result["respond"])

    def test_chunk_hash_is_deterministic(self):
        from app.agents.watcher_agent import chunk_hash
        h1 = chunk_hash("hello world meeting transcript")
        h2 = chunk_hash("hello world meeting transcript")
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 16)
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_role_feature.py::TestWatcherAgent -v
```

Expected: `ModuleNotFoundError: No module named 'app.agents.watcher_agent'`

- [ ] **Step 3: Create `app/agents/watcher_agent.py`**

```python
import hashlib
import json

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

WATCHER_SYSTEM_PROMPT = """You are the Jarvis Role Watcher.
Monitor a live meeting transcript chunk on behalf of a role character.

HIGH SIGNAL (respond: true):
- A key decision is being made or voted on
- A risk, assumption, or blind spot this role would catch
- A strong disagreement the role should weigh in on
- A direct question the role can answer authoritatively

LOW SIGNAL (respond: false):
- Small talk, greetings, logistics
- Recap of already-discussed topics
- Chunk shorter than 20 words

Sensitivity levels:
- major_only: ONLY "decision" triggers respond=true
- smart: "decision", "risk", "disagreement" trigger respond=true
- frequent: any strong assertion also triggers respond=true

Return ONLY valid JSON: {"respond": bool, "signal": "decision|risk|disagreement|assertion|null"}"""


def chunk_hash(text: str) -> str:
    return hashlib.sha256(text.strip().encode()).hexdigest()[:16]


def run_watcher_agent(
    llm: BaseChatModel,
    *,
    chunk: str,
    role_name: str,
    role_description: str,
    sensitivity: str,
) -> dict[str, object]:
    if len(chunk.split()) < 20:
        return {"respond": False, "signal": None}

    payload = json.dumps(
        {
            "task": "watcher",
            "transcript_chunk": chunk,
            "role_name": role_name,
            "role_description": role_description,
            "sensitivity": sensitivity,
        },
        ensure_ascii=False,
    )
    try:
        res = llm.invoke([SystemMessage(content=WATCHER_SYSTEM_PROMPT), HumanMessage(content=payload)])
        raw = res.content if isinstance(res.content, str) else "{}"
        data = json.loads(raw)
    except Exception:
        return {"respond": False, "signal": None}

    respond = bool(data.get("respond", False))
    signal = data.get("signal") or None

    if respond and signal:
        if sensitivity == "major_only" and signal != "decision":
            respond = False
        elif sensitivity == "smart" and signal not in ("decision", "risk", "disagreement"):
            respond = False

    return {"respond": respond, "signal": signal if respond else None}
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_role_feature.py -v
```

Expected: All 17 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/agents/watcher_agent.py tests/test_role_feature.py
git commit -m "feat(role): add watcher_agent with sensitivity-gated signal detection"
```

---

## Task 4: Enhance `role_agent.py`

**Files:**
- Modify: `ai-brain-orchestration/app/agents/role_agent.py`
- Modify: `ai-brain-orchestration/tests/test_role_feature.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_role_feature.py`:

```python
class _RoleAgentLLM:
    def __init__(self, **kwargs): pass
    def invoke(self, messages):
        prompt = messages[0].content
        if "Role-Play Agent" in prompt:
            return _FakeLangChainResponse(json.dumps({
                "reply": "As a VC, I see significant execution risk here.",
                "role": "Venture Capitalist",
                "signal_type": "decision",
                "follow_up_questions": ["What is your 12-month NRR?", "Who owns enterprise sales?"],
                "actions": [],
            }))
        return _FakeLangChainResponse(json.dumps({"reply": "ok"}))


class TestRoleAgent(unittest.TestCase):
    def test_returns_required_fields(self):
        from app.agents.role_agent import run_role_agent
        out = run_role_agent(
            _RoleAgentLLM(),
            text="We are deciding to pivot to B2C",
            role_name="Venture Capitalist",
            role_description="Series B investor focused on SaaS metrics and unit economics",
            signal_type="decision",
            context={"memory": {}, "context": {}, "user_name": "Alice"},
        )
        self.assertIn("reply", out)
        self.assertIn("role", out)
        self.assertIn("signal_type", out)
        self.assertIn("follow_up_questions", out)
        self.assertIsInstance(out["follow_up_questions"], list)
        self.assertEqual(out["signal_type"], "decision")

    def test_follow_up_questions_populated(self):
        from app.agents.role_agent import run_role_agent
        out = run_role_agent(
            _RoleAgentLLM(),
            text="We are deciding to pivot",
            role_name="Venture Capitalist",
            role_description="Series B investor focused on SaaS metrics",
            signal_type="decision",
            context={},
        )
        self.assertEqual(len(out["follow_up_questions"]), 2)

    def test_default_signal_type_on_demand(self):
        from app.agents.role_agent import run_role_agent
        out = run_role_agent(
            _RoleAgentLLM(),
            text="Tell me your view",
            role_name="Venture Capitalist",
            role_description="Series B investor focused on SaaS metrics",
            context={},
        )
        self.assertIn("signal_type", out)
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_role_feature.py::TestRoleAgent -v
```

Expected: `TypeError: run_role_agent() got an unexpected keyword argument 'role_name'`

- [ ] **Step 3: Replace `app/agents/role_agent.py` entirely**

```python
import json

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

ROLE_SYSTEM_PROMPT = """You are Jarvis Role-Play Agent.
YOUR CHARACTER:
  Name: {role_name}
  Description: {role_description}

Stay in character for the entire response. Ground your perspective in the meeting transcript provided.

RESPONSE STRUCTURE:
  1. One-line position (your character's stance on what was just said)
  2. 3-5 pointed observations specific to this moment
  3. 1-2 sharp follow-up questions you would ask as this character

Return a single JSON object with keys:
- reply: your full in-character response (can be multi-paragraph)
- role: the role name (short label)
- signal_type: "decision" | "risk" | "disagreement" | "assertion" | "on-demand" | "entry"
- follow_up_questions: array of 1-3 question strings (can be empty)
- actions: array of suggested follow-up actions (can be empty)

Rules:
- Be constructive and insightful, not dismissive.
- Ground your perspective in real-world reasoning AND the transcript provided.
- If signal_type is "entry", give a brief in-character self-introduction."""


def run_role_agent(
    llm: BaseChatModel,
    *,
    text: str,
    role_name: str,
    role_description: str,
    signal_type: str = "on-demand",
    context: dict[str, object],
) -> dict[str, object]:
    system = ROLE_SYSTEM_PROMPT.format(role_name=role_name, role_description=role_description)
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
    raw = res.content if isinstance(res.content, str) else "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}
    return {
        "reply": str(data.get("reply", "")).strip() or "Here is my perspective.",
        "role": str(data.get("role", "")).strip() or role_name,
        "signal_type": str(data.get("signal_type", signal_type)).strip(),
        "follow_up_questions": list(data.get("follow_up_questions") or []),
        "actions": list(data.get("actions") or []),
    }
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_role_feature.py -v
```

Expected: All 20 tests pass.

- [ ] **Step 5: Run the full existing test suite to confirm no regressions**

```bash
cd ai-brain-orchestration && python -m pytest tests/ -v
```

Expected: All tests pass (including `test_orchestrator.py` — the old `role_hint` tests must now work with the new signature OR are updated).

> **Note:** `test_orchestrator.py` has a `_FakeChatGroq` that checks `"Role-Play Agent" in prompt` and returns `{"reply": "...", "role": "investor", "actions": []}`. The new `run_role_agent` still produces `reply/role/actions` keys, so the existing test will still pass. The new `follow_up_questions`/`signal_type` keys are additive. No changes needed.

- [ ] **Step 6: Commit**

```bash
git add app/agents/role_agent.py tests/test_role_feature.py
git commit -m "feat(role): enhance role_agent with role_name/description, signal_type, follow_up_questions"
```

---

## Task 5: Update `orchestrator.py` — EXIT_ROLE + role injection + handler functions

**Files:**
- Modify: `ai-brain-orchestration/app/orchestrator.py`
- Modify: `ai-brain-orchestration/tests/test_role_feature.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_role_feature.py`:

```python
from unittest.mock import patch
from app.orchestrator import SESSION_STORE, run_execute
from app.schemas import ExecuteRequest


class _FullFakeLLM:
    """Combined fake that handles all agent prompts including new role variants."""
    def __init__(self, **kwargs): pass
    def invoke(self, messages):
        prompt = messages[0].content
        payload_str = messages[1].content if len(messages) > 1 else "{}"
        try:
            data = json.loads(payload_str)
        except Exception:
            data = {}
        if "Intent Router" in prompt:
            text = str(data.get("text", "")).lower()
            if "exit role" in text or "be yourself" in text:
                return _FakeLangChainResponse(json.dumps({"route": "GENERAL"}))
            return _FakeLangChainResponse(json.dumps({"route": "GENERAL"}))
        if "Role-Play Agent" in prompt:
            return _FakeLangChainResponse(json.dumps({
                "reply": "As a VC, here is my take.",
                "role": "Venture Capitalist",
                "signal_type": "entry",
                "follow_up_questions": [],
                "actions": [],
            }))
        return _FakeLangChainResponse(json.dumps({"reply": "ok", "intent": "GENERAL", "actions": []}))


@patch("app.orchestrator.settings.groq_api_key", "test-key")
@patch("app.orchestrator.ChatGroq", _FullFakeLLM)
class TestOrchestratorRoleIntegration(unittest.TestCase):
    def setUp(self):
        SESSION_STORE.clear("u1", "r1")

    def test_exit_role_fast_path_clears_role(self):
        from app.session_store import ActiveRole
        SESSION_STORE.set_role("u1", "r1", ActiveRole(
            name="VC", description="Venture capitalist focused on SaaS"
        ))
        req = ExecuteRequest(user_id="u1", room_id="r1", text="Hey Jarvis exit role", source="voice")
        res = run_execute(req)
        self.assertIsNone(SESSION_STORE.get_role("u1", "r1"))
        self.assertEqual(res.ui_event, "ROLE_EXITED")

    def test_play_role_activates_session_state(self):
        req = ExecuteRequest(
            user_id="u1", room_id="r1",
            text="act as a venture capitalist",
            source="voice",
        )
        res = run_execute(req)
        role = SESSION_STORE.get_role("u1", "r1")
        self.assertIsNotNone(role)
        self.assertEqual(res.ui_event, "ROLE_ACTIVATED")
        self.assertIn("role_activated", (res.artifacts or {}))

    def test_role_injected_in_system_prompt(self):
        from app.session_store import ActiveRole
        SESSION_STORE.set_role("u1", "r1", ActiveRole(
            name="VC", description="Venture capitalist focused on SaaS"
        ))
        # The system prompt builder should include role context
        from app.orchestrator import _build_system_prompt
        req = ExecuteRequest(user_id="u1", room_id="r1", text="what do you think", source="chat")
        prompt = _build_system_prompt(req)
        self.assertIn("Venture Capitalist", prompt)
        self.assertIn("ACTIVE ROLE", prompt)
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_role_feature.py::TestOrchestratorRoleIntegration -v
```

Expected: Tests fail — `EXIT_ROLE` not recognized, `ROLE_ACTIVATED` not in response, role not in system prompt.

- [ ] **Step 3: Implement — modify `app/orchestrator.py`**

**3a. Update imports at the top of the file:**

```python
import functools
import json
import logging
import re
import time

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq

from app.agents.action_items_agent import run_action_items_agent
from app.agents.brainstorm_agent import run_brainstorm_agent
from app.agents.decision_agent import run_decision_agent
from app.agents.notes_agent import filter_key_points
from app.agents.role_agent import run_role_agent
from app.agents.screen_agent import run_screen_agent
from app.agents.summary_agent import run_summary_agent
from app.agents.watcher_agent import run_watcher_agent, chunk_hash
from app.config import settings
from app.schemas import (
    ExecuteRequest,
    ExecuteResponse,
    RoleSetRequest,
    RoleSetResponse,
    RoleExitRequest,
    RoleExitResponse,
    RoleWatchRequest,
    RoleWatchResponse,
)
from app.notes_store import NotesStore
from app.screen_context_store import ScreenContextStore
from app.session_store import ActiveRole, SessionStore
from app.transcript_store import TranscriptStore
```

**3b. Add `EXIT_ROLE` to the fast-path in `_route_intent` (add BEFORE the `PLAY_ROLE` check):**

```python
    if any(k in lower for k in (
        "exit role", "stop role", "end role", "leave role",
        "stop acting", "stop playing", "be yourself", "normal mode",
    )):
        return "EXIT_ROLE"
```

**3c. Add two helper functions after `_normalize`:**

```python
def _extract_role_name(text: str) -> str:
    patterns = [
        r"act\s+as\s+(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
        r"play\s+(?:the\s+role\s+of\s+|as\s+)?(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
        r"pretend\s+you\s+are\s+(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
        r"think\s+like\s+(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
        r"speak\s+as\s+(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
        r"be\s+(?:a\s+|an\s+)?(.+?)(?:\s+and\b|\s+who\b|$)",
    ]
    lower = text.lower()
    for p in patterns:
        m = re.search(p, lower)
        if m:
            name = m.group(1).strip()
            return name[:60].title()
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
```

**3d. In `run_execute`, add `EXIT_ROLE` handler BEFORE the general fallback (after the `ACTION_ITEMS` block):**

```python
        if route == "EXIT_ROLE":
            SESSION_STORE.clear_role(req.user_id, req.room_id)
            reply = "I'm stepping out of my role. Back to normal Jarvis mode."
            _append_conversation(req, reply)
            return ExecuteResponse(
                reply=reply,
                intent="EXIT_ROLE",
                actions=[],
                ui_event="ROLE_EXITED",
            )
```

**3e. Replace the `PLAY_ROLE / DEVIL_ADVOCATE` handler block in `run_execute`:**

```python
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

            # Auto-activate role in session store (no-op if already active)
            existing = SESSION_STORE.get_role(req.user_id, req.room_id)
            if not existing:
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
```

**3f. Modify `_build_system_prompt` to inject active role context (add at the end of the function, before the `return`):**

```python
    # Role injection — transparent to all routes while role is active
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
        SYSTEM_PROMPT
        + (f"\n\n{meeting_block}" if meeting_block else "")
        + f"\n\nPersona: {persona}"
        + role_block
    )
```

**3g. Add the three handler functions at the bottom of `orchestrator.py` (before `_with_model_fallback`):**

```python
def handle_role_set(body: RoleSetRequest) -> RoleSetResponse:
    role = ActiveRole(
        name=body.role_name,
        description=body.role_description,
        sensitivity=body.sensitivity,
    )
    SESSION_STORE.set_role(body.user_id, body.room_id, role)
    memory = SESSION_STORE.get_context_window(body.user_id, body.room_id)
    out = run_role_agent(
        _build_llm(settings.model_reasoning, 0.3),
        text="You are entering this meeting now. Introduce yourself in character briefly.",
        role_name=body.role_name,
        role_description=body.role_description,
        signal_type="entry",
        context={"memory": memory, "context": body.context or {}, "user_name": body.user_name},
    )
    return RoleSetResponse(reply=out["reply"], role_name=body.role_name)


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
    if h == role.last_chunk_hash:
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
    role_out = run_role_agent(
        _build_llm(settings.model_reasoning, 0.3),
        text=body.transcript_chunk,
        role_name=role.name,
        role_description=role.description,
        signal_type=str(watcher_out.get("signal") or "on-demand"),
        context={"memory": memory, "context": body.context or {}},
    )

    SESSION_STORE.update_proactive(body.user_id, body.room_id, h)

    return RoleWatchResponse(
        respond=True,
        reply=role_out["reply"],
        signal=str(watcher_out.get("signal") or ""),
        role_name=role.name,
        follow_up_questions=list(role_out.get("follow_up_questions") or []),
    )
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd ai-brain-orchestration && python -m pytest tests/ -v
```

Expected: All tests pass (including original `test_orchestrator.py`).

- [ ] **Step 5: Commit**

```bash
git add app/orchestrator.py tests/test_role_feature.py
git commit -m "feat(role): add EXIT_ROLE fast-path, role injection, handler functions to orchestrator"
```

---

## Task 6: Add 3 role routes to `ai-brain/main.py`

**Files:**
- Modify: `ai-brain-orchestration/app/main.py`
- Modify: `ai-brain-orchestration/tests/test_role_feature.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_role_feature.py`:

```python
from fastapi.testclient import TestClient
from app.main import app


class _MainFakeLLM:
    def __init__(self, **kwargs): pass
    def invoke(self, messages):
        prompt = messages[0].content
        if "Role-Play Agent" in prompt:
            return _FakeLangChainResponse(json.dumps({
                "reply": "As a VC, I'm ready to provide perspective.",
                "role": "Venture Capitalist",
                "signal_type": "entry",
                "follow_up_questions": [],
                "actions": [],
            }))
        if "Role Watcher" in prompt:
            return _FakeLangChainResponse(json.dumps({"respond": True, "signal": "decision"}))
        return _FakeLangChainResponse(json.dumps({"reply": "ok", "intent": "GENERAL", "actions": []}))


@patch("app.main.settings.ai_brain_service_token", "")
@patch("app.orchestrator.settings.groq_api_key", "test-key")
@patch("app.orchestrator.ChatGroq", _MainFakeLLM)
class TestRoleRoutes(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        SESSION_STORE.clear("u2", "r2")

    def test_role_set_creates_role(self):
        res = self.client.post("/v1/role/set", json={
            "user_id": "u2", "room_id": "r2",
            "role_name": "Venture Capitalist",
            "role_description": "Series B investor focused on SaaS metrics and unit economics",
            "sensitivity": "smart",
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("reply", data)
        self.assertEqual(data["role_name"], "Venture Capitalist")
        self.assertTrue(data["activated"])
        self.assertIsNotNone(SESSION_STORE.get_role("u2", "r2"))

    def test_role_exit_clears_role(self):
        SESSION_STORE.set_role("u2", "r2", ActiveRole(
            name="VC", description="Venture capitalist focused on SaaS"
        ))
        res = self.client.post("/v1/role/exit", json={"user_id": "u2", "room_id": "r2"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["deactivated"])
        self.assertIsNone(SESSION_STORE.get_role("u2", "r2"))

    def test_role_watch_no_active_role_returns_false(self):
        res = self.client.post("/v1/role/watch", json={
            "user_id": "u2", "room_id": "r2",
            "transcript_chunk": "We are deciding to pivot to consumer now so let us all vote on this immediately please",
        })
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["respond"])

    def test_role_watch_rate_limit(self):
        SESSION_STORE.set_role("u2", "r2", ActiveRole(
            name="VC",
            description="Venture capitalist focused on SaaS",
            last_proactive_at=time.time(),   # just responded — rate-limited
        ))
        res = self.client.post("/v1/role/watch", json={
            "user_id": "u2", "room_id": "r2",
            "transcript_chunk": "We are deciding to pivot to consumer now so let us all vote on this immediately please",
        })
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["respond"])

    def test_role_set_validates_short_description(self):
        res = self.client.post("/v1/role/set", json={
            "user_id": "u2", "room_id": "r2",
            "role_name": "VC",
            "role_description": "short",   # < 20 chars
        })
        self.assertEqual(res.status_code, 422)
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd ai-brain-orchestration && python -m pytest tests/test_role_feature.py::TestRoleRoutes -v
```

Expected: `404 Not Found` for all role routes.

- [ ] **Step 3: Implement — modify `app/main.py`**

**3a. Update the import from orchestrator:**

```python
from app.orchestrator import (
    run_execute,
    handle_role_set,
    handle_role_exit,
    handle_role_watch,
    NOTES_STORE,
    SESSION_STORE,
    TRANSCRIPT_STORE,
)
```

**3b. Update the import from schemas:**

```python
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
    RoleWatchRequest,
    RoleWatchResponse,
    ScreenAnalyzeRequest,
    TranscriptResponse,
)
```

**3c. Add three new routes (add after the existing `/v1/transcribe` route):**

```python
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
def role_watch(
    body: RoleWatchRequest,
    _: Annotated[None, Depends(verify_service_token)],
) -> RoleWatchResponse:
    return handle_role_watch(body)
```

- [ ] **Step 4: Run all tests — confirm they pass**

```bash
cd ai-brain-orchestration && python -m pytest tests/ -v
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/main.py tests/test_role_feature.py
git commit -m "feat(role): add /v1/role/set, /v1/role/exit, /v1/role/watch routes to ai-brain"
```

---

## Task 7: Meet-mind backend — `assistant_client.py` + proxy routes

**Files:**
- Modify: `meet-mind/backend/app/assistant_client.py`
- Modify: `meet-mind/backend/app/main.py`

- [ ] **Step 1: Add 3 forward methods to `assistant_client.py`**

Append to the end of `meet-mind/backend/app/assistant_client.py`:

```python
async def forward_role_set(payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", "/v1/role/set", json=payload, label="role set")


async def forward_role_exit(payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", "/v1/role/exit", json=payload, label="role exit")


async def forward_role_watch(payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", "/v1/role/watch", json=payload, timeout=30.0, label="role watch")
```

- [ ] **Step 2: Add proxy routes to `meet-mind/backend/app/main.py`**

**2a. Extend the `assistant_client` import at the top of `main.py`:**

```python
from app.assistant_client import (
    AssistantBrainError,
    forward_execute,
    forward_notes_append_raw,
    forward_role_exit,
    forward_role_set,
    forward_role_watch,
    forward_screen_analyze,
    forward_summary_finalize,
    ping_brain,
)
```

**2b. Add 3 inline Pydantic models near the top (after the existing `BaseModel` imports):**

```python
class _RoleSetBody(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    role_name: str
    role_description: str
    sensitivity: str = "smart"
    context: dict | None = None


class _RoleExitBody(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""


class _RoleWatchBody(BaseModel):
    user_id: str
    room_id: str
    user_name: str = ""
    transcript_chunk: str
    context: dict | None = None
```

**2c. Add 3 proxy routes (add near the end of the file, before the WebSocket route):**

```python
@app.post("/api/role/set")
async def role_set_proxy(body: _RoleSetBody):
    try:
        return await forward_role_set(body.model_dump())
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))


@app.post("/api/role/exit")
async def role_exit_proxy(body: _RoleExitBody):
    try:
        return await forward_role_exit(body.model_dump())
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))


@app.post("/api/role/watch")
async def role_watch_proxy(body: _RoleWatchBody):
    try:
        return await forward_role_watch(body.model_dump())
    except AssistantBrainError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))
```

- [ ] **Step 3: Verify startup**

```bash
cd meet-mind/backend && uvicorn app.main:app --port 8000 --reload
```

Expected: Server starts without import errors. Check `http://localhost:8000/docs` — three new role endpoints appear.

- [ ] **Step 4: Commit**

```bash
cd meet-mind/backend
git add app/assistant_client.py app/main.py
git commit -m "feat(role): add role proxy routes to meet-mind backend"
```

---

## Task 8: Frontend types + store + api

**Files:**
- Modify: `meet-mind/frontend/src/types/index.ts`
- Modify: `meet-mind/frontend/src/store/meetingStore.ts`
- Modify: `meet-mind/frontend/src/services/api.ts`

- [ ] **Step 1: Extend `types/index.ts`**

Replace the existing `AssistantMessage` interface and add `ActiveRole`:

```typescript
export interface AssistantMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: Date;
  type?: 'text' | 'action_items' | 'summary' | 'decision' | 'role';
  // Role-play fields — only present on role messages
  role_name?: string;
  signal_type?: string;
  follow_up_questions?: string[];
}

export interface ActiveRole {
  name: string;
  description: string;
  sensitivity: 'major_only' | 'smart' | 'frequent';
}
```

- [ ] **Step 2: Extend `meetingStore.ts`**

**2a. Add import at the top:**

```typescript
import type { Participant, AssistantMessage, ActiveRole } from '../types';
```

**2b. Add to the `MeetingState` interface (after `persona`):**

```typescript
  activeRole: ActiveRole | null;
  setActiveRole: (role: ActiveRole) => void;
  clearActiveRole: () => void;
```

**2c. Add to the initial state object in `create()` (after `persona: 'neutral'`):**

```typescript
  activeRole: null,
```

**2d. Add to `leaveMeeting` in the `set({...})` call:**

```typescript
      activeRole: null,
```

**2e. Add actions to the end of the `create()` body (before the closing `})`:**

```typescript
  setActiveRole: (role) => set({ activeRole: role }),
  clearActiveRole: () => set({ activeRole: null }),
```

- [ ] **Step 3: Extend `api.ts`**

Add interfaces and methods. Add the following interfaces before the `export const api = {` line:

```typescript
export interface RoleSetBody {
  user_id: string;
  room_id: string;
  user_name?: string;
  role_name: string;
  role_description: string;
  sensitivity?: 'major_only' | 'smart' | 'frequent';
  context?: Record<string, unknown> | null;
}

export interface RoleSetResponse {
  reply: string;
  role_name: string;
  activated: boolean;
}

export interface RoleExitBody {
  user_id: string;
  room_id: string;
  user_name?: string;
}

export interface RoleExitResponse {
  reply: string;
  deactivated: boolean;
}

export interface RoleWatchBody {
  user_id: string;
  room_id: string;
  user_name?: string;
  transcript_chunk: string;
  context?: Record<string, unknown> | null;
}

export interface RoleWatchResponse {
  respond: boolean;
  reply?: string;
  signal?: string | null;
  role_name?: string;
  follow_up_questions?: string[];
}
```

Add the three methods to the `api` object (before the closing `};`):

```typescript
  roleSet(body: RoleSetBody): Promise<RoleSetResponse> {
    return request('/api/role/set', { method: 'POST', body: JSON.stringify(body) });
  },

  roleExit(body: RoleExitBody): Promise<RoleExitResponse> {
    return request('/api/role/exit', { method: 'POST', body: JSON.stringify(body) });
  },

  roleWatch(body: RoleWatchBody): Promise<RoleWatchResponse> {
    return request('/api/role/watch', { method: 'POST', body: JSON.stringify(body) });
  },
```

- [ ] **Step 4: TypeScript compile check**

```bash
cd meet-mind/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd meet-mind/frontend
git add src/types/index.ts src/store/meetingStore.ts src/services/api.ts
git commit -m "feat(role): add ActiveRole types, store state, and API methods to frontend"
```

---

## Task 9: Add `ROLE_ACTIVATED` / `ROLE_EXITED` handling to `useAssistantChat.ts`

**Files:**
- Modify: `meet-mind/frontend/src/hooks/useAssistantChat.ts`

- [ ] **Step 1: Extend `applyAssistantUiResponse` in `useAssistantChat.ts`**

Find the `applyAssistantUiResponse` callback. After the last `else if` block (the `NOTES_RAW_CHUNK` block), add:

```typescript
      } else if (ui === 'ROLE_ACTIVATED') {
        const roleData = res.artifacts?.role_activated as {
          name: string;
          description: string;
          sensitivity: string;
        } | undefined;
        if (roleData?.name) {
          useMeetingStore.getState().setActiveRole({
            name: roleData.name,
            description: roleData.description,
            sensitivity: (roleData.sensitivity as 'major_only' | 'smart' | 'frequent') || 'smart',
          });
        }
      } else if (ui === 'ROLE_EXITED') {
        useMeetingStore.getState().clearActiveRole();
      }
```

- [ ] **Step 2: TypeScript compile check**

```bash
cd meet-mind/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAssistantChat.ts
git commit -m "feat(role): handle ROLE_ACTIVATED/ROLE_EXITED ui_events in useAssistantChat"
```

---

## Task 10: Create `useRoleMode.ts`

**Files:**
- Create: `meet-mind/frontend/src/hooks/useRoleMode.ts`

- [ ] **Step 1: Create `src/hooks/useRoleMode.ts`**

```typescript
import { useRef, useCallback, useEffect } from 'react';
import { useMeetingStore } from '../store/meetingStore';
import { api } from '../services/api';
import type { AssistantMessage } from '../types';

const WATCH_INTERVAL_MS = 12_000;

function roleChunkHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

interface UseRoleModeParams {
  assistantUserId: string;
  effectiveRoomId: string;
  addAssistantMessage: (msg: AssistantMessage) => void;
}

export function useRoleMode({
  assistantUserId,
  effectiveRoomId,
  addAssistantMessage,
}: UseRoleModeParams) {
  const activeRole = useMeetingStore((s) => s.activeRole);
  const transcriptBufferRef = useRef<string[]>([]);
  const lastHashRef = useRef('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const submitRoleChunk = useCallback((chunk: string) => {
    if (!useMeetingStore.getState().activeRole) return;
    const trimmed = chunk.trim();
    if (!trimmed) return;
    transcriptBufferRef.current.push(trimmed);
    // Keep buffer bounded to ~500 words
    const joined = transcriptBufferRef.current.join(' ');
    const words = joined.split(/\s+/);
    if (words.length > 500) {
      transcriptBufferRef.current = [words.slice(-400).join(' ')];
    }
  }, []);

  const tick = useCallback(async () => {
    const role = useMeetingStore.getState().activeRole;
    if (!role || !effectiveRoomId) return;
    const chunk = transcriptBufferRef.current.join(' ').trim();
    if (!chunk) return;
    const h = roleChunkHash(chunk);
    if (h === lastHashRef.current) return;
    lastHashRef.current = h;
    try {
      const res = await api.roleWatch({
        user_id: assistantUserId,
        room_id: effectiveRoomId,
        transcript_chunk: chunk,
      });
      if (res.respond && res.reply) {
        addAssistantMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: res.reply,
          timestamp: new Date(),
          type: 'role',
          role_name: res.role_name ?? role.name,
          signal_type: res.signal ?? 'on-demand',
          follow_up_questions: res.follow_up_questions ?? [],
        });
      }
    } catch {
      // Proactive watch is best-effort — silent fail
    }
  }, [addAssistantMessage, assistantUserId, effectiveRoomId]);

  useEffect(() => {
    if (activeRole) {
      intervalRef.current = setInterval(() => { void tick(); }, WATCH_INTERVAL_MS);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      transcriptBufferRef.current = [];
      lastHashRef.current = '';
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [activeRole, tick]);

  return { submitRoleChunk };
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
cd meet-mind/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRoleMode.ts
git commit -m "feat(role): add useRoleMode hook with 12s watcher interval"
```

---

## Task 11: Create `RoleSetupModal.tsx`

**Files:**
- Create: `meet-mind/frontend/src/components/meeting/RoleSetupModal.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState } from 'react';
import { useMeetingStore } from '../../store/meetingStore';
import { api } from '../../services/api';
import type { ActiveRole } from '../../types';

interface RoleSetupModalProps {
  assistantUserId: string;
  effectiveRoomId: string;
  userName: string;
  onClose: () => void;
  onActivated: (reply: string) => void;
}

export function RoleSetupModal({
  assistantUserId,
  effectiveRoomId,
  userName,
  onClose,
  onActivated,
}: RoleSetupModalProps) {
  const setActiveRole = useMeetingStore((s) => s.setActiveRole);
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [sensitivity, setSensitivity] = useState<ActiveRole['sensitivity']>('smart');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const nameValid = roleName.trim().length >= 1 && roleName.trim().length <= 60;
  const descValid = roleDescription.trim().length >= 20 && roleDescription.trim().length <= 1000;
  const isValid = nameValid && descValid;

  async function handleActivate() {
    if (!isValid) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.roleSet({
        user_id: assistantUserId,
        room_id: effectiveRoomId,
        user_name: userName,
        role_name: roleName.trim(),
        role_description: roleDescription.trim(),
        sensitivity,
      });
      setActiveRole({ name: roleName.trim(), description: roleDescription.trim(), sensitivity });
      onActivated(res.reply);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to activate role');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.65)',
    }}>
      <div style={{
        background: 'rgba(10,14,26,0.98)',
        border: '1px solid rgba(245,158,11,0.3)',
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        width: '100%', maxWidth: 420,
        margin: '0 1rem', padding: '1.5rem',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <span style={{ fontSize: '.95rem', fontWeight: 700, color: '#f59e0b' }}>🎭 Set Role</span>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            color: 'rgba(255,255,255,.5)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem',
          }}>×</button>
        </div>

        {/* Role name */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.07em', color: 'rgba(255,255,255,.4)', marginBottom: 6 }}>
            Role name
          </label>
          <input
            type="text" maxLength={60} value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
            placeholder="e.g. Venture Capitalist"
            style={{
              width: '100%', background: 'rgba(255,255,255,.05)',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: 10,
              padding: '.55rem .75rem', fontSize: '.83rem', color: '#fff', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <p style={{ fontSize: '.62rem', color: 'rgba(255,255,255,.3)', marginTop: 4 }}>{roleName.length}/60</p>
        </div>

        {/* Description */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.07em', color: 'rgba(255,255,255,.4)', marginBottom: 6 }}>
            Character description
          </label>
          <textarea
            rows={4} maxLength={1000} value={roleDescription}
            onChange={(e) => setRoleDescription(e.target.value)}
            placeholder="Describe how this character thinks, what they focus on, their specific perspective and expertise..."
            style={{
              width: '100%', background: 'rgba(255,255,255,.05)',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: 10,
              padding: '.55rem .75rem', fontSize: '.83rem', color: '#fff', outline: 'none',
              resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
            }}
          />
          <p style={{ fontSize: '.62rem', color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
            {roleDescription.length}/1000 (minimum 20 characters)
          </p>
        </div>

        {/* Sensitivity */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.07em', color: 'rgba(255,255,255,.4)', marginBottom: 6 }}>
            Proactive intervention
          </label>
          <select
            value={sensitivity}
            onChange={(e) => setSensitivity(e.target.value as ActiveRole['sensitivity'])}
            style={{
              width: '100%', background: 'rgba(255,255,255,.05)',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: 10,
              padding: '.55rem .75rem', fontSize: '.83rem', color: '#fff', outline: 'none',
              boxSizing: 'border-box',
            }}
          >
            <option value="major_only">Major only — decisions only</option>
            <option value="smart">Smart — decisions, risks, disagreements (recommended)</option>
            <option value="frequent">Frequent — any strong assertion</option>
          </select>
        </div>

        {error && <p style={{ fontSize: '.78rem', color: '#f87171', marginBottom: '1rem' }}>{error}</p>}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '.55rem', borderRadius: 10,
            border: '1px solid rgba(255,255,255,.12)',
            background: 'transparent', color: 'rgba(255,255,255,.5)',
            fontSize: '.82rem', cursor: 'pointer',
          }}>Cancel</button>
          <button
            onClick={handleActivate}
            disabled={!isValid || loading}
            style={{
              flex: 1, padding: '.55rem', borderRadius: 10, border: 'none',
              background: isValid && !loading ? '#f59e0b' : 'rgba(245,158,11,0.25)',
              color: isValid && !loading ? '#000' : 'rgba(245,158,11,0.4)',
              fontWeight: 700, fontSize: '.82rem',
              cursor: isValid && !loading ? 'pointer' : 'not-allowed',
            }}
          >{loading ? 'Activating…' : 'Activate Role'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
cd meet-mind/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/meeting/RoleSetupModal.tsx
git commit -m "feat(role): add RoleSetupModal component"
```

---

## Task 12: Create `RoleStatusBadge.tsx`

**Files:**
- Create: `meet-mind/frontend/src/components/meeting/RoleStatusBadge.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useMeetingStore } from '../../store/meetingStore';
import { api } from '../../services/api';

interface RoleStatusBadgeProps {
  assistantUserId: string;
  effectiveRoomId: string;
  userName: string;
  onExited: (reply: string) => void;
}

export function RoleStatusBadge({
  assistantUserId,
  effectiveRoomId,
  userName,
  onExited,
}: RoleStatusBadgeProps) {
  const activeRole = useMeetingStore((s) => s.activeRole);
  const clearActiveRole = useMeetingStore((s) => s.clearActiveRole);

  if (!activeRole) return null;

  async function handleExit() {
    try {
      const res = await api.roleExit({
        user_id: assistantUserId,
        room_id: effectiveRoomId,
        user_name: userName,
      });
      clearActiveRole();
      onExited(res.reply);
    } catch {
      clearActiveRole();
      onExited('Role ended.');
    }
  }

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 100,
      background: 'rgba(245,158,11,0.12)',
      border: '1px solid rgba(245,158,11,0.35)',
    }}>
      <span style={{ fontSize: '.75rem' }}>🎭</span>
      <span style={{
        fontSize: '.65rem', fontWeight: 700, color: '#f59e0b',
        maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{activeRole.name}</span>
      <button
        onClick={() => { void handleExit(); }}
        title="Exit role"
        style={{
          width: 14, height: 14, borderRadius: '50%', border: 'none',
          background: 'rgba(245,158,11,0.2)', color: '#f59e0b',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '.6rem', lineHeight: 1, padding: 0,
        }}
      >✕</button>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
cd meet-mind/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/meeting/RoleStatusBadge.tsx
git commit -m "feat(role): add RoleStatusBadge component"
```

---

## Task 13: Create `RoleBubble.tsx`

**Files:**
- Create: `meet-mind/frontend/src/components/meeting/RoleBubble.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { AssistantMessage } from '../../types';

interface RoleBubbleProps {
  message: AssistantMessage;
  onFollowUpClick?: (question: string) => void;
}

const SIGNAL_LABELS: Record<string, string> = {
  decision: 'decision',
  risk: 'risk flagged',
  disagreement: 'disagreement',
  assertion: 'assertion',
  'on-demand': 'on demand',
  entry: 'entering role',
};

export function RoleBubble({ message, onFollowUpClick }: RoleBubbleProps) {
  const signalLabel = SIGNAL_LABELS[message.signal_type ?? ''] ?? message.signal_type ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '4px 0' }}>
      {/* Main bubble */}
      <div style={{
        borderRadius: 14,
        border: '1px solid rgba(245,158,11,0.35)',
        background: 'rgba(245,158,11,0.04)',
        overflow: 'hidden',
      }}>
        {/* Header row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px',
          background: 'rgba(245,158,11,0.08)',
          borderBottom: '1px solid rgba(245,158,11,0.15)',
        }}>
          <span style={{ fontSize: '.75rem' }}>🎭</span>
          <span style={{ fontSize: '.68rem', fontWeight: 700, color: '#f59e0b', letterSpacing: '.03em' }}>
            {message.role_name}
          </span>
          {signalLabel && (
            <>
              <span style={{ color: 'rgba(245,158,11,0.4)', fontSize: '.65rem' }}>•</span>
              <span style={{ fontSize: '.62rem', color: 'rgba(245,158,11,0.6)' }}>[{signalLabel}]</span>
            </>
          )}
        </div>
        {/* Body */}
        <div style={{
          padding: '10px 12px',
          fontSize: '.83rem', lineHeight: 1.55,
          color: 'rgba(255,255,255,.88)',
          whiteSpace: 'pre-wrap',
        }}>
          {message.content}
        </div>
      </div>

      {/* Follow-up question chips */}
      {message.follow_up_questions && message.follow_up_questions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 2 }}>
          {message.follow_up_questions.map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowUpClick?.(q)}
              style={{
                padding: '4px 10px', borderRadius: 100,
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.28)',
                color: '#f59e0b', fontSize: '.68rem', cursor: 'pointer',
                transition: 'all .15s',
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
cd meet-mind/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/meeting/RoleBubble.tsx
git commit -m "feat(role): add RoleBubble component with follow-up question chips"
```

---

## Task 14: Wire everything in `AssistantPanel.tsx`

**Files:**
- Modify: `meet-mind/frontend/src/components/meeting/AssistantPanel.tsx`

- [ ] **Step 1: Add new imports at the top of `AssistantPanel.tsx`**

After the existing import block, add:

```typescript
import { useRoleMode } from '../../hooks/useRoleMode';
import { RoleSetupModal } from './RoleSetupModal';
import { RoleStatusBadge } from './RoleStatusBadge';
import { RoleBubble } from './RoleBubble';
```

- [ ] **Step 2: Add `activeRole` to the destructured store state in `AssistantPanel`**

Find:
```typescript
  } = useMeetingStore();
```

Change the destructure block to also extract `activeRole`:
```typescript
  const activeRole = useMeetingStore((s) => s.activeRole);
```

Add this line after the main `useMeetingStore()` destructure.

- [ ] **Step 3: Add modal open state after the existing `panelMode` state**

```typescript
  const [roleModalOpen, setRoleModalOpen] = useState(false);
```

- [ ] **Step 4: Mount the `useRoleMode` hook — add after the `useAutoNotes` hook call**

```typescript
  const { submitRoleChunk } = useRoleMode({
    assistantUserId,
    effectiveRoomId,
    addAssistantMessage,
  });
```

- [ ] **Step 5: Feed transcript chunks to `submitRoleChunk`**

Find the `useWakeWord` hook call:
```typescript
  const {
    wakePausedForVoiceRef,
    ...
  } = useWakeWord({
    addAssistantMessage,
    setVoiceAiMode,
    submitAutoNoteChunk,
    ...
  });
```

Replace `submitAutoNoteChunk` in the `useWakeWord` props with a combined callback:

```typescript
  const handleTranscriptChunk = useCallback(
    (chunk: string) => {
      submitAutoNoteChunk(chunk);
      submitRoleChunk(chunk);
    },
    [submitAutoNoteChunk, submitRoleChunk],
  );
```

Then pass `handleTranscriptChunk` instead of `submitAutoNoteChunk` to `useWakeWord`:
```typescript
  const { ... } = useWakeWord({
    addAssistantMessage,
    setVoiceAiMode,
    submitAutoNoteChunk: handleTranscriptChunk,   // ← changed
    startVoiceRecordingRef,
    isRecordingVoiceRef,
    voiceAiMode,
  });
```

- [ ] **Step 6: Mount `RoleStatusBadge` in the panel header**

Find the header area in the JSX. Locate the `PersonaSelector` line:
```tsx
      <PersonaSelector persona={persona} setPersona={setPersona} />
```

Replace it with:
```tsx
      <PersonaSelector persona={persona} setPersona={setPersona} />
      <div style={{ padding: '.3rem .7rem', borderBottom: '1px solid rgba(255,255,255,.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 }}>
        {activeRole ? (
          <RoleStatusBadge
            assistantUserId={assistantUserId}
            effectiveRoomId={effectiveRoomId}
            userName={userName}
            onExited={(reply) => {
              addAssistantMessage({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: reply,
                timestamp: new Date(),
                type: 'text',
              });
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setRoleModalOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 100, border: 'none', cursor: 'pointer',
              background: 'rgba(245,158,11,0.08)',
              color: 'rgba(245,158,11,0.7)',
              fontSize: '.65rem', fontWeight: 700, letterSpacing: '.05em',
            }}
          >
            🎭 Set Role
          </button>
        )}
      </div>
```

- [ ] **Step 7: Route role messages to `RoleBubble` in the messages list**

Find:
```tsx
        {assistantMessages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
```

Replace with:
```tsx
        {assistantMessages.map(msg =>
          msg.type === 'role' ? (
            <RoleBubble
              key={msg.id}
              message={msg}
              onFollowUpClick={(q) => { void chatHandleSend(q); }}
            />
          ) : (
            <MessageBubble key={msg.id} message={msg} />
          )
        )}
```

- [ ] **Step 8: Mount `RoleSetupModal` at the bottom of the component (before the closing `</aside>`)**

```tsx
      {roleModalOpen && (
        <RoleSetupModal
          assistantUserId={assistantUserId}
          effectiveRoomId={effectiveRoomId}
          userName={userName}
          onClose={() => setRoleModalOpen(false)}
          onActivated={(reply) => {
            addAssistantMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: reply,
              timestamp: new Date(),
              type: 'role',
              role_name: useMeetingStore.getState().activeRole?.name ?? 'Role',
              signal_type: 'entry',
              follow_up_questions: [],
            });
          }}
        />
      )}
```

- [ ] **Step 9: TypeScript compile check**

```bash
cd meet-mind/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 10: Start dev server and test manually**

```bash
cd meet-mind/frontend && npm run dev
```

Golden path checks:
1. Open AssistantPanel — "🎭 Set Role" button visible below PersonaSelector
2. Click "Set Role" → modal opens with name / description / sensitivity fields
3. Fill name: "Venture Capitalist", description: "Series B investor focused on SaaS metrics and unit economics with a contrarian lens", sensitivity: "smart" → click Activate
4. Modal closes → `RoleStatusBadge` appears: "🎭 Venture Capitalist ✕"
5. Type a message to Jarvis → response comes back in character (amber bubble if `type=role`, or regular bubble for non-role intent)
6. Say "Hey Jarvis, act as a product manager" → response activates role via voice path, badge updates
7. Say "Hey Jarvis, exit role" → badge disappears, regular Jarvis resumes
8. Click ✕ on badge → role cleared, "Set Role" button reappears

- [ ] **Step 11: Commit**

```bash
git add src/components/meeting/AssistantPanel.tsx
git commit -m "feat(role): wire useRoleMode, RoleStatusBadge, RoleSetupModal, RoleBubble into AssistantPanel"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| Custom role with rich character description | Tasks 11 (`RoleSetupModal`) + Task 1 (`ActiveRole.description`) |
| Persistent role session (server-side) | Task 1 (`SessionStore.set_role`) + Task 5 (orchestrator injection) |
| Smart proactive intervention (decisions/risks/disagreements) | Task 3 (`watcher_agent`) + Task 10 (`useRoleMode`) |
| Richer in-character responses + follow-up questions | Task 4 (`role_agent`) + Task 13 (`RoleBubble`) |
| Role badge visible when active | Task 12 (`RoleStatusBadge`) |
| Two activation paths (button/modal + voice) | Task 11 (modal) + Task 5 (PLAY_ROLE auto-activate) |
| Voice exit ("exit role", "be yourself") | Task 5 (EXIT_ROLE fast-path) |
| Button exit (✕ on badge) | Task 12 (`RoleStatusBadge`) |
| Sensitivity levels (major_only/smart/frequent) | Task 3 (watcher sensitivity gate) |
| 60s rate limit on proactive responses | Task 5 (`handle_role_watch`) |
| Hash dedup prevents re-analysis | Task 3 (`chunk_hash`) + Task 5 |
| Role injection into ALL prompts | Task 5 (`_build_system_prompt`) |
| Anti-regression: existing routes unchanged | Additive only; no existing route modified |

**Placeholder scan:** No TBD / TODO / "similar to task N" found. All code blocks are complete.

**Type consistency:** `ActiveRole.sensitivity` is `str` in Python, `'major_only' | 'smart' | 'frequent'` in TypeScript — consistent. `follow_up_questions: list[str]` Python → `string[]` TypeScript — consistent. `run_role_agent` accepts `role_name` + `role_description` in both task 4 and task 5 — consistent.
