"""
Email-related data schemas
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


# === Email Templates ===

class TemplateCreate(BaseModel):
    name: str
    subject: str
    body: str


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None


class TemplateResponse(BaseModel):
    id: int
    name: str
    subject: str
    body: str
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# === Email Accounts ===

class EmailAccountResponse(BaseModel):
    id: int
    email_address: str
    display_name: Optional[str] = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class EmailAccountCreate(BaseModel):
    """Manual email account creation (for development/testing)"""
    email_address: str
    display_name: Optional[str] = None


# === Compose & Send ===

class ComposeRequest(BaseModel):
    """Request to compose/send an email"""
    contact_id: int
    email_account_id: Optional[int] = None  # Which Gmail to send from
    template_id: Optional[int] = None       # Apply a template (optional)
    subject: str
    body: str


class ComposePreviewRequest(BaseModel):
    """Preview a template with a specific contact's info filled in"""
    contact_id: int
    template_id: int


class SentEmailResponse(BaseModel):
    id: int
    contact_id: int
    to_email: str
    subject: str
    body: str
    status: str
    template_id: Optional[int] = None
    sent_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}
