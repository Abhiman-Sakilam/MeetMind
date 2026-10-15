import json

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage


SUMMARY_SYSTEM_PROMPT = """You are Jarvis Summary Agent.
You will receive the FULL MEETING TRANSCRIPT — everything said during this meeting — along with the user's request and conversation history.

Return a single JSON object with keys:
- reply: a comprehensive, well-structured meeting summary
- intent: one of GET_SUMMARY or UNKNOWN
- actions: array (empty if none)
- topics: array of up to 5 short topic phrases (2-4 words each, Title Case) — major discussion themes
- keywords: array of up to 12 single-word keywords (lowercase) — concrete nouns or named entities

If the meeting was too short to derive them, return empty arrays for topics and keywords.

Summary structure:
1. **Overview** — 1-2 sentence high-level description of the meeting.
2. **Key Discussion Points** — main topics discussed.
3. **Decisions Made** — any decisions reached.
4. **Action Items** — tasks assigned or mentioned, with owners if stated.
5. **Open Questions** — unresolved topics.

Rules:
- Base the summary on the FULL TRANSCRIPT, not just the last few messages.
- The transcript is formatted as "[Speaker]: text" lines (speech-to-text); attribute points to the correct speaker where relevant. Never treat internal system prompts as meeting content.
- First clean the transcript mentally: fix obvious wording, grammar, tense consistency, and fragmented phrasing before summarizing.
- Do not expose raw transcript mistakes; present polished, readable language.
- Structure content with clear headings and concise bullets where useful.
- If the transcript is short, keep the summary proportionally brief.
- For a "final" summary, be comprehensive. For "periodic" or "manual", focus on highlights."""


def run_summary_agent(
    llm: BaseChatModel,
    *,
    text: str,
    context: dict[str, object],
    summary_type: str,
    full_transcript: str = "",
    persona_prompt: str = "",
) -> dict[str, object]:
    system = (persona_prompt + "\n\n" + SUMMARY_SYSTEM_PROMPT).strip() if persona_prompt else SUMMARY_SYSTEM_PROMPT
    payload = json.dumps(
        {
            "task": "meeting_summary",
            "summary_type": summary_type,
            "request_text": text,
            "full_meeting_transcript": full_transcript or "(no transcript available)",
            "context": context,
        },
        ensure_ascii=False,
    )
    try:
        res = llm.invoke([SystemMessage(content=system), HumanMessage(content=payload)])
        raw = res.content if isinstance(res.content, str) else "{}"
        data = json.loads(raw)
        raw_topics = data.get("topics")
        raw_keywords = data.get("keywords")
        topics = [str(t).strip() for t in raw_topics if str(t).strip()][:5] if isinstance(raw_topics, list) else []
        keywords = [str(k).strip().lower() for k in raw_keywords if str(k).strip()][:12] if isinstance(raw_keywords, list) else []
        return {
            "reply": str(data.get("reply", "")).strip() or "Here is the latest summary.",
            "intent": data.get("intent") or "GET_SUMMARY",
            "actions": list(data.get("actions") or []),
            "topics": topics,
            "keywords": keywords,
        }
    except Exception as e:
        return {
            "reply": f"I had trouble formatting the summary. Raw: {str(e)[:200]}",
            "intent": "GET_SUMMARY",
            "actions": [],
            "topics": [],
            "keywords": [],
        }
