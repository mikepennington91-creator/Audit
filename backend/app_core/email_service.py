from __future__ import annotations

import asyncio
import html
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

DEFAULT_EMAIL_LOGO_URL = (
    "https://customer-assets.emergentagent.com/"
    "job_c2cdf81f-38d8-495b-bbbc-bf9142927afb/artifacts/"
    "pll87efh_ChatGPT%20Image%20Jan%2013%2C%202026%2C%2007_06_32%20AM.png"
)


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


def _branded_html(subject: str, body: str) -> str:
    """Wrap application email content in one consistent, email-client-safe shell."""
    app_url = public_app_url()
    privacy_url = f"{app_url}/privacy"
    logo_url = os.environ.get("EMAIL_LOGO_URL", DEFAULT_EMAIL_LOGO_URL)
    safe_subject = html.escape(subject)
    safe_logo_url = html.escape(logo_url, quote=True)
    safe_app_url = html.escape(app_url, quote=True)
    safe_privacy_url = html.escape(privacy_url, quote=True)

    return f"""<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f6f6;font-family:Arial,Helvetica,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f6f6;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e1e7e6;box-shadow:0 4px 16px rgba(20,45,50,.06);">
            <tr>
              <td style="padding:24px 30px 18px;border-bottom:4px solid #17877d;text-align:center;">
                <a href="{safe_app_url}" style="text-decoration:none;display:inline-block;">
                  <img src="{safe_logo_url}" alt="Infinit Audit" style="display:block;max-width:220px;max-height:72px;width:auto;height:auto;margin:0 auto;border:0;" />
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:30px;line-height:1.55;font-size:15px;">
                <div style="font-size:20px;font-weight:700;margin:0 0 20px;color:#172033;">{safe_subject}</div>
                {body}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 30px;background:#f7faf9;border-top:1px solid #e1e7e6;text-align:center;font-size:12px;line-height:1.6;color:#667085;">
                <div>This is an automated service email from Infinit Audit.</div>
                <div style="margin-top:6px;">
                  <a href="{safe_privacy_url}" style="color:#17877d;text-decoration:underline;">Privacy Policy</a>
                  &nbsp;&middot;&nbsp;
                  <a href="{safe_app_url}" style="color:#17877d;text-decoration:underline;">Infinit Audit</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


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
    privacy_url = f"{public_app_url()}/privacy"

    message = EmailMessage()
    message["From"] = formataddr((from_name, from_email))
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(f"{text_body.rstrip()}\n\nPrivacy Policy: {privacy_url}\n")
    if html_body:
        message.add_alternative(_branded_html(subject, html_body), subtype="html")

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
