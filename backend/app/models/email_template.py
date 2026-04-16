"""
Email Template table — Reusable cold email templates
SDRs can create templates and apply them when composing emails.
Templates support placeholder variables like {{first_name}}, {{company_name}}, etc.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Template name (e.g. "Initial Outreach", "Follow-up #2")
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    # Email subject line (supports {{variables}})
    subject: Mapped[str] = mapped_column(String(500), nullable=False)

    # Email body (supports {{variables}})
    # Available variables: {{first_name}}, {{last_name}}, {{company_name}},
    # {{title}}, {{industry}}, {{sender_name}}
    body: Mapped[str] = mapped_column(Text, nullable=False)

    # Who created this template (null = shared/system template)
    created_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    creator: Mapped[Optional["User"]] = relationship("User")


from app.models.user import User  # noqa: E402, F401
