"""
联系人表 — 存储 SDR 的客户/潜在客户信息
数据来源：Apollo.io 导入 或 手动创建
去重规则：email + company_domain 组合唯一
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import String, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Contact(Base):
    __tablename__ = "contacts"

    # === 唯一约束：同一个邮箱+公司域名 不会重复导入 ===
    __table_args__ = (
        UniqueConstraint("email", "company_domain", name="uq_contact_email_domain"),
    )

    # === 基本信息 ===
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50))

    # === 工作信息 ===
    title: Mapped[Optional[str]] = mapped_column(String(200))          # 职位
    company_name: Mapped[Optional[str]] = mapped_column(String(200))   # 公司名
    company_domain: Mapped[Optional[str]] = mapped_column(String(200)) # 公司域名（去重用）
    industry: Mapped[Optional[str]] = mapped_column(String(100))       # 行业
    company_size: Mapped[Optional[str]] = mapped_column(String(50))    # 公司规模

    # === 社交链接 ===
    linkedin_url: Mapped[Optional[str]] = mapped_column(String(500))   # LinkedIn 主页

    # === AI 生成内容 ===
    ai_person_report: Mapped[Optional[str]] = mapped_column(Text)      # AI 人物研究报告
    ai_company_report: Mapped[Optional[str]] = mapped_column(Text)     # AI 公司研究报告
    ai_tags: Mapped[Optional[str]] = mapped_column(Text)               # 行业关键词标签（JSON 格式）

    # === Apollo.io 数据 ===
    apollo_id: Mapped[Optional[str]] = mapped_column(String(100))      # Apollo 内部 ID（用于同步）

    # === 归属关系 ===
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    # owner_id 指向负责这个联系人的 SDR
    # SDR 只能看到 owner_id = 自己的联系人（权限隔离）

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
    owner: Mapped["User"] = relationship("User")
    activities: Mapped[List["Activity"]] = relationship(
        "Activity", back_populates="contact", order_by="Activity.created_at.desc()"
    )
    leads: Mapped[List["Lead"]] = relationship("Lead", back_populates="contact")
