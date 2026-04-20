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
    """ICP search filters — mapped to Apollo API parameters"""
    # Primary Search
    q_organization_name: Optional[str] = None              # Company Name
    company_domain: Optional[str] = None                   # Company Domain
    q_organization_keyword_tags: Optional[List[str]] = None    # Keywords (industry/niche)
    # 新增：LinkedIn URL / Person Name 都走 Apollo 的 free-text q_keywords
    # New: LinkedIn URL + Person Name → Apollo free-text q_keywords
    q_keywords: Optional[str] = None

    # Refine filters
    person_titles: Optional[List[str]] = None
    person_seniorities: Optional[List[str]] = None
    person_locations: Optional[List[str]] = None           # 支持多州 multi-state
    organization_industry_tag_ids: Optional[List[str]] = None
    employee_ranges: Optional[List[str]] = None
    revenue_ranges: Optional[List[str]] = None

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


@router.get("/test")
async def test_apollo(current_user: User = Depends(get_current_user)):
    """Temporary debug endpoint — test Apollo API with minimal request"""
    import httpx

    api_key = apollo_service.api_key
    if not api_key:
        return {"error": "No Apollo API key configured"}

    url = "https://api.apollo.io/api/v1/mixed_people/api_search"

    # Attempt 1: API key in header
    headers = {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": api_key,
    }
    payload = {
        "person_locations": ["California, US"],
        "per_page": 5,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        r1 = await client.post(url, json=payload, headers=headers)
        print(f"=== ATTEMPT 1 (key in header) === Status: {r1.status_code}")
        print(f"Response: {r1.text[:500]}")

        if r1.status_code == 200:
            return {"attempt": 1, "method": "key_in_header", "status": r1.status_code, "data": r1.json()}

        # Attempt 2: API key in body
        headers2 = {"Content-Type": "application/json"}
        payload2 = {
            "api_key": api_key,
            "person_locations": ["California, US"],
            "per_page": 5,
        }
        r2 = await client.post(url, json=payload2, headers=headers2)
        print(f"=== ATTEMPT 2 (key in body) === Status: {r2.status_code}")
        print(f"Response: {r2.text[:500]}")

        if r2.status_code == 200:
            return {"attempt": 2, "method": "key_in_body", "status": r2.status_code, "data": r2.json()}

        return {
            "attempt1": {"method": "key_in_header", "status": r1.status_code, "response": r1.text[:300]},
            "attempt2": {"method": "key_in_body", "status": r2.status_code, "response": r2.text[:300]},
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
            q_organization_name=data.q_organization_name,
            person_titles=data.person_titles,
            person_seniorities=data.person_seniorities,
            person_locations=data.person_locations,
            organization_industry_tag_ids=data.organization_industry_tag_ids,
            organization_num_employees_ranges=data.employee_ranges,
            organization_revenue_ranges=data.revenue_ranges,
            q_organization_keyword_tags=data.q_organization_keyword_tags,
            q_organization_domains=data.company_domain,
            q_keywords=data.q_keywords,
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
            "industry_keywords": org.get("keywords") or [],
            "company_size": _format_employee_count(org.get("estimated_num_employees")),
            "annual_revenue": org.get("annual_revenue_printed") or _format_revenue(org.get("annual_revenue")),
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


class EnrichRequest(BaseModel):
    """Apollo IDs to enrich (costs credits)"""
    apollo_ids: List[str]


@router.post("/enrich")
async def enrich_people(
    data: EnrichRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Enrich selected people — get email, phone, LinkedIn, company details.
    CONSUMES Apollo credits (1 credit per person).
    """
    if not apollo_service.is_configured:
        raise HTTPException(status_code=400, detail="Apollo API key not configured.")

    if len(data.apollo_ids) > 25:
        raise HTTPException(status_code=400, detail="Maximum 25 people per enrich request.")

    try:
        enriched = await apollo_service.enrich_people_bulk(data.apollo_ids)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Apollo enrichment error: {str(e)}")

    # Build enriched results
    results = []
    for person in enriched:
        if not person:
            continue
        org = person.get("organization", {}) or {}
        phone_numbers = person.get("phone_numbers") or []
        results.append({
            "apollo_id": person.get("id"),
            "first_name": person.get("first_name", ""),
            "last_name": person.get("last_name", ""),
            "email": person.get("email"),
            "title": person.get("title"),
            "phone": phone_numbers[0].get("sanitized_number") if phone_numbers else None,
            "linkedin_url": person.get("linkedin_url"),
            "company_name": org.get("name"),
            "company_domain": org.get("primary_domain"),
            "industry": org.get("industry"),
            "industry_keywords": org.get("keywords") or [],
            "company_size": _format_employee_count(org.get("estimated_num_employees")),
            "annual_revenue": org.get("annual_revenue_printed") or _format_revenue(org.get("annual_revenue")),
            "city": person.get("city"),
            "state": person.get("state"),
            "country": person.get("country"),
        })

    return {
        "enriched": results,
        "count": len(results),
        "credits_used": len(results),
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
            # Apollo search result's "phone" → office_phone (corporate line)
            if person.get("phone"):
                existing.office_phone = person["phone"]
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
                office_phone=person.get("phone"),  # search result phone = corporate
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
        "failed": 0,
        "total": created + updated,
        "message": f"Added {created} new contacts, updated {updated} existing.",
    }


def _format_revenue(revenue) -> Optional[str]:
    """Convert numeric annual revenue to human-readable string"""
    if not revenue:
        return None
    try:
        r = float(revenue)
    except (ValueError, TypeError):
        return None
    if r >= 1_000_000_000:
        return f"${r / 1_000_000_000:.1f}B"
    elif r >= 1_000_000:
        return f"${r / 1_000_000:.0f}M"
    elif r >= 1_000:
        return f"${r / 1_000:.0f}K"
    return f"${r:.0f}"


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
