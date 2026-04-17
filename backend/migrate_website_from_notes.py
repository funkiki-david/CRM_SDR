"""
Migration: Extract 'Website: https://...' from notes field into the new website column.
Removes the extracted portion from notes.
"""

import asyncio
import re
import sys

sys.path.insert(0, ".")

from app.core.database import async_session
from app.models.contact import Contact
from sqlalchemy import select


async def migrate():
    async with async_session() as session:
        result = await session.execute(
            select(Contact).where(Contact.notes.ilike("%Website:%"))
        )
        contacts = result.scalars().all()

        updated = 0
        for c in contacts:
            if not c.notes:
                continue

            # Extract "Website: https://..." from notes
            match = re.search(r"Website:\s*(https?://\S+)", c.notes)
            if not match:
                continue

            website_url = match.group(1).rstrip("|").strip()

            # Only update if website field is empty
            if c.website:
                continue

            c.website = website_url

            # Remove the "Website: url" segment from notes
            # Handle patterns like "Website: url | " or " | Website: url"
            cleaned = c.notes
            cleaned = re.sub(r"\s*\|\s*Website:\s*https?://\S+", "", cleaned)
            cleaned = re.sub(r"Website:\s*https?://\S+\s*\|\s*", "", cleaned)
            cleaned = re.sub(r"Website:\s*https?://\S+", "", cleaned)
            cleaned = cleaned.strip().strip("|").strip()

            c.notes = cleaned if cleaned else None
            updated += 1

        await session.commit()
        print(f"Migrated {updated} contacts (website extracted from notes)")


if __name__ == "__main__":
    asyncio.run(migrate())
