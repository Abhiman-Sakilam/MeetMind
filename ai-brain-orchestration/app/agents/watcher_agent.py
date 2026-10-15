import hashlib
import json

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

WATCHER_SYSTEM_PROMPT = """You are the Jarvis Role Watcher.
Monitor a live meeting transcript chunk on behalf of a role character.

HIGH SIGNAL (respond: true):
- A key decision is being made or voted on
- A risk, assumption, or blind spot this role would catch
- A strong disagreement the role should weigh in on
- A direct question the role can answer authoritatively

LOW SIGNAL (respond: false):
- Small talk, greetings, logistics
- Recap of already-discussed topics

Sensitivity levels:
- major_only: ONLY "decision" triggers respond=true
- smart: "decision", "risk", "disagreement" trigger respond=true
- frequent: any strong assertion also triggers respond=true

Return ONLY valid JSON: {"respond": bool, "signal": "decision|risk|disagreement|assertion|null"}"""


def chunk_hash(text: str) -> str:
    return hashlib.sha256(text.strip().encode()).hexdigest()[:16]


def run_watcher_agent(
    llm: BaseChatModel,
    *,
    chunk: str,
    role_name: str,
    role_description: str,
    sensitivity: str,
) -> dict[str, object]:
    # Floor low enough that short-but-critical chunks ("Let's ship tomorrow, agreed?") still trigger.
    if len(chunk.split()) < 8:
        return {"respond": False, "signal": None}

    payload = json.dumps(
        {
            "task": "watcher",
            "transcript_chunk": chunk,
            "role_name": role_name,
            "role_description": role_description,
            "sensitivity": sensitivity,
        },
        ensure_ascii=False,
    )
    try:
        res = llm.invoke([SystemMessage(content=WATCHER_SYSTEM_PROMPT), HumanMessage(content=payload)])
        raw = res.content if isinstance(res.content, str) else "{}"
        data = json.loads(raw)
    except Exception:
        return {"respond": False, "signal": None}

    respond = bool(data.get("respond", False))
    signal = data.get("signal") or None

    # A respond=true without a valid signal cannot be trusted — and would bypass
    # the sensitivity filter below. Require a recognised signal to fire.
    if respond:
        if signal not in ("decision", "risk", "disagreement", "assertion"):
            respond = False
        elif sensitivity == "major_only" and signal != "decision":
            respond = False
        elif sensitivity == "smart" and signal not in ("decision", "risk", "disagreement"):
            respond = False

    return {"respond": respond, "signal": signal if respond else None}
