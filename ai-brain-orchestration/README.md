# AI Brain Orchestration

Text-in / text-out agentic service for **MeetMind / Jarvis** using **LangChain + Groq**.  
**Does not** run Whisper or TTS — those live in **meet-mind** ([pattern A](../Rough/FINAL_PLAN.md)).

## Flow

```
User → meet-mind (Whisper) → text → this service (LangChain/Groq) → reply text → meet-mind (TTS) → user
```

## Setup

```bash
cd ai-brain-orchestration
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: GROQ_API_KEY, optional AI_BRAIN_SERVICE_TOKEN
uvicorn app.main:app --reload --host 0.0.0.0 --port 8100
```

Recommended model routing env defaults:

- `MODEL_GENERAL=llama-3.3-70b-versatile`
- `MODEL_ROUTER=llama-3.1-8b-instant`
- `MODEL_SUMMARY=llama-3.3-70b-versatile`
- `MODEL_NOTES=llama-3.1-8b-instant`
- `MODEL_REASONING=llama-3.3-70b-versatile`
- `MODEL_TOOL_USE=llama-3-groq-70b-tool-use`
- `MODEL_SCREEN=meta-llama/llama-4-scout-17b-16e-instruct` — **required for real screen analysis** (sends the screenshot pixels to Groq). The general text model cannot see images.

## API

- `GET /api/health` — liveness
- `POST /v1/execute` — run orchestrator (JSON body; see `app/schemas.py`)

If `AI_BRAIN_SERVICE_TOKEN` is set, clients must send:

`Authorization: Bearer <AI_BRAIN_SERVICE_TOKEN>`

## meet-mind connectivity

In **meet-mind** backend env (to add when you wire the proxy):

- `AI_BRAIN_BASE_URL=http://localhost:8100`
- `AI_BRAIN_SERVICE_TOKEN=<same as brain if set>`

Then expose e.g. `POST /api/assistant/execute` on meet-mind that forwards to `POST /v1/execute` here.

## Repo layout

| Path | Role |
|------|------|
| `app/main.py` | FastAPI app, routes |
| `app/config.py` | Settings from env |
| `app/schemas.py` | Request/response models |
| `app/orchestrator.py` | LangChain orchestration + JSON reply |
