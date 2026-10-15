import re
from datetime import datetime, timedelta

_WEEKDAYS = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}


def _parse_clock(text: str) -> tuple[int, int] | None:
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", text)
    if m:
        hour = int(m.group(1)) % 12
        if m.group(3) == "pm":
            hour += 12
        return hour, int(m.group(2) or 0)
    m = re.search(r"\b(\d{1,2}):(\d{2})\b", text)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


def resolve_due_datetime(text: str, now: datetime) -> datetime | None:
    """Resolve a natural-language due date/time relative to `now`.

    Handles "today/tonight/tomorrow", weekday names, and clock times
    ("8am", "8:00", "20:00"). Returns None when no date/time is present.
    Pure: `now` is injected so results are deterministic.
    """
    low = text.lower()
    clock = _parse_clock(low)

    base_date = None
    if "tomorrow" in low:
        base_date = (now + timedelta(days=1)).date()
    elif "today" in low or "tonight" in low:
        base_date = now.date()
    else:
        for name, idx in _WEEKDAYS.items():
            if re.search(rf"\b{name}\b", low):
                delta = (idx - now.weekday()) % 7 or 7
                base_date = (now + timedelta(days=delta)).date()
                break

    if base_date is None and clock is None:
        return None

    explicit_day = base_date is not None
    if base_date is None:
        base_date = now.date()

    hour, minute = clock or (9, 0)
    dt = datetime(base_date.year, base_date.month, base_date.day, hour, minute)

    # Clock-only ("at 8am") that already passed today -> roll to tomorrow.
    if not explicit_day and clock and dt <= now:
        dt += timedelta(days=1)
    return dt
