"""
Seed data script — Insert sample contacts, leads, and activities
Run with: python seed_data.py
This gives you real data to see in the UI during development.
"""

import asyncio
import sys
from datetime import date, datetime, timedelta, timezone

# Add backend to path so imports work
sys.path.insert(0, ".")

from app.core.database import async_session, engine, Base
from app.models.user import User, UserRole
from app.models.contact import Contact
from app.models.lead import Lead, LeadStatus
from app.models.activity import Activity, ActivityType
from sqlalchemy import select, text


async def seed():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        # Get the admin user
        result = await session.execute(
            select(User).where(User.role == UserRole.ADMIN)
        )
        admin = result.scalar_one_or_none()
        if admin is None:
            print("No admin user found. Run the backend first to create one.")
            return

        # Check if we already have contacts
        result = await session.execute(select(Contact).limit(1))
        if result.scalar_one_or_none() is not None:
            print("Seed data already exists. Skipping.")
            return

        admin_id = admin.id
        today = date.today()

        # === Sample Contacts ===
        contacts_data = [
            {
                "first_name": "John",
                "last_name": "Smith",
                "email": "john.smith@techcorp.com",
                "phone": "+1-415-555-0101",
                "title": "VP of Engineering",
                "company_name": "TechCorp Inc",
                "company_domain": "techcorp.com",
                "industry": "SaaS / Cloud",
                "company_size": "200-500",
                "linkedin_url": "https://linkedin.com/in/johnsmith",
                "ai_tags": '["SaaS", "Cloud Infrastructure", "Series B", "Engineering Leader"]',
            },
            {
                "first_name": "Sarah",
                "last_name": "Lee",
                "email": "sarah.lee@finova.io",
                "phone": "+1-212-555-0202",
                "title": "Head of Operations",
                "company_name": "Finova Financial",
                "company_domain": "finova.io",
                "industry": "FinTech",
                "company_size": "50-200",
                "linkedin_url": "https://linkedin.com/in/sarahlee",
                "ai_tags": '["FinTech", "Operations", "Process Automation", "Compliance"]',
            },
            {
                "first_name": "Michael",
                "last_name": "Chen",
                "email": "m.chen@logismart.com",
                "phone": "+1-310-555-0303",
                "title": "CTO",
                "company_name": "LogiSmart",
                "company_domain": "logismart.com",
                "industry": "Logistics / Supply Chain",
                "company_size": "500-1000",
                "linkedin_url": "https://linkedin.com/in/michaelchen",
                "ai_tags": '["Logistics", "AI/ML", "Supply Chain", "Enterprise"]',
            },
            {
                "first_name": "Emily",
                "last_name": "Davis",
                "email": "emily.d@greenleaf.co",
                "phone": "+1-503-555-0404",
                "title": "Director of Marketing",
                "company_name": "GreenLeaf Solutions",
                "company_domain": "greenleaf.co",
                "industry": "CleanTech",
                "company_size": "50-200",
                "linkedin_url": "https://linkedin.com/in/emilydavis",
                "ai_tags": '["CleanTech", "Sustainability", "Marketing", "B2B"]',
            },
            {
                "first_name": "Robert",
                "last_name": "Kim",
                "email": "rkim@dataflow.ai",
                "title": "CEO",
                "company_name": "DataFlow AI",
                "company_domain": "dataflow.ai",
                "industry": "AI / Machine Learning",
                "company_size": "10-50",
                "ai_tags": '["AI", "Data Analytics", "Startup", "Seed Stage"]',
            },
        ]

        contacts = []
        for cdata in contacts_data:
            c = Contact(**cdata, owner_id=admin_id)
            session.add(c)
            contacts.append(c)

        await session.flush()  # get IDs

        # === Sample Leads with follow-up dates ===
        leads_data = [
            {
                "contact": contacts[0],
                "status": LeadStatus.INTERESTED,
                "next_follow_up": today - timedelta(days=1),  # Overdue!
                "follow_up_reason": "Send comparison chart — evaluating competitors",
                "notes": "Very engaged, asked detailed pricing questions",
            },
            {
                "contact": contacts[1],
                "status": LeadStatus.CONTACTED,
                "next_follow_up": today,  # Due today
                "follow_up_reason": "Follow up on proposal sent last week",
                "notes": "Budget approval pending",
            },
            {
                "contact": contacts[2],
                "status": LeadStatus.MEETING_SET,
                "next_follow_up": today + timedelta(days=2),  # This week
                "follow_up_reason": "Prepare demo for Thursday meeting",
                "notes": "CTO wants to see integration capabilities",
            },
            {
                "contact": contacts[3],
                "status": LeadStatus.NEW,
                "next_follow_up": today + timedelta(days=3),
                "follow_up_reason": "Send intro email with case study",
            },
            {
                "contact": contacts[4],
                "status": LeadStatus.CONTACTED,
                "next_follow_up": today + timedelta(days=5),
                "follow_up_reason": "Check if they reviewed the deck",
            },
        ]

        for ldata in leads_data:
            lead = Lead(
                contact_id=ldata["contact"].id,
                owner_id=admin_id,
                status=ldata["status"],
                next_follow_up=ldata["next_follow_up"],
                follow_up_reason=ldata["follow_up_reason"],
                notes=ldata.get("notes"),
            )
            session.add(lead)

        # === Sample Activities ===
        now = datetime.now(timezone.utc)
        activities_data = [
            {
                "contact": contacts[0],
                "activity_type": ActivityType.CALL,
                "subject": "Intro call — discussed cloud migration needs",
                "content": "John is looking for a new cloud infrastructure provider. Currently on AWS but unhappy with costs. Q3 budget approved for evaluation.",
                "created_at": now - timedelta(days=3),
            },
            {
                "contact": contacts[0],
                "activity_type": ActivityType.EMAIL,
                "subject": "Sent pricing sheet and case studies",
                "content": "Followed up on the call with our enterprise pricing and two case studies from similar SaaS companies.",
                "created_at": now - timedelta(days=2),
            },
            {
                "contact": contacts[1],
                "activity_type": ActivityType.EMAIL,
                "subject": "Cold email — operational efficiency pitch",
                "content": "Personalized outreach highlighting how we helped similar FinTech companies reduce manual processes by 40%.",
                "created_at": now - timedelta(days=5),
            },
            {
                "contact": contacts[1],
                "activity_type": ActivityType.CALL,
                "subject": "Sarah called back — interested in a proposal",
                "content": "She mentioned they're spending too much time on compliance reporting. Wants a formal proposal by Friday.",
                "created_at": now - timedelta(days=1),
            },
            {
                "contact": contacts[2],
                "activity_type": ActivityType.LINKEDIN,
                "subject": "Connected on LinkedIn, exchanged messages",
                "content": "Michael accepted the connection request. He's interested in AI-powered route optimization.",
                "created_at": now - timedelta(days=4),
            },
            {
                "contact": contacts[2],
                "activity_type": ActivityType.MEETING,
                "subject": "Video call — deep dive on integration requirements",
                "content": "45-min call. They use SAP for ERP. Need API integration. CTO wants a live demo next week.",
                "created_at": now - timedelta(hours=6),
            },
            {
                "contact": contacts[3],
                "activity_type": ActivityType.EMAIL,
                "subject": "Intro email sent",
                "content": "First outreach to Emily. Highlighted our sustainability-focused clients.",
                "created_at": now - timedelta(hours=3),
            },
            {
                "contact": contacts[4],
                "activity_type": ActivityType.NOTE,
                "subject": "Research note — DataFlow AI raised seed round",
                "content": "Found on TechCrunch that they just closed a $5M seed round. Good timing for outreach.",
                "created_at": now - timedelta(hours=1),
            },
        ]

        for adata in activities_data:
            activity = Activity(
                contact_id=adata["contact"].id,
                user_id=admin_id,
                activity_type=adata["activity_type"],
                subject=adata["subject"],
                content=adata.get("content"),
                created_at=adata["created_at"],
            )
            session.add(activity)

        await session.commit()
        print(f"Seed data inserted:")
        print(f"  - {len(contacts)} contacts")
        print(f"  - {len(leads_data)} leads with follow-up dates")
        print(f"  - {len(activities_data)} activities")
        print("Done! Refresh your browser to see the data.")


if __name__ == "__main__":
    asyncio.run(seed())
