import re
from datetime import datetime

from app.agents.date_resolver import resolve_due_datetime

# Phrases that wrap the actual task; stripped to get a clean title.
_TRIGGER_PATTERNS = [
    r"\badd (a |an )?reminder\b", r"\bcreate (a |an )?reminder\b",
    r"\bremind me to\b", r"\badd an action item\b", r"\badd action item\b",
    r"\bput\b", r"\badd\b",
    r"\bto (the )?action items\b", r"\bon (the )?action items\b",
    r"\bon (the )?list\b", r"\bto (the )?list\b", r"\bto do\b",
]
_DATE_WORDS = [
    r"\btomorrow\b", r"\btoday\b", r"\btonight\b",
    r"\bmonday\b", r"\btuesday\b", r"\bwednesday\b", r"\bthursday\b",
    r"\bfriday\b", r"\bsaturday\b", r"\bsunday\b",
    r"\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b", r"\b\d{1,2}:\d{2}\b",
    r"\b\d{1,2}\s*(am|pm)\b",
]


def _extract_title(text: str) -> str:
    t = text
    for pat in _TRIGGER_PATTERNS + _DATE_WORDS:
        t = re.sub(pat, " ", t, flags=re.IGNORECASE)
    t = re.sub(r"\s+", " ", t).strip(" ,.-")
    return t or "New action item"


def run_add_action_item_agent(text: str, now: datetime) -> dict:
    due = resolve_due_datetime(text, now)
    title = _extract_title(text)
    iso = due.isoformat() if due else None
    item = {"title": title}
    if iso:
        item["due_date"] = iso
    when = f" (due {iso})" if iso else ""
    return {
        "title": title,
        "due_date": iso,
        "items": [item],
        "reply": f"Added to action items: {title}{when}.",
    }
