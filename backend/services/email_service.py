"""Email delivery for Infinit Audit.

SMTP is deliberately configuration-driven so the application can ship before
mailbox credentials are enabled.  Callers receive False when email is not yet
configured and can safely retry later.
"""

from __future__ import annotations

import asyncio
import os
import smtplib
from email.message import EmailMessage
from typing import Iterable, Optional


def email_configured() -> bool:
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM_EMAIL"))


def _as_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _send_sync(
    *,
    recipients: Iterable[str],
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
    attachment: Optional[bytes] = None,
    attachment_name: Optional[str] = None,
    attachment_type: str = "application/octet-stream",
) -> bool:
    host = os.environ.get("SMTP_HOST")
    from_email = os.environ.get("SMTP_FROM_EMAIL")
    if not host or not from_email:
        return False

    recipients = [address.strip() for address in recipients if address and address.strip()]
    if not recipients:
        return False

    port = int(os.environ.get("SMTP_PORT", "587"))
    username = os.environ.get("SMTP_USERNAME")
    password = os.environ.get("SMTP_PASSWORD")
    use_ssl = _as_bool("SMTP_USE_SSL", port == 465)
    use_starttls = _as_bool("SMTP_USE_STARTTLS", not use_ssl)
    from_name = os.environ.get("SMTP_FROM_NAME", "Infinit Audit")

    message = EmailMessage()
    message["From"] = f"{from_name} <{from_email}>"
    message["To"] = ", ".join(recipients)
    message["Subject"] = subject
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    if attachment is not None:
        maintype, subtype = (attachment_type.split("/", 1) + ["octet-stream"])[:2]
        message.add_attachment(
            attachment,
            maintype=maintype,
            subtype=subtype,
            filename=attachment_name or "attachment",
        )

    smtp_cls = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
    with smtp_cls(host, port, timeout=20) as smtp:
        if not use_ssl and use_starttls:
            smtp.starttls()
        if username:
            smtp.login(username, password or "")
        smtp.send_message(message)
    return True


async def send_email(**kwargs) -> bool:
    """Send email without blocking FastAPI's event loop."""
    if not email_configured():
        return False
    try:
        return await asyncio.to_thread(_send_sync, **kwargs)
    except Exception:
        # Delivery errors are intentionally surfaced as False. Workflow state
        # should never be rolled back just because an email provider is down.
        return False
