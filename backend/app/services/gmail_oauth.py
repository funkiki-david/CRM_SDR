"""
Gmail OAuth 2.0 service — authorization URL, token exchange, refresh, send.

Flow:
  1. /api/auth/google/start  →  build authorization URL, set CSRF state
  2. User logs in at Google → Google redirects to callback with `code`
  3. /api/auth/google/callback → exchange code for tokens, write to email_accounts
  4. Send time: refresh access_token if expired, call Gmail API users.messages.send

All tokens (access + refresh) stored Fernet-encrypted in email_accounts table,
reusing the same crypto key as SMTP passwords.
"""

from __future__ import annotations

import base64
import json
import secrets
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Optional

from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.core.config import settings
from app.core.crypto import encrypt_secret, decrypt_secret


# Gmail API scopes we need
# - gmail.send: send email
# - userinfo.email: confirm which Google account just authorized (sanity check)
# - openid: standard OIDC
GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]


class GmailOAuthError(Exception):
    """Raised when OAuth flow / Gmail API call fails with a user-readable message."""


def _client_config() -> dict:
    """Build the OAuth client config dict that google-auth-oauthlib expects."""
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise GmailOAuthError(
            "Google OAuth is not configured. Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET."
        )
    return {
        "web": {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.GOOGLE_OAUTH_REDIRECT_URI],
        }
    }


def _new_flow() -> Flow:
    """Fresh Flow instance — scopes + redirect pre-bound."""
    flow = Flow.from_client_config(_client_config(), scopes=GOOGLE_SCOPES)
    flow.redirect_uri = settings.GOOGLE_OAUTH_REDIRECT_URI
    return flow


# ============================================================================
# Step 1: Build authorization URL
# ============================================================================

def build_authorization_url(state_payload: dict) -> tuple[str, str]:
    """
    Returns (auth_url, state_token).

    state_payload: arbitrary JSON-serializable dict, gets base64-encoded into the
      `state` query param so the callback can recover it. Typically {"user_id": N}
      so we know which logged-in user this callback belongs to.

    Also prefixes a random nonce to prevent CSRF token reuse.
    """
    nonce = secrets.token_urlsafe(16)
    state_data = {"nonce": nonce, **state_payload}
    state_token = base64.urlsafe_b64encode(
        json.dumps(state_data).encode()
    ).decode().rstrip("=")

    flow = _new_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",   # 换取 refresh_token
        include_granted_scopes="true",
        prompt="consent",        # 强制每次都给 refresh_token（否则第二次授权可能拿不到）
        state=state_token,
    )
    return auth_url, state_token


def parse_state(state_token: str) -> dict:
    """Decode state back to the payload dict. Raises ValueError on tampered state."""
    try:
        padding = "=" * (-len(state_token) % 4)
        decoded = base64.urlsafe_b64decode(state_token + padding).decode()
        return json.loads(decoded)
    except (ValueError, json.JSONDecodeError) as e:
        raise ValueError(f"Invalid state token: {e}")


# ============================================================================
# Step 2: Exchange code for tokens
# ============================================================================

def exchange_code_for_tokens(code: str) -> dict:
    """
    Trade the auth code for (access_token, refresh_token, expires_at, email).
    Returns a dict:
      {
        "access_token_encrypted": str,
        "refresh_token_encrypted": str,
        "token_expires_at": datetime,
        "email": str,        # from Google userinfo — the authorized Gmail
      }
    """
    flow = _new_flow()
    try:
        flow.fetch_token(code=code)
    except Exception as e:
        raise GmailOAuthError(f"Failed to exchange code: {e}")

    creds: Credentials = flow.credentials
    if not creds.refresh_token:
        # If Google didn't return a refresh_token (user previously granted without
        # revoking), we can't refresh later. Tell user to revoke + re-grant.
        raise GmailOAuthError(
            "Google did not return a refresh_token. Revoke access at "
            "https://myaccount.google.com/permissions and try again."
        )

    # Get the authenticated email address via userinfo
    try:
        service = build("oauth2", "v2", credentials=creds, cache_discovery=False)
        userinfo = service.userinfo().get().execute()
        email = userinfo.get("email", "")
    except HttpError as e:
        raise GmailOAuthError(f"Failed to read Google userinfo: {e}")

    expiry = creds.expiry
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    return {
        "access_token_encrypted": encrypt_secret(creds.token),
        "refresh_token_encrypted": encrypt_secret(creds.refresh_token),
        "token_expires_at": expiry,
        "email": email.lower(),
    }


# ============================================================================
# Step 3: Load + refresh credentials for an existing account
# ============================================================================

def _credentials_from_account(
    access_token_encrypted: str,
    refresh_token_encrypted: str,
    token_expires_at: Optional[datetime],
) -> Credentials:
    """Rebuild Credentials from encrypted DB fields."""
    return Credentials(
        token=decrypt_secret(access_token_encrypted),
        refresh_token=decrypt_secret(refresh_token_encrypted),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=GOOGLE_SCOPES,
        expiry=token_expires_at,
    )


def refresh_if_needed(
    access_token_encrypted: str,
    refresh_token_encrypted: str,
    token_expires_at: Optional[datetime],
) -> tuple[Credentials, Optional[dict]]:
    """
    Return (live_credentials, updated_fields_or_None).

    If access_token expired, refresh it and return the new encrypted values
    so the caller can persist them back to the DB.
    """
    creds = _credentials_from_account(
        access_token_encrypted, refresh_token_encrypted, token_expires_at
    )

    # google-auth handles expiry comparison internally; force a refresh if expired
    # or within 5 min of expiring (safety buffer).
    now = datetime.now(timezone.utc)
    needs_refresh = (
        creds.expired
        or (token_expires_at and (token_expires_at - now) < timedelta(minutes=5))
    )
    if not needs_refresh:
        return creds, None

    try:
        creds.refresh(GoogleRequest())
    except Exception as e:
        raise GmailOAuthError(f"Failed to refresh Google token: {e}")

    updates = {
        "access_token": encrypt_secret(creds.token),
        "token_expires_at": creds.expiry.replace(tzinfo=timezone.utc) if creds.expiry and creds.expiry.tzinfo is None else creds.expiry,
    }
    return creds, updates


# ============================================================================
# Step 4: Send email via Gmail API
# ============================================================================

def send_via_gmail(
    creds: Credentials,
    *,
    from_email: str,
    from_name: Optional[str],
    to_email: str,
    subject: str,
    body: str,
    body_html: Optional[str] = None,
) -> str:
    """
    Send an email through Gmail API. Returns the Gmail message ID.
    Raises GmailOAuthError on failure.
    """
    msg = EmailMessage()
    if from_name:
        msg["From"] = f"{from_name} <{from_email}>"
    else:
        msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    try:
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        sent = service.users().messages().send(
            userId="me", body={"raw": raw}
        ).execute()
        return sent.get("id", "")
    except HttpError as e:
        raise GmailOAuthError(f"Gmail send failed: {e}")
    except Exception as e:
        raise GmailOAuthError(f"Gmail send failed: {type(e).__name__}: {e}")
