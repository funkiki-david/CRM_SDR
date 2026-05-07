"""Finder routes — supports the new 3-tab Finder Page (Spec A).

Three thin endpoints under /api/finder/* that the upcoming tabbed UI
will call. Existing /api/apollo/* routes are NOT touched — old Finder
keeps working until Spec B replaces the frontend.

  POST /api/finder/web-search        Tab 1 fallback (Apollo 0 → Claude web search)
  POST /api/finder/lookup-by-email   Tab 2 (Apollo /people/match by email)
  POST /api/finder/lookup-by-domain  Tab 3 (Apollo /organizations/enrich by domain)
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from app.core.deps import get_current_user
from app.models.user import User
from app.services.apollo import apollo_service
from app.services.web_search import WebSearchCandidate, search_companies_via_web

router = APIRouter(prefix="/api/finder", tags=["Finder"])


# ============================================================================
# Tab 1 fallback — Web Search
# ============================================================================

class WebSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=200)


class WebSearchResponse(BaseModel):
    candidates: List[WebSearchCandidate]
    source: str = "web_search"  # for UI badge ("from web search")


@router.post("/web-search", response_model=WebSearchResponse)
async def finder_web_search(
    body: WebSearchRequest,
    current_user: User = Depends(get_current_user),
):
    """Tab 1 Browse fallback: when Apollo returns 0 candidates, the frontend
    auto-calls this endpoint. We use Claude + the web_search_20250305 tool
    to find up to 5 structured {company_name, domain, summary} matches.

    Failures are silent — empty array is returned so the UI just shows
    "no web results" rather than a server error.
    """
    _ = current_user  # auth required, no per-user filtering
    candidates = await search_companies_via_web(body.query)
    return WebSearchResponse(candidates=candidates)


# ============================================================================
# Tab 2 — Lookup by email
# ============================================================================

class LookupByEmailRequest(BaseModel):
    email: EmailStr


class LookupByEmailResponse(BaseModel):
    found: bool
    person: Optional[Dict[str, Any]] = None  # raw Apollo person object


@router.post("/lookup-by-email", response_model=LookupByEmailResponse)
async def lookup_by_email(
    body: LookupByEmailRequest,
    current_user: User = Depends(get_current_user),
):
    """Tab 2 main lookup: find a person in Apollo by email.

    Wraps apollo_service.enrich_by_name (which delegates to Apollo's
    /v1/people/match — that endpoint prioritises email when present).
    Returns found=False with person=None when Apollo has no match;
    the frontend shows a static "No match" message — no web fallback
    for precise queries (per product decision in DIAG report).
    """
    _ = current_user
    if not apollo_service.is_configured:
        raise HTTPException(status_code=400, detail="Apollo API key not configured")

    try:
        # enrich_by_name needs first_name positionally; passing "" lets the
        # internal payload contain only `email`, which Apollo accepts.
        person = await apollo_service.enrich_by_name(
            first_name="",
            email=str(body.email),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Apollo lookup failed: {e}")

    if not person:
        return LookupByEmailResponse(found=False, person=None)

    # Apollo gotcha: for unknown / fake emails, /people/match still returns a
    # placeholder person dict with empty first/last/name and a headline like
    # "X is a role based email address". Treat name-empty records as no-match.
    has_name = bool(
        (person.get("first_name") or "").strip()
        or (person.get("last_name") or "").strip()
        or (person.get("name") or "").strip()
    )
    if not has_name:
        return LookupByEmailResponse(found=False, person=None)

    return LookupByEmailResponse(found=True, person=person)


# ============================================================================
# Tab 3 — Lookup by domain
# ============================================================================

class LookupByDomainRequest(BaseModel):
    domain: str = Field(..., min_length=3, max_length=200)


class LookupByDomainResponse(BaseModel):
    found: bool
    organization: Optional[Dict[str, Any]] = None


def _normalize_domain(raw: str) -> str:
    """Accept anything from `apple.com` to `https://www.apple.com/about` and
    return the bare domain (`apple.com`). SDR-friendly — they paste URLs."""
    s = raw.strip().lower()
    for prefix in ("https://", "http://"):
        if s.startswith(prefix):
            s = s[len(prefix):]
    if s.startswith("www."):
        s = s[4:]
    s = s.split("/", 1)[0]  # drop path
    s = s.split("?", 1)[0]  # drop query
    return s


@router.post("/lookup-by-domain", response_model=LookupByDomainResponse)
async def lookup_by_domain(
    body: LookupByDomainRequest,
    current_user: User = Depends(get_current_user),
):
    """Tab 3 main lookup: find a company in Apollo by domain.

    Wraps apollo_service.enrich_organization (Apollo /v1/organizations/enrich).
    Returns found=False when not in Apollo (frontend shows static no-match).
    """
    _ = current_user
    if not apollo_service.is_configured:
        raise HTTPException(status_code=400, detail="Apollo API key not configured")

    domain = _normalize_domain(body.domain)
    if not domain or "." not in domain:
        raise HTTPException(status_code=400, detail="Invalid domain")

    try:
        result = await apollo_service.enrich_organization(domain)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Apollo lookup failed: {e}")

    org = result.get("organization") if result else None
    if not org:
        return LookupByDomainResponse(found=False, organization=None)
    return LookupByDomainResponse(found=True, organization=org)
