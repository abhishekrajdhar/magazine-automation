"""Outgoing e-mail: password-reset and invitation links.

EMAIL_BACKEND=smtp sends through any SMTP relay (Google Workspace, SES, Postmark, ...). With `log` the message is
written to the server log in development only; with `none`, or `log` in production, nothing is sent and callers
fall back to handing the link to an administrator.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.config import get_settings

log = logging.getLogger("pressflow.mail")


def delivers() -> bool:
    s = get_settings()
    return s.email_backend == "smtp" and bool(s.smtp_host and s.smtp_from)


def send(to: str, subject: str, body: str) -> bool:
    """True when the message was handed to the mail server."""
    s = get_settings()
    if s.email_backend == "log" and s.env != "production":
        log.warning("E-mail to %s (dev log only): %s\n%s", to, subject, body)
        return False
    if not delivers():
        log.info("E-mail to a member not sent: no mail server is configured.")
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_from, to, subject
    msg.set_content(body)
    try:
        if s.smtp_security == "ssl":
            server: smtplib.SMTP = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=15, context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15)
        with server:
            if s.smtp_security == "starttls":
                server.starttls(context=ssl.create_default_context())
            if s.smtp_username:
                server.login(s.smtp_username, s.smtp_password)
            server.send_message(msg)
        return True
    except (smtplib.SMTPException, OSError) as e:
        log.error("E-mail could not be sent: %s", e)
        return False
