"""HTTP client to ai-brain-orchestration (text-in / text-out)."""

from typing import Any

import httpx

from app.config import settings

# Shared client — reuses the connection pool across all requests to the brain service.
_client = httpx.AsyncClient(timeout=httpx.Timeout(300.0))


class AssistantBrainError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _brain_base() -> str:
    base = (settings.ai_brain_base_url or "").strip().rstrip("/")
    if not base:
        raise AssistantBrainError("AI_BRAIN_BASE_URL is not set", status_code=503)
    return base


def _auth_headers() -> dict[str, str]:
    token = (settings.ai_brain_service_token or "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


async def _request(
    method: str,
    path: str,
    *,
    timeout: float = 300.0,
    json: dict[str, Any] | None = None,
    files: dict | None = None,
    label: str = "request",
) -> dict[str, Any]:
    base = _brain_base()
    url = f"{base}{path}"
    headers = _auth_headers()
    try:
        if method == "GET":
            r = await _client.get(url, headers=headers, timeout=timeout)
        else:
            kwargs: dict[str, Any] = {"headers": headers, "timeout": timeout}
            if files:
                kwargs["files"] = files
            elif json is not None:
                kwargs["json"] = json
            r = await _client.post(url, **kwargs)
        if r.status_code >= 400:
            raise AssistantBrainError(
                f"Brain {label} failed: {r.status_code} {r.text[:500]}",
                status_code=r.status_code if r.status_code < 500 else 502,
            )
        return r.json()
    except AssistantBrainError:
        raise
    except httpx.ConnectError as e:
        raise AssistantBrainError(
            f"Cannot connect to AI Brain at {base} (is uvicorn running on port 8100?). {e}",
            status_code=503,
        ) from e
    except httpx.TimeoutException as e:
        raise AssistantBrainError(
            f"AI Brain at {base} timed out. {e}",
            status_code=504,
        ) from e


async def ping_brain() -> dict[str, Any]:
    return await _request("GET", "/api/health", timeout=10.0, label="health")


async def forward_execute(payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", "/v1/execute", json=payload, label="execute")


async def forward_summary_finalize(payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", "/v1/summary/finalize", json=payload, label="summary finalize")


async def forward_screen_analyze(payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", "/v1/screen/analyze", json=payload, label="screen analyze")


async def forward_notes_append_raw(payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", "/v1/notes/append-raw", json=payload, timeout=10.0, label="notes append-raw")


async def forward_role_set(payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", "/v1/role/set", json=payload, label="role set")


async def forward_role_exit(payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", "/v1/role/exit", json=payload, label="role exit")


async def forward_role_watch(payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", "/v1/role/watch", json=payload, timeout=30.0, label="role watch")


async def forward_role_state(user_id: str, room_id: str) -> dict[str, Any]:
    from urllib.parse import urlencode

    qs = urlencode({"user_id": user_id, "room_id": room_id})
    return await _request("GET", f"/v1/role/state?{qs}", timeout=10.0, label="role state")


