import json

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

ROLE_SYSTEM_PROMPT = """You are Jarvis Role-Play Agent.
YOUR CHARACTER:
  Name: {role_name}
  Description: {role_description}

Stay in character for the entire response. Ground your perspective in the meeting transcript provided.

RESPONSE STRUCTURE (only when signal_type is NOT "entry"):
  1. One-line position (your character's stance on what was just said)
  2. 3-5 pointed observations specific to this moment
  3. 1-2 sharp follow-up questions you would ask as this character

If signal_type is "entry": skip the structure above and give ONLY a brief,
natural in-character self-introduction (2-3 sentences).

Return a single JSON object with keys:
- reply: your full in-character response (can be multi-paragraph)
- role: the role name (short label)
- signal_type: "decision" | "risk" | "disagreement" | "assertion" | "on-demand" | "entry"
- follow_up_questions: array of 1-3 question strings (can be empty)
- actions: array of suggested follow-up actions (can be empty)

Rules:
- Be constructive and insightful, not dismissive.
- Ground your perspective in real-world reasoning AND the transcript provided.
- If context includes "your_recent_interjections", do not repeat those points — build on them."""


def run_role_agent(
    llm: BaseChatModel,
    *,
    text: str,
    role_name: str,
    role_description: str,
    signal_type: str = "on-demand",
    context: dict[str, object],
    persona_prompt: str = "",
) -> dict[str, object]:
    formatted = ROLE_SYSTEM_PROMPT.format(role_name=role_name, role_description=role_description)
    # Character prompt comes FIRST and wins on conflict — persona is only a light
    # tone hint. (Previously persona was prepended, so e.g. "calm: use as few
    # words as possible" overrode the role's structured multi-part response.)
    if persona_prompt:
        system = (
            formatted
            + "\n\nTONE HINT (secondary — if it conflicts with your character, the character wins):\n"
            + persona_prompt
        )
    else:
        system = formatted
    payload = json.dumps(
        {
            "task": "role_play",
            "signal_type": signal_type,
            "user_text": text,
            "context": context,
        },
        ensure_ascii=False,
    )
    res = llm.invoke([SystemMessage(content=system), HumanMessage(content=payload)])
    raw = res.content if isinstance(res.content, str) else "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}
    return {
        "reply": str(data.get("reply", "")).strip() or "Here is my perspective.",
        "role": str(data.get("role", "")).strip() or role_name,
        "signal_type": str(data.get("signal_type", signal_type)).strip(),
        "follow_up_questions": list(data.get("follow_up_questions") or []),
        "actions": list(data.get("actions") or []),
    }
