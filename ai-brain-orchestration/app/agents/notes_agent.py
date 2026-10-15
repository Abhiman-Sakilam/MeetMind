import json
import logging
from time import time

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

logger = logging.getLogger(__name__)

FILTER_NOTES_PROMPT = """You are Jarvis Notes Agent.
You will receive a RAW TRANSCRIPT of everything a user said during a meeting while note-taking mode was active.
Your job: extract the key points and important information, grouped by topic.

Return a JSON object with a single key "sections" — an array of objects, each with:
- "heading": short topic label (2-6 words)
- "points": array of clear, grammatically-correct sentences capturing the key points for that topic

Rules:
- Group related points under a common heading.
- Extract ONLY meaningful points: decisions, facts, ideas, action items, important statements.
- Skip filler words, repeated thoughts, and casual chatter.
- Correct grammar and make each point a clean, standalone sentence.
- Deduplicate: if the same idea is repeated, keep only the best version.
- If the transcript is empty or has no meaningful content, return {"sections": []}.
- Do NOT include markdown, code fences, or extra keys."""


def _extract_text_from_item(item: dict) -> tuple[str, str]:
    """Flexibly extract title and text from an LLM-returned note item,
    handling various key name variations."""
    title = ""
    text = ""
    for k in ("title", "topic", "heading", "label", "category"):
        v = str(item.get(k, "")).strip()
        if v:
            title = v
            break
    for k in ("text", "note", "content", "point", "description", "summary", "body"):
        v = str(item.get(k, "")).strip()
        if v:
            text = v
            break
    if not text:
        vals = [str(v).strip() for v in item.values() if isinstance(v, str) and len(str(v).strip()) > 10]
        if vals:
            text = vals[0]
    return title, text


def filter_key_points(llm: BaseChatModel, raw_transcript: str, persona_prompt: str = "") -> list[dict[str, str | float]]:
    """Run LLM over the full raw transcript to extract key points grouped by section.
    Called only on stop/show — not per-chunk."""
    if not raw_transcript.strip():
        return []

    system = (persona_prompt + "\n\n" + FILTER_NOTES_PROMPT).strip() if persona_prompt else FILTER_NOTES_PROMPT
    payload = json.dumps({"raw_transcript": raw_transcript}, ensure_ascii=False)
    try:
        res = llm.invoke([
            SystemMessage(content=system),
            HumanMessage(content=payload),
        ])
        raw_content = res.content if isinstance(res.content, str) else "{}"
        logger.debug("filter_key_points LLM response: %s", raw_content[:500])
        data = json.loads(raw_content)

        result: list[dict[str, str | float]] = []
        now = time()

        sections = data.get("sections") or []
        if isinstance(sections, dict):
            sections = [sections]

        if sections:
            for section in sections:
                if not isinstance(section, dict):
                    continue
                heading = str(section.get("heading", "")).strip()
                points = section.get("points") or []
                if isinstance(points, str):
                    points = [points]
                for pt in points:
                    text = str(pt).strip() if isinstance(pt, str) else ""
                    if not text and isinstance(pt, dict):
                        _, text = _extract_text_from_item(pt)
                    if text:
                        result.append({"text": text, "section": heading, "ts": now})

        if not result:
            notes_raw = data.get("notes") or data.get("key_points") or data.get("points") or []
            if isinstance(notes_raw, dict):
                notes_raw = [notes_raw]
            for item in notes_raw:
                if not isinstance(item, dict):
                    if isinstance(item, str) and item.strip():
                        result.append({"text": item.strip(), "section": "", "ts": now})
                    continue
                title, text = _extract_text_from_item(item)
                if title and text:
                    result.append({"text": text, "section": title, "ts": now})
                elif text:
                    result.append({"text": text, "section": "", "ts": now})

        if not result and raw_transcript.strip():
            logger.warning("filter_key_points returned empty despite non-empty transcript, using raw fallback")
            sentences = [s.strip() for s in raw_transcript.replace(".", ".\n").split("\n") if len(s.strip()) > 15]
            for s in sentences[:20]:
                result.append({"text": s, "section": "", "ts": now})

        return result
    except Exception:
        logger.exception("filter_key_points failed, returning raw as fallback")
        sentences = [s.strip() for s in raw_transcript.split(".") if len(s.strip()) > 10]
        now = time()
        return [{"text": s + ".", "section": "", "ts": now} for s in sentences[:20]] if sentences else [{"text": raw_transcript[:500], "section": "", "ts": now}]


SESSION_TITLE_PROMPT = """You are titling a single block of meeting notes.

Given a JSON array of note points, return a JSON object {"title": "..."} where
the title is a short Title Case headline of 3 to 6 words that names the topic.

Rules:
- No punctuation, no quotes, no markdown.
- Capitalize main words.
- Never return more than 6 words."""


def generate_session_title(llm: BaseChatModel, filtered_notes: list[dict[str, str | float]]) -> str:
    """Return a 3-6 word title for a notes session. Falls back to 'Notes Session' on any error."""
    if not filtered_notes:
        return "Notes Session"

    payload = json.dumps({"notes": filtered_notes}, ensure_ascii=False)
    try:
        res = llm.invoke([
            SystemMessage(content=SESSION_TITLE_PROMPT),
            HumanMessage(content=payload),
        ])
        raw = res.content if isinstance(res.content, str) else "{}"
        data = json.loads(raw)
        title = str(data.get("title", "")).strip().strip('"').strip("'").rstrip(".")
        if not title:
            return "Notes Session"
        # Hard cap at 6 words
        return " ".join(title.split()[:6])
    except Exception:
        logger.exception("generate_session_title failed; using fallback")
        return "Notes Session"
