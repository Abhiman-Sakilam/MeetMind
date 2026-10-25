"""Send meeting summary emails via SMTP using aiosmtplib."""
from __future__ import annotations

import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

_logger = logging.getLogger(__name__)


def _is_configured() -> bool:
    from app.config import settings
    return bool(settings.smtp_host and settings.smtp_user and settings.smtp_password)


def _build_html(
    *,
    room_name: str,
    title: str,
    summary: str,
    action_items: list[dict],
    decisions: list[dict],
) -> str:
    actions_html = ""
    if action_items:
        rows = "".join(
            f"<tr><td style='padding:4px 8px;border-bottom:1px solid #eee'>{i+1}</td>"
            f"<td style='padding:4px 8px;border-bottom:1px solid #eee'>{item.get('title','')}</td>"
            f"<td style='padding:4px 8px;border-bottom:1px solid #eee'>{item.get('assigned_to') or '—'}</td>"
            f"<td style='padding:4px 8px;border-bottom:1px solid #eee'>{item.get('status','pending')}</td></tr>"
            for i, item in enumerate(action_items)
        )
        actions_html = f"""
        <h3 style='color:#4F46E5'>Action Items</h3>
        <table style='border-collapse:collapse;width:100%;font-size:14px'>
          <tr style='background:#4F46E5;color:white'>
            <th style='padding:6px 8px'>#</th>
            <th style='padding:6px 8px;text-align:left'>Task</th>
            <th style='padding:6px 8px;text-align:left'>Assigned To</th>
            <th style='padding:6px 8px;text-align:left'>Status</th>
          </tr>{rows}
        </table>"""

    decisions_html = ""
    if decisions:
        items = "".join(
            f"<li><b>{d.get('title','')}</b>"
            + (f" — Chosen: {d['chosen']}" if d.get("chosen") else "")
            + "</li>"
            for d in decisions
        )
        decisions_html = f"<h3 style='color:#4F46E5'>Decisions</h3><ul>{items}</ul>"

    summary_html = summary.replace("\n", "<br>") if summary else "<em>No summary available.</em>"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset='utf-8'></head>
<body style='font-family:Arial,sans-serif;max-width:700px;margin:auto;color:#111'>
  <div style='background:#4F46E5;color:white;padding:20px 24px;border-radius:8px 8px 0 0'>
    <h1 style='margin:0;font-size:22px'>Meeting Report</h1>
    <p style='margin:4px 0 0;font-size:14px;opacity:0.85'>Room: {room_name} — {title}</p>
  </div>
  <div style='padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px'>
    <h3 style='color:#4F46E5'>Summary</h3>
    <div style='background:#F9FAFB;padding:16px;border-radius:6px;font-size:14px;line-height:1.6'>
      {summary_html}
    </div>
    {actions_html}
    {decisions_html}
    <hr style='margin-top:32px;border:none;border-top:1px solid #e5e7eb'>
    <p style='font-size:12px;color:#9CA3AF'>Sent by MeetMind · Jarvis AI Meeting Assistant</p>
  </div>
</body>
</html>"""


async def send_summary_email(
    *,
    to_addresses: list[str],
    room_name: str,
    title: str,
    summary: str,
    action_items: list[dict],
    decisions: list[dict],
) -> None:
    """Send a meeting summary email. Raises if SMTP is not configured or delivery fails."""
    if not _is_configured():
        raise RuntimeError(
            "Email is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in .env"
        )
    if not to_addresses:
        raise ValueError("No recipient addresses provided")

    from app.config import settings
    import aiosmtplib

    from_addr = settings.smtp_from or settings.smtp_user
    subject = f"Meeting Summary: {title or room_name}"
    html = _build_html(
        room_name=room_name,
        title=title,
        summary=summary,
        action_items=action_items,
        decisions=decisions,
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addresses)
    msg.attach(MIMEText(summary or "No summary available.", "plain"))
    msg.attach(MIMEText(html, "html"))

    _logger.info("Sending summary email to %s for room %s", to_addresses, room_name)
    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user,
        password=settings.smtp_password,
        use_tls=settings.smtp_use_tls,
    )
    _logger.info("Summary email sent successfully to %s", to_addresses)


async def send_password_reset_email(*, to_address: str, link: str) -> None:
    """Email a password-reset link. Without SMTP, log the link so local development still works.

    Runs as a background task, so failures are logged rather than raised."""
    from app.config import settings

    if not _is_configured():
        # The link grants account access, so only print it for local development.
        from urllib.parse import urlparse
        if urlparse(settings.frontend_url).hostname in ("localhost", "127.0.0.1"):
            _logger.warning("SMTP not configured. Local dev password reset link for %s: %s", to_address, link)
        else:
            _logger.warning("SMTP not configured; password reset email for %s not sent", to_address)
        return

    import aiosmtplib

    minutes = settings.password_reset_expire_minutes
    text = (
        "We received a request to reset your MeetMind password.\n\n"
        f"Choose a new password here (the link expires in {minutes} minutes):\n{link}\n\n"
        "If you didn't ask for this, you can ignore this email."
    )
    html = f"""<!DOCTYPE html>
<html>
<head><meta charset='utf-8'></head>
<body style='font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111'>
  <h2 style='margin:0 0 12px'>Reset your MeetMind password</h2>
  <p style='font-size:14px;line-height:1.6'>We received a request to reset your password.
     This link expires in {minutes} minutes.</p>
  <p style='margin:24px 0'>
    <a href='{link}' style='background:#fa6114;color:#fff;padding:12px 22px;border-radius:999px;
       text-decoration:none;font-weight:bold;font-size:14px'>Choose a new password</a>
  </p>
  <p style='font-size:12px;color:#6B7280'>If you didn't ask for this, you can ignore this email.</p>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Reset your MeetMind password"
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to_address
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settings.smtp_password,
            use_tls=settings.smtp_use_tls,
        )
        _logger.info("Password reset email sent to %s", to_address)
    except Exception:
        _logger.exception("Password reset email to %s failed", to_address)
