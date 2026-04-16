"""
Seed email templates + a test email account
Run with: python seed_emails.py
"""

import asyncio
import sys

sys.path.insert(0, ".")

from app.core.database import async_session, engine, Base
from app.models.user import User, UserRole
from app.models.email_template import EmailTemplate
from app.models.email_account import EmailAccount
from sqlalchemy import select, text


async def seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        # Get admin user
        result = await session.execute(select(User).where(User.role == UserRole.ADMIN))
        admin = result.scalar_one_or_none()
        if not admin:
            print("No admin user. Run backend first.")
            return

        # Check if templates exist
        result = await session.execute(select(EmailTemplate).limit(1))
        if result.scalar_one_or_none():
            print("Templates already exist. Skipping.")
            return

        # === Sample Email Templates ===
        templates = [
            EmailTemplate(
                name="Initial Outreach",
                subject="Quick question about {{company_name}}",
                body="""Hi {{first_name}},

I came across {{company_name}} and was impressed by what you're doing in the {{industry}} space.

I'm reaching out because we've helped similar companies streamline their operations and I think there might be a fit.

Would you be open to a quick 15-minute call this week to explore?

Best,
{{sender_name}}""",
                created_by=admin.id,
            ),
            EmailTemplate(
                name="Follow-up #1",
                subject="Re: Quick question about {{company_name}}",
                body="""Hi {{first_name}},

Just wanted to follow up on my previous email. I know things get busy!

I'd love to share a quick case study showing how we helped a company in {{industry}} achieve significant results.

Would a brief call work for you this week?

Best,
{{sender_name}}""",
                created_by=admin.id,
            ),
            EmailTemplate(
                name="Value-Add Touch",
                subject="Thought you'd find this useful, {{first_name}}",
                body="""Hi {{first_name}},

I recently came across an article about trends in {{industry}} and thought of {{company_name}}.

[Insert relevant article or insight here]

Happy to chat about how this applies to what you're building. Let me know if you'd like to connect.

Best,
{{sender_name}}""",
                created_by=admin.id,
            ),
            EmailTemplate(
                name="Break-up Email",
                subject="Should I close your file?",
                body="""Hi {{first_name}},

I've reached out a few times and haven't heard back, so I'll assume the timing isn't right.

I'll go ahead and close your file on my end. If anything changes in the future, feel free to reach out — I'm always happy to help.

Wishing you and the {{company_name}} team all the best.

{{sender_name}}""",
                created_by=admin.id,
            ),
        ]

        for t in templates:
            session.add(t)

        # Add a test email account
        account = EmailAccount(
            user_id=admin.id,
            email_address="david@amazonsolutions.us",
            display_name="David Zheng",
            is_active=True,
        )
        session.add(account)

        await session.commit()
        print(f"Created {len(templates)} email templates")
        print(f"Created 1 email account: david@amazonsolutions.us")
        print("Done!")


if __name__ == "__main__":
    asyncio.run(seed())
