"""
向量 Embedding 表 — 为语义搜索服务
每条活动记录生成一个 1536 维向量（OpenAI text-embedding-3-small）
存入 pgvector，支持用大白话搜历史记录
例："哪些客户提到过预算问题" → 语义匹配所有相关对话
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from pgvector.sqlalchemy import Vector

from app.core.database import Base


class Embedding(Base):
    __tablename__ = "embeddings"

    # === 基本信息 ===
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # === 关联的活动 ===
    activity_id: Mapped[int] = mapped_column(
        ForeignKey("activities.id"), nullable=False, unique=True, index=True
    )

    # === 用于生成 embedding 的原始文本 ===
    source_text: Mapped[str] = mapped_column(Text, nullable=False)

    # === 向量数据（1536 维，匹配 OpenAI text-embedding-3-small）===
    vector = mapped_column(Vector(1536), nullable=False)

    # === 时间戳 ===
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
