#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  setup.sh — One-shot bootstrap for the full MeetMind + AI Brain stack
#
#  Components:
#    1. AI Brain Orchestration  (Python/FastAPI — port 8100)
#    2. MeetMind Backend        (Python/FastAPI — port 8000)
#    3. MeetMind Frontend       (React/Vite    — port 3000)
#
#  Usage:
#    chmod +x setup.sh
#    ./setup.sh              # Interactive — prompts for mode & GPU
#    ./setup.sh --docker     # Docker mode (skip prompts)
#    ./setup.sh --local      # Local dev mode (skip prompts)
#    ./setup.sh --gpu        # Enable GPU STT (combine with above)
#    ./setup.sh --help       # Show help
#
#  Examples:
#    ./setup.sh --docker --gpu     # Docker with GPU STT
#    ./setup.sh --local            # Local dev, CPU-only
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Resolve project root (directory containing this script) ──────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

BRAIN_DIR="$PROJECT_ROOT/ai-brain-orchestration"
MEETMIND_DIR="$PROJECT_ROOT/meet-mind"
BACKEND_DIR="$MEETMIND_DIR/backend"
FRONTEND_DIR="$MEETMIND_DIR/frontend"

# ── Colors ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ── Logging helpers ──────────────────────────────────────────────────────
info()    { echo -e "${CYAN}ℹ ${RESET} $*"; }
success() { echo -e "${GREEN}✔ ${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠ ${RESET} $*"; }
error()   { echo -e "${RED}✖ ${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}━━━ $* ━━━${RESET}\n"; }
step()    { echo -e "  ${DIM}→${RESET} $*"; }

# ── Defaults ─────────────────────────────────────────────────────────────
MODE=""        # "docker" | "local"
USE_GPU=false
SKIP_PROMPTS=false

# ── Parse CLI flags ──────────────────────────────────────────────────────
show_help() {
    cat <<EOF

${BOLD}setup.sh${RESET} — Bootstrap the full MeetMind + AI Brain stack

${BOLD}USAGE${RESET}
  ./setup.sh [OPTIONS]

${BOLD}OPTIONS${RESET}
  --docker      Run MeetMind via Docker Compose (recommended)
  --local       Run all services locally (bare-metal Python + npm)
  --gpu         Enable NVIDIA GPU for STT (faster-whisper CUDA)
  --help        Show this help message

${BOLD}EXAMPLES${RESET}
  ./setup.sh                       # Interactive prompts
  ./setup.sh --docker --gpu        # Docker + GPU STT
  ./setup.sh --local               # Local dev, CPU-only

${BOLD}SERVICES${RESET}
  AI Brain Orchestration   → http://localhost:8100
  MeetMind Backend         → http://localhost:8000
  MeetMind Frontend        → http://localhost:3000

EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --docker) MODE="docker"; SKIP_PROMPTS=true; shift ;;
        --local)  MODE="local";  SKIP_PROMPTS=true; shift ;;
        --gpu)    USE_GPU=true;  shift ;;
        --help|-h) show_help ;;
        *)
            error "Unknown option: $1"
            echo "  Run ./setup.sh --help for usage."
            exit 1
            ;;
    esac
done

# ── Interactive mode selection ───────────────────────────────────────────
if [[ -z "$MODE" ]]; then
    header "MeetMind + AI Brain — Setup"
    echo -e "  ${BOLD}1)${RESET} Docker   ${DIM}(recommended — Compose manages DB, backend, frontend)${RESET}"
    echo -e "  ${BOLD}2)${RESET} Local    ${DIM}(bare-metal Python venvs + npm dev server)${RESET}"
    echo ""
    read -rp "  Choose mode [1/2]: " mode_choice
    case "$mode_choice" in
        1|docker|d) MODE="docker" ;;
        2|local|l)  MODE="local"  ;;
        *) error "Invalid choice. Exiting."; exit 1 ;;
    esac

    echo ""
    read -rp "  Enable NVIDIA GPU for STT? [y/N]: " gpu_choice
    case "$gpu_choice" in
        [yY]*) USE_GPU=true ;;
        *)     USE_GPU=false ;;
    esac
fi

# ── Prerequisite checks ─────────────────────────────────────────────────
header "Checking prerequisites"

check_cmd() {
    if command -v "$1" &>/dev/null; then
        success "$1 found → $(command -v "$1")"
        return 0
    else
        error "$1 not found"
        return 1
    fi
}

MISSING=()

# Python 3.10+
if command -v python3 &>/dev/null; then
    PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
    PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
    if [[ "$PY_MAJOR" -ge 3 && "$PY_MINOR" -ge 10 ]]; then
        success "python3 $PY_VERSION"
    else
        warn "python3 $PY_VERSION found — 3.10+ recommended"
    fi
else
    MISSING+=("python3")
fi

# pip
check_cmd pip3 || check_cmd pip || MISSING+=("pip")

if [[ "$MODE" == "docker" ]]; then
    check_cmd docker || MISSING+=("docker")
    # Check docker compose (v2 plugin)
    if docker compose version &>/dev/null 2>&1; then
        success "docker compose (plugin)"
    elif command -v docker-compose &>/dev/null; then
        success "docker-compose (standalone)"
    else
        MISSING+=("docker-compose")
    fi
fi

if [[ "$MODE" == "local" ]]; then
    check_cmd node || MISSING+=("node")
    check_cmd npm  || MISSING+=("npm")
fi

if [[ "$USE_GPU" == true ]]; then
    if command -v nvidia-smi &>/dev/null; then
        GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader,nounits 2>/dev/null | head -1)
        success "NVIDIA GPU detected → $GPU_NAME"
    else
        warn "nvidia-smi not found — GPU mode selected but no NVIDIA driver detected"
    fi
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo ""
    error "Missing required tools: ${MISSING[*]}"
    echo -e "  Install them and re-run this script."
    exit 1
fi

# ── Directory validation ────────────────────────────────────────────────
header "Validating project structure"

DIRS_OK=true
for dir in "$BRAIN_DIR" "$MEETMIND_DIR" "$BACKEND_DIR" "$FRONTEND_DIR"; do
    if [[ -d "$dir" ]]; then
        success "$(basename "$dir")/ found"
    else
        error "Missing directory: $dir"
        DIRS_OK=false
    fi
done

if [[ "$DIRS_OK" == false ]]; then
    error "Project structure incomplete. Ensure ai-brain-orchestration/ and meet-mind/ exist."
    exit 1
fi

# ═════════════════════════════════════════════════════════════════════════
#  STEP 1 — AI Brain Orchestration (.env + venv)
# ═════════════════════════════════════════════════════════════════════════
header "1/3  AI Brain Orchestration"

# ── .env scaffold ────────────────────────────────────────────────────────
if [[ ! -f "$BRAIN_DIR/.env" ]]; then
    if [[ -f "$BRAIN_DIR/.env.example" ]]; then
        cp "$BRAIN_DIR/.env.example" "$BRAIN_DIR/.env"
        success "Created ai-brain-orchestration/.env from .env.example"
        warn "Edit ai-brain-orchestration/.env → set GROQ_API_KEY"
    else
        warn "No .env.example found — creating minimal .env"
        cat > "$BRAIN_DIR/.env" <<'ENVEOF'
# Required for orchestration — get yours at https://console.groq.com
GROQ_API_KEY=gsk_your_key_here

# Model routing
MODEL_GENERAL=llama-3.3-70b-versatile
MODEL_ROUTER=llama-3.1-8b-instant
MODEL_SUMMARY=llama-3.3-70b-versatile
MODEL_NOTES=llama-3.1-8b-instant
MODEL_REASONING=llama-3.3-70b-versatile
MODEL_TOOL_USE=llama-3-groq-70b-tool-use
MODEL_SCREEN=meta-llama/llama-4-scout-17b-16e-instruct

# Optional: if set, meet-mind must send Authorization: Bearer <token>
AI_BRAIN_SERVICE_TOKEN=

# Server
HOST=0.0.0.0
PORT=8100
ENVEOF
        success "Created ai-brain-orchestration/.env"
        warn "Edit ai-brain-orchestration/.env → set GROQ_API_KEY"
    fi
else
    info "ai-brain-orchestration/.env already exists — skipping"
fi

# ── Python venv + deps ───────────────────────────────────────────────────
# Helper: ensure a venv exists and its python + pip actually work; recreate if broken.
ensure_venv() {
    local venv_dir="$1"
    if [[ -d "$venv_dir" ]]; then
        # Check both python and pip — site-packages can be corrupted even if python runs
        if "$venv_dir/bin/python" --version &>/dev/null \
           && "$venv_dir/bin/python" -m pip --version &>/dev/null; then
            info ".venv already exists and is healthy — reusing"
            return 0
        else
            warn ".venv exists but is broken (corrupted Python or pip) — recreating"
            rm -rf "$venv_dir"
        fi
    fi
    step "Creating virtual environment..."
    python3 -m venv --clear "$venv_dir"
    success "Created .venv"
}

ensure_venv "$BRAIN_DIR/.venv"

step "Installing Python dependencies..."
"$BRAIN_DIR/.venv/bin/python" -m pip install --quiet --upgrade pip
"$BRAIN_DIR/.venv/bin/python" -m pip install --quiet -r "$BRAIN_DIR/requirements.txt"
success "AI Brain dependencies installed"

# ═════════════════════════════════════════════════════════════════════════
#  STEP 2 — MeetMind Backend
# ═════════════════════════════════════════════════════════════════════════
header "2/3  MeetMind Backend"

# ── .env scaffolds ───────────────────────────────────────────────────────
# Root-level .env (for Docker Compose variable substitution)
if [[ ! -f "$MEETMIND_DIR/.env" ]]; then
    if [[ -f "$MEETMIND_DIR/.env.example" ]]; then
        cp "$MEETMIND_DIR/.env.example" "$MEETMIND_DIR/.env"
        success "Created meet-mind/.env from .env.example"
    fi
else
    info "meet-mind/.env already exists — skipping"
fi

# Backend .env (for local uvicorn dev)
if [[ ! -f "$BACKEND_DIR/.env" ]]; then
    if [[ -f "$BACKEND_DIR/.env.example" ]]; then
        cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
        success "Created meet-mind/backend/.env from .env.example"
    fi
else
    info "meet-mind/backend/.env already exists — skipping"
fi

# ── Apply GPU/CPU settings ──────────────────────────────────────────────
apply_stt_settings() {
    local envfile="$1"
    if [[ "$USE_GPU" == true ]]; then
        # GPU settings
        sed -i 's/^STT_DEVICE=.*/STT_DEVICE=cuda/' "$envfile" 2>/dev/null || true
        sed -i 's/^STT_COMPUTE_TYPE=.*/STT_COMPUTE_TYPE=float16/' "$envfile" 2>/dev/null || true
        sed -i 's/^STT_MODEL_NAME=.*/STT_MODEL_NAME=distil-large-v3/' "$envfile" 2>/dev/null || true
        step "GPU STT configured in $(basename "$(dirname "$envfile")")/$(basename "$envfile")"
    else
        # CPU settings
        sed -i 's/^STT_DEVICE=.*/STT_DEVICE=cpu/' "$envfile" 2>/dev/null || true
        sed -i 's/^STT_COMPUTE_TYPE=.*/STT_COMPUTE_TYPE=int8/' "$envfile" 2>/dev/null || true
        sed -i 's/^STT_MODEL_NAME=.*/STT_MODEL_NAME=distil-medium.en/' "$envfile" 2>/dev/null || true
        step "CPU STT configured in $(basename "$(dirname "$envfile")")/$(basename "$envfile")"
    fi
}

[[ -f "$MEETMIND_DIR/.env" ]] && apply_stt_settings "$MEETMIND_DIR/.env"
[[ -f "$BACKEND_DIR/.env" ]]  && apply_stt_settings "$BACKEND_DIR/.env"

if [[ "$MODE" == "docker" ]]; then
    # ── Docker mode — build only ─────────────────────────────────────────
    info "Docker mode — containers will be built in the launch step"
    success "Backend env files ready for Docker Compose"

elif [[ "$MODE" == "local" ]]; then
    # ── Local mode — venv + deps ─────────────────────────────────────────
    ensure_venv "$BACKEND_DIR/.venv"

    step "Installing Python dependencies (this may take a while for Whisper/TTS)..."
    "$BACKEND_DIR/.venv/bin/python" -m pip install --quiet --upgrade pip
    "$BACKEND_DIR/.venv/bin/python" -m pip install --quiet -r "$BACKEND_DIR/requirements.txt"
    success "Backend dependencies installed"

    # Check if Postgres is reachable
    if command -v pg_isready &>/dev/null; then
        if pg_isready -h localhost -p 5432 &>/dev/null; then
            success "PostgreSQL reachable on localhost:5432"
        else
            warn "PostgreSQL not reachable on localhost:5432"
            echo -e "    ${DIM}Start it manually, or run:  docker compose -f meet-mind/docker-compose.yml up db${RESET}"
        fi
    else
        info "pg_isready not found — cannot verify Postgres. Ensure it's running on :5432"
    fi
fi

# ═════════════════════════════════════════════════════════════════════════
#  STEP 3 — MeetMind Frontend
# ═════════════════════════════════════════════════════════════════════════
header "3/3  MeetMind Frontend"

if [[ "$MODE" == "docker" ]]; then
    info "Docker mode — frontend container will be built in the launch step"
    success "Frontend ready for Docker Compose"

elif [[ "$MODE" == "local" ]]; then
    step "Installing npm dependencies..."
    (cd "$FRONTEND_DIR" && npm ci --silent 2>/dev/null || npm install --silent)
    success "Frontend dependencies installed"
fi

# ═════════════════════════════════════════════════════════════════════════
#  Generate a start script
# ═════════════════════════════════════════════════════════════════════════
header "Generating start.sh"

START_SCRIPT="$PROJECT_ROOT/start.sh"

if [[ "$MODE" == "docker" ]]; then
    # ── Docker start script ──────────────────────────────────────────────
    if [[ "$USE_GPU" == true ]]; then
        COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build"
        COMPOSE_DOWN="docker compose -f docker-compose.yml -f docker-compose.gpu.yml down"
    else
        COMPOSE_CMD="docker compose up --build"
        COMPOSE_DOWN="docker compose down"
    fi

    cat > "$START_SCRIPT" <<STARTEOF
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
#  start.sh — Launch all services (generated by setup.sh)
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="\$SCRIPT_DIR/ai-brain-orchestration"
MEETMIND_DIR="\$SCRIPT_DIR/meet-mind"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

cleanup() {
    echo -e "\n\${CYAN}Shutting down...\${RESET}"
    # Stop AI Brain
    if [[ -n "\${BRAIN_PID:-}" ]]; then
        kill "\$BRAIN_PID" 2>/dev/null || true
        wait "\$BRAIN_PID" 2>/dev/null || true
        echo -e "  \${GREEN}✔\${RESET} AI Brain stopped"
    fi
    # Stop Docker Compose
    (cd "\$MEETMIND_DIR" && $COMPOSE_DOWN 2>/dev/null) || true
    echo -e "  \${GREEN}✔\${RESET} MeetMind containers stopped"
    echo -e "\${GREEN}All services stopped.\${RESET}"
}
trap cleanup EXIT INT TERM

echo -e "\${BOLD}━━━ Starting AI Brain Orchestration ━━━\${RESET}"
(
    cd "\$BRAIN_DIR"
    source .venv/bin/activate
    exec uvicorn app.main:app --host 0.0.0.0 --port 8100
) &
BRAIN_PID=\$!
echo -e "  \${GREEN}✔\${RESET} AI Brain starting on :8100  (PID \$BRAIN_PID)"

# Wait for brain to be ready
echo -e "  \${DIM}Waiting for AI Brain health check...\${RESET}"
for i in {1..30}; do
    if curl -sf http://localhost:8100/api/health >/dev/null 2>&1; then
        echo -e "  \${GREEN}✔\${RESET} AI Brain is healthy"
        break
    fi
    sleep 1
done

echo -e "\n\${BOLD}━━━ Starting MeetMind (Docker Compose) ━━━\${RESET}"
(cd "\$MEETMIND_DIR" && $COMPOSE_CMD) &
COMPOSE_PID=\$!

echo -e "\n\${BOLD}━━━ Services ━━━\${RESET}"
echo -e "  AI Brain        → \${CYAN}http://localhost:8100\${RESET}"
echo -e "  MeetMind API    → \${CYAN}http://localhost:8000\${RESET}"
echo -e "  MeetMind UI     → \${CYAN}http://localhost:3000\${RESET}"
echo -e "\n  Press \${BOLD}Ctrl+C\${RESET} to stop all services.\n"

wait \$COMPOSE_PID
STARTEOF

elif [[ "$MODE" == "local" ]]; then
    # ── Local start script ───────────────────────────────────────────────
    cat > "$START_SCRIPT" <<'STARTEOF'
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
#  start.sh — Launch all services locally (generated by setup.sh)
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="$SCRIPT_DIR/ai-brain-orchestration"
BACKEND_DIR="$SCRIPT_DIR/meet-mind/backend"
FRONTEND_DIR="$SCRIPT_DIR/meet-mind/frontend"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

PIDS=()

cleanup() {
    echo -e "\n${CYAN}Shutting down...${RESET}"
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
    done
    echo -e "${GREEN}All services stopped.${RESET}"
}
trap cleanup EXIT INT TERM

# ── 1. AI Brain Orchestration ───────────────────────────────────────────
echo -e "${BOLD}━━━ Starting AI Brain Orchestration (:8100) ━━━${RESET}"
(
    cd "$BRAIN_DIR"
    source .venv/bin/activate
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8100
) &
PIDS+=($!)
echo -e "  ${GREEN}✔${RESET} AI Brain starting (PID ${PIDS[-1]})"

# Wait for brain
echo -e "  ${DIM}Waiting for AI Brain health check...${RESET}"
for i in {1..30}; do
    if curl -sf http://localhost:8100/api/health >/dev/null 2>&1; then
        echo -e "  ${GREEN}✔${RESET} AI Brain is healthy"
        break
    fi
    sleep 1
done

# ── 2. MeetMind Backend ────────────────────────────────────────────────
echo -e "\n${BOLD}━━━ Starting MeetMind Backend (:8000) ━━━${RESET}"
(
    cd "$BACKEND_DIR"
    source .venv/bin/activate
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) &
PIDS+=($!)
echo -e "  ${GREEN}✔${RESET} Backend starting (PID ${PIDS[-1]})"

# Wait for backend
echo -e "  ${DIM}Waiting for backend health check...${RESET}"
for i in {1..30}; do
    if curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then
        echo -e "  ${GREEN}✔${RESET} Backend is healthy"
        break
    fi
    sleep 1
done

# ── 3. MeetMind Frontend ───────────────────────────────────────────────
echo -e "\n${BOLD}━━━ Starting MeetMind Frontend (:3000) ━━━${RESET}"
(
    cd "$FRONTEND_DIR"
    npm run dev
) &
PIDS+=($!)
echo -e "  ${GREEN}✔${RESET} Frontend starting (PID ${PIDS[-1]})"

# ── Summary ─────────────────────────────────────────────────────────────
echo -e "\n${BOLD}━━━ Services ━━━${RESET}"
echo -e "  AI Brain        → ${CYAN}http://localhost:8100${RESET}"
echo -e "  MeetMind API    → ${CYAN}http://localhost:8000${RESET}"
echo -e "  MeetMind UI     → ${CYAN}http://localhost:3000${RESET}"
echo -e "\n  Press ${BOLD}Ctrl+C${RESET} to stop all services.\n"

# Wait for all background processes
wait
STARTEOF
fi

chmod +x "$START_SCRIPT"
success "Created start.sh"

# ═════════════════════════════════════════════════════════════════════════
#  Generate a stop script
# ═════════════════════════════════════════════════════════════════════════
STOP_SCRIPT="$PROJECT_ROOT/stop.sh"

cat > "$STOP_SCRIPT" <<'STOPEOF'
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
#  stop.sh — Stop all running services (generated by setup.sh)
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

echo -e "${BOLD}━━━ Stopping all services ━━━${RESET}"

# Stop uvicorn processes (AI Brain + Backend)
KILLED=0
for pid in $(pgrep -f "uvicorn app.main:app" 2>/dev/null || true); do
    kill "$pid" 2>/dev/null && ((KILLED++)) || true
done
if [[ $KILLED -gt 0 ]]; then
    echo -e "  ${GREEN}✔${RESET} Stopped $KILLED uvicorn process(es)"
else
    echo -e "  ${YELLOW}⚠${RESET} No uvicorn processes found"
fi

# Stop Vite dev server
KILLED=0
for pid in $(pgrep -f "vite" 2>/dev/null || true); do
    kill "$pid" 2>/dev/null && ((KILLED++)) || true
done
if [[ $KILLED -gt 0 ]]; then
    echo -e "  ${GREEN}✔${RESET} Stopped $KILLED Vite process(es)"
fi

# Stop Docker Compose containers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEETMIND_DIR="$SCRIPT_DIR/meet-mind"

if [[ -f "$MEETMIND_DIR/docker-compose.yml" ]]; then
    if docker compose -f "$MEETMIND_DIR/docker-compose.yml" ps --quiet 2>/dev/null | grep -q .; then
        (cd "$MEETMIND_DIR" && docker compose down 2>/dev/null) || true
        echo -e "  ${GREEN}✔${RESET} Docker containers stopped"
    else
        echo -e "  ${YELLOW}⚠${RESET} No Docker containers running"
    fi
fi

echo -e "\n${GREEN}All services stopped.${RESET}"
STOPEOF

chmod +x "$STOP_SCRIPT"
success "Created stop.sh"

# ═════════════════════════════════════════════════════════════════════════
#  Summary
# ═════════════════════════════════════════════════════════════════════════
header "Setup Complete ✔"

echo -e "  ${BOLD}Mode:${RESET}  $MODE"
echo -e "  ${BOLD}GPU:${RESET}   $(if $USE_GPU; then echo 'enabled (CUDA)'; else echo 'disabled (CPU)'; fi)"
echo ""
echo -e "  ${BOLD}Generated scripts:${RESET}"
echo -e "    ./start.sh  — Launch all services"
echo -e "    ./stop.sh   — Stop all services"
echo ""

# Show any remaining action items
echo -e "  ${BOLD}Before starting, verify:${RESET}"

if grep -q "gsk_your_key_here" "$BRAIN_DIR/.env" 2>/dev/null; then
    echo -e "    ${YELLOW}⚠${RESET}  Set ${BOLD}GROQ_API_KEY${RESET} in ai-brain-orchestration/.env"
fi

if [[ "$MODE" == "local" ]]; then
    echo -e "    ${CYAN}ℹ${RESET}  PostgreSQL must be running on localhost:5432"
    echo -e "       ${DIM}Quick start:  docker compose -f meet-mind/docker-compose.yml up db${RESET}"
fi

echo ""
echo -e "  ${BOLD}Then run:${RESET}"
echo -e "    ${GREEN}./start.sh${RESET}"
echo ""
