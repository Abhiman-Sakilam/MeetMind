# Action Items, Recall & Wake Reliability Implementation Plan

**Goal:** Wake works mid-response (TTS barge-in), action items are extracted from the full meeting + notes, users can add custom dated action items by voice, and Jarvis recalls anything said earlier in the current meeting.

**Architecture:** Part D (meet-mind React) — resume wake as soon as the command is sent + stop TTS on a new wake. Part A (ai-brain FastAPI) — feed full transcript + notes into the action-items agent. Part B — a new `ADD_ACTION_ITEM` intent backed by a pure stdlib date resolver (no LLM, no new dependency) plus meet-mind persistence of `due_date`. Part C — GENERAL answers using the current meeting's full transcript.

**Tech Stack:** TypeScript + Vite + Vitest (frontend); Python 3.12 + FastAPI + Pydantic + LangChain/Groq + unittest (backend).

## Global Constraints

- Must not break existing features (project guidelines). All changes additive / behavior-preserving.
- Recall is CURRENT-MEETING ONLY — no cross-meeting/cross-day search.
- Date resolver is PURE stdlib and takes `now: datetime` as a parameter — never call `datetime.now()` inside it (keeps tests deterministic). No new pip dependency.
- Backend keyword matching stays word-boundary based (`\b`), consistent with `_keyword_route`.
- Repo is NOT git-initialized. Treat each "Commit" step as a logical checkpoint (stage + review); do not fail a task if `git` is absent.
- Backend tests run with: `PYTHONPATH=.:.venv/lib/python3.12/site-packages .venv/bin/python -m unittest <module> -v` from `ai-brain-orchestration/`.
- Frontend tests run with: `npm test` from `meet-mind/frontend/`.

---

## Part D — Wake reliability mid-response + TTS barge-in (meet-mind/frontend)

File map:
- `src/hooks/useAssistantChat.ts` — export `stopTts` (Task D1)
- `src/hooks/useWakeWord.ts` — stop TTS when a wake fires (Task D2)
- `src/hooks/useVoiceCapture.ts` — resume wake right after send + guard finally + stop TTS at capture start (Task D3)

---

### Task D1: Export `stopTts`

**Files:**
- Modify: `meet-mind/frontend/src/hooks/useAssistantChat.ts`

**Interfaces:**
- Produces: `export function stopTts(): void` — cuts current `_ttsAudio` playback and cancels `speechSynthesis` (body already exists at ~line 117; only the `export` keyword is added).

- [ ] **Step 1: Add `export` to the existing `stopTts`**

Change `function stopTts() {` (around line 117) to `export function stopTts() {`. No body change.

- [ ] **Step 2: Type-check**

Run: `cd meet-mind/frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add meet-mind/frontend/src/hooks/useAssistantChat.ts
git commit -m "feat(tts): export stopTts for barge-in"
```

---

### Task D2: Stop TTS when a wake fires

**Files:**
- Modify: `meet-mind/frontend/src/hooks/useWakeWord.ts`

**Interfaces:**
- Consumes: `stopTts` from `./useAssistantChat` (same dir).

- [ ] **Step 1: Import stopTts**

At the top of `useWakeWord.ts`, add:
```ts
import { stopTts } from './useAssistantChat';
```

- [ ] **Step 2: Call it on the wake-fire path**

In the `onresult` handler, immediately after `if (!wakeMatched) return;` and the dedupe/cooldown bookkeeping, before `void startVoiceRecordingRef.current();`, add:
```ts
        stopTts(); // barge-in: cut Jarvis mid-sentence so the user can speak
```

- [ ] **Step 3: Type-check**

Run: `cd meet-mind/frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add meet-mind/frontend/src/hooks/useWakeWord.ts
git commit -m "feat(wake): stop TTS on wake (barge-in)"
```

---

### Task D3: Resume wake as soon as the command is sent

**Files:**
- Modify: `meet-mind/frontend/src/hooks/useVoiceCapture.ts`

**Interfaces:**
- Consumes: `stopTts` from `./useAssistantChat`; existing `scheduleWakeRestart`, `wakePausedForVoiceRef`, `wakeWordListeningRef`, `isRecordingVoiceRef`.
- Produces: wake listening resumes before the brain round-trip; TTS stops at capture start.

- [ ] **Step 1: Import stopTts**

Merge into the existing `./useAssistantChat` import (do not duplicate the line):
```ts
import { detectLocalCommand, executeLocalCommand, stopTts } from './useAssistantChat';
```

- [ ] **Step 2: Stop TTS + resume-guard at capture start**

At the top of `startVoiceRecording`, right after `isRecordingVoiceRef.current = true;`, add:
```ts
    stopTts(); // if Jarvis was speaking, cut it — the user is talking now
```

- [ ] **Step 3: Resume wake before awaiting the brain**

In the recorder `onstop`, locate the send path just before `const res = await api.assistantVoiceExecute({`. Immediately before that `await`, add:
```ts
          // Resume wake NOW so a mid-response "Jarvis" is heard while the brain works.
          wakePausedForVoiceRef.current = false;
          if (wakeWordListeningRef.current) scheduleWakeRestart();
```

- [ ] **Step 4: Guard the `finally` so it doesn't unpause a NEW capture**

In the same `onstop`, change the `finally` block to only reset wake state when no new capture is active:
```ts
        } finally {
          setIsVoiceSending(false);
          if (!isRecordingVoiceRef.current) {
            wakePausedForVoiceRef.current = false;
            if (useMeetingStore.getState().voiceAiMode && isWakeWordSupported()) {
              useMeetingStore.getState().setVoiceToolbarTranscript('', 'listening');
            } else {
              useMeetingStore.getState().clearVoiceToolbar();
            }
            if (wakeWordListeningRef.current) {
              scheduleWakeRestart();
            }
          }
        }
```

- [ ] **Step 5: Type-check + existing tests**

Run: `cd meet-mind/frontend && npx tsc -b --noEmit && npm test`
Expected: tsc clean; wakeWord tests still 11/11.

- [ ] **Step 6: Manual verification (browser, both services up via ./start.sh)**

- Wake, let Jarvis start speaking a reply, say "Jarvis" mid-reply → TTS stops, new "Listening for your question…" appears.
- Wake, ask a slow question; while "Sending audio to Jarvis…" shows, say "Jarvis" again → it starts a new capture (wake not dead during processing).

- [ ] **Step 7: Commit**

```bash
git add meet-mind/frontend/src/hooks/useVoiceCapture.ts
git commit -m "feat(wake): resume wake during brain round-trip; stop TTS at capture start"
```

---

## Part A — Action items from full transcript + notes (ai-brain-orchestration)

File map:
- `app/agents/action_items_agent.py` — accept transcript + notes (Task A1)
- `app/orchestrator.py` — gather + pass them (Task A2)
- `tests/test_orchestrator.py` — test (Tasks A1/A2)

---

### Task A1: Agent accepts full transcript + notes

**Files:**
- Modify: `ai-brain-orchestration/app/agents/action_items_agent.py`

**Interfaces:**
- Produces: `run_action_items_agent(llm, *, text, context, persona_prompt="", full_transcript="", notes_text="") -> dict` — new keyword-only params default to `""` (back-compatible). The transcript + notes go into the LLM payload.

- [ ] **Step 1: Update the system prompt**

Change the first two lines of `ACTION_ITEMS_SYSTEM_PROMPT` from:
```
You are Jarvis Action Items Agent.
Extract actionable tasks from the meeting conversation context.
```
to:
```
You are Jarvis Action Items Agent.
Extract ALL actionable tasks from the full meeting transcript and notes provided below,
plus the user's request. Do not miss tasks mentioned anywhere in the transcript or notes.
```

- [ ] **Step 2: Add the params and include them in the payload**

Change the signature:
```python
def run_action_items_agent(
    llm: BaseChatModel,
    *,
    text: str,
    context: dict[str, object],
    persona_prompt: str = "",
    full_transcript: str = "",
    notes_text: str = "",
) -> dict[str, object]:
```
And the payload dict (cap large inputs):
```python
    payload = json.dumps(
        {
            "task": "extract_action_items",
            "user_text": text,
            "meeting_transcript": full_transcript[-6000:],
            "notes": notes_text[-4000:],
            "context": context,
        },
        ensure_ascii=False,
    )
```

- [ ] **Step 3: Write failing test** — append to `tests/test_orchestrator.py`

```python
class ActionItemsSourceTests(unittest.TestCase):
    def test_agent_payload_includes_transcript_and_notes(self):
        from app.agents import action_items_agent as aia
        captured = {}

        class _Rec:
            def invoke(self, messages):
                captured["payload"] = messages[1].content
                return type("R", (), {"content": '{"reply":"ok","items":[]}'})()

        aia.run_action_items_agent(
            _Rec(), text="what are the action items",
            context={}, full_transcript="[A]: ship the report by friday",
            notes_text="- call the vendor",
        )
        self.assertIn("ship the report by friday", captured["payload"])
        self.assertIn("call the vendor", captured["payload"])
```

- [ ] **Step 4: Run test**

Run: `cd ai-brain-orchestration && PYTHONPATH=.:.venv/lib/python3.12/site-packages .venv/bin/python -m unittest tests.test_orchestrator.ActionItemsSourceTests -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ai-brain-orchestration/app/agents/action_items_agent.py ai-brain-orchestration/tests/test_orchestrator.py
git commit -m "feat(action-items): extract from full transcript + notes"
```

---

### Task A2: Orchestrator gathers transcript + notes

**Files:**
- Modify: `ai-brain-orchestration/app/orchestrator.py` (ACTION_ITEMS branch)

**Interfaces:**
- Consumes: `TRANSCRIPT_STORE.get_attributed_transcript`, `NOTES_STORE.get(...).raw_transcript()`, `run_action_items_agent` (extended in A1).

- [ ] **Step 1: Gather and pass in the ACTION_ITEMS branch**

Replace the `if route == "ACTION_ITEMS":` branch's agent call so it also passes transcript + notes:
```python
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
```
(Keep the rest of the branch — reply/`_append_conversation`/return — unchanged.)

- [ ] **Step 2: Run full orchestrator suite**

Run: `cd ai-brain-orchestration && PYTHONPATH=.:.venv/lib/python3.12/site-packages .venv/bin/python -m unittest tests.test_orchestrator -v`
Expected: all PASS (existing ACTION_ITEMS test + new).

- [ ] **Step 3: Commit**

```bash
git add ai-brain-orchestration/app/orchestrator.py
git commit -m "feat(action-items): feed transcript+notes from orchestrator"
```

---

## Part B — ADD_ACTION_ITEM: imperative custom items with dates

File map:
- `app/agents/date_resolver.py` — new pure resolver (Task B1)
- `app/agents/add_action_item_agent.py` — new title+date agent (Task B2)
- `app/orchestrator.py` — route + branch (Task B3)
- `meet-mind/backend/app/main.py` — persist `due_date` + handle intent (Task B4)

---

### Task B1: Pure date resolver

**Files:**
- Create: `ai-brain-orchestration/app/agents/date_resolver.py`
- Test: `ai-brain-orchestration/tests/test_date_resolver.py`

**Interfaces:**
- Produces: `resolve_due_datetime(text: str, now: datetime) -> datetime | None` — resolves "today/tonight/tomorrow", weekday names, and clock times ("8am", "8:00", "20:00") relative to `now`; returns `None` when no date/time is present.

- [ ] **Step 1: Write failing tests** — `tests/test_date_resolver.py`

```python
import unittest
from datetime import datetime
from app.agents.date_resolver import resolve_due_datetime

NOW = datetime(2026, 7, 10, 9, 0)  # Friday


class DateResolverTests(unittest.TestCase):
    def test_tomorrow_at_8am(self):
        self.assertEqual(resolve_due_datetime("a match tomorrow at 8am", NOW),
                         datetime(2026, 7, 11, 8, 0))

    def test_today_24h(self):
        self.assertEqual(resolve_due_datetime("call today at 20:00", NOW),
                         datetime(2026, 7, 10, 20, 0))

    def test_weekday_next_occurrence(self):
        # Friday NOW → next Monday
        self.assertEqual(resolve_due_datetime("meeting on monday at 10am", NOW),
                         datetime(2026, 7, 13, 10, 0))

    def test_date_only_defaults_9am(self):
        self.assertEqual(resolve_due_datetime("lunch tomorrow", NOW),
                         datetime(2026, 7, 11, 9, 0))

    def test_no_datetime_returns_none(self):
        self.assertIsNone(resolve_due_datetime("buy milk", NOW))

    def test_clock_already_passed_today_rolls_tomorrow(self):
        # 8am < 9am now, no explicit day → next day
        self.assertEqual(resolve_due_datetime("ping me at 8am", NOW),
                         datetime(2026, 7, 11, 8, 0))
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ai-brain-orchestration && PYTHONPATH=. .venv/bin/python -m unittest tests.test_date_resolver -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `date_resolver.py`**

```python
import re
from datetime import datetime, timedelta

_WEEKDAYS = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}


def _parse_clock(text: str) -> tuple[int, int] | None:
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", text)
    if m:
        hour = int(m.group(1)) % 12
        if m.group(3) == "pm":
            hour += 12
        return hour, int(m.group(2) or 0)
    m = re.search(r"\b(\d{1,2}):(\d{2})\b", text)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


def resolve_due_datetime(text: str, now: datetime) -> datetime | None:
    low = text.lower()
    clock = _parse_clock(low)

    base_date = None
    if "tomorrow" in low:
        base_date = (now + timedelta(days=1)).date()
    elif "today" in low or "tonight" in low:
        base_date = now.date()
    else:
        for name, idx in _WEEKDAYS.items():
            if re.search(rf"\b{name}\b", low):
                delta = (idx - now.weekday()) % 7 or 7
                base_date = (now + timedelta(days=delta)).date()
                break

    if base_date is None and clock is None:
        return None

    explicit_day = base_date is not None
    if base_date is None:
        base_date = now.date()

    hour, minute = clock or (9, 0)
    dt = datetime(base_date.year, base_date.month, base_date.day, hour, minute)

    # Clock-only ("at 8am") that already passed today → roll to tomorrow.
    if not explicit_day and clock and dt <= now:
        dt += timedelta(days=1)
    return dt
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ai-brain-orchestration && PYTHONPATH=. .venv/bin/python -m unittest tests.test_date_resolver -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add ai-brain-orchestration/app/agents/date_resolver.py ai-brain-orchestration/tests/test_date_resolver.py
git commit -m "feat(action-items): pure stdlib date resolver"
```

---

### Task B2: Add-action-item agent (title + date, no LLM)

**Files:**
- Create: `ai-brain-orchestration/app/agents/add_action_item_agent.py`
- Test: `ai-brain-orchestration/tests/test_add_action_item.py`

**Interfaces:**
- Produces: `run_add_action_item_agent(text: str, now: datetime) -> dict` returning
  `{"title": str, "due_date": str | None, "reply": str, "items": list}` where `items` is
  `[{"title": ..., "due_date": ...(iso, omitted when None)}]` and `due_date` is ISO-8601.

- [ ] **Step 1: Write failing tests** — `tests/test_add_action_item.py`

```python
import unittest
from datetime import datetime
from app.agents.add_action_item_agent import run_add_action_item_agent

NOW = datetime(2026, 7, 10, 9, 0)


class AddActionItemTests(unittest.TestCase):
    def test_virat_match(self):
        out = run_add_action_item_agent(
            "add a match with virat tomorrow at 8am to action items", NOW)
        self.assertIn("virat", out["title"].lower())
        self.assertNotIn("action items", out["title"].lower())
        self.assertNotIn("tomorrow", out["title"].lower())
        self.assertEqual(out["due_date"], "2026-07-11T08:00:00")
        self.assertEqual(out["items"][0]["title"], out["title"])
        self.assertEqual(out["items"][0]["due_date"], "2026-07-11T08:00:00")

    def test_remind_me_no_time(self):
        out = run_add_action_item_agent("remind me to email the report", NOW)
        self.assertIn("email the report", out["title"].lower())
        self.assertIsNone(out["due_date"])
        self.assertNotIn("due_date", out["items"][0])
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ai-brain-orchestration && PYTHONPATH=. .venv/bin/python -m unittest tests.test_add_action_item -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `add_action_item_agent.py`**

```python
import re
from datetime import datetime

from app.agents.date_resolver import resolve_due_datetime

# Phrases that wrap the actual task; stripped to get a clean title.
_TRIGGER_PATTERNS = [
    r"\badd (a |an )?reminder\b", r"\bcreate (a |an )?reminder\b",
    r"\bremind me to\b", r"\badd an action item\b", r"\badd action item\b",
    r"\bput\b", r"\badd\b",
    r"\bto (the )?action items\b", r"\bon (the )?action items\b",
    r"\bon (the )?list\b", r"\bto (the )?list\b", r"\bto do\b",
]
_DATE_WORDS = [
    r"\btomorrow\b", r"\btoday\b", r"\btonight\b",
    r"\bmonday\b", r"\btuesday\b", r"\bwednesday\b", r"\bthursday\b",
    r"\bfriday\b", r"\bsaturday\b", r"\bsunday\b",
    r"\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b", r"\b\d{1,2}:\d{2}\b",
    r"\b\d{1,2}\s*(am|pm)\b",
]


def _extract_title(text: str) -> str:
    t = text
    for pat in _TRIGGER_PATTERNS + _DATE_WORDS:
        t = re.sub(pat, " ", t, flags=re.IGNORECASE)
    t = re.sub(r"\s+", " ", t).strip(" ,.-")
    return t or "New action item"


def run_add_action_item_agent(text: str, now: datetime) -> dict:
    due = resolve_due_datetime(text, now)
    title = _extract_title(text)
    iso = due.isoformat() if due else None
    item = {"title": title}
    if iso:
        item["due_date"] = iso
    when = f" (due {iso})" if iso else ""
    return {
        "title": title,
        "due_date": iso,
        "items": [item],
        "reply": f"Added to action items: {title}{when}.",
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ai-brain-orchestration && PYTHONPATH=. .venv/bin/python -m unittest tests.test_add_action_item -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ai-brain-orchestration/app/agents/add_action_item_agent.py ai-brain-orchestration/tests/test_add_action_item.py
git commit -m "feat(action-items): add-action-item agent (title + date)"
```

---

### Task B3: Route + orchestrator branch for ADD_ACTION_ITEM

**Files:**
- Modify: `ai-brain-orchestration/app/orchestrator.py`
- Test: `ai-brain-orchestration/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `run_add_action_item_agent`, `datetime.now()` (at call site only).
- Produces: `ADD_ACTION_ITEM` in `_STRONG_KEYWORDS`, `_LLM_ALLOWED`, `ROUTER_PROMPT`; a `_dispatch_route` branch returning `intent="ADD_ACTION_ITEM"`, `ui_event="ACTION_ITEMS"`, `artifacts={"items": [...]}`.

- [ ] **Step 1: Write failing test** — append to `tests/test_orchestrator.py`

```python
class AddActionItemRouteTests(unittest.TestCase):
    def test_keyword_routes_to_add(self):
        from app.orchestrator import _keyword_route
        self.assertEqual(
            _keyword_route("add a match with virat tomorrow at 8am to action items")[0],
            "ADD_ACTION_ITEM",
        )

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_add_action_item_returns_item(self):
        req = ExecuteRequest(
            user_id="u-add", room_id="r-add",
            text="add a match with virat tomorrow at 8am to action items",
        )
        res = run_execute(req)
        self.assertEqual(res.intent, "ADD_ACTION_ITEM")
        self.assertTrue(res.artifacts and res.artifacts.get("items"))
        self.assertIn("virat", res.artifacts["items"][0]["title"].lower())
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ai-brain-orchestration && PYTHONPATH=.:.venv/lib/python3.12/site-packages .venv/bin/python -m unittest tests.test_orchestrator.AddActionItemRouteTests -v`
Expected: FAIL — route unknown; falls to GENERAL.

- [ ] **Step 3: Add the import + keyword + allowed + prompt**

Top of `orchestrator.py` imports, add:
```python
from datetime import datetime
from app.agents.add_action_item_agent import run_add_action_item_agent
```
In `_STRONG_KEYWORDS`, add BEFORE the `ACTION_ITEMS` entry (so add-phrasing wins over list-phrasing):
```python
    ("ADD_ACTION_ITEM", ("add a reminder", "create a reminder", "remind me to",
                         "add an action item", "add action item",
                         "to the action items", "to action items",
                         "on the action items", "put it on the list")),
```
Add `"ADD_ACTION_ITEM"` to `_LLM_ALLOWED`. In `ROUTER_PROMPT`, extend the "Also allowed" line:
```
Also allowed: CANCEL (...), REPEAT (...), ADD_ACTION_ITEM (user dictates a NEW task/reminder to add, e.g. "add a match with Virat tomorrow at 8am to action items").
```

- [ ] **Step 4: Add the dispatch branch**

In `_dispatch_route`, BEFORE the `if route == "ACTION_ITEMS":` branch, add:
```python
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
```

- [ ] **Step 5: Run tests**

Run: `cd ai-brain-orchestration && PYTHONPATH=.:.venv/lib/python3.12/site-packages .venv/bin/python -m unittest tests.test_orchestrator -v`
Expected: new AddActionItemRouteTests PASS; all existing PASS.

- [ ] **Step 6: Commit**

```bash
git add ai-brain-orchestration/app/orchestrator.py ai-brain-orchestration/tests/test_orchestrator.py
git commit -m "feat(action-items): ADD_ACTION_ITEM intent + branch"
```

---

### Task B4: meet-mind persists `due_date` + ADD_ACTION_ITEM

**Files:**
- Modify: `meet-mind/backend/app/main.py` (`_persist_ai_artifacts`)

**Interfaces:**
- Consumes: brain response `artifacts.items = [{title, assigned_to?, due_date?}]` with ISO `due_date`; `ActionItem` model with `due_date: datetime | None`.

- [ ] **Step 1: Persist due_date for both intents**

In `_persist_ai_artifacts`, change the current `if intent == "ACTION_ITEMS":` action-item block to:
```python
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
```

- [ ] **Step 2: Syntax check**

Run: `cd meet-mind/backend && python -m py_compile app/main.py` (or the backend venv python).
Expected: no error.

- [ ] **Step 3: Manual verification (both services up)**

Say "Jarvis, add a match with Virat tomorrow at 8am to action items" → then `GET /api/meetings/{room}/intelligence` shows an action item titled "match with Virat" with a non-null `due_date` for tomorrow 08:00.

- [ ] **Step 4: Commit**

```bash
git add meet-mind/backend/app/main.py
git commit -m "feat(action-items): persist due_date and ADD_ACTION_ITEM"
```

---

## Part C — Recall within the current meeting (ai-brain-orchestration)

File map:
- `app/orchestrator.py` (`_run_general`) — include capped transcript (Task C1)

---

### Task C1: GENERAL answers from the meeting transcript

**Files:**
- Modify: `ai-brain-orchestration/app/orchestrator.py` (`_run_general`, `SYSTEM_PROMPT`)
- Test: `ai-brain-orchestration/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `TRANSCRIPT_STORE.get_attributed_transcript`.
- Produces: `_run_general` payload includes `meeting_transcript` (capped ~8000 chars); system prompt allows answering from earlier meeting content.

- [ ] **Step 1: Write failing test** — append to `tests/test_orchestrator.py`

```python
class RecallTests(unittest.TestCase):
    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_general_payload_includes_transcript(self):
        from app.orchestrator import TRANSCRIPT_STORE
        uid, rid = "u-rec", "r-rec"
        TRANSCRIPT_STORE.clear(uid, rid)
        TRANSCRIPT_STORE.append(uid, rid, "I have a Virat match tomorrow", speaker="A")
        captured = {}
        orig = _FakeChatGroq.invoke

        def spy(self, messages):
            captured["user"] = messages[1].content
            return orig(self, messages)

        with patch.object(_FakeChatGroq, "invoke", spy):
            run_execute(ExecuteRequest(user_id=uid, room_id=rid,
                                       text="what did I say about the Virat match?"))
        self.assertIn("Virat match tomorrow", captured["user"])
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ai-brain-orchestration && PYTHONPATH=.:.venv/lib/python3.12/site-packages .venv/bin/python -m unittest tests.test_orchestrator.RecallTests -v`
Expected: FAIL — transcript not in payload.

- [ ] **Step 3: Add transcript to `_run_general`**

In `_run_general`, build the transcript and add it to `user_content`:
```python
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
```
(Leave the rest of `_run_general` unchanged.)

- [ ] **Step 4: Allow recall in the system prompt**

In `SYSTEM_PROMPT`, add one line under SCOPE RULES:
```
- You MAY answer questions about anything stated earlier in THIS meeting using the provided meeting_transcript (e.g. something the user mentioned before). This is in scope.
```

- [ ] **Step 5: Run tests**

Run: `cd ai-brain-orchestration && PYTHONPATH=.:.venv/lib/python3.12/site-packages .venv/bin/python -m unittest tests.test_orchestrator -v`
Expected: RecallTests PASS; all existing PASS.

- [ ] **Step 6: Commit**

```bash
git add ai-brain-orchestration/app/orchestrator.py ai-brain-orchestration/tests/test_orchestrator.py
git commit -m "feat(recall): GENERAL answers from current-meeting transcript"
```

---

## Final verification

- [ ] Backend: `cd ai-brain-orchestration && PYTHONPATH=.:.venv/lib/python3.12/site-packages .venv/bin/python -m unittest tests.test_orchestrator tests.test_date_resolver tests.test_add_action_item -v` → all green.
- [ ] Frontend: `cd meet-mind/frontend && npm test && npx tsc -b --noEmit` → all green.
- [ ] Manual (both services up via `./start.sh`, restart to load new code):
  - Wake mid-response barge-in stops TTS and starts new capture.
  - "Jarvis, what are the action items" pulls tasks mentioned earlier in the meeting.
  - "Jarvis, add a match with Virat tomorrow at 8am to action items" → item persisted with due_date.
  - "Jarvis, what did I say about the Virat match?" → recalls the earlier statement.
