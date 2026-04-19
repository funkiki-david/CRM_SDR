"""
Email Account table — Stores connected email accounts (multiple providers).

Supported providers:
  - gmail_oauth   → Google Gmail via OAuth (uses access_token / refresh_token)
  - outlook_oauth → Microsoft Outlook via OAuth (future — same token fields)
  - smtp          → Generic SMTP/IMAP (Hostinger, custom domains, etc.)
                    Password 以 Fernet 加密存储在 smtp_password_encrypted
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Text, ForeignKey, Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EmailAccount(Base):
    __tablename__ = "email_accounts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Which user owns this email account
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )

    # Email address (e.g. david@amazonsolutions.us)
    email_address: Mapped[str] = mapped_column(String(255), nullable=False)

    # Display name used in "From" field (e.g. "David Zheng")
    display_name: Mapped[Optional[str]] = mapped_column(String(200))

    # === Provider type — 决定用哪种方式发邮件 ===
    # 取值 values: gmail_oauth | outlook_oauth | smtp
    provider_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="smtp", server_default="smtp"
    )

    # === OAuth fields (gmail_oauth / outlook_oauth) ===
    # 加密存储 — 前端绝不暴露
    access_token: Mapped[Optional[str]] = mapped_column(Text)
    refresh_token: Mapped[Optional[str]] = mapped_column(Text)
    token_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # === SMTP/IMAP fields (provider_type = smtp) ===
    smtp_host: Mapped[Optional[str]] = mapped_column(String(255))
    smtp_port: Mapped[Optional[int]] = mapped_column(Integer)
    imap_host: Mapped[Optional[str]] = mapped_column(String(255))
    imap_port: Mapped[Optional[int]] = mapped_column(Integer)
    smtp_username: Mapped[Optional[str]] = mapped_column(String(255))
    # 密码用 Fernet 加密后存储，不明文。字段名以 _encrypted 结尾作为合同约定
    smtp_password_encrypted: Mapped[Optional[str]] = mapped_column(Text)
    # 加密模式：ssl（465 隐式 TLS）/ starttls（587 显式 TLS）/ none
    smtp_encryption: Mapped[Optional[str]] = mapped_column(String(20))

    # === Status ===
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # 最后一次测试连接的结果 last test connection result
    last_tested_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_test_error: Mapped[Optional[str]] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    owner: Mapped["User"] = relationship("User")


from app.models.user import User  # noqa: E402, F401
