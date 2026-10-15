import json
import re
import logging

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

logger = logging.getLogger(__name__)

SCREEN_SYSTEM_PROMPT_VISION = """You are Jarvis Screen Analysis Agent.
You receive a screenshot image (pixels) plus an optional user question.
Describe what you actually see: UI, text, colors, layout, obvious bugs or accessibility issues.
Answer the user's question using only what is visible in the image.
Return a single JSON object with keys:
- reply: string (helpful, grounded in the image)
- intent: string (use SCREEN_ANALYSIS)
- actions: array (usually empty)
No markdown or code fences — only raw JSON."""


def _parse_json_reply(raw: str) -> dict[str, object]:
    t = (raw or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```\s*$", "", t)
    t = t.strip()
    return json.loads(t)


def _extract_json_object(raw: str) -> dict[str, object] | None:
    t = (raw or "").strip()
    if not t:
        return None
    try:
        return _parse_json_reply(t)
    except Exception:
        pass

    start = t.find("{")
    end = t.rfind("}")
    if start != -1 and end != -1 and end > start:
        snippet = t[start : end + 1]
        try:
            return _parse_json_reply(snippet)
        except Exception:
            return None
    return None


def _coerce_model_text(content: object) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                txt = item.get("text")
                if isinstance(txt, str):
                    parts.append(txt)
        return "\n".join(p.strip() for p in parts if p and p.strip()).strip()
    return ""


SCREEN_SYSTEM_PROMPT_TEXT = """You are Jarvis Screen Analysis Agent.
No image was attached. Apologize briefly and ask the user to use Screen analysis again and allow screen/window capture when the browser prompts.
Return JSON: reply (string), intent SCREEN_ANALYSIS, actions []."""


def run_screen_agent(
    llm: BaseChatModel,
    *,
    question: str,
    mime_type: str,
    name: str,
    image_base64: str | None,
    prior_context: dict[str, str],
    persona_prompt: str = "",
) -> dict[str, object]:
    vision_system = (persona_prompt + "\n\n" + SCREEN_SYSTEM_PROMPT_VISION).strip() if persona_prompt else SCREEN_SYSTEM_PROMPT_VISION
    text_system = (persona_prompt + "\n\n" + SCREEN_SYSTEM_PROMPT_TEXT).strip() if persona_prompt else SCREEN_SYSTEM_PROMPT_TEXT
    has_image = bool(image_base64 and len(image_base64.strip()) > 200)

    if has_image:
        prior = json.dumps(prior_context or {}, ensure_ascii=False)
        text_part = (
            f"User question: {question or 'Describe this screen.'}\n"
            f"Filename hint: {name}\n"
            f"Prior context (JSON): {prior}\n"
            "Analyze the attached image and answer in JSON only."
        )
        messages = [
            SystemMessage(content=vision_system),
            HumanMessage(
                content=[
                    {"type": "text", "text": text_part},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type or 'image/png'};base64,{image_base64.strip()}",
                        },
                    },
                ]
            ),
        ]
    else:
        payload = json.dumps(
            {
                "task": "screen_analysis",
                "question": question,
                "image": {"name": name, "mime_type": mime_type, "available": False},
                "prior_context": prior_context,
            },
            ensure_ascii=False,
        )
        messages = [
            SystemMessage(content=text_system),
            HumanMessage(content=payload),
        ]

    try:
        res = llm.invoke(messages)
        raw_text = _coerce_model_text(res.content)
        data = _extract_json_object(raw_text)
        if data is None:
            # Vision models can occasionally ignore JSON formatting instructions.
            # Treat plain text as a valid answer instead of failing hard.
            data = {"reply": raw_text, "intent": "SCREEN_ANALYSIS", "actions": []}
        return {
            "reply": str(data.get("reply", "")).strip() or "I analyzed the screenshot.",
            "intent": data.get("intent") or "SCREEN_ANALYSIS",
            "actions": list(data.get("actions") or []),
        }
    except Exception as e:
        logger.exception("Screen analysis failed")
        message = str(e).strip()
        if "model_decommissioned" in message or "not found" in message.lower():
            reply = (
                "Screen analysis model is unavailable. "
                "Set MODEL_SCREEN in ai-brain-orchestration to a current Groq vision model and try again."
            )
        else:
            reply = "I had trouble analyzing the screenshot. Please try again."
        return {
            "reply": reply,
            "intent": "SCREEN_ANALYSIS",
            "actions": [],
        }
