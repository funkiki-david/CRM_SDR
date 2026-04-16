"""
Sent Email table — Tracks every email sent from the system
Links to the contact, the sender account, and optionally the template used.
Also automatically creates an Activity record for the timeline.
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Text, ForeignKey, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EmailStatus(str, enum.Enum):
    DRAFT = "draft"
    SENT = "sent"
    FAILED = "failed"


class SentEmail(Base):
    __tablename__ = "sent_emails"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Who received it
    contact_id: Mapped[int] = mapped_column(
        ForeignKey("contacts.id"), nullable=False, index=True
    )
    to_email: Mapped[str] = mapped_column(String(255), nullable=False)

    # Who sent it and from which account
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    email_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("email_accounts.id"), nullable=True
    )

    # Email content
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    # Which template was used (if any)
    template_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("email_templates.id"), nullable=True
    )

    # Delivery status
    status: Mapped[EmailStatus] = mapped_column(
        Enum(EmailStatus), nullable=False, default=EmailStatus.DRAFT
    )

    # Gmail message ID (for tracking replies later)
    gmail_message_id: Mapped[Optional[str]] = mapped_column(String(200))

    # Timestamps
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    contact: Mapped["Contact"] = relationship("Contact")
    sender: Mapped["User"] = relationship("User")
    email_account: Mapped[Optional["EmailAccount"]] = relationship("EmailAccount")
    template: Mapped[Optional["EmailTemplate"]] = relationship("EmailTemplate")


from app.models.contact import Contact  # noqa: E402, F401
from app.models.user import User  # noqa: E402, F401
from app.models.email_account import EmailAccount  # noqa: E402, F401
from app.models.email_template import EmailTemplate  # noqa: E402, F401
