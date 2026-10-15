# Action Items, Recall & Wake Reliability — Design

Date: 2026-07-10
Status: Approved (design), pending implementation plan

## Problem

User-reported gaps after the previous wake/routing work shipped:

1. **Action items miss points.** The overview/notes capture everything, but action-item
   extraction ignores much of it — it only sees the current utterance.
2. **Imperative custom items fail.** "Add a match with Virat tomorrow at 8am to action
   items" does nothing — no add intent, no date parsing, and Jarvis refuses non-meeting
   items.
3. **No recall.** After the user says something ("I have a Virat match tomorrow"), later
   asking "what happened to the Virat match?" fails — the answer path can't see earlier
   speech.
4. **Wake drops mid-conversation.** Even on the new code, saying "Jarvis" while Jarvis is
   processing/speaking the previous reply is ignored.

Constraint (project guidelines): must not break existing features. Enhancement only.

## Scope

Four mostly-independent parts:

- **Part A** — action-item extraction reads full transcript + notes (`ai-brain-orchestration`).
- **Part B** — new `ADD_ACTION_ITEM` intent: imperative custom items with parsed dates
  (`ai-brain-orchestration` + `meet-mind` persistence).
- **Part C** — GENERAL recall from the current meeting's full transcript
  (`ai-brain-orchestration`).
- **Part D** — wake reliability mid-response + TTS barge-in (`meet-mind/frontend`).

Recall is **current-meeting only** (full history of this room). Cross-meeting / cross-day
semantic search is explicitly out of scope. No new STT/TTS engines.

Implementation priority: **D and A first** (active bug + missing items), then **B and C**.

---

## Part A — Action items from full transcript + notes

Files: `ai-brain-orchestration/app/orchestrator.py` (ACTION_ITEMS branch),
`app/agents/action_items_agent.py`.

Today the ACTION_ITEMS branch calls `run_action_items_agent(text=req.text, context={memory})`
— only the triggering utterance + the 8-turn session window. It never reads
`TRANSCRIPT_STORE` or `NOTES_STORE`.

### Changes
- In the ACTION_ITEMS branch, gather:
  - `full_transcript = TRANSCRIPT_STORE.get_attributed_transcript(req.user_id, req.room_id)`
    (same call SUMMARY already uses).
  - `notes_state = NOTES_STORE.get(req.user_id, req.room_id)`; pass its raw transcript
    (`notes_state.raw_transcript()`) or filtered notes if present.
- Extend `run_action_items_agent(...)` signature with `full_transcript: str = ""` and
  `notes_text: str = ""`; include both in the agent's user payload.
- Update the agent prompt to "Extract ALL actionable tasks from the meeting transcript and
  notes below" (was: "conversation context"). Keep the existing no-placeholder rule for
  `assigned_to`/`due_date`.
- Token safety: cap the transcript passed to the agent (e.g. last ~6000 chars) to avoid
  oversized prompts; document the cap in code.

### Preserved
- Output shape unchanged: `artifacts.items = [{title, assigned_to?, due_date?}]`,
  `ui_event="ACTION_ITEMS"`. meet-mind persistence unchanged for this part.

### Testing
- Unit: seed `TRANSCRIPT_STORE` with utterances containing 3 clear tasks not present in the
  triggering message; assert `run_action_items_agent` (with the fake LLM) receives the
  transcript in its payload. Assert existing ACTION_ITEMS test still passes.

---

## Part B — `ADD_ACTION_ITEM`: imperative custom items with dates

Files: `ai-brain-orchestration/app/orchestrator.py`, new
`app/agents/add_action_item_agent.py`, `app/schemas.py` (allowed routes),
`ai-brain-orchestration/requirements*.txt` (add `python-dateutil`),
`meet-mind/backend/app/main.py` (`_persist_ai_artifacts`).

### Intent + routing
- New route `ADD_ACTION_ITEM`. Strong keyword phrases (word-boundary):
  "add … to action items", "add … to the action items", "add an action item",
  "add action item", "remind me to", "put … on the action items",
  "add a reminder", "create a reminder".
- Distinct from `ACTION_ITEMS` (which *lists/extracts*). Add to `_STRONG_KEYWORDS`,
  `_LLM_ALLOWED`, and the `ROUTER_PROMPT` enum with an example.

### Handler (`add_action_item_agent.py`)
- Input: `req.text`.
- Parse **title** and **due datetime**:
  - Extract a relative/absolute date-time phrase and resolve it with a small resolver:
    handle "today", "tomorrow", weekday names, and clock times ("8am", "8:00", "20:00")
    relative to a caller-supplied `now: datetime` (passed in so it stays testable and
    deterministic — never call `datetime.now()` inside the pure parser).
    Use `dateutil` for absolute-date fallback.
  - Title = utterance with the trigger phrase and the date-time phrase stripped, cleaned
    (e.g. "a match with Virat").
- Returns `{title: str, due_date: str | None}` where `due_date` is ISO-8601
  (`YYYY-MM-DDTHH:MM:SS`) or `None` when no time was given.
- This intent is **not** subject to the meeting-only refusal — personal items are allowed.
  Do not route personal-topic *questions* here; only explicit add phrasing.

### Orchestrator branch
- Handle `ADD_ACTION_ITEM`: call the agent, return
  `ExecuteResponse(reply="Added: <title> (<due>)", intent="ADD_ACTION_ITEM",
  ui_event="ACTION_ITEMS", artifacts={"items": [{title, due_date}]})`.
  `_append_conversation` as normal.

### meet-mind persistence (fix the dropped `due_date`)
- In `_persist_ai_artifacts`, extend the action-item persist branch to run for
  `intent in ("ACTION_ITEMS", "ADD_ACTION_ITEM")` and to parse `item.get("due_date")`
  (ISO string) into a `datetime` for the `ActionItem.due_date` column (currently always
  dropped). Malformed/absent → `None`. No new endpoint required; the existing
  execute→persist path stores it.

### Testing
- Unit (pure resolver): `("... tomorrow at 8am", now=2026-07-10T09:00)` →
  `2026-07-11T08:00:00`; "today at 20:00"; weekday; no-time → `None`.
- Unit (title strip): "add a match with Virat tomorrow at 8am to action items" →
  title "a match with Virat" (or "match with Virat"), due tomorrow 08:00.
- Router: the add phrasing routes to `ADD_ACTION_ITEM`, not `ACTION_ITEMS`.
- meet-mind: `_persist_ai_artifacts` with an ISO `due_date` writes a non-null
  `ActionItem.due_date`.

---

## Part C — Recall within the current meeting

Files: `ai-brain-orchestration/app/orchestrator.py` (`_run_general`).

`_run_general` builds context from `memory` (summary + last 8 turns) only. Earlier speech
is lost. For the current meeting, the full attributed transcript is available in
`TRANSCRIPT_STORE`.

### Changes
- In `_run_general`, add `meeting_transcript` to the user payload:
  `TRANSCRIPT_STORE.get_attributed_transcript(req.user_id, req.room_id)`, capped to a token
  budget (e.g. last ~8000 chars) to protect the context window.
- Update `_build_system_prompt` (or the GENERAL user content) so the model is told it MAY
  answer questions about anything stated earlier in this meeting using the transcript —
  without weakening the "no internet / no external facts" rule.

### Preserved
- GENERAL output shape unchanged. The meeting-only scope rule stays; recall is about *this
  meeting's* content, which is in scope.

### Testing
- Unit: seed `TRANSCRIPT_STORE` with "I have a Virat match tomorrow" many turns earlier
  (beyond the 8-turn window), then a GENERAL query "what did I say about the Virat match?";
  assert the transcript text is present in the payload handed to the LLM.

---

## Part D — Wake reliability mid-response + TTS barge-in

Files: `meet-mind/frontend/src/hooks/useVoiceCapture.ts`, and the TTS play path
(`hooks/useAssistantChat.ts` `playTts` + `stopTts`).

### Root cause
`wakePausedForVoiceRef` is set true at capture start and only reset in the recorder
`onstop` `finally`, which runs *after* the brain round-trip. During transcription + brain +
the start of TTS, wake is not listening — so mid-response "Jarvis" is ignored.

### Changes
1. **Resume wake as soon as audio is sent.** After the command blob is POSTed (recording is
   already stopped), resume wake listening (`wakePausedForVoiceRef.current = false;
   scheduleWakeRestart()`) instead of waiting for the brain reply. Guard re-entry so a new
   wake during an in-flight request starts a fresh capture cleanly (the existing
   `isRecordingVoiceRef` guard covers overlap; a second wake simply queues a new capture
   after the current send settles).
2. **TTS barge-in.** Track the current TTS playback (audio element / `speechSynthesis`) in a
   ref. When a wake fires (in `useWakeWord`) or a new command starts, call `stopTts()` to
   cut playback immediately so the user can interrupt Jarvis while it is speaking.
3. Keep the existing capture barge-in (fresh wake during capture restarts capture) from the
   prior change.

### Risks / mitigation
- Overlapping brain requests if the user wakes again before the previous reply returns:
  acceptable; each request is independent and stateless server-side. Do not block the new
  wake on the old request.
- Echo: while TTS plays and wake listens, the mic may hear Jarvis. Mitigated by barge-in
  (TTS stops on wake) and the word-boundary matcher; no extra echo cancellation in scope.

### Testing
- Manual (browser, both services up): wake, let Jarvis start replying, say "Jarvis"
  mid-reply → TTS stops and a new "Listening…" starts. Wake works during the previous
  request's processing.
- Any pure helper extracted (e.g. a "should resume wake" predicate) gets a vitest unit.

---

## Rollout
- Parts are independent; land D and A first, then B and C.
- Part B adds one dependency (`python-dateutil`) to `ai-brain-orchestration` and persists a
  previously-dropped column; additive, no migration (column already exists).
- No frontend/back schema breaks; `ADD_ACTION_ITEM` and `due_date` are additive.
