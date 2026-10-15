# Phase 1: Meeting End Page & Live Notes Panel — Implementation Plan

**Spec:** `docs/plans/specs/2026-05-24-meeting-end-page-phase-1-design.md`

**Goal:** Rebuild the meeting end page (topics chips, unified summary, session-grouped notes, action-item checklist) and let the live notes panel grow to 50vh before scrolling.

**Architecture:** Brain gains session-aware notes + topic/keyword extraction in the existing summary agent. Backend persists `session_id`/`session_title` on notes and `topics`/`keywords` on meetings, plus a new `PATCH` route for action items. Frontend replaces `MeetingEnd.tsx` with five focused cards and bumps `LiveNotesPanel`'s max height.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy / langchain-groq (brain + backend); React 19 / TypeScript / Vite / Zustand (frontend).

**Pre-flight notes for the engineer:**

- The repo is **not** a git repo today. Treat each "Commit" step as a checkpoint — `git add` + `git commit` if you've initialized git, otherwise just save and move on. Don't initialize git unilaterally.
- Brain tests live in `ai-brain-orchestration/tests/` and use `unittest.TestCase`. Run them with `python -m unittest tests.test_<name>` from inside `ai-brain-orchestration/` after activating its `.venv`.
- Backend has no pytest tests today. New backend tests in this plan run as standalone `python -m unittest tests.test_<name>` from inside `meet-mind/backend/` after activating its `.venv`. Create the `tests/` directory in Task 9 if it doesn't exist.
- Frontend has no test framework. Use `npx tsc --noEmit` (type-check) and the manual smoke walkthrough in Task 23 as verification.
- Order of work: **all Brain tasks → all Backend tasks → all Frontend tasks**. Each layer is backwards-compatible with the previous one (the brain can ship before the backend, etc.).

---

## File Inventory

**Brain — modify:**
- `ai-brain-orchestration/app/notes_store.py` — `NoteSession` dataclass; `NotesState.sessions`; lifecycle methods
- `ai-brain-orchestration/app/redis_client.py` — round-trip new shape with legacy fallback
- `ai-brain-orchestration/app/agents/notes_agent.py` — new `generate_session_title()`
- `ai-brain-orchestration/app/agents/summary_agent.py` — return `topics`, `keywords`
- `ai-brain-orchestration/app/orchestrator.py` — STOP_NOTES uses new session API, returns `session_id`/`session_title`; SHOW_NOTES too; summary endpoints surface topics/keywords

**Brain — create:**
- `ai-brain-orchestration/tests/test_note_sessions.py`
- `ai-brain-orchestration/tests/test_session_title.py`
- `ai-brain-orchestration/tests/test_summary_topics.py`

**Backend — modify:**
- `meet-mind/backend/app/models.py` — `Note.session_id`, `Note.session_title`, `Meeting.topics`, `Meeting.keywords`
- `meet-mind/backend/app/database.py` — additive migrations
- `meet-mind/backend/app/main.py` — `_persist_ai_artifacts`; summary finalize; intelligence endpoint; new `PATCH /api/meetings/{room_name}/action_items/{id}`

**Backend — create:**
- `meet-mind/backend/tests/__init__.py`
- `meet-mind/backend/tests/test_action_items_patch.py`
- `meet-mind/backend/tests/test_intelligence_payload.py`

**Frontend — modify:**
- `meet-mind/frontend/src/components/meeting/LiveNotesPanel.tsx`
- `meet-mind/frontend/src/store/meetingStore.ts`
- `meet-mind/frontend/src/services/api.ts`
- `meet-mind/frontend/src/pages/MeetingEnd.tsx`
- `meet-mind/frontend/src/types/index.ts`

**Frontend — create:**
- `meet-mind/frontend/src/components/end/TopicsCard.tsx`
- `meet-mind/frontend/src/components/end/SummaryCard.tsx`
- `meet-mind/frontend/src/components/end/NotesCard.tsx`
- `meet-mind/frontend/src/components/end/ActionItemsCard.tsx`
- `meet-mind/frontend/src/components/end/TranscriptCard.tsx`

---

## Brain Tasks

### Task 1: Add `NoteSession` dataclass with backward-compatible `NotesState`

**Files:**
- Create: `ai-brain-orchestration/tests/test_note_sessions.py`
- Modify: `ai-brain-orchestration/app/notes_store.py`

- [ ] **Step 1: Write the failing test**

Create `ai-brain-orchestration/tests/test_note_sessions.py`:

```python
import unittest
from app.notes_store import NotesState, NoteSession


class NoteSessionShapeTests(unittest.TestCase):
    def test_state_defaults_to_no_sessions_and_inactive(self):
        state = NotesState()
        self.assertFalse(state.active)
        self.assertEqual(state.sessions, [])

    def test_notes_property_aggregates_filtered_across_sessions(self):
        state = NotesState(
            active=False,
            sessions=[
                NoteSession(id="s1", title="A", filtered_notes=[{"text": "x", "section": "", "ts": 1.0}]),
                NoteSession(id="s2", title="B", filtered_notes=[{"text": "y", "section": "", "ts": 2.0}]),
            ],
        )
        texts = [n["text"] for n in state.notes]
        self.assertEqual(texts, ["x", "y"])

    def test_notes_property_falls_back_to_raw_chunks(self):
        state = NotesState(
            active=True,
            sessions=[NoteSession(id="s1", title=None, raw_chunks=["hello", "world"])],
        )
        texts = [n["text"] for n in state.notes]
        self.assertEqual(texts, ["hello", "world"])

    def test_raw_transcript_concatenates_active_session(self):
        state = NotesState(
            active=True,
            sessions=[NoteSession(id="s1", title=None, raw_chunks=["a b", "c"])],
        )
        self.assertEqual(state.raw_transcript(), "a b c")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

```
cd ai-brain-orchestration && source .venv/bin/activate
python -m unittest tests.test_note_sessions -v
```

Expected: `ImportError: cannot import name 'NoteSession'` (it doesn't exist yet).

- [ ] **Step 3: Replace `NotesState` with the session-aware shape**

Edit `ai-brain-orchestration/app/notes_store.py`. Replace the whole `NotesState` class (lines 13-27) with:

```python
@dataclass
class NoteSession:
    id: str = ""
    title: str | None = None
    raw_chunks: list[str] = field(default_factory=list)
    filtered_notes: list[dict[str, str | float]] = field(default_factory=list)
    started_at: float = field(default_factory=time)
    stopped_at: float | None = None


@dataclass
class NotesState:
    active: bool = False
    sessions: list[NoteSession] = field(default_factory=list)
    updated_at: float = field(default_factory=time)

    @property
    def notes(self) -> list[dict[str, str | float]]:
        """Aggregate notes across all sessions for backward compatibility.

        Prefers filtered_notes when present; falls back to raw_chunks for the active session."""
        out: list[dict[str, str | float]] = []
        for s in self.sessions:
            if s.filtered_notes:
                out.extend(s.filtered_notes)
            else:
                out.extend({"text": c, "ts": s.started_at} for c in s.raw_chunks if c.strip())
        return out

    def raw_transcript(self) -> str:
        """Raw transcript of the active (last) session for filter_key_points()."""
        if not self.sessions:
            return ""
        s = self.sessions[-1]
        return " ".join(c.strip() for c in s.raw_chunks if c.strip())

    def get_active_session(self) -> "NoteSession | None":
        return self.sessions[-1] if self.sessions else None
```

- [ ] **Step 4: Run test to verify it passes**

```
python -m unittest tests.test_note_sessions -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

Stage `app/notes_store.py` and `tests/test_note_sessions.py`. Commit message: `feat(brain): introduce NoteSession + session-aware NotesState`.

---

### Task 2: Wire `NotesStore` lifecycle through sessions

**Files:**
- Modify: `ai-brain-orchestration/app/notes_store.py`
- Modify: `ai-brain-orchestration/tests/test_note_sessions.py`

- [ ] **Step 1: Add failing lifecycle test**

Append to `tests/test_note_sessions.py`:

```python
from app.notes_store import NotesStore


class NotesStoreLifecycleTests(unittest.TestCase):
    def test_start_creates_new_session_each_time(self):
        store = NotesStore()
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "first")
        store.stop("u1", "r1")
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "second")
        state = store.get("u1", "r1")
        self.assertEqual(len(state.sessions), 2)
        self.assertEqual(state.sessions[0].raw_chunks, ["first"])
        self.assertEqual(state.sessions[1].raw_chunks, ["second"])
        self.assertTrue(state.active)

    def test_append_raw_targets_last_session_only(self):
        store = NotesStore()
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "alpha")
        store.append_raw("u1", "r1", "beta")
        state = store.get("u1", "r1")
        self.assertEqual(state.sessions[-1].raw_chunks, ["alpha", "beta"])

    def test_stop_sets_stopped_at_and_inactive(self):
        store = NotesStore()
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "x")
        before = store.get("u1", "r1").sessions[-1].started_at
        store.stop("u1", "r1")
        state = store.get("u1", "r1")
        self.assertFalse(state.active)
        self.assertIsNotNone(state.sessions[-1].stopped_at)
        self.assertGreaterEqual(state.sessions[-1].stopped_at, before)

    def test_set_filtered_writes_to_last_session(self):
        store = NotesStore()
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "hi there")
        store.set_filtered("u1", "r1", [{"text": "Hi there.", "section": "Intro", "ts": 1.0}])
        state = store.get("u1", "r1")
        self.assertEqual(state.sessions[-1].filtered_notes, [{"text": "Hi there.", "section": "Intro", "ts": 1.0}])
```

- [ ] **Step 2: Run, expect failures**

```
python -m unittest tests.test_note_sessions -v
```

Expected: lifecycle tests fail (current `start()` resets `raw_chunks`; new shape doesn't have that field).

- [ ] **Step 3: Replace lifecycle methods in `NotesStore`**

In `ai-brain-orchestration/app/notes_store.py`, replace the methods `start()`, `stop()`, `append_raw()`, `append()`, `set_filtered()` (current lines 86-131) with:

```python
import uuid


# inside NotesStore class

def _new_session_id(self) -> str:
    return uuid.uuid4().hex

def start(self, user_id: str, room_id: str) -> NotesState:
    key = self._key(user_id, room_id)
    with self._lock:
        state = self._get_state(key)
        now = time()
        if state.active:
            return state
        state.sessions.append(NoteSession(
            id=self._new_session_id(),
            title=None,
            raw_chunks=[],
            filtered_notes=[],
            started_at=now,
            stopped_at=None,
        ))
        state.active = True
        state.updated_at = now
        self._redis_save(key, state)
        return state

def stop(self, user_id: str, room_id: str) -> NotesState:
    key = self._key(user_id, room_id)
    with self._lock:
        state = self._get_state(key)
        now = time()
        if state.sessions and state.sessions[-1].stopped_at is None:
            state.sessions[-1].stopped_at = now
        state.active = False
        state.updated_at = now
        self._redis_save(key, state)
        return state

def append_raw(self, user_id: str, room_id: str, text: str) -> NotesState:
    key = self._key(user_id, room_id)
    with self._lock:
        state = self._get_state(key)
        stripped = text.strip()
        if stripped:
            if not state.sessions or state.sessions[-1].stopped_at is not None:
                # No active session — start one implicitly so chunks aren't dropped
                state.sessions.append(NoteSession(
                    id=self._new_session_id(),
                    title=None,
                    raw_chunks=[],
                    filtered_notes=[],
                    started_at=time(),
                    stopped_at=None,
                ))
                state.active = True
            state.sessions[-1].raw_chunks.append(stripped)
        state.updated_at = time()
        self._redis_save(key, state)
        return state

def append(self, user_id: str, room_id: str, text: str) -> NotesState:
    return self.append_raw(user_id, room_id, text)

def set_filtered(self, user_id: str, room_id: str, notes: list[dict[str, str | float]]) -> NotesState:
    key = self._key(user_id, room_id)
    with self._lock:
        state = self._get_state(key)
        if state.sessions:
            state.sessions[-1].filtered_notes = notes
        state.updated_at = time()
        self._redis_save(key, state)
        return state

def set_session_title(self, user_id: str, room_id: str, title: str) -> NotesState:
    key = self._key(user_id, room_id)
    with self._lock:
        state = self._get_state(key)
        if state.sessions:
            state.sessions[-1].title = title
        state.updated_at = time()
        self._redis_save(key, state)
        return state
```

Also add `import uuid` to the top of the file (next to the existing imports).

- [ ] **Step 4: Run, expect pass**

```
python -m unittest tests.test_note_sessions -v
```

Expected: all 8 tests pass.

Also run the existing notes-related test to make sure nothing broke:

```
python -m unittest tests.test_feature_stores -v
```

Expected: still passes (the legacy `state.notes` property keeps it green).

- [ ] **Step 5: Commit**

`feat(brain): NotesStore lifecycle pushes/seals NoteSession instances`.

---

### Task 3: `generate_session_title()` in notes_agent

**Files:**
- Modify: `ai-brain-orchestration/app/agents/notes_agent.py`
- Create: `ai-brain-orchestration/tests/test_session_title.py`

- [ ] **Step 1: Write the failing test**

Create `ai-brain-orchestration/tests/test_session_title.py`:

```python
import unittest
from unittest.mock import MagicMock
from app.agents.notes_agent import generate_session_title


class _FakeMsg:
    def __init__(self, content: str):
        self.content = content


class GenerateSessionTitleTests(unittest.TestCase):
    def test_returns_clean_title_from_llm(self):
        llm = MagicMock()
        llm.invoke.return_value = _FakeMsg('{"title": "Q4 Marketing Strategy"}')
        notes = [{"text": "We will boost ads", "section": "Marketing", "ts": 1.0}]
        title = generate_session_title(llm, notes)
        self.assertEqual(title, "Q4 Marketing Strategy")

    def test_fallback_on_llm_error(self):
        llm = MagicMock()
        llm.invoke.side_effect = RuntimeError("boom")
        title = generate_session_title(llm, [{"text": "hello", "section": "", "ts": 1.0}])
        self.assertEqual(title, "Notes Session")

    def test_fallback_when_empty_input(self):
        llm = MagicMock()
        title = generate_session_title(llm, [])
        self.assertEqual(title, "Notes Session")
        llm.invoke.assert_not_called()

    def test_strips_quotes_and_periods(self):
        llm = MagicMock()
        llm.invoke.return_value = _FakeMsg('{"title": "\\"Pricing Discussion.\\""}')
        title = generate_session_title(llm, [{"text": "x", "section": "", "ts": 1.0}])
        self.assertEqual(title, "Pricing Discussion")
```

- [ ] **Step 2: Run, expect ImportError**

```
python -m unittest tests.test_session_title -v
```

Expected: `ImportError: cannot import name 'generate_session_title'`.

- [ ] **Step 3: Implement `generate_session_title`**

Append to `ai-brain-orchestration/app/agents/notes_agent.py`:

```python
SESSION_TITLE_PROMPT = """You are titling a single block of meeting notes.

Given a JSON array of note points, return a JSON object {"title": "..."} where
the title is a short Title Case headline of 3 to 6 words that names the topic.

Rules:
- No punctuation, no quotes, no markdown.
- Capitalize main words.
- Never return more than 6 words."""


def generate_session_title(llm: BaseChatModel, filtered_notes: list[dict[str, str | float]]) -> str:
    """Return a 3-6 word title for a notes session. Falls back to 'Notes Session' on any error."""
    if not filtered_notes:
        return "Notes Session"

    payload = json.dumps({"notes": filtered_notes}, ensure_ascii=False)
    try:
        res = llm.invoke([
            SystemMessage(content=SESSION_TITLE_PROMPT),
            HumanMessage(content=payload),
        ])
        raw = res.content if isinstance(res.content, str) else "{}"
        data = json.loads(raw)
        title = str(data.get("title", "")).strip().strip('"').strip("'").rstrip(".")
        if not title:
            return "Notes Session"
        # Hard cap at 6 words
        return " ".join(title.split()[:6])
    except Exception:
        logger.exception("generate_session_title failed; using fallback")
        return "Notes Session"
```

- [ ] **Step 4: Run, expect pass**

```
python -m unittest tests.test_session_title -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

`feat(brain): add generate_session_title agent helper`.

---

### Task 4: Orchestrator returns `session_id` + `session_title` on STOP_NOTES / SHOW_NOTES

**Files:**
- Modify: `ai-brain-orchestration/app/orchestrator.py`

- [ ] **Step 1: Find the STOP_NOTES branch**

Open `ai-brain-orchestration/app/orchestrator.py`. The block to change starts around line 172 with `if route == "STOP_NOTES":` and the SHOW_NOTES block starts around line 197. The artifacts returned are `{"notes": filtered, "raw_chunk_count": ..., "cleaned": True}`.

- [ ] **Step 2: Update imports**

In the import block near the top, change:

```python
from app.agents.notes_agent import filter_key_points
```

to:

```python
from app.agents.notes_agent import filter_key_points, generate_session_title
```

- [ ] **Step 3: Update STOP_NOTES branch**

Replace the existing STOP_NOTES block. Find:

```python
            state = NOTES_STORE.get(req.user_id, req.room_id)
            raw = state.raw_transcript()
            filtered = filter_key_points(_build_llm(settings.model_notes, 0.0), raw, _persona_prompt(req)) if raw else []
            NOTES_STORE.set_filtered(req.user_id, req.room_id, filtered)
            NOTES_STORE.stop(req.user_id, req.room_id)
            state = NOTES_STORE.get(req.user_id, req.room_id)
```

Replace with:

```python
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
```

- [ ] **Step 4: Update STOP_NOTES artifacts**

Find the response near line 194 (still inside STOP_NOTES):

```python
                artifacts={"notes": filtered, "raw_chunk_count": len(state.raw_chunks), "cleaned": True},
```

Replace with:

```python
                artifacts={
                    "notes": filtered,
                    "raw_chunk_count": sum(len(s.raw_chunks) for s in state.sessions),
                    "cleaned": True,
                    "session_id": session_id,
                    "session_title": session_title,
                },
```

- [ ] **Step 5: Update SHOW_NOTES artifacts**

Find the SHOW_NOTES response near line 217:

```python
                artifacts={"notes": filtered, "raw_chunk_count": len(state.raw_chunks)},
```

Replace with:

```python
                artifacts={
                    "notes": filtered,
                    "raw_chunk_count": sum(len(s.raw_chunks) for s in state.sessions),
                    "session_id": state.get_active_session().id if state.get_active_session() else "",
                },
```

Also find any other reference to `state.raw_chunks` inside the SHOW_NOTES block (the logger line at ~200):

```python
            logger.info("SHOW_NOTES: user=%s room=%s raw_chunks=%d raw_len=%d",
                        req.user_id, req.room_id, len(state.raw_chunks), len(raw))
```

Replace with:

```python
            logger.info("SHOW_NOTES: user=%s room=%s raw_chunks=%d raw_len=%d",
                        req.user_id, req.room_id, sum(len(s.raw_chunks) for s in state.sessions), len(raw))
```

- [ ] **Step 6: Update the APPEND_NOTE_RAW chunk_count reference**

Around line 361, find:

```python
                artifacts={"raw_chunk": req.text.strip(), "chunk_count": len(notes_state_obj.raw_chunks)},
```

Replace with:

```python
                artifacts={"raw_chunk": req.text.strip(), "chunk_count": sum(len(s.raw_chunks) for s in notes_state_obj.sessions)},
```

- [ ] **Step 7: Run all brain tests to confirm nothing regressed**

```
python -m unittest discover tests -v
```

Expected: all existing tests pass; the new note-session and session-title tests still pass.

- [ ] **Step 8: Commit**

`feat(brain): STOP_NOTES emits session_id and session_title artifacts`.

---

### Task 5: `summary_agent` returns `topics` + `keywords`

**Files:**
- Modify: `ai-brain-orchestration/app/agents/summary_agent.py`
- Create: `ai-brain-orchestration/tests/test_summary_topics.py`

- [ ] **Step 1: Write the failing test**

Create `ai-brain-orchestration/tests/test_summary_topics.py`:

```python
import json
import unittest
from unittest.mock import MagicMock
from app.agents.summary_agent import run_summary_agent


class _FakeMsg:
    def __init__(self, content: str):
        self.content = content


class SummaryTopicsTests(unittest.TestCase):
    def test_returns_topics_and_keywords_arrays(self):
        llm = MagicMock()
        llm.invoke.return_value = _FakeMsg(json.dumps({
            "reply": "## Overview\n...",
            "intent": "GET_SUMMARY",
            "actions": [],
            "topics": ["Q4 Planning", "Vision 2027"],
            "keywords": ["marketing", "pricing"],
        }))
        out = run_summary_agent(
            llm,
            text="summarize",
            context={},
            summary_type="final",
            full_transcript="lots of text",
        )
        self.assertEqual(out["topics"], ["Q4 Planning", "Vision 2027"])
        self.assertEqual(out["keywords"], ["marketing", "pricing"])

    def test_missing_keys_default_to_empty(self):
        llm = MagicMock()
        llm.invoke.return_value = _FakeMsg(json.dumps({"reply": "ok"}))
        out = run_summary_agent(llm, text="x", context={}, summary_type="manual")
        self.assertEqual(out["topics"], [])
        self.assertEqual(out["keywords"], [])

    def test_non_list_values_coerced_to_empty(self):
        llm = MagicMock()
        llm.invoke.return_value = _FakeMsg(json.dumps({"reply": "ok", "topics": "not a list", "keywords": None}))
        out = run_summary_agent(llm, text="x", context={}, summary_type="manual")
        self.assertEqual(out["topics"], [])
        self.assertEqual(out["keywords"], [])
```

- [ ] **Step 2: Run, expect failure**

```
python -m unittest tests.test_summary_topics -v
```

Expected: `KeyError: 'topics'` (current agent doesn't return that key).

- [ ] **Step 3: Update summary_agent prompt and parser**

Open `ai-brain-orchestration/app/agents/summary_agent.py`. Update `SUMMARY_SYSTEM_PROMPT` to add the new keys. Replace:

```python
Return a single JSON object with keys:
- reply: a comprehensive, well-structured meeting summary
- intent: one of GET_SUMMARY or UNKNOWN
- actions: array (empty if none)
```

With:

```python
Return a single JSON object with keys:
- reply: a comprehensive, well-structured meeting summary
- intent: one of GET_SUMMARY or UNKNOWN
- actions: array (empty if none)
- topics: array of up to 5 short topic phrases (2-4 words each, Title Case) — major discussion themes
- keywords: array of up to 12 single-word keywords (lowercase) — concrete nouns or named entities

If the meeting was too short to derive them, return empty arrays for topics and keywords.
```

Then update the return statement at the bottom. Replace:

```python
        return {
            "reply": str(data.get("reply", "")).strip() or "Here is the latest summary.",
            "intent": data.get("intent") or "GET_SUMMARY",
            "actions": list(data.get("actions") or []),
        }
```

With:

```python
        raw_topics = data.get("topics")
        raw_keywords = data.get("keywords")
        topics = [str(t).strip() for t in raw_topics if str(t).strip()][:5] if isinstance(raw_topics, list) else []
        keywords = [str(k).strip().lower() for k in raw_keywords if str(k).strip()][:12] if isinstance(raw_keywords, list) else []
        return {
            "reply": str(data.get("reply", "")).strip() or "Here is the latest summary.",
            "intent": data.get("intent") or "GET_SUMMARY",
            "actions": list(data.get("actions") or []),
            "topics": topics,
            "keywords": keywords,
        }
```

Also update the `except` branch to include the same empty keys:

```python
    except Exception as e:
        return {
            "reply": f"I had trouble formatting the summary. Raw: {str(e)[:200]}",
            "intent": "GET_SUMMARY",
            "actions": [],
            "topics": [],
            "keywords": [],
        }
```

- [ ] **Step 4: Run, expect pass**

```
python -m unittest tests.test_summary_topics -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Surface topics/keywords from the orchestrator**

The summary agent's output gets wrapped into an `ExecuteResponse` somewhere in orchestrator. Find where `run_summary_agent`'s return is consumed in `orchestrator.py` (search for `run_summary_agent`). Wherever the response builds `artifacts`, propagate `topics` and `keywords`. Specifically: search for blocks that call `run_summary_agent(...)` and set `actions` from its `actions` key — in the same dict, add:

```python
                artifacts={
                    # ...existing keys
                    "topics": result.get("topics", []),
                    "keywords": result.get("keywords", []),
                },
```

Do this for every call site of `run_summary_agent` in `orchestrator.py` (there are usually two: SUMMARY_NOW/SUMMARY_PERIODIC, and SUMMARY_FINAL via finalize). If `artifacts` doesn't already exist in that branch, add it next to `actions=`.

- [ ] **Step 6: Run all brain tests**

```
python -m unittest discover tests -v
```

Expected: all green.

- [ ] **Step 7: Commit**

`feat(brain): summary agent emits topics and keywords arrays`.

---

### Task 6: Redis serialization for new shape with legacy fallback

**Files:**
- Modify: `ai-brain-orchestration/app/notes_store.py`

- [ ] **Step 1: Add a serialization test**

Append to `ai-brain-orchestration/tests/test_note_sessions.py`:

```python
import json
from app.notes_store import NotesStore


class RedisSerializationTests(unittest.TestCase):
    def test_serialize_round_trip(self):
        store = NotesStore()
        # serialize a state by reaching into the internal helpers via public API
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "hello")
        store.set_filtered("u1", "r1", [{"text": "Hello.", "section": "", "ts": 1.0}])
        store.set_session_title("u1", "r1", "Greeting")
        store.stop("u1", "r1")
        state = store.get("u1", "r1")

        # Use the same shape that _redis_save writes
        from app.notes_store import _state_to_dict, _state_from_dict
        encoded = _state_to_dict(state)
        decoded = _state_from_dict(json.loads(json.dumps(encoded)))
        self.assertEqual(decoded.active, state.active)
        self.assertEqual(len(decoded.sessions), 1)
        self.assertEqual(decoded.sessions[0].title, "Greeting")
        self.assertEqual(decoded.sessions[0].raw_chunks, ["hello"])
        self.assertEqual(decoded.sessions[0].filtered_notes, [{"text": "Hello.", "section": "", "ts": 1.0}])

    def test_legacy_payload_migrates_into_single_session(self):
        from app.notes_store import _state_from_dict
        legacy = {
            "active": False,
            "raw_chunks": ["a", "b"],
            "filtered_notes": [{"text": "A.", "section": "", "ts": 1.0}],
            "updated_at": 123.4,
        }
        decoded = _state_from_dict(legacy)
        self.assertEqual(len(decoded.sessions), 1)
        self.assertEqual(decoded.sessions[0].id, "legacy")
        self.assertEqual(decoded.sessions[0].raw_chunks, ["a", "b"])
        self.assertEqual(decoded.sessions[0].filtered_notes, [{"text": "A.", "section": "", "ts": 1.0}])
```

- [ ] **Step 2: Run, expect failure**

```
python -m unittest tests.test_note_sessions -v
```

Expected: `ImportError: cannot import name '_state_to_dict'`.

- [ ] **Step 3: Implement module-level (de)serialization helpers**

In `ai-brain-orchestration/app/notes_store.py`, add two module-level helpers near the top of the file (below the imports and constants, above the dataclasses):

```python
def _state_to_dict(state: "NotesState") -> dict:
    return {
        "version": 2,
        "active": state.active,
        "updated_at": state.updated_at,
        "sessions": [
            {
                "id": s.id,
                "title": s.title,
                "raw_chunks": list(s.raw_chunks),
                "filtered_notes": list(s.filtered_notes),
                "started_at": s.started_at,
                "stopped_at": s.stopped_at,
            }
            for s in state.sessions
        ],
    }


def _state_from_dict(data: dict) -> "NotesState":
    # Legacy (v1) payload: had top-level raw_chunks / filtered_notes
    if "sessions" not in data and ("raw_chunks" in data or "filtered_notes" in data):
        return NotesState(
            active=bool(data.get("active", False)),
            sessions=[NoteSession(
                id="legacy",
                title=None,
                raw_chunks=list(data.get("raw_chunks", [])),
                filtered_notes=list(data.get("filtered_notes", [])),
                started_at=float(data.get("updated_at", time())),
                stopped_at=float(data.get("updated_at", time())) if not data.get("active") else None,
            )],
            updated_at=float(data.get("updated_at", time())),
        )

    sessions = []
    for s in data.get("sessions", []) or []:
        try:
            sessions.append(NoteSession(
                id=str(s.get("id", "")),
                title=s.get("title"),
                raw_chunks=list(s.get("raw_chunks", [])),
                filtered_notes=list(s.get("filtered_notes", [])),
                started_at=float(s.get("started_at", time())),
                stopped_at=(float(s["stopped_at"]) if s.get("stopped_at") is not None else None),
            ))
        except Exception:
            _logger.debug("Skipping malformed session entry: %r", s)
    return NotesState(
        active=bool(data.get("active", False)),
        sessions=sessions,
        updated_at=float(data.get("updated_at", time())),
    )
```

- [ ] **Step 4: Update `_redis_save` and `_redis_load` to use them**

Replace the current `_redis_save` body with:

```python
def _redis_save(self, key: str, state: NotesState) -> None:
    from app.redis_client import get_redis
    r = get_redis()
    if r is None:
        return
    try:
        r.set(key, json.dumps(_state_to_dict(state)), ex=_REDIS_TTL)
    except Exception as exc:
        _logger.debug("Redis notes save failed: %s", exc)
```

Replace `_redis_load`:

```python
def _redis_load(self, key: str) -> NotesState | None:
    from app.redis_client import get_redis
    r = get_redis()
    if r is None:
        return None
    try:
        raw = r.get(key)
        if raw:
            return _state_from_dict(json.loads(raw))
    except Exception as exc:
        _logger.debug("Redis notes load failed: %s", exc)
    return None
```

- [ ] **Step 5: Run, expect pass**

```
python -m unittest tests.test_note_sessions -v
```

Expected: all tests pass (incl. round-trip and legacy migration).

- [ ] **Step 6: Commit**

`feat(brain): redis round-trip + legacy migration for session-aware NotesState`.

---

## Backend Tasks

### Task 7: Add `session_id`/`session_title` columns to `notes`, `topics`/`keywords` to `meetings`

**Files:**
- Modify: `meet-mind/backend/app/models.py`
- Modify: `meet-mind/backend/app/database.py`

- [ ] **Step 1: Add SQLAlchemy columns to `Note` and `Meeting`**

Open `meet-mind/backend/app/models.py`. Find the `Note` class (line 89). Add two new columns just below `speaker_name`:

```python
class Note(Base):
    __tablename__ = "notes"

    id = Column(String, primary_key=True, default=_uuid)
    meeting_id = Column(String, ForeignKey("meetings.id"), nullable=False)
    content = Column(Text, nullable=False)
    type = Column(String(50), default="key_point")
    speaker_name = Column(String, nullable=True)
    session_id = Column(String(64), nullable=True)
    session_title = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    meeting = relationship("Meeting", back_populates="notes")
```

Find the `Meeting` class (line 28). Add two columns just below `status`:

```python
class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(String, primary_key=True, default=_uuid)
    room_name = Column(String, unique=True, index=True)
    title = Column(String, default="Untitled Meeting")
    created_at = Column(DateTime(timezone=True), default=_now)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    topic = Column(String, nullable=True)
    status = Column(String, default="active")
    topics = Column(JSON, nullable=True)
    keywords = Column(JSON, nullable=True)

    participants = relationship(...)
    # ...rest unchanged
```

- [ ] **Step 2: Add additive migrations**

Open `meet-mind/backend/app/database.py`. Find the `_MIGRATIONS` list (line 17). Append these four entries to the list (after the meetings/topic line for grouping):

```python
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS topics JSONB",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS keywords JSONB",
    "ALTER TABLE notes ADD COLUMN IF NOT EXISTS session_id VARCHAR(64)",
    "ALTER TABLE notes ADD COLUMN IF NOT EXISTS session_title VARCHAR(200)",
```

- [ ] **Step 3: Run the backend once to apply migrations**

```
cd meet-mind/backend && source .venv/bin/activate
python -c "import asyncio; from app.database import init_db; asyncio.run(init_db())"
```

Expected: completes with no exception. Run it again — should be a no-op (the IF NOT EXISTS clauses ensure idempotence).

- [ ] **Step 4: Verify columns exist**

```
python -c "import asyncio; from app.database import engine; from sqlalchemy import text; async def show(): import asyncio
async def run():
    async with engine.connect() as c:
        for tbl, col in [('notes','session_id'), ('notes','session_title'), ('meetings','topics'), ('meetings','keywords')]:
            r = await c.execute(text(f\"select column_name from information_schema.columns where table_name='{tbl}' and column_name='{col}'\"))
            print(tbl, col, r.scalar())
asyncio.run(run())"
```

Easier alternative — open a psql shell and run `\d notes` / `\d meetings`. Expected: the four new columns are present.

- [ ] **Step 5: Commit**

`feat(backend): add session_id/session_title on notes and topics/keywords on meetings`.

---

### Task 8: `_persist_ai_artifacts` writes `session_id`/`session_title` on notes

**Files:**
- Modify: `meet-mind/backend/app/main.py`

- [ ] **Step 1: Update the STOP_NOTES/SHOW_NOTES persistence branch**

Open `meet-mind/backend/app/main.py`. Find the block in `_persist_ai_artifacts` (line 706-722):

```python
        if intent in ("STOP_NOTES", "SHOW_NOTES"):
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
                    ))
```

Replace with:

```python
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
```

- [ ] **Step 2: Smoke check**

Restart the backend (`uvicorn app.main:app --reload`). Trigger a STOP_NOTES flow end-to-end with a real or scripted brain call. Then query the DB:

```
psql $DATABASE_URL -c "SELECT id, session_id, session_title FROM notes ORDER BY created_at DESC LIMIT 5;"
```

Expected: latest rows include a populated `session_id` and `session_title`.

- [ ] **Step 3: Commit**

`feat(backend): persist session_id/session_title from STOP_NOTES artifacts`.

---

### Task 9: `summary/finalize` writes `topics`/`keywords` on the Meeting

**Files:**
- Modify: `meet-mind/backend/app/main.py`

- [ ] **Step 1: Find the summary finalize handler**

Open `meet-mind/backend/app/main.py`. Search for `@app.post("/api/assistant/summary/finalize")` (line 612). The handler calls `forward_summary_finalize(...)`, gets `out`, then calls `_persist_ai_artifacts(...)`.

- [ ] **Step 2: After the persist call, update the meeting row**

Locate the existing line `await _persist_ai_artifacts(db, meeting.id, "final meeting summary", out)` (around line 632). Immediately after it, add:

```python
            topics = out.get("artifacts", {}).get("topics") if isinstance(out.get("artifacts"), dict) else out.get("topics")
            keywords = out.get("artifacts", {}).get("keywords") if isinstance(out.get("artifacts"), dict) else out.get("keywords")
            if isinstance(topics, list) or isinstance(keywords, list):
                meeting.topics = topics if isinstance(topics, list) else meeting.topics
                meeting.keywords = keywords if isinstance(keywords, list) else meeting.keywords
                await db.commit()
```

- [ ] **Step 3: Smoke check**

Trigger a finalize end-to-end. Then:

```
psql $DATABASE_URL -c "SELECT topics, keywords FROM meetings ORDER BY created_at DESC LIMIT 1;"
```

Expected: arrays populated.

- [ ] **Step 4: Commit**

`feat(backend): summary/finalize persists topics + keywords on the Meeting`.

---

### Task 10: New endpoint — `PATCH /api/meetings/{room_name}/action_items/{id}`

**Files:**
- Modify: `meet-mind/backend/app/main.py`
- Create: `meet-mind/backend/tests/__init__.py` (empty)
- Create: `meet-mind/backend/tests/test_action_items_patch.py`

- [ ] **Step 1: Create the test file with a failing test**

Create `meet-mind/backend/tests/__init__.py` as an empty file.

Create `meet-mind/backend/tests/test_action_items_patch.py`:

```python
import asyncio
import unittest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import init_db, engine
from app.models import Meeting, ActionItem
from app.database import async_session


class ActionItemsPatchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await init_db()
        # Seed a meeting and an action item
        async with async_session() as db:
            self.meeting = Meeting(room_name="patch-test-room", title="Test")
            db.add(self.meeting)
            await db.flush()
            self.item = ActionItem(meeting_id=self.meeting.id, title="Send Q4 deck", status="pending")
            db.add(self.item)
            await db.commit()
            await db.refresh(self.item)
            self.item_id = self.item.id

    async def test_happy_path_completes_item(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.patch(
                f"/api/meetings/patch-test-room/action_items/{self.item_id}",
                json={"status": "completed"},
            )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "completed")

    async def test_bad_status_returns_400(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.patch(
                f"/api/meetings/patch-test-room/action_items/{self.item_id}",
                json={"status": "weird"},
            )
        self.assertEqual(r.status_code, 400)

    async def test_wrong_meeting_returns_404(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.patch(
                f"/api/meetings/does-not-exist/action_items/{self.item_id}",
                json={"status": "completed"},
            )
        self.assertEqual(r.status_code, 404)

    async def test_wrong_item_returns_404(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.patch(
                "/api/meetings/patch-test-room/action_items/does-not-exist",
                json={"status": "completed"},
            )
        self.assertEqual(r.status_code, 404)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run, expect failure**

```
cd meet-mind/backend && source .venv/bin/activate
python -m unittest tests.test_action_items_patch -v
```

Expected: 404 for the happy path (endpoint doesn't exist yet).

- [ ] **Step 3: Implement the endpoint**

Open `meet-mind/backend/app/main.py`. Just below the intelligence endpoint (`get_meeting_intelligence`, ending near line 828), add:

```python
@app.patch("/api/meetings/{room_name}/action_items/{action_item_id}")
async def update_action_item_status(
    room_name: str,
    action_item_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update the completion status of a single action item."""
    status = (body or {}).get("status")
    if status not in ("pending", "completed"):
        raise HTTPException(status_code=400, detail="status must be 'pending' or 'completed'")

    meeting_q = await db.execute(select(Meeting).where(Meeting.room_name == room_name))
    meeting = meeting_q.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

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
```

- [ ] **Step 4: Run, expect pass**

```
python -m unittest tests.test_action_items_patch -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

`feat(backend): PATCH /api/meetings/{room}/action_items/{id} updates status`.

---

### Task 11: Intelligence endpoint returns `topics`, `keywords`, and session info on notes

**Files:**
- Modify: `meet-mind/backend/app/main.py`
- Create: `meet-mind/backend/tests/test_intelligence_payload.py`

- [ ] **Step 1: Write the failing test**

Create `meet-mind/backend/tests/test_intelligence_payload.py`:

```python
import unittest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import init_db, async_session
from app.models import Meeting, Note


class IntelligencePayloadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await init_db()
        async with async_session() as db:
            self.meeting = Meeting(
                room_name="intel-test-room",
                title="Test",
                topics=["Q4 Planning", "Vision 2027"],
                keywords=["marketing", "pricing"],
            )
            db.add(self.meeting)
            await db.flush()
            db.add(Note(meeting_id=self.meeting.id, content="Point A", type="key_point:Marketing",
                        session_id="s1", session_title="Q4 Marketing Strategy"))
            db.add(Note(meeting_id=self.meeting.id, content="Point B", type="key_point:Marketing",
                        session_id="s1", session_title="Q4 Marketing Strategy"))
            db.add(Note(meeting_id=self.meeting.id, content="Old point", type="key_point"))  # no session
            await db.commit()

    async def test_response_includes_topics_keywords_and_session_fields_on_notes(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/meetings/intel-test-room/intelligence")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["topics"], ["Q4 Planning", "Vision 2027"])
        self.assertEqual(body["keywords"], ["marketing", "pricing"])

        notes = body["notes"]
        with_session = [n for n in notes if n.get("session_id")]
        self.assertEqual(len(with_session), 2)
        self.assertEqual(with_session[0]["session_id"], "s1")
        self.assertEqual(with_session[0]["session_title"], "Q4 Marketing Strategy")
        # legacy note has null session_id
        legacy = [n for n in notes if not n.get("session_id")]
        self.assertEqual(len(legacy), 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run, expect failure**

```
python -m unittest tests.test_intelligence_payload -v
```

Expected: `KeyError: 'topics'` or assertion error (current response has no topics/session_id fields).

- [ ] **Step 3: Extend the intelligence handler**

Open `meet-mind/backend/app/main.py`. Find `get_meeting_intelligence` (line 749). Replace the entire `return { ... }` block (lines 775-828) with:

```python
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
```

- [ ] **Step 4: Run, expect pass**

```
python -m unittest tests.test_intelligence_payload -v
```

Expected: 1 test passes. Then run both backend test files together:

```
python -m unittest discover tests -v
```

Expected: all green.

- [ ] **Step 5: Commit**

`feat(backend): intelligence payload exposes topics/keywords + session fields`.

---

## Frontend Tasks

### Task 12: `LiveNotesPanel` grows to 50vh with smooth transition

**Files:**
- Modify: `meet-mind/frontend/src/components/meeting/LiveNotesPanel.tsx`

- [ ] **Step 1: Locate the scroll container**

Open `LiveNotesPanel.tsx`. Find the only element whose `className` contains `max-h-56 overflow-y-auto overscroll-contain` (~ line 66).

- [ ] **Step 2: Change the class list**

Replace `max-h-56` with `max-h-[50vh]` and add `transition-[max-height] duration-200`. Concretely, replace:

```tsx
max-h-56 overflow-y-auto overscroll-contain
```

with:

```tsx
max-h-[50vh] overflow-y-auto overscroll-contain transition-[max-height] duration-200
```

- [ ] **Step 3: Type-check**

```
cd meet-mind/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Visual sanity check**

Run `npm run dev`, join a meeting, turn on notes, talk for a while. Confirm the panel expands as items arrive, caps at half the screen, and the latest item is visible without manual scrolling.

- [ ] **Step 5: Commit**

`feat(frontend): LiveNotesPanel grows to 50vh before scrolling`.

---

### Task 13: Extend `meetingStore` and `types` with `topics`/`keywords`/`actionItems`

**Files:**
- Modify: `meet-mind/frontend/src/types/index.ts`
- Modify: `meet-mind/frontend/src/store/meetingStore.ts`

- [ ] **Step 1: Add types**

Open `meet-mind/frontend/src/types/index.ts`. Add near the bottom:

```ts
export interface MeetingNote {
  id?: string;
  text: string;
  ts: number;
  section?: string;
  session_id?: string | null;
  session_title?: string | null;
}

export interface MeetingActionItem {
  id: string;
  title: string;
  assigned_to?: string | null;
  due_date?: string | null;
  status: "pending" | "completed";
}
```

- [ ] **Step 2: Extend `meetingEndData` in store**

Open `meet-mind/frontend/src/store/meetingStore.ts`. Find the `meetingEndData` type definition (around line 42). Add three new fields:

```ts
meetingEndData: {
  title: string;
  duration: string;
  summary: string;
  spokenTranscript: string;
  notes: MeetingNote[];
  participants: string[];
  startTime: Date | null;
  endTime: Date | null;
  topics: string[];
  keywords: string[];
  actionItems: MeetingActionItem[];
} | null;
```

Make sure to import `MeetingNote` and `MeetingActionItem` at the top: `import type { MeetingNote, MeetingActionItem } from "../types";`.

- [ ] **Step 3: Initialize the new fields in `setMeetingEndData`**

Find any place in the store where `meetingEndData` is set (search for `meetingEndData:`). When creating the object, set defaults:

```ts
meetingEndData: {
  // ...existing fields
  topics: data.topics ?? [],
  keywords: data.keywords ?? [],
  actionItems: data.actionItems ?? [],
},
```

If the setter accepts a partial object, update both call sites where end data is initialized.

- [ ] **Step 4: Add an optimistic-update reducer**

Inside the Zustand store factory, add a new method:

```ts
setActionItemStatus: (itemId, status) => set((state) => {
  if (!state.meetingEndData) return {};
  return {
    meetingEndData: {
      ...state.meetingEndData,
      actionItems: state.meetingEndData.actionItems.map(a =>
        a.id === itemId ? { ...a, status } : a
      ),
    },
  };
}),
```

And add its signature to the store's TypeScript interface:

```ts
setActionItemStatus: (itemId: string, status: "pending" | "completed") => void;
```

- [ ] **Step 5: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

`feat(frontend): extend meetingStore with topics/keywords/actionItems + setter`.

---

### Task 14: `api.toggleActionItem`

**Files:**
- Modify: `meet-mind/frontend/src/services/api.ts`

- [ ] **Step 1: Add the method**

Open `meet-mind/frontend/src/services/api.ts`. Inside the `api` object, add:

```ts
  toggleActionItem: async (roomName: string, itemId: string, status: "completed" | "pending") => {
    const r = await fetch(`${API_URL}/api/meetings/${roomName}/action_items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) throw new Error(`toggleActionItem failed: ${r.status}`);
    return r.json() as Promise<{ id: string; title: string; status: "pending" | "completed"; updated_at: string | null }>;
  },
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

`feat(frontend): api.toggleActionItem hits PATCH endpoint`.

---

### Task 15: `TopicsCard` component

**Files:**
- Create: `meet-mind/frontend/src/components/end/TopicsCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
interface Props {
  topics: string[];
  keywords: string[];
}

export function TopicsCard({ topics, keywords }: Props) {
  if (topics.length === 0 && keywords.length === 0) return null;
  return (
    <div className="bento-card bento-topics interactable" style={{ animationDelay: '.2s' }}>
      <div className="card-label">📚 Topics & <span>Keywords</span></div>
      {topics.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '.75rem' }}>
          {topics.map((t, i) => (
            <span key={`t-${i}`} className="participant-tag highlight" style={{ fontSize: '.95rem', padding: '.5rem 1rem' }}>{t}</span>
          ))}
        </div>
      )}
      {keywords.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginTop: '.9rem' }}>
          {keywords.map((k, i) => (
            <span key={`k-${i}`} className="participant-tag" style={{ fontSize: '.72rem', opacity: .7, padding: '.3rem .65rem' }}>{k}</span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

`feat(frontend): TopicsCard component`.

---

### Task 16: `SummaryCard` component

**Files:**
- Create: `meet-mind/frontend/src/components/end/SummaryCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { MarkdownMessage } from '../meeting/MarkdownMessage';

interface Props {
  summary: string;
}

export function SummaryCard({ summary }: Props) {
  return (
    <div className="bento-card bento-summary interactable" style={{ animationDelay: '.3s', overflowY: 'auto' }}>
      <div className="card-label">🧠 Meeting <span>Summary</span></div>
      {summary?.trim() ? (
        <div className="insight-text" style={{ fontSize: '.92rem', lineHeight: 1.7, marginTop: '.75rem' }}>
          <MarkdownMessage content={summary} />
        </div>
      ) : (
        <p style={{ opacity: .4, fontStyle: 'italic', fontSize: '.88rem' }}>No summary generated.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

`feat(frontend): SummaryCard component`.

---

### Task 17: `NotesCard` component (groups by session)

**Files:**
- Create: `meet-mind/frontend/src/components/end/NotesCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { MeetingNote } from '../../types';

interface Props {
  notes: MeetingNote[];
}

interface Group {
  id: string;
  title: string;
  notes: MeetingNote[];
  startTs: number;
  endTs: number;
}

function groupBySession(notes: MeetingNote[]): Group[] {
  const map = new Map<string, Group>();
  for (const n of notes) {
    const id = n.session_id ?? "__ungrouped__";
    const title = n.session_title ?? (id === "__ungrouped__" ? "Ungrouped" : "Notes Session");
    if (!map.has(id)) {
      map.set(id, { id, title, notes: [], startTs: n.ts || 0, endTs: n.ts || 0 });
    }
    const g = map.get(id)!;
    g.notes.push(n);
    if (n.ts && n.ts < g.startTs) g.startTs = n.ts;
    if (n.ts && n.ts > g.endTs) g.endTs = n.ts;
  }
  // Real sessions first, ungrouped last
  return [...map.values()].sort((a, b) => {
    if (a.id === "__ungrouped__") return 1;
    if (b.id === "__ungrouped__") return -1;
    return a.startTs - b.startTs;
  });
}

function fmtTime(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function NotesCard({ notes }: Props) {
  if (notes.length === 0) {
    return (
      <div className="bento-card bento-actions interactable" style={{ animationDelay: '.4s', overflowY: 'auto' }}>
        <div className="card-label">📝 Meeting <span>Notes</span></div>
        <p style={{ opacity: .4, fontSize: '.88rem', fontStyle: 'italic' }}>No notes captured. Turn on Notes mode during the meeting to capture key points.</p>
      </div>
    );
  }

  const groups = groupBySession(notes);

  return (
    <div className="bento-card bento-actions interactable" style={{ animationDelay: '.4s', overflowY: 'auto' }}>
      <div className="card-label">📝 Meeting <span>Notes</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', marginTop: '.5rem' }}>
        {groups.map((g) => (
          <details key={g.id} open style={{
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,.08)',
            background: g.id === "__ungrouped__" ? 'rgba(255,255,255,.02)' : 'rgba(0,0,0,.3)',
            padding: '.65rem .9rem',
          }}>
            <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '.85rem', fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>
                {g.title}
              </span>
              <span style={{ fontSize: '.7rem', color: 'rgba(255,255,255,.4)' }}>
                {g.startTs ? `${fmtTime(g.startTs)} → ${fmtTime(g.endTs)}` : ''}
              </span>
            </summary>
            <ul style={{ marginTop: '.5rem', paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
              {g.notes.map((n, i) => (
                <li key={i} style={{ fontSize: '.83rem', color: 'rgba(255,255,255,.78)', lineHeight: 1.5 }}>{n.text}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

`feat(frontend): NotesCard groups notes by session_id`.

---

### Task 18: `ActionItemsCard` component (checklist with persistence)

**Files:**
- Create: `meet-mind/frontend/src/components/end/ActionItemsCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react';
import { Check } from 'lucide-react';
import type { MeetingActionItem } from '../../types';
import { api } from '../../services/api';
import { useMeetingStore } from '../../store/meetingStore';

interface Props {
  roomName: string;
  items: MeetingActionItem[];
}

export function ActionItemsCard({ roomName, items }: Props) {
  const setItemStatus = useMeetingStore(s => s.setActionItemStatus);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="bento-card bento-actions interactable" style={{ animationDelay: '.5s' }}>
        <div className="card-label">✅ Action <span>Items</span></div>
        <p style={{ opacity: .4, fontSize: '.88rem', fontStyle: 'italic' }}>No action items extracted.</p>
      </div>
    );
  }

  const toggle = async (item: MeetingActionItem) => {
    const next = item.status === "completed" ? "pending" : "completed";
    setItemStatus(item.id, next);          // optimistic
    setError(null);
    try {
      await api.toggleActionItem(roomName, item.id, next);
    } catch (e) {
      setItemStatus(item.id, item.status); // revert
      setError(e instanceof Error ? e.message : "Failed to update");
      setTimeout(() => setError(null), 3000);
    }
  };

  // Pending first, completed at the bottom
  const ordered = [...items].sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed"));

  return (
    <div className="bento-card bento-actions interactable" style={{ animationDelay: '.5s' }}>
      <div className="card-label">✅ Action <span>Items</span></div>
      {error && (
        <div style={{ padding: '.4rem .8rem', marginBottom: '.6rem', borderRadius: 8, background: 'rgba(255,68,68,.1)', border: '1px solid rgba(255,68,68,.25)', color: '#ff6b6b', fontSize: '.78rem' }}>{error}</div>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: '.4rem 0 0 0', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {ordered.map((item) => {
          const done = item.status === "completed";
          return (
            <li key={item.id}
                onClick={() => toggle(item)}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '.65rem',
                  padding: '.6rem .85rem',
                  borderRadius: 12,
                  border: `1px solid ${done ? 'rgba(0,255,204,.3)' : 'rgba(255,255,255,.08)'}`,
                  background: done ? 'rgba(0,255,204,.06)' : 'rgba(0,0,0,.3)',
                  opacity: done ? .55 : 1,
                  transition: 'all .15s',
                }}>
              <div style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2,
                background: done ? '#00ffcc' : 'transparent',
                border: `1px solid ${done ? '#00ffcc' : 'rgba(255,255,255,.25)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{done && <Check size={10} style={{ color: '#000' }} />}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.86rem', color: 'rgba(255,255,255,.9)', textDecoration: done ? 'line-through' : 'none' }}>{item.title}</div>
                <div style={{ fontSize: '.7rem', color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
                  {item.assigned_to ? `@${item.assigned_to}` : 'unassigned'}
                  {item.due_date ? ` · ${new Date(item.due_date).toLocaleDateString()}` : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

`feat(frontend): ActionItemsCard checklist with optimistic PATCH`.

---

### Task 19: `TranscriptCard` (collapsible)

**Files:**
- Create: `meet-mind/frontend/src/components/end/TranscriptCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { MarkdownMessage } from '../meeting/MarkdownMessage';

interface Props {
  transcript: string;
}

export function TranscriptCard({ transcript }: Props) {
  if (!transcript?.trim()) return null;
  return (
    <div className="bento-card bento-transcript interactable" style={{ animationDelay: '.6s' }}>
      <details>
        <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
          <span className="card-label">🎙️ Spoken <span>Transcript</span></span>
        </summary>
        <div className="insight-text" style={{ marginTop: '.75rem', fontSize: '.85rem', lineHeight: 1.6 }}>
          <MarkdownMessage content={transcript} />
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

`feat(frontend): TranscriptCard collapsible`.

---

### Task 20: Rewrite `MeetingEnd.tsx` with new card order

**Files:**
- Modify: `meet-mind/frontend/src/pages/MeetingEnd.tsx`

- [ ] **Step 1: Update the intelligence fetch to populate the new fields**

Open `MeetingEnd.tsx`. Find the `useEffect` that calls `api.getMeetingIntelligence` (around line 22). Replace its body with one that maps the richer payload onto `data`:

```tsx
  useEffect(() => {
    if (!roomId || !storeData) return;
    let cancelled = false;
    api.getMeetingIntelligence(roomId).then(intel => {
      if (cancelled) return;
      const dbNotes = (intel.notes || []).map((n: any) => ({
        id: n.id,
        text: n.content,
        ts: n.at ? new Date(n.at).getTime() : Date.now(),
        section: n.section || '',
        session_id: n.session_id ?? null,
        session_title: n.session_title ?? null,
      }));
      const dbActions = (intel.action_items || []).map((a: any) => ({
        id: a.id,
        title: a.title,
        assigned_to: a.assigned_to ?? null,
        due_date: a.due_date ?? null,
        status: a.status === 'completed' ? 'completed' : 'pending',
      }));
      const trMd = formatTranscriptMarkdown(intel.transcripts || []);
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          topics: intel.topics ?? [],
          keywords: intel.keywords ?? [],
          notes: dbNotes.length > 0 ? dbNotes : prev.notes,
          actionItems: dbActions,
          spokenTranscript: trMd.trim() ? trMd : (prev.spokenTranscript ?? ''),
        };
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [roomId, storeData]);
```

- [ ] **Step 2: Import the new card components**

Near the top:

```tsx
import { TopicsCard } from '../components/end/TopicsCard';
import { SummaryCard } from '../components/end/SummaryCard';
import { NotesCard } from '../components/end/NotesCard';
import { ActionItemsCard } from '../components/end/ActionItemsCard';
import { TranscriptCard } from '../components/end/TranscriptCard';
```

Remove the now-unused imports: `MarkdownMessage` (if no longer used directly on this page), `Check` (used inside `ActionItemsCard` now).

- [ ] **Step 3: Replace the bento dashboard contents**

Find the `<main className="bento-dashboard">` block (line 155). Replace from the opening `<main` through its closing `</main>` with:

```tsx
      <main className="bento-dashboard">
        {/* Meta card (unchanged) */}
        <div className="bento-card bento-meta interactable" style={{ animationDelay: '.1s' }}>
          <div className="card-label">Session Complete</div>
          <h1 style={{ fontFamily:"'Outfit',sans-serif", fontSize:'clamp(2rem,5vw,3.8rem)', fontWeight:900, lineHeight:1, letterSpacing:'-2px', marginBottom:'1rem' }}>
            {data.title.split(' ').map((w,i,arr) => i===arr.length-1 ? <em key={i} style={{ color:'#ffd700', fontStyle:'normal' }}>{w}</em> : w+' ')}
          </h1>
          <p style={{ opacity:.55, maxWidth:560, lineHeight:1.65, fontSize:'.95rem' }}>
            Jarvis monitored the session and synthesized key decisions and action items in real-time.
          </p>
          <div style={{ display:'flex', gap:'1rem', marginTop:'auto', paddingTop:'2rem', flexWrap:'wrap' }}>
            <span className="participant-tag highlight">{data.startTime ? data.startTime.toLocaleDateString() : 'Today'}</span>
            <span className="participant-tag">{data.duration}</span>
            <span className="participant-tag">{data.participants.length} Participants</span>
            {data.participants.map((p,i) => <span key={i} className="participant-tag">{p}</span>)}
          </div>
        </div>

        <TopicsCard topics={data.topics} keywords={data.keywords} />
        <SummaryCard summary={data.summary} />
        <NotesCard notes={data.notes} />
        <ActionItemsCard roomName={roomId!} items={data.actionItems} />
        <TranscriptCard transcript={data.spokenTranscript ?? ''} />
      </main>
```

- [ ] **Step 4: Remove unused locals**

Delete the `checkedItems` state and `toggleCheck` function — they're no longer used (the new `ActionItemsCard` owns toggling).

- [ ] **Step 5: Type-check**

```
cd meet-mind/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

`feat(frontend): MeetingEnd rebuilt with 5 focused cards in the new order`.

---

### Task 21: Full end-to-end smoke test

**Files:** none (manual verification).

- [ ] **Step 1: Bring up all three services**

In three terminals:

```
# brain
cd ai-brain-orchestration && source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8100

# backend
cd meet-mind/backend && source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# frontend
cd meet-mind/frontend && npm run dev
```

- [ ] **Step 2: Walk through the script**

1. Open `http://localhost:5173` (or whatever Vite reports).
2. Create a meeting titled "Phase 1 smoke".
3. Join the meeting. Verify the `LiveNotesPanel` is collapsed/small.
4. Say "Hey Jarvis, start taking notes about marketing."
5. Speak ~6 bullet points across ~20 seconds. Watch the panel grow as new items arrive — it should expand smoothly up to ~50% of the viewport and then auto-scroll.
6. Say "stop taking notes." Wait for confirmation.
7. Repeat: "start taking notes about pricing", speak 3-4 points, "stop taking notes."
8. Ask the assistant: "extract action items from this meeting." Confirm at least 1 action item is returned.
9. End the meeting. You should land on `MeetingEnd.tsx`.

- [ ] **Step 3: Verify each end-page card**

- **Top meta card** — unchanged: title, duration, participants.
- **Topics card** — shows 2-5 topic chips and several keyword chips. The 85% score is gone.
- **Summary card** — markdown narrative covering both notes sessions.
- **Notes card** — two `<details>` accordions, each with a title like "Marketing Strategy" and "Pricing Discussion" plus the time range. An "Ungrouped" group is absent (since all notes from this meeting have a `session_id`).
- **Action items card** — at least one row with a checkbox. Click one — it crosses out and moves to the bottom. Refresh the page; the completed state persists.
- **Transcript card** — collapsed by default. Open it; full speaker-attributed transcript appears.

- [ ] **Step 4: Verify failure modes**

- Toggle an action item with the backend stopped (e.g., kill the backend uvicorn briefly). Confirm the checkbox reverts and a red toast appears.
- Truncate `meetings.topics` for the current meeting in psql to `null`. Reload the end page; the Topics card is hidden.

- [ ] **Step 5: Commit**

`docs(plans): mark Phase 1 smoke walkthrough complete`.

---

## Self-Review (run after writing the full plan)

**Spec coverage check (one bullet per spec section):**

- §1 Goals — items 1, 8, 9, 10, 11 ✓ (Tasks 12, 15, 16, 17, 18 respectively)
- §2 Non-Goals — respected (no backfill, no inline editing, no drag-reorder, no PDF template change)
- §3 End-Page Layout — Task 20 implements the exact vertical order
- §4.1 Notes columns — Task 7
- §4.2 Action items status string normalization — Task 10 validates input to two strings
- §5.1 NoteSession + NotesStore — Tasks 1, 2
- §5.2 generate_session_title — Task 3
- §5.3 STOP_NOTES / SHOW_NOTES artifacts — Task 4
- §5.4 summary_agent topics/keywords — Task 5
- §6.1 backend persists session_id/session_title — Task 8
- §6.2 meetings.topics/keywords — Task 7 (schema), Task 9 (writer)
- §6.3 PATCH endpoint — Task 10
- §6.4 intelligence payload — Task 11
- §7.1 LiveNotesPanel — Task 12
- §7.2 MeetingEnd.tsx — Tasks 15-20
- §7.3 api.ts — Task 14
- §7.4 meetingStore — Task 13
- §8 Data flows — exercised end-to-end in Task 21
- §9 Error handling — covered (Task 3 fallback, Task 5 try/except, Task 18 revert + toast, Task 6 legacy fallback)
- §10 Testing — Tasks 1, 2, 3, 5, 6, 10, 11 cover the named unit tests; Task 21 covers the E2E
- §11 Migration path — implicit (brain → backend → frontend ordering)

**Placeholder scan:** None found ("Notes Session" is a real fallback string from the spec, not a placeholder).

**Type consistency:**
- `session_id: str` everywhere (brain, DB, JSON, TS)
- `session_title: str | None` consistent
- `topics: list[str]` / `keywords: list[str]` consistent
- Status string set `{ "pending", "completed" }` consistent (model default, PATCH validator, frontend type, normalization in persistence)
- `MeetingNote` and `MeetingActionItem` types defined once in `types/index.ts` and re-used

No fixes needed.
