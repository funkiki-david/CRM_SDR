"""
Emails API — Compose, preview, and send emails
Handles template variable substitution and Gmail API sending.
When Gmail OAuth is not configured, emails are saved as drafts.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.contact import Contact
from app.models.email_account import EmailAccount
from app.models.email_template import EmailTemplate
from app.models.sent_email import SentEmail, EmailStatus
from app.models.activity import Activity, ActivityType
from app.schemas.email import (
    ComposeRequest, ComposePreviewRequest, SentEmailResponse,
    EmailAccountResponse, EmailAccountCreate, SMTPTestRequest,
)
from app.core.crypto import encrypt_password, decrypt_password
from app.services.smtp_sender import (
    test_connection as smtp_test_connection,
    send_mail as smtp_send_mail,
    SMTPError,
)
from app.services.gmail_oauth import (
    refresh_if_needed as gmail_refresh_if_needed,
    send_via_gmail,
    GmailOAuthError,
)
from app.services.email_receiver import (
    fetch_new_emails,
    IMAPError,
)

router = APIRouter(prefix="/api/emails", tags=["Emails"])


def _fill_template(text: str, contact: Contact, sender_name: str) -> str:
    """
    Replace template placeholders with actual contact data.
    Supported: {{first_name}}, {{last_name}}, {{company_name}},
               {{title}}, {{industry}}, {{sender_name}}
    """
    replacements = {
        "{{first_name}}": contact.first_name or "",
        "{{last_name}}": contact.last_name or "",
        "{{company_name}}": contact.company_name or "",
        "{{title}}": contact.title or "",
        "{{industry}}": contact.industry or "",
        "{{sender_name}}": sender_name,
    }
    for placeholder, value in replacements.items():
        text = text.replace(placeholder, value)
    return text


# === Email Accounts ===

@router.get("/accounts", response_model=list[EmailAccountResponse])
async def list_email_accounts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all email accounts. Team-shared access: every user (Admin / Manager
    / SDR) sees every configured sending address. user_id on the row marks
    who first added it, not a read gate.
    """
    _ = current_user  # reserved for future per-role filtering
    result = await db.execute(select(EmailAccount))
    return result.scalars().all()


@router.post("/accounts", response_model=EmailAccountResponse, status_code=201)
async def add_email_account(
    data: EmailAccountCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Add an email account. Three providers supported:
      - gmail_oauth: placeholder — OAuth flow wires up tokens separately
      - outlook_oauth: placeholder
      - smtp: full SMTP/IMAP config + password (encrypted at rest)
    """
    provider = (data.provider_type or "smtp").lower()

    account = EmailAccount(
        user_id=current_user.id,
        email_address=data.email_address,
        display_name=data.display_name or current_user.full_name,
        provider_type=provider,
        is_active=True,
    )

    if provider == "smtp":
        if not (data.smtp_host and data.smtp_port and data.smtp_username and data.smtp_password):
            raise HTTPException(
                status_code=400,
                detail="SMTP 模式需要 smtp_host / smtp_port / smtp_username / smtp_password",
            )
        account.smtp_host = data.smtp_host
        account.smtp_port = data.smtp_port
        account.imap_host = data.imap_host
        account.imap_port = data.imap_port
        account.smtp_username = data.smtp_username
        account.smtp_password_encrypted = encrypt_password(data.smtp_password)
        account.smtp_encryption = data.smtp_encryption or "ssl"

    db.add(account)
    await db.flush()
    return account


@router.post("/accounts/test-smtp")
async def test_smtp_credentials(
    data: SMTPTestRequest,
    current_user: User = Depends(get_current_user),
):
    """
    在保存账号前验证 SMTP 凭据（连接 + 登录）。
    成功返回 {ok:true}，失败返回 400 + 错误描述。
    """
    try:
        await smtp_test_connection(
            host=data.smtp_host,
            port=data.smtp_port,
            username=data.smtp_username,
            password=data.smtp_password,
            encryption=data.smtp_encryption,
        )
    except SMTPError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "message": "Connected and authenticated successfully"}


@router.delete("/accounts/{account_id}", status_code=204)
async def remove_email_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Disconnect an email account"""
    account = await db.get(EmailAccount, account_id)
    if account is None or account.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Account not found")
    await db.delete(account)


# === Preview & Send ===

@router.post("/preview")
async def preview_template(
    data: ComposePreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Preview a template with a specific contact's info filled in.
    Returns the subject and body with all {{variables}} replaced.
    """
    contact = await db.get(Contact, data.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    template = await db.get(EmailTemplate, data.template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    return {
        "subject": _fill_template(template.subject, contact, current_user.full_name),
        "body": _fill_template(template.body, contact, current_user.full_name),
    }


@router.post("/send")
async def send_email(
    data: ComposeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send an email — TEMPORARILY FROZEN.
    SDRs are sending from their own Gmail for now; the CRM only records
    activity. Unfreeze by removing the 501 return below — the original
    SMTP / Gmail dispatcher is left intact underneath.
    """
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=501,
        content={"error": "Email module is temporarily frozen", "code": "EMAIL_FROZEN"},
    )
    # --- frozen: original dispatcher retained ---
    contact = await db.get(Contact, data.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not contact.email:
        raise HTTPException(status_code=400, detail="Contact has no email address")

    email_account = None
    if data.email_account_id:
        email_account = await db.get(EmailAccount, data.email_account_id)
        # Team-shared: any logged-in user can send through any configured account.
        if email_account is None:
            raise HTTPException(status_code=404, detail="Email account not found")

    subject = _fill_template(data.subject, contact, current_user.full_name)
    body = _fill_template(data.body, contact, current_user.full_name)

    email_status = EmailStatus.DRAFT
    sent_at = None
    gmail_message_id = None

    # === Dispatcher ===
    if email_account is None:
        # 没选账号 → 存 draft（老行为）
        pass
    elif email_account.provider_type == "smtp":
        if not email_account.smtp_password_encrypted:
            raise HTTPException(status_code=400, detail="SMTP account missing password")
        try:
            password = decrypt_password(email_account.smtp_password_encrypted)
        except ValueError as e:
            raise HTTPException(status_code=500, detail=f"密码解密失败，请重新保存账号: {e}")

        try:
            result_id = await smtp_send_mail(
                host=email_account.smtp_host,
                port=email_account.smtp_port,
                username=email_account.smtp_username,
                password=password,
                encryption=email_account.smtp_encryption or "ssl",
                from_email=email_account.email_address,
                from_name=email_account.display_name,
                to_email=contact.email,
                subject=subject,
                body=body,
            )
            email_status = EmailStatus.SENT
            sent_at = datetime.now(timezone.utc)
            gmail_message_id = result_id  # 复用字段记录 SMTP 返回
        except SMTPError as e:
            raise HTTPException(status_code=502, detail=f"SMTP send failed: {e}")
    elif email_account.provider_type == "gmail_oauth":
        # Gmail OAuth：刷新 access_token（如需）→ 调 Gmail API users.messages.send
        if not email_account.access_token or not email_account.refresh_token:
            raise HTTPException(
                status_code=400,
                detail="Gmail account missing OAuth tokens. Reconnect via Settings.",
            )
        try:
            creds, token_updates = gmail_refresh_if_needed(
                access_token_encrypted=email_account.access_token,
                refresh_token_encrypted=email_account.refresh_token,
                token_expires_at=email_account.token_expires_at,
            )
            # 若刷新成功，把新的 access_token 回写
            if token_updates:
                email_account.access_token = token_updates["access_token"]
                email_account.token_expires_at = token_updates["token_expires_at"]
                await db.flush()

            gmail_msg_id = send_via_gmail(
                creds,
                from_email=email_account.email_address,
                from_name=email_account.display_name,
                to_email=contact.email,
                subject=subject,
                body=body,
            )
            email_status = EmailStatus.SENT
            sent_at = datetime.now(timezone.utc)
            gmail_message_id = gmail_msg_id
        except GmailOAuthError as e:
            raise HTTPException(status_code=502, detail=f"Gmail send failed: {e}")

    elif email_account.provider_type == "outlook_oauth":
        # TODO: Microsoft Graph API — 暂未实现，落 draft
        email_status = EmailStatus.DRAFT
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown provider_type: {email_account.provider_type}",
        )

    sent_email = SentEmail(
        direction="sent",
        contact_id=contact.id,
        from_email=email_account.email_address if email_account else None,
        to_email=contact.email,
        user_id=current_user.id,
        email_account_id=data.email_account_id,
        subject=subject,
        body=body,
        template_id=data.template_id,
        status=email_status,
        gmail_message_id=gmail_message_id,
        message_id=gmail_message_id,  # use SMTP response as best-effort thread key
        sent_at=sent_at,
    )
    db.add(sent_email)

    activity = Activity(
        activity_type=ActivityType.EMAIL,
        subject=f"Sent: {subject}" if email_status == EmailStatus.SENT else f"Draft: {subject}",
        content=body,
        contact_id=contact.id,
        user_id=current_user.id,
    )
    db.add(activity)

    await db.flush()
    return sent_email


@router.get("/sent", response_model=list[SentEmailResponse])
async def list_sent_emails(
    contact_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Legacy endpoint — kept for backward compat. Use GET /api/emails instead."""
    _ = current_user
    query = select(SentEmail).where(SentEmail.direction == "sent")
    if contact_id:
        query = query.where(SentEmail.contact_id == contact_id)
    query = query.order_by(SentEmail.created_at.desc()).limit(limit)

    result = await db.execute(query)
    return result.scalars().all()


# === Unified inbox/sent list (used by the /emails page) ===

@router.get("")
async def list_messages(
    direction: str = Query("all", pattern="^(all|sent|received)$"),
    contact_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Unified message list for the Emails page — team-shared visibility.
    Returns {messages: [...], total: N, counts: {sent, received, all}}.
    """
    _ = current_user
    base = select(SentEmail)
    if direction != "all":
        base = base.where(SentEmail.direction == direction)
    if contact_id:
        base = base.where(SentEmail.contact_id == contact_id)
    if search:
        term = f"%{search}%"
        base = base.where(
            or_(
                SentEmail.subject.ilike(term),
                SentEmail.from_email.ilike(term),
                SentEmail.to_email.ilike(term),
            )
        )

    total_res = await db.execute(select(func.count()).select_from(base.subquery()))
    total = total_res.scalar_one()

    # Sort: received_at or sent_at, falling back to created_at
    order_col = func.coalesce(SentEmail.received_at, SentEmail.sent_at, SentEmail.created_at)
    page_q = base.order_by(order_col.desc()).offset(skip).limit(limit)
    rows = (await db.execute(page_q)).scalars().all()

    # Separate counts across all three tabs (unfiltered by direction)
    count_q = select(SentEmail.direction, func.count()).group_by(SentEmail.direction)
    count_rows = (await db.execute(count_q)).all()
    counts = {"sent": 0, "received": 0, "all": 0}
    for dir_name, n in count_rows:
        counts[dir_name] = int(n)
        counts["all"] += int(n)

    def _serialize(m: SentEmail) -> dict:
        return {
            "id": m.id,
            "direction": m.direction,
            "subject": m.subject,
            "from_email": m.from_email,
            "to_email": m.to_email,
            "contact_id": m.contact_id,
            "email_account_id": m.email_account_id,
            "status": m.status.value if hasattr(m.status, "value") else m.status,
            "is_read": bool(m.is_read),
            "sent_at": m.sent_at.isoformat() if m.sent_at else None,
            "received_at": m.received_at.isoformat() if m.received_at else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "snippet": (m.body or "")[:200],
        }

    return {"messages": [_serialize(m) for m in rows], "total": total, "counts": counts}


@router.get("/{message_id}")
async def get_message(
    message_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return a single email message with full body."""
    _ = current_user
    m = await db.get(SentEmail, message_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Message not found")
    # Mark received rows as read on first open
    if m.direction == "received" and not m.is_read:
        m.is_read = True
        await db.flush()
    return {
        "id": m.id,
        "direction": m.direction,
        "subject": m.subject,
        "from_email": m.from_email,
        "to_email": m.to_email,
        "contact_id": m.contact_id,
        "email_account_id": m.email_account_id,
        "status": m.status.value if hasattr(m.status, "value") else m.status,
        "is_read": bool(m.is_read),
        "sent_at": m.sent_at.isoformat() if m.sent_at else None,
        "received_at": m.received_at.isoformat() if m.received_at else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "body": m.body or "",
        "body_html": m.body_html or "",
        "message_id": m.message_id,
        "in_reply_to": m.in_reply_to,
    }


# === IMAP Sync ===

@router.post("/sync")
async def sync_inbox(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Pull recent inbox messages from every configured account with IMAP creds.
    Dedupes by message_id. Auto-links to a contact when from_email matches a
    known contact's email. Creates an Activity row for the timeline.
    """
    accounts_res = await db.execute(
        select(EmailAccount).where(
            EmailAccount.is_active.is_(True),
            EmailAccount.imap_host.isnot(None),
            EmailAccount.smtp_password_encrypted.isnot(None),
        )
    )
    accounts = accounts_res.scalars().all()

    total_new = 0
    total_skipped = 0
    per_account: list[dict] = []

    for acc in accounts:
        try:
            password = decrypt_password(acc.smtp_password_encrypted)
        except Exception as e:
            per_account.append({
                "account": acc.email_address,
                "error": f"decrypt failed: {e}",
            })
            continue

        username = acc.smtp_username or acc.email_address
        # Fetch last 30 days — IMAP date format: "DD-Mon-YYYY"
        since = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%d-%b-%Y")
        try:
            fetched = await fetch_new_emails(
                imap_host=acc.imap_host,
                imap_port=acc.imap_port or 993,
                username=username,
                password=password,
                since_date=since,
                max_messages=50,
            )
        except IMAPError as e:
            per_account.append({"account": acc.email_address, "error": str(e)})
            continue

        new_count = 0
        skipped_count = 0
        for msg in fetched:
            mid = msg.get("message_id")
            if mid:
                exists_q = await db.execute(
                    select(SentEmail.id).where(SentEmail.message_id == mid).limit(1)
                )
                if exists_q.scalar_one_or_none() is not None:
                    skipped_count += 1
                    continue

            from_addr = (msg.get("from") or "").lower()

            # Try link to contact by from_email
            linked_contact_id: Optional[int] = None
            if from_addr:
                c_q = await db.execute(
                    select(Contact.id).where(func.lower(Contact.email) == from_addr).limit(1)
                )
                linked_contact_id = c_q.scalar_one_or_none()

            # Fallback: if in_reply_to matches a previously-sent message,
            # use that thread's contact
            if linked_contact_id is None and msg.get("in_reply_to"):
                thread_q = await db.execute(
                    select(SentEmail.contact_id)
                    .where(SentEmail.message_id == msg["in_reply_to"])
                    .limit(1)
                )
                linked_contact_id = thread_q.scalar_one_or_none()

            row = SentEmail(
                direction="received",
                contact_id=linked_contact_id,
                from_email=from_addr or None,
                to_email=(msg.get("to") or acc.email_address),
                user_id=acc.user_id,
                email_account_id=acc.id,
                subject=(msg.get("subject") or "(no subject)")[:500],
                body=msg.get("body_plain") or "",
                body_html=msg.get("body_html") or None,
                status=EmailStatus.SENT,  # direction='received' is the real source of truth
                message_id=mid,
                in_reply_to=msg.get("in_reply_to"),
                received_at=msg.get("received_at") or datetime.now(timezone.utc),
                is_read=False,
            )
            db.add(row)
            new_count += 1

            # Timeline entry — only when linked to a contact
            if linked_contact_id:
                db.add(Activity(
                    activity_type=ActivityType.EMAIL,
                    subject=f"Received: {row.subject}",
                    content=row.body[:2000],
                    contact_id=linked_contact_id,
                    user_id=acc.user_id,
                ))

        await db.flush()
        total_new += new_count
        total_skipped += skipped_count
        per_account.append({
            "account": acc.email_address,
            "new_emails": new_count,
            "skipped": skipped_count,
        })

    return {
        "new_emails": total_new,
        "skipped": total_skipped,
        "per_account": per_account,
        "user": current_user.email,
    }
