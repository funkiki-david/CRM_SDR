"""
Lead 表 — 跟踪每个潜在客户的销售进展
一个 Contact 可以有一条 Lead 记录，表示这个人是一个正在跟进的销售线索
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Text, ForeignKey, Enum, Date
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class LeadStatus(str, enum.Enum):
    """Lead 状态 — 销售推进阶段"""
    NEW = "new"                     # 刚导入，还没联系
    CONTACTED = "contacted"         # 已发出第一封邮件/打过电话
    INTERESTED = "interested"       # 对方有回应、表现出兴趣
    MEETING_SET = "meeting_set"     # 约到了会议
    PROPOSAL = "proposal"           # 发了方案
    CLOSED_WON = "closed_won"      # 成交
    CLOSED_LOST = "closed_lost"    # 丢单


class Lead(Base):
    __tablename__ = "leads"

    # === 基本信息 ===
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    status: Mapped[LeadStatus] = mapped_column(
        Enum(LeadStatus), nullable=False, default=LeadStatus.NEW
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)  # 备注

    # === 跟进计划 ===
    next_follow_up: Mapped[Optional[datetime]] = mapped_column(Date)  # 下次跟进日期
    follow_up_reason: Mapped[Optional[str]] = mapped_column(String(500))  # 跟进原因/待办
    # Dashboard V1 (2026-05-12): when SDR clicks "Close follow-up" on the
    # dashboard row, next_follow_up is cleared and this timestamp records
    # the closure. The Lead/Contact stays Active — this is "I'm done chasing
    # this one for now", not "closed lost".
    follow_up_closed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # === 关联 ===
    contact_id: Mapped[int] = mapped_column(
        ForeignKey("contacts.id"), nullable=False, index=True
    )
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    # owner_id 和 contact.owner_id 通常相同，但 Manager 可以重新分配 lead

    # === 时间戳 ===
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # === 关系 ===
    contact: Mapped["Contact"] = relationship("Contact", back_populates="leads")
    owner: Mapped["User"] = relationship("User")
