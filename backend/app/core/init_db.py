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
            # Emails page: extend sent_emails to also hold received messages
            "ALTER TABLE sent_emails ADD COLUMN IF NOT EXISTS direction VARCHAR(20) NOT NULL DEFAULT 'sent'",
            "ALTER TABLE sent_emails ADD COLUMN IF NOT EXISTS from_email VARCHAR(255)",
            "ALTER TABLE sent_emails ADD COLUMN IF NOT EXISTS body_html TEXT",
            "ALTER TABLE sent_emails ADD COLUMN IF NOT EXISTS message_id VARCHAR(500)",
            "ALTER TABLE sent_emails ADD COLUMN IF NOT EXISTS in_reply_to VARCHAR(500)",
            "ALTER TABLE sent_emails ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ",
            "ALTER TABLE sent_emails ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE",
            # contact_id used to be NOT NULL — relax for received rows without a matched contact
            """
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='sent_emails'
                  AND column_name='contact_id' AND is_nullable='NO'
              ) THEN
                ALTER TABLE sent_emails ALTER COLUMN contact_id DROP NOT NULL;
              END IF;
            END $$
            """,
            "CREATE INDEX IF NOT EXISTS ix_sent_emails_direction ON sent_emails(direction)",
            "CREATE INDEX IF NOT EXISTS ix_sent_emails_message_id ON sent_emails(message_id)",
            "CREATE INDEX IF NOT EXISTS ix_sent_emails_from_email ON sent_emails(from_email)",
            # Backfill from_email on existing rows using the linked email_account
            """
            UPDATE sent_emails se
            SET from_email = ea.email_address
            FROM email_accounts ea
            WHERE se.email_account_id = ea.id AND se.from_email IS NULL
            """,
            # Tasks table (Problem 5: AI Suggested To-Do "Create Task")
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
                user_id INTEGER NOT NULL REFERENCES users(id),
                task_type VARCHAR(20) NOT NULL DEFAULT 'follow_up',
                description TEXT NOT NULL,
                due_date DATE,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                source VARCHAR(30) NOT NULL DEFAULT 'manual',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                completed_at TIMESTAMPTZ
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_tasks_status ON tasks(status)",
            "CREATE INDEX IF NOT EXISTS ix_tasks_contact_id ON tasks(contact_id)",
            "CREATE INDEX IF NOT EXISTS ix_tasks_user_id ON tasks(user_id)",
            # AI suggestion snoozes
            """
            CREATE TABLE IF NOT EXISTS ai_suggestion_snoozes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                suggestion_hash VARCHAR(64) NOT NULL,
                snooze_until TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_ai_snooze_user ON ai_suggestion_snoozes(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_ai_snooze_hash ON ai_suggestion_snoozes(suggestion_hash)",
            # Activity audit step B: outcome / temperature / duration columns
            # for the new Log Action mockup. All optional, no backfill.
            "ALTER TABLE activities ADD COLUMN IF NOT EXISTS outcome VARCHAR(20)",
            "ALTER TABLE activities ADD COLUMN IF NOT EXISTS temperature VARCHAR(20)",
            "ALTER TABLE activities ADD COLUMN IF NOT EXISTS duration_minutes INTEGER",
            # Contact lifecycle: is_active=false = archived (hidden by default).
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
        ]
        for sql in field_migrations:
            await conn.execute(text(sql))

    # === Seed initial users (idempotent: skip if email already exists) ===
    # Single source of truth for the team accounts. Adding a row here will
    # create the user on next deploy; existing users are left untouched
    # (password / role changes through the UI are preserved).
    # `team` is informational only — the User model has no team column.
    seed_users = [
        {
            "email": "info@amazonsolutions.us",
            "password": "admin123",
            "full_name": "David Admin",
            "role": UserRole.ADMIN,
            "team": "Amazon Solutions",
        },
        {
            "email": "marketing@graphictac.biz",
            "password": "admin123",
            "full_name": "David Marketing",
            "role": UserRole.MANAGER,
            "team": "GT Marketing",
        },
        {
            "email": "graphictac.doug@gmail.com",
            "password": "admin123",
            "full_name": "Doug",
            "role": UserRole.MANAGER,
            "team": "GT Marketing",
        },
        {
            "email": "graphictac.steve@gmail.com",
            "password": "admin123",
            "full_name": "Steve",
            "role": UserRole.MANAGER,
            "team": "GT Marketing",
        },
        # Disabled 2026-05-05: Graphictac.usa@gmail.com not currently in use.
        # Uncomment to re-enable. Shared login for Alex + Amie; the live DB
        # row already exists with full_name "Alex Amie".
        # {
        #     "email": "Graphictac.usa@gmail.com",
        #     "password": "admin123",
        #     "full_name": "Alex Amie",
        #     "role": UserRole.MANAGER,
        #     "team": "GT Marketing",
        # },
    ]

    async with async_session() as session:
        from sqlalchemy import select, func
        for spec in seed_users:
            # Case-insensitive lookup — Postgres email values are stored
            # exactly as inserted, but humans type them with random casing.
            existing = await session.execute(
                select(User).where(func.lower(User.email) == spec["email"].lower())
            )
            if existing.scalar_one_or_none() is not None:
                print(f"[seed] {spec['email']} already exists — skip")
                continue

            session.add(User(
                email=spec["email"],
                hashed_password=hash_password(spec["password"]),
                full_name=spec["full_name"],
                role=spec["role"],
                is_active=True,
            ))
            print(f"[seed] created {spec['role'].value}: {spec['email']} / {spec['password']}")
        await session.commit()
