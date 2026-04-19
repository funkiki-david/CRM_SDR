"""
Emails API — Compose, preview, and send emails
Handles template variable substitution and Gmail API sending.
When Gmail OAuth is not configured, emails are saved as drafts.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
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
    """List connected email accounts for the current user"""
    result = await db.execute(
        select(EmailAccount).where(EmailAccount.user_id == current_user.id)
    )
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


@router.post("/send", response_model=SentEmailResponse)
async def send_email(
    data: ComposeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send an email — dispatcher based on account.provider_type:
      - smtp          → 用 aiosmtplib 直接发
      - gmail_oauth   → TODO: Gmail API (stub: save as draft)
      - outlook_oauth → TODO: MS Graph API (stub: save as draft)
    Also logs an activity in the contact's timeline.
    """
    contact = await db.get(Contact, data.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not contact.email:
        raise HTTPException(status_code=400, detail="Contact has no email address")

    email_account = None
    if data.email_account_id:
        email_account = await db.get(EmailAccount, data.email_account_id)
        if email_account is None or email_account.user_id != current_user.id:
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
    elif email_account.provider_type in ("gmail_oauth", "outlook_oauth"):
        # OAuth 提供商暂时保存为 draft —— 真实发送等 OAuth 配置好再实现
        # TODO: Gmail API / Microsoft Graph 发送
        email_status = EmailStatus.DRAFT
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown provider_type: {email_account.provider_type}",
        )

    sent_email = SentEmail(
        contact_id=contact.id,
        to_email=contact.email,
        user_id=current_user.id,
        email_account_id=data.email_account_id,
        subject=subject,
        body=body,
        template_id=data.template_id,
        status=email_status,
        gmail_message_id=gmail_message_id,
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
    """List sent emails, optionally filtered by contact"""
    query = select(SentEmail).where(SentEmail.user_id == current_user.id)
    if contact_id:
        query = query.where(SentEmail.contact_id == contact_id)
    query = query.order_by(SentEmail.created_at.desc()).limit(limit)

    result = await db.execute(query)
    return result.scalars().all()
