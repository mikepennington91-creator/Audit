import re

from date_formats import parse_date


def notice_filename(record: dict) -> str:
    kind = "Disposal" if record.get("notice_type") == "disposal" else "Hold"
    try:
        day = parse_date(record.get("event_date")).strftime("%d%m%y")
    except (TypeError, ValueError):
        day = "undated"
    # Safe for HTTP headers, email attachments and Windows filenames.
    reference = re.sub(r"[^A-Za-z0-9 _-]+", "-", str(record.get("reference") or ""))
    reference = reference.strip(" -")[:80] or "notice"
    return f"{kind} - {day} - {reference}.pdf"
