# Phase 1: Meeting End Page & Live Notes Panel — Design Spec

**Date:** 2026-05-24
**Scope:** Bug fixes for items 1, 8, 9, 10, 11 in `Bugs.md`.
**Status:** Approved design; ready for implementation plan.

---

## 1. Goals

Make the meeting end page useful and well-formatted, and let the live notes panel breathe during a meeting. Specifically:

- **Item 1**: Live notes panel grows with new content up to ~50% of viewport height, then auto-scrolls to the latest entry.
- **Item 8**: Replace the static "85%" score at the top of the end page with a **Topics + Keywords** card derived from the meeting transcript.
- **Item 9**: On the end page, group notes by the start→stop session they came from. Each session has an LLM-generated title.
- **Item 10**: A single, well-formatted **Summary** narrative card on top of the end page, followed by clean detail sections (Notes, Action Items, Transcript).
- **Item 11**: Render action items as a real checklist; toggling a checkbox persists `action_items.status` to the database.

Items 2, 3, 4, 5, 6, 7 from `Bugs.md` are deferred to Phase 2 and Phase 3.

## 2. Non-Goals

- Backfilling existing notes (those without `session_id`) into sessions — they render as an "Ungrouped" group at the bottom of the Notes section.
- Inline editing of action item titles, assignees, or due dates on the end page (only checkbox toggling).
- Drag-reordering of sessions or items.
- Updating the PDF / email export templates beyond what is needed to consume the new data shape. They keep working because they read the same DB rows.

## 3. End-Page Layout

```
┌──────────────────────────────────────────────────────────┐
│  Meeting title · 42 min · 4 participants                │
├──────────────────────────────────────────────────────────┤
│  TOPICS                                                  │
│  ┌─ Q4 Planning ─┐ ┌─ Vision 2027 ─┐ ┌─ Budget ─┐       │
│  Keywords: marketing · pricing · hiring · onboarding... │
├──────────────────────────────────────────────────────────┤
│  SUMMARY                                                 │
│  One narrative card from the LLM:                        │
│  · Key discussion points                                 │
│  · Per-speaker contributions ("Ajay raised…")            │
│  · Role-play moments (if any)                            │
│  · Decisions made                                        │
├──────────────────────────────────────────────────────────┤
│  NOTES                                                   │
│  ▼ Q4 Marketing Strategy   (14:32 → 14:48)              │
│     • point 1                                            │
│     • point 2                                            │
│  ▼ Pricing Discussion      (15:05 → 15:14)              │
│     • point 1                                            │
├──────────────────────────────────────────────────────────┤
│  ACTION ITEMS                                            │
│  ☐ Send Q4 deck to leadership · @Ajay · Jun 1           │
│  ☐ Schedule pricing review · @Priya · Jun 3             │
│  (completed items rendered crossed out at bottom)        │
├──────────────────────────────────────────────────────────┤
│  TRANSCRIPT  (collapsed by default)                      │
└──────────────────────────────────────────────────────────┘
```

Vertical order is fixed: **Topics → Summary → Notes → Action Items → Transcript**. The previous "85%" card and the loose "Insights" section are removed.

## 4. Data Model Changes

### 4.1 `notes` table (meet-mind backend)

Add two nullable columns:

| Column | Type | Purpose |
|--------|------|---------|
| `session_id` | `String(64)` nullable | Groups notes from one start-notes → stop-notes pair |
| `session_title` | `String(200)` nullable | LLM-generated title for the session; denormalized for fast reads |

Existing rows (no `session_id`) keep working and will appear under an "Ungrouped" group in the UI.

Migration is **additive** and happens at startup, matching the existing pattern in `meet-mind/backend/app/database.py` (idempotent `ADD COLUMN IF NOT EXISTS`).

### 4.2 `action_items` table

No schema change. The existing `status` column (default `"pending"`) is now actually written to by the new endpoint. The string values used are `"pending"` and `"completed"` only — anything else the LLM returns is normalized to `"pending"` on insert.

## 5. Brain Service Changes (`ai-brain-orchestration`)

### 5.1 `notes_store.py` — switch to a session-aware shape

Current `NotesState`:

```python
@dataclass
class NotesState:
    active: bool
    raw_chunks: list[str]
    filtered_notes: list[dict]
    updated_at: float
```

New shape:

```python
@dataclass
class NoteSession:
    id: str               # uuid4 hex
    title: str | None     # filled in by stop()
    raw_chunks: list[str]
    filtered_notes: list[dict]
    started_at: float
    stopped_at: float | None

@dataclass
class NotesState:
    active: bool
    sessions: list[NoteSession]   # appended on each start()
    updated_at: float
```

Behavior:

- `start()` → appends a fresh `NoteSession` with a new UUID; sets `active=True`.
- `append_raw(text)` → appends to the **last** session's `raw_chunks`. If no session exists (shouldn't happen but guard anyway), creates one implicitly.
- `stop()` → seals the active session: sets `stopped_at`, runs `filter_key_points()` LLM, runs a second LLM call for `_generate_session_title()` (see 5.2), stores both on the session, sets `active=False`.
- `get_active_session()` → returns the last open session or `None`.
- Redis serialization (in `redis_client.py`) is updated to round-trip the new shape. Old in-Redis records under the previous shape are best-effort migrated on read by wrapping the existing `raw_chunks` into a single legacy session with `id="legacy"`, no title. If migration fails, fall through to an empty state — meeting still works.

### 5.2 New helper: session title generation

In `notes_agent.py`, add:

```python
def generate_session_title(llm, filtered_notes: list[dict]) -> str:
    """Return a 3-6 word title for a notes session.

    Prompt: "Given the following meeting notes, produce a short
    Title Case headline of 3 to 6 words. No punctuation. No quotes."
    """
```

Uses `MODEL_NOTES` (llama-3.1-8b-instant) for speed. Falls back to `"Notes Session"` on any error.

### 5.3 Orchestrator: extend `STOP_NOTES` and `SHOW_NOTES` routes

`orchestrator.py` — the STOP_NOTES branch:

1. Read raw chunks from the active session (unchanged).
2. Call `filter_key_points()` (unchanged).
3. **New**: call `generate_session_title()` with the filtered notes.
4. Persist title and session_id back via `NOTES_STORE.set_filtered(...)`.
5. Add `session_id` and `session_title` to the response `artifacts`:

```json
{
  "ui_event": "NOTES_CLOSE",
  "notes_state": "off",
  "artifacts": {
    "notes": [...],
    "session_id": "8c2f...",
    "session_title": "Q4 Marketing Strategy"
  }
}
```

`SHOW_NOTES` keeps its existing behavior (filtering only the active session) and **does not** generate a title — title is only minted at session close.

### 5.4 `summary_agent.py` — extend output with topics + keywords

The existing `run_summary_agent()` JSON output gets two new top-level keys:

```json
{
  "reply": "...narrative summary markdown...",
  "intent": "GET_SUMMARY",
  "actions": [],
  "topics": ["Q4 Planning", "Vision 2027", "Budget"],
  "keywords": ["marketing", "pricing", "hiring", "onboarding"]
}
```

Prompt addition:

> After the summary text, also return up to 5 short topic phrases (2-4 words each, Title Case) and up to 12 keywords (single words, lowercase). Topics are major discussion themes. Keywords are concrete nouns or named entities. Omit if the meeting was too short to extract them.

`topics` and `keywords` flow back through `summary_type: "final"` (i.e., the `/v1/summary/finalize` route) and `summary_type: "periodic"`/`"manual"` calls too. The end page only consumes the `"final"` ones.

## 6. Meet-Mind Backend Changes

### 6.1 Persist `session_id` and `session_title` on Note rows

In `_persist_ai_artifacts()` (`main.py:675-746`), the `STOP_NOTES` / `SHOW_NOTES` branch:

```python
for note in artifacts.get("notes", []):
    db.add(Note(
        meeting_id=meeting.id,
        content=note.get("text", ""),
        type=f"key_point:{note.get('section') or ''}",
        speaker_name=note.get("speaker_name"),
        session_id=artifacts.get("session_id"),
        session_title=artifacts.get("session_title"),
    ))
```

Backwards-compatible: when `session_id` is absent (older brain or pre-migration), columns stay null and the UI groups them under "Ungrouped".

### 6.2 Persist `topics` and `keywords` on the meeting

Two paths considered:

- **A.** Add `topics` / `keywords` columns to `meetings` table.
- **B.** Store them on the existing `Note` row with `type="summary:final"` as JSON inside `content`.

**Choice: A.** Cleaner queries, surfaces in PDF/email later without a regex. Migration adds two nullable columns:

| Column | Type | Purpose |
|--------|------|---------|
| `topics` | `JSON` nullable | List of strings |
| `keywords` | `JSON` nullable | List of strings |

Written by the `/api/assistant/summary/finalize` handler after a successful brain call.

### 6.3 New endpoint: toggle action item status

```
PATCH /api/meetings/{room_name}/action_items/{action_item_id}
Body: { "status": "completed" | "pending" }
Returns: { "id": ..., "status": ..., "updated_at": ... }
```

- Validates `status` is one of the two allowed values.
- Validates the action item belongs to the named meeting.
- 404 on either lookup miss, 400 on bad status.
- No auth required for Phase 1 (matches current model; JWT auth gating is out of scope).

### 6.4 Extend `/api/meetings/{room_name}/intelligence` response

Add the new fields to the existing intelligence payload (`main.py:749-828`):

```json
{
  "meeting": { ... },
  "topics": ["Q4 Planning", ...],
  "keywords": ["marketing", ...],
  "notes": [
    {"id": ..., "content": "...", "session_id": "8c2f...", "session_title": "Q4 Marketing Strategy", "created_at": "..."}
  ],
  "action_items": [
    {"id": ..., "title": "...", "assigned_to": "...", "due_date": "...", "status": "pending"}
  ],
  "transcripts": [...],
  "commands": [...],
  "decisions": [...]
}
```

Frontend groups `notes` by `session_id` client-side. Notes whose `session_id` is null are bucketed into a synthetic group `{id: "ungrouped", title: "Ungrouped"}` at the bottom.

## 7. Frontend Changes (`meet-mind/frontend`)

### 7.1 `LiveNotesPanel.tsx` (Item 1)

Single change to the scroll container's class list:

```tsx
// before
className="... max-h-56 overflow-y-auto overscroll-contain ..."

// after
className="... max-h-[50vh] overflow-y-auto overscroll-contain transition-[max-height] duration-200 ..."
```

The existing `useEffect` that scrolls to bottom on new items (lines 12-16) is kept verbatim. The `transition-[max-height]` keeps growth from feeling jumpy.

Edge case: when only one or two items are present, the container does not need to be tall. The Tailwind class chain only sets a *max*, so the container will naturally size to its content until the cap is hit.

### 7.2 `pages/MeetingEnd.tsx` (Items 8, 9, 10, 11)

Replace the current three cards (Score 85%, Notes, Insights) with five:

- **`TopicsCard`** — renders `data.topics` as pill chips (slightly larger) and `data.keywords` as smaller, muted chips. If both are empty, hide the card entirely.
- **`SummaryCard`** — renders `data.summary` as markdown using the existing `MarkdownMessage` component. No edits, no toggles — it's already a unified narrative.
- **`NotesCard`** — groups `data.notes` by `session_id`. Each group is a `<details>` element (native accordion, no extra deps) with `<summary>` showing `session_title` and time range (derived from first/last note's `created_at`). Body is a `<ul>` of points. Ungrouped notes get a final, less-prominent group.
- **`ActionItemsCard`** — list of checkbox rows. Toggling calls `api.toggleActionItem(roomName, itemId, nextStatus)` and updates local state optimistically. Completed items render at the bottom with strikethrough.
- **`TranscriptCard`** — wraps the existing transcript markdown in a `<details>` (collapsed by default).

### 7.3 `services/api.ts`

Add one method:

```ts
export const api = {
  // ...existing
  toggleActionItem: (roomName: string, itemId: string, status: "completed" | "pending") =>
    fetch(`${API_URL}/api/meetings/${roomName}/action_items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(r => r.json()),
};
```

### 7.4 `store/meetingStore.ts`

`meetingEndData` gains three fields:

```ts
meetingEndData: {
  title: string;
  duration: number;
  summary: string;
  spokenTranscript: string;
  notes: { id, content, session_id, session_title, created_at }[];
  participants: string[];
  startTime, endTime;
  // NEW
  topics: string[];
  keywords: string[];
  actionItems: { id, title, assigned_to, due_date, status }[];
} | null;
```

A small reducer `setActionItemStatus(itemId, status)` mutates `actionItems` in place for the optimistic update.

## 8. Data Flow Summaries

### 8.1 Stop notes during a meeting

```
User: "stop taking notes"
→ Frontend: POST /api/assistant/execute
→ Backend: forward to brain /v1/execute
→ Brain orchestrator: STOP_NOTES branch
   - filter_key_points()      [LLM, MODEL_NOTES]
   - generate_session_title() [LLM, MODEL_NOTES]
   - NOTES_STORE.stop()
→ Brain response artifacts: { notes, session_id, session_title }
→ Backend _persist_ai_artifacts: insert Note rows with session_id + session_title
→ Frontend: appendNoteItem locally (now tagged with session); LiveNotesPanel keeps showing
```

### 8.2 Open end page

```
Frontend MeetingEnd.tsx mounts
→ POST /api/assistant/summary/finalize
   → Backend fetches full transcript, forwards to brain /v1/summary/finalize
   → Brain SummaryAgent returns { summary, topics, keywords }
   → Backend: write topics/keywords to meetings table; insert Note(type='summary:final')
→ GET /api/meetings/{room}/intelligence
   → returns meeting + topics + keywords + notes + action_items + transcripts
→ Frontend renders 5 cards.
```

### 8.3 Toggle action item

```
User clicks checkbox
→ Frontend: optimistic store update + PATCH /api/meetings/{room}/action_items/{id}
→ Backend updates row, returns updated record
→ On 4xx/5xx: revert the optimistic update and show a toast
```

## 9. Error Handling

- **Title generation fails** in brain: log, store `session_title = "Notes Session"`, do not block STOP_NOTES.
- **Topics/keywords extraction fails**: brain returns empty arrays; frontend hides the Topics card.
- **PATCH action_items returns error**: frontend reverts optimistic state; toast "Could not update — please retry".
- **Old notes without `session_id`**: rendered in the Ungrouped accordion. No backfill job in Phase 1.
- **Redis with old NotesState shape**: best-effort migrate into a single legacy session; on failure, start fresh with empty state and log a warning. The meeting still works.

## 10. Testing

Backend (`meet-mind/backend`):
- Unit: `PATCH /action_items/{id}` happy path + 404 (wrong meeting) + 400 (bad status).
- Unit: intelligence endpoint returns `topics`, `keywords`, and groups notes correctly by `session_id`.

Brain (`ai-brain-orchestration`):
- Unit: `NoteSession` lifecycle — start adds a new session, append goes to last, stop seals it and stores title.
- Unit: `generate_session_title` returns a fallback string when LLM raises.
- Unit: `run_summary_agent` returns `topics` and `keywords` arrays in its parsed output (mock LLM).

Frontend:
- Component test: `NotesCard` renders one accordion per unique `session_id` plus an Ungrouped group when null session ids exist.
- Component test: `ActionItemsCard` toggles a checkbox, calls API, and renders completed items at the bottom with strikethrough.
- Component test: `LiveNotesPanel` grows up to its max and scrolls to the latest item.

E2E (`page2-meeting.html` style manual walkthrough):
- Start meeting → take notes → stop → take notes again → stop → end meeting → end page shows two titled note sessions + topics chips + a unified summary + checkable action items.

## 11. Migration Path

1. Deploy brain changes first (additive — new keys in responses, ignored by old backend).
2. Deploy backend migration (additive columns) and updated `_persist_ai_artifacts`.
3. Deploy frontend.

Each step is backwards-compatible: nothing breaks if a step is rolled back individually.

## 12. Open Questions

None blocking. Carry-forward to Phase 2/3:
- Auto-extracted action items (item 2) will reuse the same `action_items` table and the new PATCH endpoint.
- Whether to surface session titles inside the in-meeting `LiveNotesPanel` (Phase 1 keeps it flat there for simplicity).
