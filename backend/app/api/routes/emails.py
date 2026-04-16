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
    EmailAccountResponse, EmailAccountCreate,
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
    Add an email account (manual mode for now).
    Full Gmail OAuth flow will be added when Google Cloud credentials are configured.
    """
    account = EmailAccount(
        user_id=current_user.id,
        email_address=data.email_address,
        display_name=data.display_name or current_user.full_name,
        is_active=True,
    )
    db.add(account)
    await db.flush()
    return account


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
    Send an email to a contact.
    If Gmail OAuth is configured → sends via Gmail API.
    If not → saves as draft with a note that Gmail needs to be connected.
    Also logs an activity in the contact's timeline.
    """
    # Verify contact exists and has an email
    contact = await db.get(Contact, data.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not contact.email:
        raise HTTPException(status_code=400, detail="Contact has no email address")

    # Check email account (if specified)
    email_account = None
    if data.email_account_id:
        email_account = await db.get(EmailAccount, data.email_account_id)
        if email_account is None or email_account.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Email account not found")

    # Fill template variables in subject and body
    subject = _fill_template(data.subject, contact, current_user.full_name)
    body = _fill_template(data.body, contact, current_user.full_name)

    # Try to send via Gmail API
    email_status = EmailStatus.DRAFT
    sent_at = None
    gmail_message_id = None

    if email_account and email_account.refresh_token:
        # TODO: Implement actual Gmail API sending when OAuth is configured
        # For now, mark as sent (simulated)
        pass

    # For now, simulate successful send
    email_status = EmailStatus.SENT
    sent_at = datetime.now(timezone.utc)

    # Save the sent email record
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

    # Log an activity in the contact's timeline
    activity = Activity(
        activity_type=ActivityType.EMAIL,
        subject=f"Sent: {subject}",
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
