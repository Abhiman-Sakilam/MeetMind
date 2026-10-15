#!/usr/bin/env python3
"""Smoke test: meet-mind assistant_client → ai-brain-orchestration.

Usage (from repo root or this directory):
  AI_BRAIN_BASE_URL=http://127.0.0.1:8100 python3 scripts/test_brain_proxy.py

Optional: set AI_BRAIN_SERVICE_TOKEN if the brain requires it.
"""

from __future__ import annotations

import asyncio
import os
import sys

# Run from backend/: app imports resolve
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


async def main() -> None:
    if not os.environ.get("AI_BRAIN_BASE_URL"):
        print("Set AI_BRAIN_BASE_URL, e.g. http://127.0.0.1:8100", file=sys.stderr)
        sys.exit(1)

    from app.assistant_client import AssistantBrainError, forward_execute, ping_brain

    try:
        print("brain health:", await ping_brain())
    except AssistantBrainError as e:
        print("brain health failed:", e, file=sys.stderr)
        sys.exit(1)

    try:
        out = await forward_execute(
            {
                "user_id": "script-user",
                "room_id": "script-room",
                "user_name": "Script",
                "text": "Reply with exactly: proxy_ok",
            }
        )
        print("execute:", out)
    except AssistantBrainError as e:
        print("execute failed:", e, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
