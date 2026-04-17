"""
Import real contacts from docs/contacts_clean_for_crm.csv into the database.
Parses location from notes field, handles missing fields, skips rows without first_name.
"""

import asyncio
import csv
import re
import sys

sys.path.insert(0, ".")

from app.core.database import async_session, engine, Base
from app.models.user import User, UserRole
from app.models.contact import Contact
from app.models.lead import Lead, LeadStatus
from sqlalchemy import select, text


def parse_location(notes: str):
    """Extract city and state from notes like 'Location: Dallas, TX' or 'Address: ..., City, State, US, ZIP'"""
    city, state = None, None

    # Try "Location: City, State"
    loc_match = re.search(r"Location:\s*([^|]+)", notes)
    if loc_match:
        parts = [p.strip() for p in loc_match.group(1).split(",")]
        if len(parts) >= 2:
            city = parts[0]
            state = parts[1]
        elif len(parts) == 1:
            city = parts[0]
        return city, state

    # Try "Address: street, city, state, country, zip"
    addr_match = re.search(r"Address:\s*([^|]+)", notes)
    if addr_match:
        parts = [p.strip() for p in addr_match.group(1).split(",")]
        # Format: street, city, state, country, zip — city is usually index 1
        if len(parts) >= 4:
            city = parts[-4]  # city
            state = parts[-3]  # state
        elif len(parts) >= 2:
            city = parts[-2]
            state = parts[-1]

    return city, state


def parse_tags(tags_str: str):
    """Parse comma-separated tags, return as list"""
    if not tags_str:
        return []
    return [t.strip() for t in tags_str.split(",") if t.strip()]


async def seed():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        # Get admin user
        result = await session.execute(select(User).where(User.role == UserRole.ADMIN))
        admin = result.scalar_one_or_none()
        if not admin:
            print("No admin user found. Run the backend first.")
            return

        csv_path = "../docs/contacts_clean_for_crm.csv"
        created = 0
        skipped = 0
        duped = 0

        with open(csv_path, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader, start=2):  # start=2 because row 1 is header
                first_name = (row.get("first_name") or "").strip()
                last_name = (row.get("last_name") or "").strip()
                email = (row.get("email") or "").strip().lower()

                # Skip rows without first_name
                if not first_name:
                    print(f"  Row {i}: Skipped (no first_name)")
                    skipped += 1
                    continue

                # Dedup by email
                if email:
                    result = await session.execute(
                        select(Contact).where(Contact.email == email)
                    )
                    if result.scalar_one_or_none():
                        print(f"  Row {i}: Duplicate email {email}, skipping")
                        duped += 1
                        continue

                # Parse location from notes
                notes = (row.get("notes") or "").strip()
                city, state = parse_location(notes) if notes else (None, None)

                # Parse tags
                tags = parse_tags(row.get("industry_tags") or "")

                # Create contact
                import json
                contact = Contact(
                    first_name=first_name,
                    last_name=last_name or "",
                    email=email or None,
                    phone=(row.get("phone") or "").strip() or None,
                    title=(row.get("title") or "").strip() or None,
                    company_name=(row.get("company_name") or "").strip() or None,
                    linkedin_url=(row.get("linkedin_url") or "").strip() or None,
                    city=city,
                    state=state,
                    industry_tags_array=tags if tags else None,
                    ai_tags=json.dumps(tags) if tags else None,
                    notes=notes or None,
                    import_source="csv_import",
                    owner_id=admin.id,
                )
                session.add(contact)
                await session.flush()

                # Create a Lead record
                lead = Lead(
                    contact_id=contact.id,
                    owner_id=admin.id,
                    status=LeadStatus.NEW,
                )
                session.add(lead)
                created += 1

        await session.commit()
        print(f"\nImport complete:")
        print(f"  Created: {created}")
        print(f"  Skipped (no name): {skipped}")
        print(f"  Duplicates: {duped}")
        print(f"  Total processed: {created + skipped + duped}")


if __name__ == "__main__":
    asyncio.run(seed())
