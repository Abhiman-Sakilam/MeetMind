# MeetMind API

Full stack setup (Docker, **GPU STT**, AI Brain, local dev) is in [../README.md](../README.md).

## AI Brain proxy (pattern A)

Set in `.env` (see `.env.example`):

- `AI_BRAIN_BASE_URL` — e.g. `http://127.0.0.1:8100`
- `AI_BRAIN_SERVICE_TOKEN` — optional; must match `AI_BRAIN_SERVICE_TOKEN` on [ai-brain-orchestration](../../ai-brain-orchestration) if enabled there

Endpoints:

- `GET /api/assistant/brain-health` — checks connectivity to the brain
- `POST /api/assistant/execute` — JSON body `{ user_id, room_id, user_name?, text, ... }` → forwarded to brain `POST /v1/execute`

Smoke test (brain must be running):

```bash
export AI_BRAIN_BASE_URL=http://127.0.0.1:8100
python3 scripts/test_brain_proxy.py
```
