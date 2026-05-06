"""
活动记录表 — 记录 SDR 与联系人的每次互动
类型包括：电话、邮件、LinkedIn 消息、会议、备注
每条活动都会生成向量 embedding 存入 pgvector，用于后续语义搜索
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Text, ForeignKey, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ActivityType(str, enum.Enum):
    """活动类型"""
    CALL = "call"           # 电话
    EMAIL = "email"         # 邮件
    LINKEDIN = "linkedin"   # LinkedIn 消息
    MEETING = "meeting"     # 会议
    NOTE = "note"           # 手动备注


class Activity(Base):
    __tablename__ = "activities"

    # === 基本信息 ===
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    activity_type: Mapped[ActivityType] = mapped_column(
        Enum(ActivityType), nullable=False
    )
    subject: Mapped[Optional[str]] = mapped_column(String(300))  # 一句话摘要
    content: Mapped[Optional[str]] = mapped_column(Text)          # 详细内容/备注

    # === Mockup additions (audit step B) ===
    # outcome:     positive / neutral / no_answer / negative
    # temperature: hot / warm / neutral / cold
    # duration_minutes: integer minutes
    # All optional — older rows have NULL, no backfill required.
    outcome: Mapped[Optional[str]] = mapped_column(String(20))
    temperature: Mapped[Optional[str]] = mapped_column(String(20))
    duration_minutes: Mapped[Optional[int]] = mapped_column()

    # === AI 生成摘要 ===
    ai_summary: Mapped[Optional[str]] = mapped_column(Text)  # AI 自动生成的一句话摘要

    # === 关联 ===
    contact_id: Mapped[int] = mapped_column(
        ForeignKey("contacts.id"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    # user_id = 谁录入的这条活动

    # === 时间戳 ===
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    # === 关系 ===
    contact: Mapped["Contact"] = relationship("Contact", back_populates="activities")
    user: Mapped["User"] = relationship("User")
    # 2026-05-06: Activity Comments real-functionalized. CASCADE so deleting an
    # activity also cleans up its comment thread.
    comments: Mapped[list["ActivityComment"]] = relationship(
        "ActivityComment",
        back_populates="activity",
        cascade="all, delete-orphan",
        order_by="ActivityComment.created_at",
    )
