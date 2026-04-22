"""
Email messages table — Tracks every email flowing through the system.
Although the table is named `sent_emails` for legacy reasons, it now holds
both outgoing (direction='sent') and incoming (direction='received')
messages so the Emails page can show a unified inbox.

Key fields for the inbox/sync flow:
  - direction:    "sent" | "received"
  - message_id:   RFC822 Message-ID header; used to dedupe IMAP fetches
  - in_reply_to:  thread linkage to another message_id
  - received_at:  when the message arrived (received rows)
  - is_read:      inbox-only read state toggle
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Text, ForeignKey, Enum, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EmailStatus(str, enum.Enum):
    DRAFT = "draft"
    SENT = "sent"
    FAILED = "failed"
    # Note: we do NOT add a "RECEIVED" enum value because altering the
    # existing Postgres enum type inside a transactional migration is
    # brittle. Received rows use direction='received' as the source of
    # truth and status is left as SENT (meaning "delivered to us").


class SentEmail(Base):
    __tablename__ = "sent_emails"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Direction: "sent" (outgoing) or "received" (inbox via IMAP)
    direction: Mapped[str] = mapped_column(
        String(20), nullable=False, default="sent", server_default="sent", index=True
    )

    # Linked contact (optional for received when no match)
    contact_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("contacts.id"), nullable=True, index=True
    )
    # Sender / recipient
    from_email: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    to_email: Mapped[str] = mapped_column(String(255), nullable=False)

    # Who acted in the app + which account handled it
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    email_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("email_accounts.id"), nullable=True
    )

    # Email content
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    body_html: Mapped[Optional[str]] = mapped_column(Text)

    # Which template was used (outgoing only)
    template_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("email_templates.id"), nullable=True
    )

    # Delivery status
    status: Mapped[EmailStatus] = mapped_column(
        Enum(EmailStatus), nullable=False, default=EmailStatus.DRAFT
    )

    # RFC822 Message-ID + reply header (for thread/dedup matching)
    message_id: Mapped[Optional[str]] = mapped_column(String(500), index=True)
    in_reply_to: Mapped[Optional[str]] = mapped_column(String(500))
    # Legacy: Gmail-specific id / SMTP response (pre-existing rows)
    gmail_message_id: Mapped[Optional[str]] = mapped_column(String(200))

    # Inbox read state
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    # Timestamps
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    contact: Mapped[Optional["Contact"]] = relationship("Contact")
    sender: Mapped["User"] = relationship("User")
    email_account: Mapped[Optional["EmailAccount"]] = relationship("EmailAccount")
    template: Mapped[Optional["EmailTemplate"]] = relationship("EmailTemplate")


from app.models.contact import Contact  # noqa: E402, F401
from app.models.user import User  # noqa: E402, F401
from app.models.email_account import EmailAccount  # noqa: E402, F401
from app.models.email_template import EmailTemplate  # noqa: E402, F401
