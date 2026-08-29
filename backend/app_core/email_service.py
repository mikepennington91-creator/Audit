from __future__ import annotations

import asyncio
import logging
import os
import smtplib
import ssl
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from typing import Iterable, Optional

import server as legacy


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailAttachment:
    filename: str
    content: bytes
    maintype: str = "application"
    subtype: str = "octet-stream"


@dataclass(frozen=True)
class EmailDeliveryResult:
    sent: bool
    status: str
    error: Optional[str] = None


def _bool_env(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def email_is_configured() -> bool:
    return bool(
        os.environ.get("SMTP_HOST")
        and os.environ.get("SMTP_USERNAME")
        and os.environ.get("SMTP_PASSWORD")
    )


def public_app_url() -> str:
    return os.environ.get("APP_PUBLIC_URL", "https://www.infinit-audit.co.uk").rstrip("/")


def _build_message(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: Optional[str],
    attachments: Iterable[EmailAttachment],
) -> EmailMessage:
    username = os.environ.get("SMTP_USERNAME", "")
    from_email = os.environ.get("SMTP_FROM_EMAIL") or username or "info@infinit-audit.co.uk"
    from_name = os.environ.get("SMTP_FROM_NAME", "Infinit Audit")

    message = EmailMessage()
    message["From"] = formataddr((from_name, from_email))
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    for attachment in attachments:
        message.add_attachment(
            attachment.content,
            maintype=attachment.maintype,
            subtype=attachment.subtype,
            filename=attachment.filename,
        )
    return message


def _send_message(message: EmailMessage) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "465"))
    username = os.environ["SMTP_USERNAME"]
    password = os.environ["SMTP_PASSWORD"]
    use_ssl = _bool_env("SMTP_USE_SSL", port == 465)
    use_starttls = _bool_env("SMTP_USE_STARTTLS", not use_ssl)
    timeout = float(os.environ.get("SMTP_TIMEOUT_SECONDS", "15"))
    context = ssl.create_default_context()

    if use_ssl:
        with smtplib.SMTP_SSL(host, port, timeout=timeout, context=context) as smtp:
            smtp.login(username, password)
            smtp.send_message(message)
        return

    with smtplib.SMTP(host, port, timeout=timeout) as smtp:
        smtp.ehlo()
        if use_starttls:
            smtp.starttls(context=context)
            smtp.ehlo()
        smtp.login(username, password)
        smtp.send_message(message)


async def _record_delivery(
    *, recipient: str, subject: str, template: str, status: str, error: Optional[str]
) -> None:
    try:
        await legacy.db.email_delivery_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "recipient": recipient,
                "subject": subject,
                "template": template,
                "status": status,
                "error": error,
                "created_at": legacy.get_uk_time_iso(),
            }
        )
    except Exception:
        logger.exception("Unable to record email delivery event")


async def send_email(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
    attachments: Optional[Iterable[EmailAttachment]] = None,
    template: str = "generic",
) -> EmailDeliveryResult:
    """Send one email without letting SMTP failures break business workflows.

    Explicit UI operations can inspect ``sent`` and turn a failed delivery into a
    user-facing error. Automated action/audit workflows can safely continue and
    retain an email delivery audit event when SMTP is unavailable.
    """
    recipient = str(to_email or "").strip()
    if not recipient:
        return EmailDeliveryResult(False, "skipped", "Recipient email is missing")

    if not email_is_configured():
        await _record_delivery(
            recipient=recipient,
            subject=subject,
            template=template,
            status="disabled",
            error="SMTP is not configured",
        )
        logger.info("Email skipped because SMTP is not configured: %s", template)
        return EmailDeliveryResult(False, "disabled", "Email service is not configured")

    message = _build_message(
        to_email=recipient,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        attachments=attachments or (),
    )
    try:
        await asyncio.to_thread(_send_message, message)
        await _record_delivery(
            recipient=recipient,
            subject=subject,
            template=template,
            status="sent",
            error=None,
        )
        return EmailDeliveryResult(True, "sent")
    except Exception as exc:
        logger.exception("SMTP delivery failed for template %s", template)
        await _record_delivery(
            recipient=recipient,
            subject=subject,
            template=template,
            status="failed",
            error=str(exc)[:500],
        )
        return EmailDeliveryResult(False, "failed", "Email delivery failed")
