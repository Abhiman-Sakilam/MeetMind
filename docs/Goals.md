# Architecture Analysis & Goals
> Generated: 2026-06-12 | Codebase: ai-brain-orchestration + meet-mind

---

## System Mental Model

Two separate services connected over HTTP:

```
        BROWSER  (one per attendee — gets a RANDOM userId per tab)
        • mic + camera   • "Hey Jarvis" wake-word   • silence-detect   • records audio
            │                                              │
   WebRTC   │ (video/audio/screen go browser-to-browser)   │ HTTPS REST
   peer↔peer│                                              │ (audio blob, text)
            │            ┌─────────────────────────────────▼──────────────────┐
            │   WS       │           meet-mind  BACKEND   (FastAPI)            │
            └───signaling┤  • /ws = signaling + chat relay ONLY (no audio/AI)  │
                + chat    │  • local Whisper (speech→text)  • local Coqui (TTS) │
                          │  • Postgres: meetings, ONE shared transcript/room   │
                          │  • is a THIN PROXY for everything AI ───────────────┤
                          └──────────────────────────┬──────────────────────────┘
                                                      │ HTTP (httpx + bearer token)
                                                      ▼
                          ┌───────────────────────────────────────────────────┐
                          │        ai-brain-orchestration  (FastAPI)           │
                          │  • Groq + Llama-3.x (NOT OpenAI like docs say)     │
                          │  • router → exactly ONE agent → reply              │
                          │  • memory/notes/transcript IN-MEMORY per (user,room)│
                          │  • Redis is optional and currently OFF             │
                          └───────────────────────────────────────────────────┘
```

- **meet-mind** = the meeting product (video calls, transcription, the website, Postgres). Holds **no** LLM key — just forwards AI requests.
- **ai-brain-orchestration** = "the brain." Holds the LLM key, does all thinking (summaries, action items, role-play, decisions, screen analysis).
- They connect by plain HTTP: `browser → meet-mind → brain → back`. Video/audio between people is separate (WebRTC, browser-to-browser).

**Key fact driving everything in Task 1:** the brain identifies everything by the pair `(user_id, room_id)`. Whoever sends a given `user_id` "owns" that slice of memory.

---

## Task 1 — Multi-Attendee Design (Current State)

### One-sentence answer
The **meeting** is shared (like Zoom). The **AI assistant** is private to each person. Everyone has the same features, but NOT shared AI context — each attendee has their own Jarvis that hears only their own microphone and answers only them.

### Two pipelines running simultaneously

**Pipeline A — the meeting itself (SHARED, peer-to-peer):**
- One person creates a meeting → gets a 12-character `room_name` code. Others paste that code to join the same room (`Home.tsx`, `POST /api/meetings/{room}/join`).
- Video, audio, and screen-share flow **browser-to-browser over WebRTC**. The backend only relays connection-setup messages and group text chat over the WebSocket (`main.py:1086-1230`). **No audio and no AI ever travel through the WebSocket.**
- Everyone sees: the shared video grid, who's present, the one active screen-share (single presenter, with takeover), and group chat.

**Pipeline B — the AI assistant (PRIVATE per person, over HTTP):**
- Each browser tab generates a **random `userId` on entry**: `crypto.randomUUID().slice(0,8)` (`MeetingRoom.tsx:76`).
- Each browser listens to **its own microphone only**, waits for "Hey Jarvis," detects when you stop talking, records that one clip, and POSTs it to the backend, which runs speech-to-text and forwards the text to the brain (`useVoiceCapture.ts`, `POST /api/assistant/voice/execute`).
- Brain stores all memory keyed by `session::{user_id}::{room_id}` (`session_store.py:58`). Because each attendee has a different random `user_id`, **each attendee gets a completely separate memory silo** — separate conversation history, separate role-play character, separate notes.
- Reply comes back **only to the person who asked.** Shown only in their assistant panel. Nothing broadcasts an AI answer to other attendees (WebSocket has no "AI result" message type).

This is intentional per design docs: *"listens continuously to each participant's own mic," "enforce per-user assistant isolation," "2 users in meeting; each triggers only their own bot"* (`FINAL_PLAN.md:7, 145, 422, 424`).

### Shared vs private (exact table)

| Thing | Shared across attendees? | How |
|---|---|---|
| Video / audio / screen-share | ✅ Shared | WebRTC peer-to-peer |
| Group text chat | ✅ Shared | WebSocket broadcast |
| Presence (who's here) | ✅ Shared | WebSocket join/leave |
| Live Jarvis Q&A (voice/text) | ❌ Private per person | Keyed by random per-tab `user_id` |
| Live transcript pill / insights overlay | ❌ Private per person | Rendered from each person's local state only |
| Role-play character ("act as investor") | ❌ Private per person | Per-`user_id` in the brain |
| Each person's Jarvis memory/context | ❌ Private per person | `session::{user_id}::{room_id}` |
| **End-of-meeting merged transcript & summary** | ⚠️ Shared but un-attributed | All chunks written to one Postgres transcript; **everyone labeled `"user"`** |

The last row is subtle: in the background, every attendee's speech chunks are auto-sent to `notes/append-raw`, and the backend appends them all to one shared transcript in Postgres (`useAutoNotes.ts:81` → `main.py:523-528`). At meeting end, that merged transcript is what the final summary is built from. **But there's no speaker diarization** — every line is stored as `speaker="user"` (`main.py:526`), and the brain even collapses unknown speakers to a generic `"Participant"` (`transcript_store.py:101`). The shared record exists, but it cannot say "Alice decided X, Bob disagreed."

### Current Design Limitations

1. **Identity is throwaway.** `user_id` is random per tab and regenerated on refresh. If a person refreshes mid-meeting, the brain treats them as a brand-new user — their Jarvis memory and active role-play vanish.
2. **No "who said what."** Because there's no diarization and everyone is `"user"`, the shared summary/action-items can't attribute anything to a person.
3. **No host / no roles.** Every attendee has identical powers. There is no moderator. The only per-room ownership concept is who is currently screen-sharing.
4. **No coordination between the per-person bots.** Two people asking at once = two independent LLM calls, no dedup, no shared answer.
5. **Marketing vs reality gap.** The landing copy claims screen analysis is shown "to everyone" and "all participants vote in real time" (`Home.tsx:10-12`). Neither is implemented — there's no broadcast of AI output and no voting UI at all.

---

## Task 2 — Architectural Problems to Fix

### 2A. Brain is not a multi-step agentic workflow engine (biggest gap vs stated goal)
- **Existing:** Project goal = *"multi-step agentic workflow engine."* Actual orchestrator = single-shot dispatcher: keyword-match (or small LLM) picks ONE intent, runs exactly ONE agent, returns (`orchestrator.py:98-391, 434-527`). No planner, no multi-step DAG, no agent calling another agent, no tool-execution loop.
- **Why matters:** What exists is a well-built meeting-assistant intent router, architecturally the opposite of multi-step agentic workflows. Roadmap items that depend on chained/branching workflows require this to be built.
- **Goal:** Real workflow layer — planner → ordered steps with dependencies (DAG) → tool calls → synthesis step — sitting above the existing agents (which become the "steps"). Current agents are good building blocks; just not orchestrated as a workflow yet.

### 2B. User identity is ephemeral and unauthenticated
- **Existing:** Random per-tab `user_id` (`MeetingRoom.tsx:76`); frontend never logs in, never stores or sends a token. Backend has JWT login but frontend doesn't use it.
- **Why matters:** Per-user memory is meaningless if the user key changes on every refresh. "Per-user isolation" can't be enforced if anyone can claim any `user_id`.
- **Goal:** Authenticate user, derive stable `user_id` from JWT, use that as brain key. Pass real display name through so shared transcript gets real attribution.

### 2C. Brain state is in-memory and per-process
- **Existing:** Session/notes/transcript/role state are in-process Python dicts; Redis optional and off by default (`session_store.py:55`, `redis_client.py:23`). Stale-read bug: once a worker caches a key it never re-reads Redis (`session_store.py:95-100`).
- **Why matters:** Restart = all live meeting context lost. >1 worker/replica → user's requests hit different memories → Jarvis "forgets" mid-sentence. Cannot scale horizontally.
- **Goal:** Redis (or DB) as source of truth, stateless workers, fix cache-invalidation so writes from other workers are visible.

### 2D. meet-mind WebSocket/room state is single-process
- **Existing:** `RoomManager` (live connections, screen-share owner) is in-process object (`main.py:45-108`).
- **Why matters:** >1 backend replica → attendees connected to different replicas can't see each other — meeting silently splits.
- **Goal:** Shared signaling backplane (Redis pub/sub) or sticky sessions per room.

### 2E. Two transcript stores with different keys and no single source of truth
- **Existing:** Postgres stores one transcript per room (shared, un-attributed); brain stores transcript per `(user_id, room)` (fragmented, private). Live assistant reads fragmented one; final summary reads shared one.
- **Why matters:** Confusing data ownership. Live assistant never sees the full-room conversation — only the asker's own captured speech. "Summarize what everyone just discussed" can't work live.
- **Goal:** Decide canonical transcript home; feed shared room transcript into brain as context for live queries.

### 2F. No speaker diarization (attribution discarded at ingestion)
- **Existing:** All speech stored as `speaker="user"`. Identity discarded on ingestion.
- **Goal:** At minimum pass each speaker's real name through the per-user path. Add diarization (pyannote/assemblyai) later.

### 2G. Synchronous proxy with 300s timeout
- **Existing:** meet-mind blocks on brain call with 300-second timeout (`assistant_client.py:10`). Long-held connections, no queue, no streaming.
- **Goal:** Stream responses or move long work to a task queue as load grows.

---

## Task 3 — Production-Readiness Gaps

### 🔴 3.1 Secrets on disk, barely gitignored — ACT NOW
- Real Groq API key (`gsk_Sx…`, 56 chars — confirmed real length) in `ai-brain-orchestration/.env`.
- Real HuggingFace token (`hf_IFJ…`, 37 chars) in `meet-mind/.env`.
- **Root `.gitignore` contains only `model-cache/`** — does NOT ignore `.env`. No git repo yet, so nothing committed, but `git init` at root primes both secrets to leak.
- Hardcoded TURN credentials baked literally in `docker-compose.yml:47-48`.
- `AI_BRAIN_SERVICE_TOKEN` is empty → brain auth entirely disabled (`main.py:59-61`).
- **Required actions:** Rotate Groq key and HF token (treat as already compromised). Add `.env` and `*.db` to root `.gitignore`. Move secrets to Docker secrets / deploy-time env injection. Set strong `AI_BRAIN_SERVICE_TOKEN`.

### 🔴 3.2 Authentication off by default; sensitive endpoints open — PARTIAL
- `JWT_SECRET` defaults to empty → all "optional auth" is no-op; WebSocket accepts anyone (`config.py:41`, `auth.py:62-71`).
- Endpoints driving the (paid) LLM, reading/exporting any meeting's full transcript, and sending summary emails are reachable anonymously — only need the 12-char room code (`main.py:563, 594, 692, 812, 938, 1043`).
- `Meeting` has no owner column → no membership/ownership check anywhere.
- **Goal:** Require auth, enforce meeting membership, fail closed without secrets in production.

### 🔴 3.3 No rate limiting on expensive open endpoints — MISSING
- Nothing throttles LLM/vision/TTS routes. Combined with 3.2: anyone can run up Groq bill or DoS the service. 50 MB images forwarded to vision model unthrottled.
- **Goal:** Rate limiting (slowapi) + auth on all AI routes.

### 🔴 3.4 State durability & database migrations — PARTIAL / MISSING
- Brain context in-memory → dies on every restart.
- Leftover **SQLite `meetmind.db`** (32 KB) in backend dir even though production is Postgres — must not ship.
- **No Alembic migrations.** Schema created by `create_all` plus hand-written `ALTER TABLE … IF NOT EXISTS` strings run on every startup (`database.py:17-92`). Additive-only, no versioning, no rollback.
- **Goal:** Redis-backed brain, real Alembic migrations, delete SQLite file.

### 🟠 3.5 Cannot run multiple workers/replicas — MISSING
- Both services assume single process. Brain launched as a **host process outside Docker Compose** by `start.sh:34-39` — orchestration tier isn't actually containerized in the normal run path.
- **Goal:** Shared state + run inside compose/k8s with a backplane before scaling out.

### 🟠 3.6 Observability — MISSING (health checks are the exception)
- Health checks: PRESENT and good (`/api/health` on both, compose healthchecks, brain-reachability diagnostic).
- No metrics (no Prometheus/OTel/Sentry), no structured logging, no request IDs, no way to correlate a request across browser→meet-mind→brain hop. Some logging is literally `print()` (`main.py:1235`).
- **Goal:** Structured JSON logs + request/correlation ID threaded through proxy + basic metrics + error tracking (Sentry).

### 🟠 3.7 Tests — PARTIAL
- Brain: ~80 unit tests, but LLM calls are mocked (tests logic, not model output).
- meet-mind backend: **2 tests**.
- Frontend: **zero tests**.
- **Goal:** Cover voice/execute/summary proxy paths, auth, and core frontend flows.

### 🟡 3.8 Silent error swallowing — PARTIAL
- AI-artifact DB writes wrapped so failures only logged, never surfaced — data can silently fail to persist (`main.py:807-809`).
- Router defaults to `GENERAL` on any error, hiding LLM/routing failures (`orchestrator.py:526-527`).
- Redis errors silently swallowed in all stores.
- **Goal:** Surface/alert on persistence and routing failures instead of hiding them.

### 🟡 3.9 Deployment is dev-grade — PARTIAL
- Secrets passed as plaintext `environment:`/`env_file`.
- Single-process uvicorn (no `--workers`/gunicorn).
- GPU compose always layered (requires NVIDIA toolkit).
- No TLS/reverse proxy, no resource limits, no CI/CD.
- **Goal:** Production compose/k8s with secrets, workers, TLS, resource limits.

### 🟡 3.10 CORS & doc drift — PARTIAL
- Brain CORS allows methods/headers `"*"` with credentials — tighten for prod (`main.py:47-53`).
- Docs say OpenAI/GPT-4o; code uses Groq/Llama-3.x. Not a bug, but update docs so cost/security/compliance review targets the right provider.

---

## Recommended Priority Order

| # | Item | Why first |
|---|---|---|
| 1 | Rotate secrets + fix `.gitignore` + set service token (3.1) | Do before anything touches git or ships |
| 2 | Turn on auth + enforce meeting membership + rate limit (3.2, 3.3) | Cost/abuse protection |
| 3 | Stable authenticated identity (2B) | Unlocks real per-user isolation, fixes refresh-loses-memory |
| 4 | Redis-backed brain + multi-worker safety (2C, 2D, 3.4, 3.5) | Required before any horizontal scale |
| 5 | Observability + migrations + tests (3.6, 3.4, 3.7) | Ops confidence |
| 6 | Multi-step workflow engine (2A) + room-wide context/diarization (2E, 2F) | Big roadmap items, unblocked after 1–5 |

---

## Key File References

| Area | File | Key lines |
|---|---|---|
| Random per-tab userId | `meet-mind/frontend/src/pages/MeetingRoom.tsx` | :76 |
| Brain session key | `ai-brain-orchestration/app/session_store.py` | :58 |
| Brain memory in-process | `ai-brain-orchestration/app/orchestrator.py` | :73-79 |
| Redis optional/off | `ai-brain-orchestration/app/redis_client.py` | :23 |
| Single-shot orchestrator | `ai-brain-orchestration/app/orchestrator.py` | :98-391, 434-527 |
| WS is signaling only | `meet-mind/backend/app/main.py` | :1086-1230 |
| Auth optional (no-op when JWT_SECRET empty) | `meet-mind/backend/app/auth.py` | :62-71 |
| Meeting has no owner column | `meet-mind/backend/app/models.py` | :28-47 |
| Auto-notes to shared transcript | `meet-mind/frontend/src/hooks/useAutoNotes.ts` | :81 |
| Speaker always stored as "user" | `meet-mind/backend/app/main.py` | :526 |
| AI_BRAIN_SERVICE_TOKEN empty = open | `ai-brain-orchestration/app/main.py` | :59-61 |
| 300s proxy timeout | `meet-mind/backend/app/assistant_client.py` | :10 |
| Silent artifact persist failure | `meet-mind/backend/app/main.py` | :807-809 |
| Ad-hoc schema migrations | `meet-mind/backend/app/database.py` | :17-92 |
| Groq models config | `ai-brain-orchestration/app/config.py` | :12-19 |
