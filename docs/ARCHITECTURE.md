# System Architecture: MeetMind + AI Brain Orchestration

## Overview

Two microservices work together to form an AI-powered meeting assistant:

| Service | Port | Role |
|---------|------|------|
| **meet-mind** (backend) | 8000 | Video/audio, STT, TTS, DB persistence, WebRTC signaling |
| **meet-mind** (frontend) | 3000 | React SPA — video grid, assistant panel, UI |
| **ai-brain-orchestration** | 8100 | LLM orchestration, intent routing, multi-agent reasoning |

---

## High-Level Connection Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          USER (Browser)                                  │
│                                                                          │
│  React 19 + PeerJS + Zustand + Tailwind CSS (Port 3000)                 │
│                                                                          │
│  ┌─────────────┐  ┌────────────────┐  ┌─────────────────────────────┐  │
│  │  VideoGrid  │  │ AssistantPanel │  │  LiveNotesPanel / Insights  │  │
│  │  (PeerJS    │  │ (Chat + Voice  │  │  (Notes, ActionItems,        │  │
│  │   WebRTC)   │  │  Input + TTS)  │  │   Decisions, Summary)       │  │
│  └─────────────┘  └───────┬────────┘  └─────────────────────────────┘  │
│                           │                                              │
└───────────────────────────┼──────────────────────────────────────────────┘
                            │ REST HTTP  /api/*
                            │ WebSocket  /ws/{room}/{user}
                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      MEET-MIND BACKEND (Port 8000)                       │
│                        FastAPI + Uvicorn                                 │
│                                                                          │
│  ┌────────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │  WebSocket     │  │  STT Engine  │  │  PostgreSQL DB             │  │
│  │  RoomManager   │  │  (Whisper)   │  │  meetings, participants,   │  │
│  │  (Signaling +  │  │  distil-     │  │  transcripts, commands,   │  │
│  │   Screen sync) │  │  medium.en   │  │  notes, action_items,     │  │
│  └────────────────┘  └──────────────┘  │  decisions                │  │
│                                         └────────────────────────────┘  │
│  ┌────────────────┐  ┌──────────────┐                                   │
│  │  TTS Engine    │  │ AssistantClient│                                  │
│  │  (Coqui TTS)   │  │ (httpx proxy) │                                  │
│  │  tts_models/   │  │               │                                  │
│  │  en/vctk/vits  │  └──────┬────────┘                                  │
│  └────────────────┘         │                                           │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │ HTTP POST  /v1/*
                              │ Bearer token auth (optional)
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│               AI BRAIN ORCHESTRATION (Port 8100)                         │
│                        FastAPI + Uvicorn                                 │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     Orchestrator                                  │   │
│  │  run_execute() → _route_intent() → dispatch to agent             │   │
│  │                                                                   │   │
│  │  ┌────────────┐ ┌─────────────┐ ┌────────────┐ ┌─────────────┐  │   │
│  │  │  Summary   │ │    Notes    │ │   Action   │ │  Decision   │  │   │
│  │  │   Agent    │ │    Agent    │ │   Items    │ │   Agent     │  │   │
│  │  └────────────┘ └─────────────┘ │   Agent    │ └─────────────┘  │   │
│  │  ┌────────────┐ ┌─────────────┐ └────────────┘ ┌─────────────┐  │   │
│  │  │ Brainstorm │ │    Role     │                 │   Watcher   │  │   │
│  │  │   Agent    │ │    Agent    │                 │   Agent     │  │   │
│  │  └────────────┘ └─────────────┘                 └─────────────┘  │   │
│  │                           ┌──────────────┐                        │   │
│  │                           │ Screen Agent │ (vision/multimodal)    │   │
│  │                           └──────────────┘                        │   │
│  └────────────────────────────────┬──────────────────────────────────┘   │
│                                   │ LangChain ChatGroq                   │
│  ┌───────────────────────────────▼──────────────────────────────────┐   │
│  │                        In-Memory Stores (optional Redis)          │   │
│  │  SessionStore · TranscriptStore · NotesStore · ScreenContextStore │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ GROQ API
                    ┌─────────────────────┐
                    │  Groq Cloud LLMs    │
                    │  llama-3.3-70b      │
                    │  llama-3.1-8b       │
                    │  llama-4-scout      │
                    │  (vision capable)   │
                    └─────────────────────┘
```

---

## Detailed Data Flow Diagrams

### 1. Voice Query Flow (End to End)

```
User speaks "Hey Jarvis, summarize the meeting so far"
│
├─► Browser (useWakeWord.ts)
│     Web Speech API detects "Hey Jarvis"
│     → switch to listen mode
│
├─► useVoiceCapture.ts
│     Records audio (MediaRecorder WebM/Opus)
│     VAD (volume threshold) auto-stops recording
│
├─► POST /api/assistant/voice/execute  (FormData: audio file)
│     ↓
│   meet-mind backend
│     └─ stt.py: faster-whisper transcribes → "summarize the meeting so far"
│     └─ DB insert: transcripts table (speaker, text, timestamp)
│     └─ assistant_client.py: forward to brain
│
├─► POST /v1/execute  (ai-brain-orchestration)
│     ExecuteRequest {
│       user_id, room_id, text="summarize the meeting so far",
│       source="voice", persona="friendly"
│     }
│     ↓
│   orchestrator.run_execute()
│     └─ append text to TranscriptStore
│     └─ retrieve SessionStore memory (last 8 turns)
│     └─ _route_intent() → "SUMMARY_NOW"
│     └─ run_summary_agent(llm=MODEL_SUMMARY, full_transcript, persona)
│         └─ Groq API: llama-3.3-70b-versatile
│         └─ returns {reply, intent, actions, ui_event="SUMMARY_CARD"}
│     └─ append to SessionStore (conversation history)
│
│   ExecuteResponse {
│     reply: "Here's what we've covered so far...",
│     intent: "GET_SUMMARY",
│     ui_event: "SUMMARY_CARD",
│     summary_type: "periodic"
│   }
│
├─► meet-mind backend
│     └─ _persist_ai_artifacts(): insert into notes/commands tables
│
└─► Frontend (useAssistantChat.ts)
      └─ Add message to assistantMessages (Zustand store)
      └─ Render as markdown in AssistantPanel
      └─ If ttsEnabled: POST /api/assistant/tts → WAV audio → play
         └─ tts.py: Coqui TTS synthesizes speech
         └─ Browser plays audio to user
```

---

### 2. Text Chat Flow

```
User types message in AssistantPanel
│
└─► POST /api/assistant/execute
      { user_id, room_id, text, session_id, persona, source="chat" }
      ↓
    Backend proxies → POST /v1/execute (brain)
      ↓
    Orchestrator routes intent:
      ┌─ BRAINSTORM      → run_brainstorm_agent()
      ├─ HELP_DECIDE     → run_decision_agent()
      ├─ ACTION_ITEMS    → run_action_items_agent()
      ├─ START_NOTES     → enable NotesStore, return reply
      ├─ STOP_NOTES      → filter_key_points(), disable NotesStore
      ├─ SHOW_NOTES      → filter_key_points(), return notes
      ├─ PLAY_ROLE       → run_role_agent() + store ActiveRole
      ├─ SCREEN_CAPTURE  → run_screen_agent() (if screenshot attached)
      ├─ SUMMARY_*       → run_summary_agent()
      └─ GENERAL         → plain LLM reply (MODEL_GENERAL)
      ↓
    ExecuteResponse → Backend → persist → Frontend renders
```

---

### 3. Meeting Lifecycle Flow

```
                    CREATE MEETING
                          │
Frontend: POST /api/meetings { title }
          ├─ DB: insert Meeting (room_name = 12-char hex UUID)
          └─ Frontend navigates → /meeting/{roomName}

                    JOIN MEETING
                          │
Frontend: POST /api/meetings/{roomName}/join { userName }
          ├─ DB: insert Participant
          └─ WebSocket connect: /ws/{roomId}/{userId}
                ↓
            Server (RoomManager)
              └─ broadcast: peer_joined { peerId, userName } to all

                    WEBRTC SETUP
                          │
Frontend A ←──────────────────────────── Frontend B
(PeerJS Peer)  WebSocket signaling  (PeerJS Peer)
    offer ──────────────────────────────► answer
    ICE candidate ◄──────────────────── ICE candidate
    ↓
  P2P audio/video stream established (bypasses server)

                    DURING MEETING
                          │
   Voice / Text ─────────────────────► AI Brain (see flows above)
   Auto-notes streaming ─────────────► POST /v1/notes/append-raw
   Screen share ──────────────────────► WebSocket sync + PeerJS stream
   Role watch (if role active) ────────► POST /v1/role/watch per chunk

                    END MEETING
                          │
Frontend: POST /api/meetings/{roomName}/end
          ├─ DB: update Meeting (status=completed, ended_at, duration)
          ├─ POST /api/assistant/summary/finalize
          │    ├─ fetch all Transcripts from DB
          │    └─ forward → POST /v1/summary/finalize (brain)
          │         └─ LLM: full meeting summary
          └─ Frontend navigates → /meeting/{roomName}/end
               └─ Display: summary, action items, decisions, PDF export
```

---

### 4. Screen Analysis Flow

```
User asks "analyze what's on screen"
│
├─► Frontend: useAssistantChat.ts
│     └─ getDisplayMedia() → user picks screen/window
│     └─ canvas.drawImage() → PNG blob → base64
│
└─► POST /api/assistant/screen/analyze
      { user_id, room_id, question, screenshot_base64, mime_type }
      ↓
    Backend proxies → POST /v1/screen/analyze (brain)
      ↓
    run_screen_agent()
      └─ Build multi-modal message: [text_content + image_url (base64)]
      └─ MODEL_SCREEN: llama-4-scout-17b-16e-instruct (vision capable)
      └─ Return {reply, intent, actions}
      ↓
    ScreenContextStore: cache image + Q&A for follow-up questions
      ↓
    Response → Frontend → render in AssistantPanel
```

---

### 5. Role Play Flow

```
User: "Act as a skeptical investor reviewing our proposal"
│
├─► POST /v1/role/set
│     { role_name="Skeptical Investor", role_description="...",
│       sensitivity="smart" }
│     ↓
│   SESSION_STORE.set_active_role()
│   ExecuteResponse { ui_event="ROLE_ACTIVATED", reply="Role active..." }
│   Frontend: RoleBubble + RoleStatusBadge shown

During meeting (auto-watch mode):
│
├─► POST /v1/role/watch (every ~10 seconds or per speech chunk)
│     { chunk = last N words of transcript }
│     ↓
│   run_watcher_agent()
│     └─ LLM: "Should [role] respond to this? (respond: bool, signal: type)"
│     └─ sensitivity "smart" → triggers on: decisions, risks, disagreements
│     └─ If respond=true:
│          └─ run_role_agent() with signal type
│          └─ ExecuteResponse { reply (in-character), ui_event="ROLE_INSIGHT" }
│          └─ Frontend: insight bubble animates in

User: "Exit role"
│
└─► POST /v1/role/exit
      SESSION_STORE.clear_active_role()
      ExecuteResponse { ui_event="ROLE_EXITED" }
```

---

## Component Architecture

### AI Brain Orchestration Internals

```
app/
├── main.py                  ← FastAPI routes (11 endpoints)
├── config.py                ← Pydantic Settings (.env)
├── schemas.py               ← Request/Response Pydantic models
├── orchestrator.py          ← Master router: run_execute()
├── personas.py              ← 6 personas (friendly/professional/witty/calm/hacker/motivator)
├── session_store.py         ← Conversation memory + active role
├── transcript_store.py      ← Full meeting speech accumulation
├── notes_store.py           ← Notes state (active flag, raw chunks, filtered)
├── screen_context_store.py  ← Screenshot + Q&A cache
├── redis_client.py          ← Optional Redis persistence (24hr TTL)
│
└── agents/
    ├── summary_agent.py     ← Generate meeting summaries (periodic/final/manual)
    ├── notes_agent.py       ← Extract and structure key points
    ├── action_items_agent.py ← Extract tasks + optional webhook POST
    ├── decision_agent.py    ← Pros/cons analysis + recommendation
    ├── brainstorm_agent.py  ← Generate 5-8 diverse ideas
    ├── role_agent.py        ← In-character role responses
    ├── screen_agent.py      ← Vision: analyze screenshots
    └── watcher_agent.py     ← Proactive role interjection decisions
```

### MeetMind Backend Internals

```
backend/app/
├── main.py                  ← FastAPI routes + WebSocket RoomManager
├── config.py                ← Pydantic Settings
├── models.py                ← SQLAlchemy ORM models
├── database.py              ← Async SQLAlchemy engine
├── assistant_client.py      ← httpx proxy to ai-brain-orchestration
├── stt.py                   ← faster-whisper (Distil-Whisper) transcription
├── tts.py                   ← Coqui TTS synthesis
├── auth.py                  ← JWT token handling
├── email_service.py         ← SMTP delivery
└── pdf_export.py            ← ReportLab PDF generation
```

### MeetMind Frontend Internals

```
frontend/src/
├── pages/
│   ├── Home.tsx             ← Create/join meeting landing
│   ├── MeetingRoom.tsx      ← Main meeting UI
│   └── MeetingEnd.tsx       ← Post-meeting summary + export
│
├── components/meeting/
│   ├── VideoGrid.tsx        ← Participant tile layout
│   ├── VideoTile.tsx        ← Individual video tile
│   ├── AssistantPanel.tsx   ← AI chat panel
│   ├── JarvisCore.tsx       ← Voice + intent orchestration
│   ├── LiveNotesPanel.tsx   ← Auto-captured notes
│   └── RoleSetupModal.tsx   ← Configure AI roles
│
├── hooks/
│   ├── useMediaStream.ts    ← Camera/microphone stream
│   ├── usePeerConnection.ts ← PeerJS WebRTC management
│   ├── useAssistantChat.ts  ← API calls + screen capture
│   ├── useVoiceCapture.ts   ← Audio recording + upload
│   ├── useWakeWord.ts       ← "Hey Jarvis" detection
│   └── useRoleMode.ts       ← Role state management
│
├── services/
│   ├── api.ts               ← HTTP REST client
│   └── socket.ts            ← WebSocket signaling client
│
└── store/
    └── meetingStore.ts      ← Zustand global state
```

---

## Intent Routing Map

```
User Input
    │
    ▼
_route_intent() in orchestrator.py
    │
    ├─ Keyword match (no LLM, instant):
    │   ├─ "start taking notes"   → START_NOTES
    │   ├─ "stop taking notes"    → STOP_NOTES
    │   ├─ "show notes"           → SHOW_NOTES
    │   ├─ "screenshot/screen"    → SCREEN_CAPTURE_ANALYZE
    │   ├─ "brainstorm/ideas"     → BRAINSTORM
    │   ├─ "help me decide"       → HELP_DECIDE
    │   ├─ "action items/tasks"   → ACTION_ITEMS
    │   ├─ "act as/play the role" → PLAY_ROLE
    │   ├─ "devil's advocate"     → DEVIL_ADVOCATE (→ RoleAgent)
    │   ├─ "exit role"            → EXIT_ROLE
    │   └─ meeting_phase=end      → SUMMARY_FINAL
    │
    └─ LLM fallback (MODEL_ROUTER = llama-3.1-8b-instant, fast):
        ├─ SUMMARY_NOW       → SummaryAgent
        ├─ SUMMARY_PERIODIC  → SummaryAgent
        └─ GENERAL           → Plain LLM reply
```

---

## LLM Model Assignment

| Model Slot | Default Model | Speed | Used For |
|-----------|---------------|-------|----------|
| MODEL_ROUTER | llama-3.1-8b-instant | Fast | Intent classification |
| MODEL_NOTES | llama-3.1-8b-instant | Fast | Key point extraction |
| MODEL_GENERAL | llama-3.3-70b-versatile | Normal | General replies |
| MODEL_SUMMARY | llama-3.3-70b-versatile | Normal | Meeting summaries |
| MODEL_REASONING | llama-3.3-70b-versatile | Normal | Brainstorm, decisions, roles |
| MODEL_TOOL_USE | llama-3-groq-70b-tool-use | Normal | Tool-calling tasks |
| MODEL_SCREEN | llama-4-scout-17b-16e-instruct | Normal | Screenshot vision analysis |

All models served via **Groq API** (high-speed inference).

---

## Database Schema (PostgreSQL)

```
users
  id (UUID PK), email (unique), display_name, hashed_password, created_at

meetings
  id (UUID PK), room_name (unique, 12-char hex), title, status, topic
  created_at, ended_at, duration_minutes

participants
  id, meeting_id (FK→meetings), name, peer_id, joined_at, left_at

transcripts
  id, meeting_id (FK), speaker_name, text, timestamp, confidence, created_at

commands
  id, meeting_id (FK), command_type, original_text, parameters (JSON)
  response, executed_at

notes
  id, meeting_id (FK), content, type, speaker_name, created_at

action_items
  id, meeting_id (FK), title, assigned_to, due_date, status, created_at

decisions
  id, meeting_id (FK), title, options (JSON), analysis, chosen_option, created_at
```

---

## Environment Configuration

### AI Brain Orchestration (Port 8100)

```
GROQ_API_KEY=gsk_...           # Required
AI_BRAIN_SERVICE_TOKEN=...     # Optional: shared secret with meet-mind
REDIS_URL=redis://...          # Optional: persistent sessions
TASKS_WEBHOOK_URL=http://...   # Optional: push action items to external system
PORT=8100
```

### MeetMind Backend (Port 8000)

```
DATABASE_URL=postgresql+asyncpg://user:pass@db:5432/meetmind
AI_BRAIN_BASE_URL=http://host.docker.internal:8100  # or http://localhost:8100
AI_BRAIN_SERVICE_TOKEN=...     # Must match brain's token if set
STT_MODEL_NAME=distil-medium.en
STT_DEVICE=cpu                 # or cuda
TTS_MODEL_NAME=tts_models/en/vctk/vits
JWT_SECRET=...                 # Optional: enables user auth
SMTP_HOST/PORT/USER/PASSWORD   # Optional: email delivery
TURN_USERNAME/CREDENTIAL       # Optional: TURN for NAT traversal
```

### MeetMind Frontend (Port 3000)

```
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

---

## Docker Deployment

```
docker-compose up
│
├─ db (postgres:16-alpine, port 5432)
│    └─ pgdata volume (persistent)
│
├─ backend (port 8000)
│    ├─ depends: db (health check)
│    ├─ hf_cache volume (Whisper model weights)
│    └─ extra_hosts: host.docker.internal → host IP
│         └─ reaches ai-brain-orchestration on host
│
└─ frontend (port 3000)
     ├─ depends: backend (health check)
     └─ nginx proxies /api/* and /ws/* to backend:8000

# ai-brain-orchestration runs separately (not in compose):
cd ai-brain-orchestration
uvicorn app.main:app --host 0.0.0.0 --port 8100
```

---

## Key Design Decisions

1. **Separation of concerns**: meet-mind owns audio/video/DB; brain owns LLM reasoning
2. **API keys isolation**: Groq key never reaches the browser — stays on brain service
3. **P2P video**: PeerJS WebRTC bypasses backend for audio/video streams (low latency)
4. **Local STT/TTS**: Whisper + Coqui run on the same machine as meet-mind (no cloud cost, private data)
5. **Stateless brain**: All session state is keyed by (user_id, room_id) — horizontally scalable
6. **Fast notes**: Raw speech appended instantly without LLM; filtered on-demand
7. **Multi-model routing**: Fast 8B model for routing/notes, 70B for reasoning/summaries
8. **Optional Redis**: Brain falls back to in-memory if Redis unavailable
9. **Persona system**: 6 switchable voices applied across all agents via system prompt injection
