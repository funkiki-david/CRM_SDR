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
    provider_type: str = "smtp"
    is_active: bool
    # SMTP config 回显（password_encrypted 永不返回前端）
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    imap_host: Optional[str] = None
    imap_port: Optional[int] = None
    smtp_username: Optional[str] = None
    smtp_encryption: Optional[str] = None
    last_tested_at: Optional[datetime] = None
    last_test_error: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class EmailAccountCreate(BaseModel):
    """
    创建邮箱账号。根据 provider_type 决定需要填什么。
      - gmail_oauth / outlook_oauth: 只需 email_address + display_name，OAuth 流程后续填充 tokens
      - smtp: 需要 smtp_host/port + username + password + encryption
    """
    email_address: str
    display_name: Optional[str] = None
    provider_type: str = "smtp"

    # SMTP fields (仅 provider_type=smtp 时用到)
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    imap_host: Optional[str] = None
    imap_port: Optional[int] = None
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None   # 明文，后端加密后存储
    smtp_encryption: Optional[str] = "ssl"


class SMTPTestRequest(BaseModel):
    """Test Connection 请求 —— 不保存账号，仅验证凭据"""
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_encryption: str = "ssl"


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
