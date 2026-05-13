"""
数据库初始化 — 系统启动时自动执行
1. 创建所有数据库表
2. 如果没有 Admin 用户，创建默认 Admin（David）
"""

from sqlalchemy import text

from app.core.database import engine, async_session, Base
from app.models import User, UserRole  # 导入所有模型，确保表结构被注册
from app.core.security import hash_password


async def init_db():
    """初始化数据库：建表 + 迁移字段 + 创建默认 Admin"""
    async with engine.begin() as conn:
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
            # 2026-05-06: Activity Comments real-functionalized.
            # ON DELETE CASCADE on activity_id — deleting the activity wipes
            # the thread. ON DELETE SET NULL on user_id so removing a user
            # leaves comments visible (frontend renders "(deleted user)").
            """
            CREATE TABLE IF NOT EXISTS activity_comments (
                id SERIAL PRIMARY KEY,
                activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                text TEXT NOT NULL,
                previous_text TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_activity_comments_activity_id_created_at ON activity_comments(activity_id, created_at)",
            # 2026-05-08 trim: drop the email module, embeddings, pgvector
            # extension, and the matched_fields column on enrichment_log.
            # All idempotent — IF EXISTS makes re-running these harmless.
            "DROP TABLE IF EXISTS sent_emails CASCADE",
            "DROP TABLE IF EXISTS email_templates CASCADE",
            "DROP TABLE IF EXISTS email_accounts CASCADE",
            "DROP TABLE IF EXISTS embeddings CASCADE",
            "ALTER TABLE enrichment_log DROP COLUMN IF EXISTS matched_fields",
            "DROP EXTENSION IF EXISTS vector",
            # 2026-05-12 Dashboard V1 — mention plumbing + close action.
            # ActivityComment gets two new columns; new join table tracks
            # per-user read state; Lead gets a close timestamp.
            "ALTER TABLE activity_comments ADD COLUMN IF NOT EXISTS mentioned_user_ids INTEGER[] NOT NULL DEFAULT '{}'",
            "ALTER TABLE activity_comments ADD COLUMN IF NOT EXISTS auto_notify_assigned BOOLEAN NOT NULL DEFAULT TRUE",
            "ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_closed_at TIMESTAMPTZ",
            """
            CREATE TABLE IF NOT EXISTS activity_comment_reads (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                comment_id INTEGER NOT NULL REFERENCES activity_comments(id) ON DELETE CASCADE,
                read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (user_id, comment_id)
            )
            """,
            # GIN index speeds up the "mentioned_user_ids @> ARRAY[me]" filter
            # used by GET /api/dashboard/mentions.
            "CREATE INDEX IF NOT EXISTS ix_activity_comments_mentioned_user_ids ON activity_comments USING GIN (mentioned_user_ids)",
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
