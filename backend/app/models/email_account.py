"""
Email Account table — Stores connected Gmail accounts
Each SDR can connect multiple Gmail accounts (e.g. company email + cold outreach email)
Gmail OAuth tokens are stored securely for sending emails via Gmail API
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EmailAccount(Base):
    __tablename__ = "email_accounts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Which user owns this email account
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )

    # Gmail address (e.g. david@amazonsolutions.us)
    email_address: Mapped[str] = mapped_column(String(255), nullable=False)

    # Display name used in "From" field (e.g. "David Zheng")
    display_name: Mapped[Optional[str]] = mapped_column(String(200))

    # OAuth tokens for Gmail API access
    # These are encrypted/stored securely — never exposed to frontend
    access_token: Mapped[Optional[str]] = mapped_column(Text)
    refresh_token: Mapped[Optional[str]] = mapped_column(Text)
    token_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Is this account currently connected and working?
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    owner: Mapped["User"] = relationship("User")


from app.models.user import User  # noqa: E402, F401
