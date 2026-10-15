import json

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage


BRAINSTORM_SYSTEM_PROMPT = """You are Jarvis Brainstorm Agent.
Help the team generate creative ideas around the given topic.
Return a single JSON object with keys:
- reply: a numbered list of 5-8 diverse ideas with one-sentence descriptions
- actions: array of follow-up actions (can be empty)
Rules:
- Be creative but grounded.
- Range from safe bets to bold experiments.
- Keep each idea concise (one sentence + optional sub-bullet)."""


def run_brainstorm_agent(
    llm: BaseChatModel,
    *,
    text: str,
    context: dict[str, object],
    persona_prompt: str = "",
) -> dict[str, object]:
    system = (persona_prompt + "\n\n" + BRAINSTORM_SYSTEM_PROMPT).strip() if persona_prompt else BRAINSTORM_SYSTEM_PROMPT
    payload = json.dumps(
        {
            "task": "brainstorm",
            "topic": text,
            "context": context,
        },
        ensure_ascii=False,
    )
    res = llm.invoke([SystemMessage(content=system), HumanMessage(content=payload)])
    raw = res.content if isinstance(res.content, str) else "{}"
    data = json.loads(raw)
    return {
        "reply": str(data.get("reply", "")).strip() or "Here are some ideas.",
        "actions": list(data.get("actions") or []),
    }
