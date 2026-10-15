# MeetMind — Changes & Feature Overview

This document summarises every backend and frontend change made to both services
(`ai-brain-orchestration` and `meet-mind`) in the current development sprint.

---

## 1. ai-brain-orchestration

### Security
- **Timing-safe token comparison** (`app/main.py`): replaced plain `==` with `hmac.compare_digest` to prevent timing-based token oracle attacks.

### REST API additions (`app/main.py`)
| Endpoint | Description |
|---|---|
| `GET /v1/transcript/{user_id}/{room_id}` | Returns the full attributed transcript for a session |
| `GET /v1/notes/{user_id}/{room_id}` | Returns the current notes state and raw chunks |
| `DELETE /v1/session/{user_id}/{room_id}` | Clears all in-memory (and Redis) state for a session |
| `POST /v1/transcribe` | Returns **501 Not Implemented** — was a stub, removed |

### Redis persistence (`app/redis_client.py` — NEW)
- Optional Redis singleton that falls back gracefully to in-memory when `REDIS_URL` is not set.
- All four stores now write-through to Redis on every mutation:
  - `transcript_store.py` — key prefix `transcript::{user_id}::{room_id}`
  - `session_store.py` — key prefix `session::{user_id}::{room_id}`
  - `notes_store.py` — key prefix `notes::{user_id}::{room_id}`
  - `screen_context_store.py` — key prefix `screen::{user_id}::{room_id}::{session_id}` (raw image bytes skipped)

### Transcript attribution (`app/transcript_store.py`)
- Added `get_attributed_transcript()` that formats segments as `[Speaker]: text\n` — used by the summary agent for better contextualised summaries.

### Intent routing hardening (`app/orchestrator.py`)
- `_normalize(text)` strips punctuation before keyword matching, eliminating false negatives on phrases like "Hey, Jarvis!"
- Keyword lists expanded to 30+ natural speech variants per intent (summarise, action items, brainstorm, decision, notes, role, screen).

### Action items webhook (`app/agents/action_items_agent.py`)
- When `TASKS_WEBHOOK_URL` is set, extracted action items are POSTed to the webhook after every run.
- LangChain tool binding (`@tool create_task`) is injected into the LLM when the webhook is configured.

### Bug fixes
- `app/agents/role_agent.py`: role hint fallback now triggers when the LLM returns an empty string (was only triggering when the key was missing).

### New configuration keys (`app/config.py`)
| Key | Default | Purpose |
|---|---|---|
| `REDIS_URL` | `""` (disabled) | Redis connection string |
| `TASKS_WEBHOOK_URL` | `""` (disabled) | Webhook endpoint for action-item delivery |

### Tests (`tests/test_agents.py` — NEW)
- 15 unit tests covering all 7 agents using a `_FakeLLM` mock that matches by `task` key in the payload JSON.
- All 15 pass with no external dependencies required.

---

## 2. meet-mind/backend

### Authentication (`app/auth.py` — NEW)
- JWT-based auth using `python-jose` + `passlib/bcrypt`.
- `create_access_token` / `decode_token` / `hash_password` / `verify_password`.
- FastAPI dependencies: `get_current_user` (raises 401) and `get_optional_user` (returns `None`).
- Auth is **opt-in** — all existing meeting routes remain public; only `/api/auth/*` and future protected routes use it.

### Auth routes (`app/main.py`)
| Endpoint | Description |
|---|---|
| `POST /api/auth/register` | Create a new user account (email + password + display name) |
| `POST /api/auth/login` | Returns JWT access token |
| `GET /api/auth/me` | Returns the authenticated user's profile |

### User model (`app/models.py`)
Added `User` table: `id`, `email` (unique, indexed), `display_name`, `hashed_password`, `created_at`.

### PDF export (`app/pdf_export.py` — NEW)
- `generate_meeting_pdf(...)` → `bytes` using `reportlab`.
- Sections: header, meeting summary, key points, action items table, decisions, transcript (first 100 segments).
- Route: `GET /api/meetings/{room_name}/export/pdf`

### Email delivery (`app/email_service.py` — NEW)
- `send_summary_email(to_addresses, room_name, title, summary, action_items, decisions)` async function.
- Builds an HTML email with a styled action-items table.
- Delivery via `aiosmtplib` using SMTP settings from `.env`.
- Route: `POST /api/meetings/{room_name}/send-summary` — body: `{ "to": ["email@example.com"] }`

### Summary persistence
- `assistant_summary_finalize` now calls `_persist_ai_artifacts` after getting the LLM result, so final summaries are stored as `Note` rows with `type="summary:final"`.

### Paginated meeting list (`app/main.py`)
`GET /api/meetings` now accepts query parameters:
| Param | Type | Description |
|---|---|---|
| `page` | int | Page number (default 1) |
| `limit` | int | Results per page (default 20, max 100) |
| `status` | str | Filter by meeting status (`active` / `ended`) |
| `from_date` | ISO date | Start of date range |
| `to_date` | ISO date | End of date range |
| `search` | str | Keyword search on room name, title, and transcript text |

### New configuration keys (`app/config.py`)
| Key | Default | Purpose |
|---|---|---|
| `SMTP_HOST` | `""` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | `""` | SMTP username |
| `SMTP_PASSWORD` | `""` | SMTP password |
| `SMTP_FROM` | `""` | From address |
| `SMTP_USE_TLS` | `true` | Enable STARTTLS |
| `JWT_SECRET` | `""` (disabled) | Random secret to enable auth |
| `JWT_ALGORITHM` | `HS256` | JWT signing algorithm |
| `JWT_EXPIRE_MINUTES` | `10080` (7 days) | Token lifetime |

### New dependencies (`requirements.txt`)
`reportlab>=4.2.0`, `aiosmtplib>=3.0.0`, `python-jose[cryptography]>=3.3.0`, `passlib[bcrypt]>=1.7.4`

---

## 3. meet-mind/frontend

### Meeting room redesign
- **Left sidebar removed**: the 280 px "MEET-MIND-SYNTHESIS" rail with Action Items / Notes / Live Transcription is gone. The layout is now 2-column: video stage + Jarvis assistant panel.
- **Video grid layout**: participants are now arranged in a responsive CSS grid instead of floating bubbles at hardcoded positions.
  - 1 participant → full frame
  - 2 participants → 2 columns
  - 3–4 participants → 2 × 2 grid
  - 5+ participants → 3-column grid (rows expand automatically)
  - Active speaker highlighted with a teal border glow.
  - Screen-share spotlight overlay preserved.

### MeetingEnd — export buttons
Two new action buttons added to the summary page nav bar:
- **Export PDF** (`FileDown` icon): downloads a PDF report generated by the backend (`GET /api/meetings/{room}/export/pdf`). Shows a spinner while loading.
- **Email Summary** (`Mail` icon): opens a modal where you enter comma-separated email addresses and click Send. Calls `POST /api/meetings/{room}/send-summary`. Shows success / error inline.

### API service additions (`services/api.ts`)
- `api.exportPdf(roomName)` → `Promise<Blob>`
- `api.sendSummaryEmail(roomName, { to: string[] })` → `Promise<{ ok: boolean }>`

---

## Quick-start checklist

### ai-brain-orchestration
```bash
pip install -r requirements.txt
# Optional: set REDIS_URL=redis://localhost:6379 in .env
uvicorn app.main:app --port 8100
```

### meet-mind/backend
```bash
pip install -r requirements.txt
# Optional: set JWT_SECRET, SMTP_* in .env for auth/email
uvicorn app.main:app --port 8000
```

### meet-mind/frontend
```bash
npm install
npm run dev   # http://localhost:5173
```
