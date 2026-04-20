"""
Enrichment 使用日志 — 记录每次 Apollo People Match 调用的 credit 消耗
用途：每日 / 15 天滚动 的 enrichment 额度控制
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EnrichmentLog(Base):
    __tablename__ = "enrichment_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), index=True, nullable=True
    )
    contact_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("contacts.id"), index=True, nullable=True
    )
    credits_used: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(20), default="ok", nullable=False)
    # matched_fields 用空格分隔存储，避免一个字段一行
    matched_fields: Mapped[Optional[str]] = mapped_column(String(200))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
