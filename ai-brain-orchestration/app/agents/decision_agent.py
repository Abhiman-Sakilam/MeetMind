import json

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage


DECISION_SYSTEM_PROMPT = """You are Jarvis Decision Support Agent.
Help the team evaluate options and make informed decisions.
Return a single JSON object with keys:
- reply: structured analysis with pros/cons and a recommendation
- options: array of option objects [{label, pros, cons}] (can be empty if not applicable)
- recommendation: your recommended choice with rationale
- actions: array of follow-up actions (can be empty)
Rules:
- Be balanced and analytical.
- Present trade-offs clearly.
- Give a clear recommendation but acknowledge uncertainty."""


def run_decision_agent(
    llm: BaseChatModel,
    *,
    text: str,
    context: dict[str, object],
    persona_prompt: str = "",
) -> dict[str, object]:
    system = (persona_prompt + "\n\n" + DECISION_SYSTEM_PROMPT).strip() if persona_prompt else DECISION_SYSTEM_PROMPT
    payload = json.dumps(
        {
            "task": "help_decide",
            "question": text,
            "context": context,
        },
        ensure_ascii=False,
    )
    res = llm.invoke([SystemMessage(content=system), HumanMessage(content=payload)])
    raw = res.content if isinstance(res.content, str) else "{}"
    data = json.loads(raw)
    return {
        "reply": str(data.get("reply", "")).strip() or "Here is my analysis.",
        "options": list(data.get("options") or []),
        "recommendation": str(data.get("recommendation", "")).strip(),
        "actions": list(data.get("actions") or []),
    }
