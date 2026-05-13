"""ActivityComment — comments left by team members on a specific activity row.

Each comment is anchored to an activity (call/meeting/email/etc) so the context
is always clear: who said what about which interaction.

Edit/Delete rules (enforced in route layer, not DB):
- Author can edit/delete their own comments
- Admin role users can delete any comment
- Edits do not expose 'edited' status to the UI, but the original text is
  retained in `previous_text` (single-level history) for audit.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional, TYPE_CHECKING

from sqlalchemy import Boolean, Integer, ForeignKey, Text, DateTime, Index
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.activity import Activity
    from app.models.user import User


class ActivityComment(Base):
    __tablename__ = "activity_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("activities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Single-level history — last value before the most recent edit. Kept for
    # audit; the UI does not surface it.
    previous_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # === Dashboard V1 mention plumbing (2026-05-12) ===
    # Postgres ARRAY of user ids this comment notifies. Filled at create time
    # from (a) parsed @mentions in the body and (b) contact.assigned_to when
    # auto_notify_assigned=True. Empty = no inbox routing.
    mentioned_user_ids: Mapped[List[int]] = mapped_column(
        ARRAY(Integer), nullable=False, default=list, server_default="{}"
    )
    # Author can opt out per-comment. Default True so the common case
    # auto-routes to the contact's assigned manager.
    auto_notify_assigned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    activity: Mapped["Activity"] = relationship("Activity", back_populates="comments")
    user: Mapped[Optional["User"]] = relationship("User")

    __table_args__ = (
        Index("ix_activity_comments_activity_id_created_at", "activity_id", "created_at"),
    )
