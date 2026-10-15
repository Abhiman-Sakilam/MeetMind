# AI Meeting Assistant — "Jarvis" — Final Plan

---

## What It Is

A video meeting platform with a built-in AI assistant that listens continuously to each participant's own mic, responds to wake-word commands ("Hey Jarvis" or "Jarvis"), analyzes shared screens, extracts action items, and generates summaries in real-time.

**Why it's valuable:** Replaces Otter.ai + Zoom + Notion into one tool. Unique because the AI can play roles (judge, investor, devil's advocate), analyze your screen, and reason about decisions — not just transcribe.

**Cost to run:** Vercel + Railway + Supabase can start on free tiers; **OpenAI usage is pay-per-token** (you provide `OPENAI_API_KEY`). Local STT/TTS avoids per-minute audio API fees.

---

## Example Session

```
Friend 1: "Hey Jarvis, start taking notes"
Jarvis: "✓ Notes recording started"

Friend 2: "Should we launch the product now or wait?"
Friend 1: "Hey Jarvis, act as an investor. What's your take?"
Jarvis: "INVESTOR PERSPECTIVE:
  - Pros: Larger TAM, faster growth potential
  - Cons: Harder customer acquisition
  - Recommendation: Validate demand first with MVP"

Friend 3: *shares screen (design mockup)*
Friend 1: "Jarvis, check the screen. What do you think?"
Jarvis: "The color palette is strong, but button contrast is low for accessibility..."

Friend 1: "Jarvis, give us a summary"
Jarvis: → Structured summary: topics, decisions, action items, next steps
```

---

## Core Tech Stack

| Layer | Primary | Alternative | Cost |
|---|---|---|---|
| Frontend | React 18 + Vite | — | Free |
| Video/Audio | PeerJS (P2P WebRTC) | Livekit (self-hosted) | Free |
| Backend | FastAPI + WebSocket | — | Free (Railway) |
| Database | PostgreSQL (Supabase) | — | Free |
| **Speech-to-Text** | **Distil-Whisper** | **Faster Whisper** | Free (local) |
| **Text-to-Speech** | **Coqui TTS — XTTS v2** | **VITS** | Free (local) |
| **AI Brain (agentic orchestration)** | **OpenAI API** (e.g. GPT-4o / GPT-4o-mini) | AWS Bedrock, Ollama | Pay-per-token (OpenAI) |
| **Vision (screen analysis)** | **OpenAI vision-capable model** (same API) | AWS Bedrock Vision, LLaVA | Pay-per-token |
| NLP | spaCy + Regex | — | Free |
| Hosting | Vercel + Railway | — | Free tier |

**Key advantage of local STT/TTS:** Distil-Whisper and XTTS v2 run locally — zero API cost per meeting for audio processing.

---

## AI Models & Techniques

### Speech-to-Text — Distil-Whisper
```
What: Distilled version of Whisper — 6x faster, same accuracy
Input: Audio stream (chunks every 5-10 seconds)
Output: Transcript text
Accuracy: ~98% (near identical to Whisper large-v3)
Cost: FREE — runs locally

Alternative: Faster Whisper
  - CTranslate2-based, 4x faster than original
  - Lower memory footprint
  - Good for CPU-only machines

Use for:
- Real-time meeting transcription
- Converting voice commands to text
```

### Text-to-Speech — Coqui TTS XTTS v2
```
What: Multi-lingual, voice-cloneable TTS model
Input: Text response from AI
Output: Natural speech audio
Quality: Near human-level
Cost: FREE — runs locally

Alternative: VITS
  - Faster inference, lighter model
  - Slightly lower quality
  - Good fallback for lower-end hardware

Use for:
- Jarvis speaks back to participants
- Natural voice responses to commands
```

### Intent & tool routing — OpenAI (agentic layer)
```
Input (after STT): "Jarvis, take notes" or flexible phrasing
         ↓
[OpenAI — function / tool calling + short session context]
         ↓
Output: intent + tool arguments + natural language reply for TTS

Regex / spaCy can supplement for cheap deterministic paths later.
```

### Named Entity Recognition — spaCy
```
Input: "John should send the report by Friday"
         ↓ [spaCy NER]
Output: {PERSON: ["John"], TASK: ["send report"], DATE: ["Friday"]}

Used for: Extract action items, identify owners, find deadlines
```

### LLM — OpenAI API (current default for AI Brain)
```
Provider: OpenAI (HTTPS API, official SDK)
Auth: OPENAI_API_KEY (server-side only — never in browser)

Recommended models (tune per cost/latency):
  - gpt-4o-mini — fast, cheap, good for routing + short replies
  - gpt-4o — stronger reasoning + vision in one model

Uses:
1. Parse flexible voice commands into intents and tool calls
2. Multi-step / follow-up dialogue within a per-user session
3. Play roles, summaries, brainstorming, decision support
4. Compose final text for Coqui XTTS

Alternative later: AWS Bedrock (Claude) if you standardize on AWS.
```

### Vision — OpenAI (multimodal)
```
Input: Screenshot of shared screen (base64 or URL per API)
Output: Feedback on design, code, document, or UI

Triggered by: "Hey Jarvis, check the screen"

Same OpenAI client as text; pick a vision-capable model (e.g. gpt-4o).
```

### Full AI Pipeline
```
My Mic Audio (continuous, local user only)
    ↓
[Wake Word Gate + VAD] — Detect "Hey Jarvis"/"Jarvis" and capture command window
    ↓
[Distil-Whisper] — Speech to text (local, free)
    ↓
[AI Brain Orchestrator — separate service/repo] — Intent parse, tool routing, multi-step follow-up
    ↓
[OpenAI API] — Reasoning, tool calls, and (when needed) vision on screenshots
    ↓
[Coqui XTTS v2] — Convert response to speech (local, free)
    ↓
[PostgreSQL] — Store transcript, commands, notes, action items
    ↓
Meeting Ends → [OpenAI via AI Brain] → Final summary + PDF export
```

---

## Supported Voice Commands

```
"Hey Jarvis, start taking notes"          → TAKE_NOTES
"Hey Jarvis, start recording"             → START_RECORDING
"Hey Jarvis, act as [role] on [topic]"   → PLAY_ROLE
"Jarvis, check the screen"               → ANALYZE_SCREEN
"Hey Jarvis, help us decide [topic]"     → HELP_DECIDE
"Hey Jarvis, brainstorm ideas for [X]"   → BRAINSTORM
"Hey Jarvis, play devil's advocate"      → DEVIL_ADVOCATE
"Hey Jarvis, give us a summary"          → GET_SUMMARY
"Hey Jarvis, create action items"        → SET_ACTION_ITEMS
"Hey Jarvis, start a vote on [topic]"    → START_VOTE
```

---

## System Architecture

**Repos (two):**
- **`meet-mind`** (`Tasks/meet-mind`) — React + FastAPI: meetings, signaling, DB, **local Distil-Whisper + Coqui XTTS**, and **proxy to AI Brain** (pattern A). Audio is transcribed and responses are spoken here; only **text** (and later images) go to the brain.
- **`ai-brain-orchestration`** (`Tasks/ai-brain-orchestration`) — FastAPI service: OpenAI agentic orchestration, tool execution, session memory. Holds **`OPENAI_API_KEY`** only here (never in the browser).

```
┌─────────────────────────────────────────────┐
│         Browser (React) — meet-mind         │
│  ┌─────────────────────────────────────┐    │
│  │ Local Voice Pipeline                │    │
│  │ - Continuous mic monitoring         │    │
│  │ - Wake word gate ("Hey Jarvis")     │    │
│  │ - VAD command capture window        │    │
│  └──────────────────┬──────────────────┘    │
│                     │                       │
│  ┌──────────────────▼───────────────────┐   │
│  │ meet-mind API client               │   │
│  │ (REST to meet-mind backend)         │   │
│  └──────────────────┬───────────────────┘   │
│                     │                       │
│  ┌──────────────────▼───────────────────┐   │
│  │   PeerJS (P2P Video/Audio)           │   │
│  └──────────────────────────────────────┘   │
└──────────────────────┬──────────────────────┘
         │ HTTPS/WS              │
         ▼                         │
┌─────────────────────────────────────────────┐
│  meet-mind FastAPI                          │
│  ┌───────────────┐  ┌────────────────────┐  │
│  │ WebSocket Hub │  │ Voice + proxy      │  │
│  │ - Signaling   │  │ - Distil-Whisper   │  │
│  │               │  │ - Coqui XTTS v2    │  │
│  │               │  │ - POST → AI Brain  │  │
│  └───────┬───────┘  └─────────┬──────────┘  │
└──────────┼────────────────────┼─────────────┘
           │                    │ HTTPS (internal)
           │ text + context     ▼
           │         ┌──────────────────────────────┐
           │         │  ai-brain-orchestration      │
           │         │  - POST /v1/execute           │
           │         │  - session: userId + roomId   │
           │         │  - OpenAI (tools / agent)     │
           │         └──────────────┬───────────────┘
           │                        │
           ▼                        ▼
┌────────────────┐    ┌──────────────────────────────┐
│ PostgreSQL     │    │ OpenAI API (hosted)           │
│ (Supabase)     │    │ (orchestration + vision)      │
└────────────────┘    └──────────────────────────────┘
```

**Data flow (pattern A, recommended):**  
`User mic → meet-mind (Whisper) → text → ai-brain-orchestration (OpenAI) → reply text → meet-mind (TTS) → user audio`

**Why Whisper/TTS on meet-mind:** One hop for audio, smaller payloads to the brain service, simpler security (brain never sees raw audio), and meet-mind stays the single entry point from the browser.

### Connectivity: meet-mind ↔ AI Brain

| Approach | Pros | Cons |
|----------|------|------|
| **A. Browser → meet-mind → AI Brain** (**locked**) | OpenAI key stays off frontend; STT/TTS co-located with user uploads; brain is text-in/text-out | meet-mind implements proxy + audio pipeline |
| **B. Browser → AI Brain directly** | Simpler meet-mind | Must expose AI Brain publicly + CORS; still never put OpenAI key in browser — use a **service API key** on AI Brain |

**Environment variables (illustrative):**
- **AI Brain repo:** `OPENAI_API_KEY`, `AI_BRAIN_SERVICE_TOKEN` (optional, if meet-mind calls with a shared secret)
- **meet-mind:** `AI_BRAIN_BASE_URL`, `AI_BRAIN_SERVICE_TOKEN` (if proxying)

**Request context every call should carry:** `userId`, `roomId`, `userName` (and optional `transcript` / `image`) so orchestration stays **per-user isolated**.

### Decisions (locked)

| Topic | Choice |
|-------|--------|
| Connectivity | **A** — browser → **meet-mind** → **ai-brain-orchestration** |
| OpenAI model | **`gpt-4o`** default (best quality for orchestration + vision); override with env e.g. `OPENAI_MODEL=gpt-4o-mini` for cheaper dev |
| Whisper + TTS | **meet-mind** (brain receives **text** only; optional image payloads later for screen analysis) |
| AI Brain repo path | **`Tasks/ai-brain-orchestration`** (sibling of `meet-mind`) |

---

## Database Schema

```sql
-- Meetings
CREATE TABLE meetings (
  id UUID PRIMARY KEY,
  room_name VARCHAR(255) UNIQUE,
  created_at TIMESTAMP,
  ended_at TIMESTAMP,
  duration_minutes INT,
  topic VARCHAR(255),
  status VARCHAR(50)   -- active, completed, archived
);

-- Participants
CREATE TABLE participants (
  id UUID PRIMARY KEY,
  meeting_id UUID REFERENCES meetings,
  name VARCHAR(255),
  joined_at TIMESTAMP,
  left_at TIMESTAMP
);

-- Transcripts (segments)
CREATE TABLE transcripts (
  id UUID PRIMARY KEY,
  meeting_id UUID REFERENCES meetings,
  speaker_name VARCHAR(255),
  text TEXT,
  timestamp FLOAT,
  confidence FLOAT,
  created_at TIMESTAMP
);

-- Commands & Responses
CREATE TABLE commands (
  id UUID PRIMARY KEY,
  meeting_id UUID REFERENCES meetings,
  command_type VARCHAR(50),
  original_text TEXT,
  parameters JSONB,
  response TEXT,
  executed_at TIMESTAMP
);

-- Notes
CREATE TABLE notes (
  id UUID PRIMARY KEY,
  meeting_id UUID REFERENCES meetings,
  content TEXT,
  type VARCHAR(50),   -- decision, action_item, key_point, question
  speaker_name VARCHAR(255),
  created_at TIMESTAMP
);

-- Action Items
CREATE TABLE action_items (
  id UUID PRIMARY KEY,
  meeting_id UUID REFERENCES meetings,
  title TEXT,
  assigned_to VARCHAR(255),
  due_date TIMESTAMP,
  status VARCHAR(50),   -- pending, completed, cancelled
  created_at TIMESTAMP
);

-- Decisions
CREATE TABLE decisions (
  id UUID PRIMARY KEY,
  meeting_id UUID REFERENCES meetings,
  title TEXT,
  options JSONB,
  analysis TEXT,
  chosen_option TEXT,
  created_at TIMESTAMP
);
```

---

## Hosting Strategy

### Phase 1 MVP — $0/month
```
Frontend:         Vercel            (free forever)
Signaling server: Railway           (free tier — 500 hrs/month)
Database:         Supabase          (free — 500MB)
Video/Audio:      PeerJS P2P        (free — no relay server)
STT:              Distil-Whisper    (local — free)
TTS:              Coqui XTTS v2     (local — free)

Supports: ~20-30 concurrent meetings
```

### Phase 2 After Validation — ~$20/month
```
Upgrade Railway to paid ($10)
Upgrade Supabase to paid ($10)
Add Redis for session caching

Supports: 50+ concurrent meetings
```

### Phase 3 Scale — $50–200/month
```
Move video to Livekit Cloud ($0.005/participant-minute)
Auto-scaling backend
Managed database

Cost scales with usage
```

---

## Cost Per Meeting (API only)

```
Distil-Whisper (STT):               FREE — local
Coqui XTTS v2 (TTS):                FREE — local
OpenAI (agentic orchestration + vision when used):
  Depends on model (e.g. gpt-4o-mini vs gpt-4o) and tokens per meeting
  Typical: small routing calls + occasional long summary → track in dashboard

Ways to reduce further:
- Default to gpt-4o-mini for routing and short replies; reserve gpt-4o for vision/heavy reasoning
- Cache idempotent tool results in Redis
- Batch or throttle screen-frame analysis

See current OpenAI pricing on https://openai.com/pricing
```

---

## Phase-by-Phase Build Plan

---

### Phase 1 — Foundation (Week 1)
> **Goal:** Basic video call works

- [ ] Init React (Vite) frontend + FastAPI backend
- [ ] Setup PostgreSQL on Supabase (free)
- [ ] Integrate PeerJS for P2P video/audio (free WebRTC)
- [ ] Build minimal WebSocket signaling server (~70 lines)
- [ ] Deploy frontend → Vercel, backend → Railway
- [ ] Test: 2 people can see and hear each other

---

### Phase 2 — AI Brain Foundation (Week 2)
> **Goal:** Separate **AI Brain** service + meet-mind voice pipeline + connectivity

- [ ] **New repository:** scaffold AI Brain service (e.g. FastAPI) — orchestration only lives here for agentic logic
  - `OPENAI_API_KEY` configured only on this service (or only on meet-mind if using proxy pattern — see architecture)
  - Endpoints e.g. `POST /v1/execute`, optional `POST /v1/transcribe`
  - `schemas`, `orchestrator`, `session_store` (per `userId` + `roomId`), `tools/` stubs
- [ ] **meet-mind:** wire connectivity (env `AI_BRAIN_BASE_URL` + optional `AI_BRAIN_SERVICE_TOKEN`)
  - thin proxy routes from meet-mind **or** documented direct client to AI Brain
- [ ] Add frontend voice pipeline hooks for continuous local mic monitoring
  - wake-word gate + VAD + command window capture
- [ ] Enforce per-user assistant isolation (every request includes `userId`, `roomId`)
- [ ] Integrate Distil-Whisper for command segments (on AI Brain or meet-mind — decide in Open decisions)
- [ ] Test: 2 users in meeting; each triggers only their own bot; AI Brain returns structured `{ intent, reply, actions }`

---

### Phase 3 — Agentic Command Execution (Week 3)
> **Goal:** AI Brain handles flexible language and executes tools

- [ ] Build MVP agentic intent router (not strict phrase matching)
  - examples: "Jarvis, take notes", "start taking notes", "can you note this?"
- [ ] Add follow-up command context per user/session (short-term memory)
- [ ] Implement tool-calling flow in orchestrator:
  - parse intent -> choose tool -> execute -> compose response
- [ ] Integrate **OpenAI API** (tool/function calling) for reasoning and ambiguous command resolution
- [ ] Persist command + action logs in PostgreSQL (meet-mind DB, or AI Brain if you centralize logging there)
- [ ] Test: "Jarvis, take notes" works without exact "Hey Jarvis, start take notes"

---

### Phase 4 — Voice Response + Screen Analysis (Week 4)
> **Goal:** Jarvis replies with natural voice and critiques shared screens

- [ ] Integrate Coqui TTS XTTS v2 in **meet-mind** for spoken replies (after brain returns text)
- [ ] Return/play TTS audio for the command owner's assistant response
- [ ] Add `getDisplayMedia()` for screen capture in browser
- [ ] Capture frames every 5 seconds when screen is shared
- [ ] Send base64 screenshot to backend on command
- [ ] Run screenshot through **OpenAI vision-capable model** for analysis
- [ ] Return feedback to all participants via WebSocket broadcast
- [ ] Handle types: design, code, document, general
- [ ] Test: "Yes Abhiman, I started taking notes" style XTTS response + screen feedback

---

### Phase 5 — Meeting Intelligence (Week 5)
> **Goal:** Full post-meeting deliverable package

- [ ] Run spaCy NER on transcript (people, dates, organizations)
- [ ] Auto-extract action items (owner, task, deadline) via OpenAI
- [ ] Add multi-command workflow support (chain tools with follow-up prompts)
- [ ] Build voting system: "Jarvis, start a vote on X"
- [ ] Generate comprehensive meeting summary at end
- [ ] Build clean summary page in React (transcript, notes, actions, decisions)
- [ ] Add PDF export via ReportLab
- [ ] Test: End a 15-min mock meeting → get full summary PDF

---

### Phase 6 — Deploy & Polish (Week 6)
> **Goal:** Live, shareable, demo-ready product

- [ ] Add simple auth (Supabase Auth or JWT)
- [ ] Handle edge cases: reconnects, empty transcripts, API timeouts
- [ ] Add assistant observability: latency, wake-word false positives, tool failure logs
- [ ] Tune wake-word sensitivity and cooldown for noisy environments
- [ ] Add meeting history dashboard (past meetings + notes)
- [ ] Add email summary delivery after meeting ends
- [ ] Performance test with 4+ concurrent participants
- [ ] Record a demo video
- [ ] Push to GitHub with README, architecture diagram, setup guide

---

## Features vs Competitors

```
Feature                    Jarvis    Otter.ai    Google Meet   Zoom
───────────────────────────────────────────────────────────────────
Video conferencing           ✅          ❌            ✅         ✅
Voice commands               ✅          ❌            ❌         ❌
Screen analysis              ✅          ❌            ❌         ❌
Decision support             ✅          ❌            ❌         ❌
Role-playing assistant       ✅          ❌            ❌         ❌
Real-time notes              ✅          ✅            ❌         ❌
Action item tracking         ✅          ✅            ❌         ❌
Meeting summary              ✅          ✅            ❌         ❌
Local STT (no API cost)      ✅          ❌            ❌         ❌
Local TTS (no API cost)      ✅          ❌            ❌         ❌
PDF export                   ✅          ❌            ❌         ❌
Open source option           ✅          ❌            ❌         ❌
```

---

## Monetization

```
Free Plan:
├─ 3 meetings/month
├─ Basic note taking
├─ No screen analysis
└─ Limited commands

Pro — $9.99/month:
├─ Unlimited meetings
├─ All commands
├─ Screen analysis
├─ Meeting summaries
└─ PDF + email export

Team — $50+/month:
├─ Everything in Pro
├─ Team dashboard
├─ Admin controls
├─ Usage analytics
└─ Priority support

Enterprise — Custom:
├─ On-premise deployment
├─ Custom voice/branding
├─ SSO integration
└─ SLA + dedicated support
```

---

## Interview Talking Points

- "Built a real-time voice-command AI assistant embedded in a video meeting"
- "Used Distil-Whisper locally — zero STT API cost, 98% accuracy"
- "Used Coqui XTTS v2 locally — zero TTS cost, near-human voice quality"
- "OpenAI API for agentic orchestration (tool calling) and vision when analyzing shared screens"
- "AI Brain as a separate deployable service, integrated with meet-mind over HTTP"
- "WebSocket infrastructure handling concurrent real-time events"
- "Full AI pipeline: STT → wake/VAD → AI Brain (OpenAI) → TTS"
- "Built on P2P WebRTC — no expensive media relay servers"

---

## Success Checklist

- [ ] Phase 1: Video call working (2+ people)
- [ ] Phase 2: Per-user wake-word isolation + AI Brain module working
- [ ] Phase 3: Flexible command understanding + tool routing working
- [ ] Phase 4: Jarvis responds with voice (XTTS v2) + screen analysis (OpenAI vision)
- [ ] Phase 5: Post-meeting summary + PDF generated
- [ ] Phase 6: Deployed + demo video + GitHub README
- [ ] Share on LinkedIn / Product Hunt
- [ ] Demo in interviews
