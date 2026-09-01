"""UK presentation of dates; stored/API dates remain ISO for sorting."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")


def parse_date(value) -> date:
    if isinstance(value, datetime):
        return value.astimezone(UK_TZ).date() if value.tzinfo else value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if "/" in text:
        return datetime.strptime(text, "%d/%m/%Y").date()
    if "T" in text or " " in text:
        return parse_date(datetime.fromisoformat(text.replace("Z", "+00:00")))
    return date.fromisoformat(text)


def format_uk_date(value, missing="N/A") -> str:
    try:
        return parse_date(value).strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return missing


def format_uk_datetime(value) -> str:
    if not value:
        return "N/A"
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        # Older naive timestamps were entered in UK local time.
        dt = dt.astimezone(UK_TZ) if dt.tzinfo else dt.replace(tzinfo=UK_TZ)
        return dt.strftime("%d/%m/%Y %H:%M")
    except (TypeError, ValueError):
        return format_uk_date(value)
