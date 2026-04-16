"""
用户表 — 存储系统用户（Admin / Manager / SDR）
三级权限：
  - admin:   David，可以管一切
  - manager: 看团队数据，分配 lead
  - sdr:     只看自己的客户，互相隔离
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import String, DateTime, Enum, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class UserRole(str, enum.Enum):
    """用户角色枚举"""
    ADMIN = "admin"
    MANAGER = "manager"
    SDR = "sdr"


class User(Base):
    __tablename__ = "users"

    # === 基本信息 ===
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)

    # === 角色权限 ===
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole), nullable=False, default=UserRole.SDR
    )

    # === 团队关系 ===
    # Manager 管理多个 SDR；SDR 的 manager_id 指向其上级 Manager
    # Admin 不需要 manager_id
    manager_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    # === 状态 ===
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # === 时间戳（全部用 UTC）===
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
    # Manager 下属的 SDR 列表
    team_members: Mapped[List["User"]] = relationship(
        "User", back_populates="manager", remote_side="User.manager_id"
    )
    manager: Mapped[Optional["User"]] = relationship(
        "User", back_populates="team_members", remote_side="User.id"
    )
