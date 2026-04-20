"""
数据库初始化 — 系统启动时自动执行
1. 启用 pgvector 扩展（语义搜索需要）
2. 创建所有数据库表
3. 如果没有 Admin 用户，创建默认 Admin（David）
"""

from sqlalchemy import text

from app.core.database import engine, async_session, Base
from app.models import User, UserRole  # 导入所有模型，确保表结构被注册
from app.core.security import hash_password


async def init_db():
    """初始化数据库：建表 + 迁移字段 + 创建默认 Admin"""
    async with engine.begin() as conn:
        # 启用 pgvector 扩展
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        # 创建所有表（已存在的表不会重复创建）
        await conn.run_sync(Base.metadata.create_all)

        # 字段级 idempotent 迁移 — create_all 不会对已存在表 ALTER
        # Field-level idempotent migrations since create_all doesn't ALTER existing tables.
        # 每条 ALTER 都用 IF NOT EXISTS，重复执行无副作用。
        field_migrations = [
            # 任务 5 AI 研究报告缓存元数据
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ai_person_generated_at TIMESTAMPTZ",
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ai_company_generated_at TIMESTAMPTZ",
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ai_report_model VARCHAR(100)",
            # 任务 11 EmailAccount 扩展 SMTP 支持
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS provider_type VARCHAR(30) NOT NULL DEFAULT 'smtp'",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS smtp_host VARCHAR(255)",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS smtp_port INTEGER",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_host VARCHAR(255)",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_port INTEGER",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS smtp_username VARCHAR(255)",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS smtp_password_encrypted TEXT",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS smtp_encryption VARCHAR(20)",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS last_test_error TEXT",
            # Team Members: 登录时间追踪
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ",
            # Contact assignment: 当前负责跟进的 Manager
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id)",
            "CREATE INDEX IF NOT EXISTS ix_contacts_assigned_to ON contacts(assigned_to)",
            # Task 2: phone → mobile_phone + office_phone 拆分
            # (1) 先 add mobile_phone (if not exists)
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS mobile_phone VARCHAR(50)",
            # (2) 重命名 phone → office_phone (幂等：只在还有 phone 时改)
            # PostgreSQL 没有 RENAME COLUMN IF EXISTS，用 DO 块条件判断
            """
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='contacts' AND column_name='phone'
              ) THEN
                ALTER TABLE contacts RENAME COLUMN phone TO office_phone;
              END IF;
            END $$
            """,
            # 如果连 office_phone 也不存在（新环境），补上
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS office_phone VARCHAR(50)",
        ]
        for sql in field_migrations:
            await conn.execute(text(sql))

    # 创建默认 Admin 用户（如果还没有的话）
    async with async_session() as session:
        from sqlalchemy import select
        result = await session.execute(
            select(User).where(User.role == UserRole.ADMIN)
        )
        admin = result.scalar_one_or_none()

        if admin is None:
            # 第一次启动，创建 David 的 Admin 账号
            admin = User(
                email="info@amazonsolutions.us",
                hashed_password=hash_password("admin123"),  # 首次登录后请改密码！
                full_name="David Zheng",
                role=UserRole.ADMIN,
                is_active=True,
            )
            session.add(admin)
            await session.commit()
            print("✅ 默认 Admin 账号已创建: info@amazonsolutions.us / admin123")
        else:
            print("✅ Admin 账号已存在，跳过创建")
