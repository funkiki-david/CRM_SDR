"""
Task model — lightweight to-dos created by the AI Suggested To-Do "Create Task"
button (and possibly future manual creation). Mixed into the dashboard
Follow-Ups list alongside lead-derived follow-ups.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Text, ForeignKey, Date
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contact_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )

    # call / email / follow_up / meeting
    task_type: Mapped[str] = mapped_column(String(20), nullable=False, default="follow_up")
    description: Mapped[str] = mapped_column(Text, nullable=False)
    due_date: Mapped[Optional[datetime]] = mapped_column(Date)

    # pending / done
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)

    # ai_suggestion / manual / etc.
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="manual")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    contact: Mapped[Optional["Contact"]] = relationship("Contact")
    user: Mapped["User"] = relationship("User")


class AISuggestionSnooze(Base):
    __tablename__ = "ai_suggestion_snoozes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    suggestion_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    snooze_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


from app.models.contact import Contact  # noqa: E402, F401
from app.models.user import User  # noqa: E402, F401
