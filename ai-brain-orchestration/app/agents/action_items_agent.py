import json
import logging

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool

_logger = logging.getLogger(__name__)

ACTION_ITEMS_SYSTEM_PROMPT = """You are Jarvis Action Items Agent.
Extract ALL actionable tasks from the full meeting transcript and notes provided below,
plus the user's request. Do not miss tasks mentioned anywhere in the transcript or notes.
Return a single JSON object with keys:
- reply: formatted list of action items (numbered list, human-readable)
- items: array of objects with keys: title (required), priority (required)
  Optionally include assigned_to and due_date ONLY when explicitly mentioned in the conversation.
  Omit those fields entirely when they are not clear from context.
- actions: empty array
Rules:
- Each item should be specific and actionable.
- Priority is one of: high, medium, low.
- Do NOT add "TBD", "Unknown", or placeholder values for any field.
- Keep the reply clean and concise."""


def _post_to_webhook(items: list[dict]) -> None:
    """Optionally POST action items to TASKS_WEBHOOK_URL if configured."""
    from app.config import settings
    url = (settings.tasks_webhook_url or "").strip()
    if not url or not items:
        return
    try:
        import urllib.request
        payload = json.dumps({"action_items": items}).encode()
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=5) as resp:
            _logger.info("Action items webhook responded %s", resp.status)
    except Exception as exc:
        _logger.warning("Action items webhook POST failed: %s", exc)


def _build_tool_llm(llm: BaseChatModel) -> BaseChatModel:
    """If TASKS_WEBHOOK_URL is set, return an LLM bound with a create_task tool."""
    from app.config import settings
    if not (settings.tasks_webhook_url or "").strip():
        return llm

    @tool
    def create_task(title: str, priority: str, assigned_to: str = "", due_date: str = "") -> str:
        """Create a task in the external task management system."""
        return f"Task queued: {title}"

    try:
        tool_llm = llm.bind_tools([create_task])
        return tool_llm
    except Exception:
        return llm


def run_action_items_agent(
    llm: BaseChatModel,
    *,
    text: str,
    context: dict[str, object],
    persona_prompt: str = "",
    full_transcript: str = "",
    notes_text: str = "",
) -> dict[str, object]:
    system = (persona_prompt + "\n\n" + ACTION_ITEMS_SYSTEM_PROMPT).strip() if persona_prompt else ACTION_ITEMS_SYSTEM_PROMPT
    payload = json.dumps(
        {
            "task": "extract_action_items",
            "user_text": text,
            "meeting_transcript": full_transcript[-6000:],
            "notes": notes_text[-4000:],
            "context": context,
        },
        ensure_ascii=False,
    )
    bound_llm = _build_tool_llm(llm)
    res = bound_llm.invoke([SystemMessage(content=system), HumanMessage(content=payload)])
    raw = res.content if isinstance(res.content, str) else "{}"
    data = json.loads(raw)
    items = []
    for item in (data.get("items") or []):
        if not isinstance(item, dict):
            continue
        cleaned = {k: v for k, v in item.items()
                   if v and str(v).strip().upper() not in ("TBD", "UNKNOWN", "N/A", "")}
        if cleaned.get("title"):
            items.append(cleaned)

    _post_to_webhook(items)

    return {
        "reply": str(data.get("reply", "")).strip() or "Here are the action items I identified.",
        "items": items,
        "actions": list(data.get("actions") or []),
    }
