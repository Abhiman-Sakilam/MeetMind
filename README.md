# MeetMind: A Video Call Assistant

Video calls with **Jarvis**, an AI assistant that listens, answers questions, and produces summaries, notes, and action items.

## Repository layout

| Path | What it is |
|------|------------|
| [`meet-mind/`](meet-mind/) | Meeting app: React frontend, FastAPI backend, WebRTC calls, local speech-to-text and text-to-speech |
| [`ai-brain-orchestration/`](ai-brain-orchestration/) | AI Brain: text-in / text-out agent service (LangChain + Groq) that generates Jarvis's replies |
| [`docs/`](docs/) | Architecture, goals, specs, and design plans |
| `setup.sh` / `start.sh` / `stop.sh` | One-time setup, then start / stop all services |

## How it fits together

```
User → meet-mind (speech-to-text) → text → ai-brain-orchestration (LLM) → reply text → meet-mind (text-to-speech) → user
```

## Quick start

```bash
./setup.sh   # creates .env files from the examples; then set GROQ_API_KEY in ai-brain-orchestration/.env
./start.sh   # starts the AI Brain and the MeetMind containers
./stop.sh    # stops everything
```

See [`meet-mind/README.md`](meet-mind/README.md) and [`ai-brain-orchestration/README.md`](ai-brain-orchestration/README.md) for details.
