# MeetMind: A Video Call Assistant

Real-time meeting UI with WebRTC (PeerJS), signaling over WebSockets, and a FastAPI backend. Voice goes through **local speech-to-text** ([faster-whisper](https://github.com/SYSTRAN/faster-whisper) / Distil-Whisper on **NVIDIA GPU** when configured), then to an external **AI Brain** service for assistant replies.

**Recommended setup:** run the stack with Docker Compose and the GPU overlay so STT uses CUDA. CPU-only is supported but slower.

---

## Quick reference — common commands

All commands run from the `meet-mind` directory.

### First-time setup

```bash
cp .env.example .env
# Edit .env — set STT_DEVICE, AI_BRAIN_BASE_URL, etc.
```

### Start

```bash
# GPU (recommended)
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build

# CPU-only
docker compose up --build
```

### Stop

```bash
docker compose down
# or GPU overlay
docker compose -f docker-compose.yml -f docker-compose.gpu.yml down
```

### Restart (no rebuild)

```bash
docker compose up
# or GPU overlay
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up
```

### Rebuild and restart a single service

```bash
docker compose up --build backend
docker compose up --build frontend
```

### Restart individual container (no rebuild)

```bash
docker compose restart backend
docker compose restart frontend
docker compose restart db
```

### Full fresh start — wipes database and Whisper model cache

```bash
# CPU
docker compose down -v && docker compose up --build

# GPU
docker compose -f docker-compose.yml -f docker-compose.gpu.yml down -v && \
  docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

> **Note:** `-v` removes `pgdata` (all meeting data) and `hf_cache` (Whisper weights). Models re-download on next start.

### Logs

```bash
docker compose logs -f              # all services
docker compose logs -f backend      # backend only
docker compose logs -f frontend     # frontend only
docker compose logs -f db           # postgres only
```

### Status

```bash
docker compose ps

# Health endpoints
curl -s http://localhost:8000/api/health
curl -s http://localhost:8000/api/stt/status
curl -s http://localhost:8000/api/assistant/brain-health
```

---

## What you need

| Component | Role |
|-----------|------|
| **NVIDIA GPU + drivers** | GPU inference for Whisper (STT) |
| **[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)** | Pass the GPU into the backend container |
| **Docker + Docker Compose** | Postgres, backend, frontend |
| **AI Brain** ([`ai-brain-orchestration`](../ai-brain-orchestration)) | LangChain / OpenAI orchestration on port **8100** |

Optional: [Hugging Face token](https://huggingface.co/settings/tokens) (`HF_TOKEN`) for faster, more reliable first-time model downloads.

---

## 1. Host: NVIDIA GPU (required for the primary path)

1. Install a recent **NVIDIA driver** for your GPU (`nvidia-smi` should work on the host).
2. Install the **NVIDIA Container Toolkit** so Docker can use the GPU. Verify with:

```bash
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

If that fails, fix the toolkit/driver setup before continuing.

---

## 2. Configure environment (GPU STT)

From the `meet-mind` directory:

```bash
cp .env.example .env
```

Edit `.env` so speech runs on the GPU (values are passed into the backend container):

```env
STT_MODEL_NAME=distil-medium.en
STT_DEVICE=cuda
STT_COMPUTE_TYPE=float16
```

- **`distil-medium.en`** — good balance of speed and quality on GPU.
- **`distil-large-v3`** — higher quality, larger download and VRAM use.

You can use `STT_DEVICE=gpu`; the backend normalizes it to `cuda`.

Optional:

```env
HF_TOKEN=hf_xxx
AI_BRAIN_BASE_URL=http://host.docker.internal:8100
AI_BRAIN_SERVICE_TOKEN=
```

`AI_BRAIN_BASE_URL` defaults to `http://host.docker.internal:8100` in Compose so the backend container can reach the brain running on the host. If the brain runs elsewhere, set the URL accordingly.

---

## 3. Start AI Brain (on the host)

In another terminal, from the repo root (sibling of `meet-mind`):

```bash
cd ai-brain-orchestration
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Set GROQ_API_KEY (and AI_BRAIN_SERVICE_TOKEN if you use it)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8100
```

If you set `AI_BRAIN_SERVICE_TOKEN` in the brain’s `.env`, set the same value in MeetMind’s `AI_BRAIN_SERVICE_TOKEN`.

### Screen analysis (Jarvis)

Screen shots are sent to the brain as a PNG; the brain must call a **vision** Groq model (`MODEL_SCREEN`, default `llama-3.2-11b-vision-preview` in `ai-brain-orchestration/.env.example`) with a valid `GROQ_API_KEY`. The general text model cannot see pixels.

**Browser permissions:** The first time you analyze (or when you are not already screen-sharing), the browser opens a **pick a window or screen to share** dialog (`getDisplayMedia`). Choose the window that should be analyzed and allow access. If you cancel or share the wrong surface, replies may be vague or wrong. If you already started **screen share** from the meeting dock, analysis reuses that capture without a second picker.

---

## 4. Start MeetMind (Docker, GPU backend)

From `meet-mind`:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

This builds the backend from `backend/Dockerfile.gpu` (CUDA 12.4 runtime, aligned with CTranslate2 GPU inference) and attaches **all** GPUs to the backend service.

**URLs**

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:8000](http://localhost:8000)

**First run:** the Whisper weights download from Hugging Face and load into GPU memory; that can take several minutes and large models need several GB of VRAM. Backend logs will show STT progress.

---

## 5. Verify

```bash
# API up
curl -s http://localhost:8000/api/health

# STT device (after model load / warmup)
curl -s http://localhost:8000/api/stt/status

# Brain reachable from MeetMind
curl -s http://localhost:8000/api/assistant/brain-health
```

If the brain is down, the API may still be healthy while assistant features fail until `ai-brain-orchestration` is running on port 8100.

---

## CPU-only fallback (no GPU)

If you do not use `docker-compose.gpu.yml`, the default backend image is CPU-only. You can still run:

```bash
docker compose up --build
```

Use CPU-oriented settings in `.env`:

```env
STT_DEVICE=cpu
STT_COMPUTE_TYPE=int8
```

If `STT_DEVICE=cuda` is set but the container has no GPU stack, the backend **falls back to CPU** automatically so voice still works, with a log message explaining the mismatch.

---

## Local development (without Docker)

Useful for iterating on the backend or frontend alone.

**Postgres** must match `DATABASE_URL` (see `backend/.env.example`). You can run only the DB via Compose: `docker compose up db`.

**Backend**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# DATABASE_URL=...  AI_BRAIN_BASE_URL=http://127.0.0.1:8100
# GPU: STT_DEVICE=cuda  STT_COMPUTE_TYPE=float16
# CPU: STT_DEVICE=cpu   STT_COMPUTE_TYPE=int8
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

For **GPU STT on bare metal**, you need a CUDA-capable environment (NVIDIA driver; CTranslate2/faster-whisper must see CUDA). The **Docker GPU** path is the most reproducible.

**Frontend**

```bash
cd frontend
npm ci
npm run dev
```

Vite serves on [http://localhost:3000](http://localhost:3000) and proxies `/api` and `/ws` to `http://localhost:8000`.

Optional env:

- `VITE_API_URL` — API base if not same-origin
- `VITE_WS_URL` — WebSocket base (see `frontend/src/services/socket.ts`)

---

## Project layout

| Path | Purpose |
|------|---------|
| `backend/` | FastAPI, WebSockets, STT (faster-whisper), proxy to AI Brain |
| `frontend/` | React + Vite + PeerJS |
| `docker-compose.yml` | Postgres + backend + frontend (CPU backend image) |
| `docker-compose.gpu.yml` | Overrides backend to `Dockerfile.gpu` + `gpus: all` |
| `backend/README.md` | AI Brain proxy endpoints and smoke test |

---

## Troubleshooting

- **`nvidia-smi` works on host but GPU not used in container** — Rebuild with both compose files; confirm Container Toolkit and `docker run --gpus all ... nvidia-smi`.
- **CUDA load failed / falling back to CPU** — Usually CPU-only image or wrong compose file; use `docker-compose.gpu.yml` and `STT_DEVICE=cuda`.
- **502 from frontend to API** — Backend still starting, or DB unhealthy; check `docker compose logs backend`.
- **Brain errors** — Ensure `ai-brain-orchestration` listens on 8100 and `AI_BRAIN_BASE_URL` matches (host: `127.0.0.1` for local uvicorn; Docker backend: `http://host.docker.internal:8100`).
