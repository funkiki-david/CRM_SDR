"""
数据库连接配置
使用 SQLAlchemy 2.0 异步引擎连接 PostgreSQL
"""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# 创建异步数据库引擎
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,  # 设为 True 可以在终端看到 SQL 语句（调试用）
)

# 创建 Session 工厂 — 每个 API 请求用一个 Session
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


# 所有数据库表的基类
class Base(DeclarativeBase):
    pass


async def get_db():
    """
    依赖注入函数 — FastAPI 的每个需要数据库的接口都会调用这个
    自动管理数据库连接的打开和关闭
    """
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
