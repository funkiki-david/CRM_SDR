"""
IMAP 收件服务 — 拉取 inbox 里的邮件，供 /api/emails/sync 调用。

imaplib 是同步库，而 FastAPI 是异步；每次 IMAP 调用都放在 asyncio.to_thread
里跑，避免阻塞事件循环。

返回的是解析后的 dict，字段包含 message_id / in_reply_to / from / to /
subject / body (text) / body_html / received_at。
"""

from __future__ import annotations

import asyncio
import email as email_lib
import imaplib
import re
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.utils import getaddresses, parsedate_to_datetime
from typing import List, Optional


class IMAPError(Exception):
    pass


def _decode_str(value: Optional[str]) -> str:
    """Decode MIME-encoded header (e.g. '=?utf-8?b?...?=') into plain text."""
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _first_address(value: Optional[str]) -> str:
    """Pull the first email address out of a header like
    '"Doug" <doug@example.com>, Other <o@x.com>' → 'doug@example.com'."""
    if not value:
        return ""
    pairs = getaddresses([value])
    for _, addr in pairs:
        if addr:
            return addr.strip().lower()
    # fallback: naive regex
    m = re.search(r"[\w.+\-]+@[\w.\-]+", value)
    return m.group(0).lower() if m else ""


def _extract_body(msg: email_lib.message.Message) -> tuple[str, str]:
    """
    Return (plain_text, html). Either can be empty. Prefers first hit of each.
    Skips attachments.
    """
    plain = ""
    html = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            cdisp = str(part.get("Content-Disposition") or "")
            if "attachment" in cdisp.lower():
                continue
            if ctype == "text/plain" and not plain:
                plain = _decode_payload(part)
            elif ctype == "text/html" and not html:
                html = _decode_payload(part)
    else:
        payload = _decode_payload(msg)
        if msg.get_content_type() == "text/html":
            html = payload
        else:
            plain = payload
    return plain, html


def _decode_payload(part: email_lib.message.Message) -> str:
    try:
        raw = part.get_payload(decode=True)
        if raw is None:
            return ""
        charset = part.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")
    except Exception:
        return ""


def _parse_message(raw_bytes: bytes) -> dict:
    msg = email_lib.message_from_bytes(raw_bytes)
    plain, html = _extract_body(msg)
    received_at: Optional[datetime] = None
    date_hdr = msg.get("Date")
    if date_hdr:
        try:
            received_at = parsedate_to_datetime(date_hdr)
            if received_at.tzinfo is None:
                received_at = received_at.replace(tzinfo=timezone.utc)
        except Exception:
            received_at = None
    return {
        "message_id": (msg.get("Message-ID") or "").strip() or None,
        "in_reply_to": (msg.get("In-Reply-To") or "").strip() or None,
        "from": _first_address(msg.get("From")),
        "from_name": _decode_str(msg.get("From", "")).split("<")[0].strip().strip('"'),
        "to": _first_address(msg.get("To")),
        "subject": _decode_str(msg.get("Subject")),
        "body_plain": plain,
        "body_html": html,
        "received_at": received_at,
    }


def _fetch_blocking(
    *,
    imap_host: str,
    imap_port: int,
    username: str,
    password: str,
    since_date: Optional[str] = None,
    max_messages: int = 50,
) -> List[dict]:
    """Synchronous IMAP fetch. Call via asyncio.to_thread."""
    try:
        mail = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=20)
    except Exception as e:
        raise IMAPError(f"IMAP connection failed {imap_host}:{imap_port}: {e}")
    try:
        try:
            mail.login(username, password)
        except imaplib.IMAP4.error as e:
            raise IMAPError(f"IMAP authentication failed ({username}): {e}")

        mail.select("INBOX", readonly=True)

        criteria = f'(SINCE "{since_date}")' if since_date else "ALL"
        status, data = mail.search(None, criteria)
        if status != "OK":
            raise IMAPError(f"IMAP search failed: {status}")
        ids = data[0].split() if data and data[0] else []
        # Most-recent first, cap to max_messages
        ids = ids[-max_messages:][::-1]

        results: List[dict] = []
        for msg_id in ids:
            try:
                status, msg_data = mail.fetch(msg_id, "(RFC822)")
                if status != "OK" or not msg_data or not msg_data[0]:
                    continue
                raw_bytes = msg_data[0][1]
                if not isinstance(raw_bytes, (bytes, bytearray)):
                    continue
                results.append(_parse_message(bytes(raw_bytes)))
            except Exception:
                # 单条解析失败不中断整批 sync
                continue
        return results
    finally:
        try:
            mail.logout()
        except Exception:
            pass


async def fetch_new_emails(
    *,
    imap_host: str,
    imap_port: int,
    username: str,
    password: str,
    since_date: Optional[str] = None,
    max_messages: int = 50,
) -> List[dict]:
    """
    Async wrapper — imaplib is blocking, so offload to a thread.
    `since_date` format: "21-Apr-2026" (IMAP date format). None = fetch ALL.
    """
    return await asyncio.to_thread(
        _fetch_blocking,
        imap_host=imap_host,
        imap_port=imap_port,
        username=username,
        password=password,
        since_date=since_date,
        max_messages=max_messages,
    )
