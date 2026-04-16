"""
Apollo API routes — Search prospects and import them into the CRM
Key features:
  - ICP-based people search
  - Automatic dedup: marks existing contacts vs new leads
  - Bulk import with smart merge (new → create, existing → update without overwriting notes)
  - Import result report
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.contact import Contact
from app.models.lead import Lead, LeadStatus
from app.services.apollo import apollo_service

router = APIRouter(prefix="/api/apollo", tags=["Apollo"])


# === Request/Response schemas ===

class SearchRequest(BaseModel):
    """ICP search filters"""
    person_titles: Optional[List[str]] = None       # e.g. ["VP of Engineering", "CTO"]
    person_locations: Optional[List[str]] = None     # e.g. ["United States"]
    industry_keywords: Optional[List[str]] = None    # e.g. ["SaaS", "FinTech"]
    employee_ranges: Optional[List[str]] = None      # e.g. ["1,50", "51,200"]
    company_domain: Optional[str] = None             # e.g. "techcorp.com"
    page: int = 1
    per_page: int = 25


class ImportRequest(BaseModel):
    """List of Apollo person records to import"""
    people: List[dict]  # Raw Apollo person objects from search results


# === Endpoints ===

@router.get("/status")
async def apollo_status(current_user: User = Depends(get_current_user)):
    """Check if Apollo API key is configured"""
    return {
        "configured": apollo_service.is_configured,
        "message": "Apollo API key is configured" if apollo_service.is_configured
                   else "Apollo API key not set. Add it in Settings or set APOLLO_API_KEY env var.",
    }


@router.post("/search")
async def search_people(
    data: SearchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Search Apollo for people matching ICP criteria.
    Results are automatically cross-referenced with local database:
      - Blue "Exists" badge + last contact date for known contacts
      - Green "New Lead" badge for new prospects
    """
    if not apollo_service.is_configured:
        raise HTTPException(
            status_code=400,
            detail="Apollo API key not configured. Add it in Settings.",
        )

    # Call Apollo API
    try:
        result = await apollo_service.search_people(
            person_titles=data.person_titles,
            person_locations=data.person_locations,
            organization_num_employees_ranges=data.employee_ranges,
            q_organization_domains=data.company_domain,
            page=data.page,
            per_page=data.per_page,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Apollo API error: {str(e)}")

    people = result.get("people", [])
    pagination = result.get("pagination", {})

    # Cross-reference with local database for dedup
    # Collect all emails from search results
    emails = [p.get("email") for p in people if p.get("email")]
    domains = [p.get("organization", {}).get("primary_domain") for p in people
               if p.get("organization", {}).get("primary_domain")]

    # Find existing contacts by email
    existing_by_email = {}
    if emails:
        result = await db.execute(
            select(Contact).where(Contact.email.in_(emails))
        )
        for contact in result.scalars().all():
            if contact.email:
                existing_by_email[contact.email.lower()] = contact

    # Build enriched results
    enriched_people = []
    for person in people:
        email = (person.get("email") or "").lower()
        existing = existing_by_email.get(email)

        org = person.get("organization", {}) or {}

        enriched_people.append({
            # Apollo data
            "apollo_id": person.get("id"),
            "first_name": person.get("first_name", ""),
            "last_name": person.get("last_name", ""),
            "email": person.get("email"),
            "title": person.get("title"),
            "phone": (person.get("phone_numbers") or [{}])[0].get("sanitized_number") if person.get("phone_numbers") else None,
            "linkedin_url": person.get("linkedin_url"),
            "company_name": org.get("name"),
            "company_domain": org.get("primary_domain"),
            "industry": org.get("industry"),
            "company_size": _format_employee_count(org.get("estimated_num_employees")),
            "photo_url": person.get("photo_url"),
            "city": person.get("city"),
            "state": person.get("state"),
            "country": person.get("country"),
            # Dedup status
            "is_existing": existing is not None,
            "existing_contact_id": existing.id if existing else None,
            "last_updated": str(existing.updated_at) if existing else None,
        })

    return {
        "people": enriched_people,
        "total": pagination.get("total_entries", 0),
        "page": pagination.get("page", 1),
        "per_page": pagination.get("per_page", 25),
        "total_pages": pagination.get("total_pages", 0),
    }


@router.post("/import")
async def import_people(
    data: ImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Import selected people from Apollo search results into the CRM.
    Smart merge logic:
      - New person → create Contact + Lead
      - Existing person → update info (but never overwrite manual notes/reports)
    Returns a summary report.
    """
    created = 0
    updated = 0
    skipped = 0

    for person in data.people:
        email = (person.get("email") or "").strip().lower()
        company_domain = (person.get("company_domain") or "").strip().lower()

        # Check if contact already exists (by email)
        existing = None
        if email:
            result = await db.execute(
                select(Contact).where(Contact.email == email)
            )
            existing = result.scalar_one_or_none()

        if existing:
            # Update existing contact (don't overwrite AI reports or manual notes)
            if person.get("title"):
                existing.title = person["title"]
            if person.get("phone"):
                existing.phone = person["phone"]
            if person.get("linkedin_url"):
                existing.linkedin_url = person["linkedin_url"]
            if person.get("company_name"):
                existing.company_name = person["company_name"]
            if person.get("company_domain"):
                existing.company_domain = person["company_domain"]
            if person.get("industry"):
                existing.industry = person["industry"]
            if person.get("company_size"):
                existing.company_size = person["company_size"]
            if person.get("apollo_id"):
                existing.apollo_id = person["apollo_id"]
            updated += 1
        else:
            # Create new contact
            first_name = person.get("first_name", "").strip()
            last_name = person.get("last_name", "").strip()
            if not first_name:
                skipped += 1
                continue

            contact = Contact(
                first_name=first_name,
                last_name=last_name or "",
                email=email or None,
                phone=person.get("phone"),
                title=person.get("title"),
                company_name=person.get("company_name"),
                company_domain=company_domain or None,
                industry=person.get("industry"),
                company_size=person.get("company_size"),
                linkedin_url=person.get("linkedin_url"),
                apollo_id=person.get("apollo_id"),
                owner_id=current_user.id,
            )
            db.add(contact)
            await db.flush()  # get the ID

            # Create a Lead record for the new contact
            lead = Lead(
                contact_id=contact.id,
                owner_id=current_user.id,
                status=LeadStatus.NEW,
            )
            db.add(lead)
            created += 1

    await db.flush()

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "total": created + updated,
        "message": f"Added {created} new contacts, updated {updated} existing.",
    }


def _format_employee_count(count) -> Optional[str]:
    """Convert numeric employee count to a human-readable range"""
    if not count:
        return None
    count = int(count)
    if count <= 10:
        return "1-10"
    elif count <= 50:
        return "10-50"
    elif count <= 200:
        return "50-200"
    elif count <= 500:
        return "200-500"
    elif count <= 1000:
        return "500-1000"
    else:
        return "1000+"
