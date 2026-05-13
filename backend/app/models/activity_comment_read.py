"""ActivityCommentRead — per-user read receipt for mention notifications.

Append-only tracking table. A row exists iff `user_id` has dismissed the
mention they received from `comment_id`. The Dashboard mentions list
joins against this table to filter out already-seen mentions.

CASCADE on both FKs: when a comment is deleted (e.g. cascaded from its
parent activity), its read receipts go with it.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ActivityCommentRead(Base):
    __tablename__ = "activity_comment_reads"

    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    comment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("activity_comments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
