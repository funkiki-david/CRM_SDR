"""
Apollo.io Service — Handles all communication with the Apollo API
All API calls go through the backend to keep the API key secure.

Apollo APIs used:
  - People Search: Find prospects by ICP filters (no credits)
  - People Enrichment: Get full email + phone + LinkedIn (uses credits)
  - Org Enrichment: Get company data (uses credits)
"""

from typing import Optional

import httpx

from app.core.config import settings

APOLLO_BASE_URL = "https://api.apollo.io/api"


class ApolloService:
    """Wrapper around Apollo.io REST API"""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.APOLLO_API_KEY
        # Track where the key came from: "env" (from .env at startup) or
        # "manual" (user pasted in Settings UI). Used by /status endpoint.
        self._source: str = "env" if self.api_key else "none"

    def set_key_manual(self, key: str) -> None:
        """Called when Admin updates via Settings UI — overrides env value"""
        self.api_key = key
        self._source = "manual" if key else "none"

    @property
    def source(self) -> str:
        return self._source

    def _headers(self) -> dict:
        return {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "x-api-key": self.api_key,
        }

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def search_people(
        self,
        q_organization_name: Optional[str] = None,
        person_titles: Optional[list] = None,
        person_seniorities: Optional[list] = None,
        person_locations: Optional[list] = None,
        organization_industry_tag_ids: Optional[list] = None,
        organization_num_employees_ranges: Optional[list] = None,
        organization_revenue_ranges: Optional[list] = None,
        q_organization_keyword_tags: Optional[list] = None,
        q_organization_domains: Optional[str] = None,
        q_keywords: Optional[str] = None,
        page: int = 1,
        per_page: int = 25,
    ) -> dict:
        """
        Search for people matching ICP criteria via JSON body.
        This does NOT consume Apollo credits.
        """
        data: dict = {
            "page": page,
            "per_page": per_page,
        }

        # Only add filters that the user filled in — don't send empty arrays
        if q_organization_name:
            data["q_organization_name"] = q_organization_name
        if person_titles:
            data["person_titles"] = person_titles
        if person_seniorities:
            data["person_seniorities"] = person_seniorities
        if person_locations:
            data["person_locations"] = person_locations
        # Industry filter: use keyword tags instead of industry_tag_ids
        # (Apollo requires specific internal IDs for industry_tag_ids which we don't have)
        if organization_industry_tag_ids:
            existing_keywords = data.get("q_organization_keyword_tags", [])
            data["q_organization_keyword_tags"] = existing_keywords + organization_industry_tag_ids
        if organization_num_employees_ranges:
            data["organization_num_employees_ranges"] = organization_num_employees_ranges
        if organization_revenue_ranges:
            data["organization_revenue_ranges"] = organization_revenue_ranges
        if q_organization_keyword_tags:
            data["q_organization_keyword_tags"] = q_organization_keyword_tags
        if q_organization_domains:
            data["q_organization_domains_list"] = [q_organization_domains]
        if q_keywords:
            # Apollo free-text search — 匹配人名、LinkedIn URL 等
            data["q_keywords"] = q_keywords

        url = f"{APOLLO_BASE_URL}/v1/mixed_people/api_search"
        print(f"=== APOLLO REQUEST ===\nURL: {url}\nBody: {data}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                headers=self._headers(),
                json=data,
            )
            if response.status_code != 200:
                print(f"=== APOLLO ERROR {response.status_code} ===\n{response.text[:500]}")
            response.raise_for_status()
            return response.json()

    async def enrich_person(self, apollo_id: str) -> dict:
        """
        Get full details for a specific person (email, phone, LinkedIn).
        This CONSUMES Apollo credits.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{APOLLO_BASE_URL}/v1/people/match",
                headers=self._headers(),
                json={"id": apollo_id, "reveal_personal_emails": False},
            )
            response.raise_for_status()
            return response.json()

    async def enrich_by_name(
        self,
        first_name: str,
        last_name: str = "",
        company_name: Optional[str] = None,
        email: Optional[str] = None,
    ) -> Optional[dict]:
        """
        Match a person by name + company (or email). Consumes 1 Apollo credit.
        Returns Apollo's "person" object or None if no match.

        /v1/people/match prioritizes email; falls back to name + organization.
        reveal_personal_emails=true 才能拿到 personal email（cost 多一个 credit）
        """
        payload: dict = {}
        if email:
            payload["email"] = email
        if first_name:
            payload["first_name"] = first_name
        if last_name:
            payload["last_name"] = last_name
        if company_name:
            payload["organization_name"] = company_name

        if not payload:
            return None

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{APOLLO_BASE_URL}/v1/people/match",
                headers=self._headers(),
                json=payload,
            )
            if response.status_code != 200:
                # 200 with no match is normal; other codes mean real error
                response.raise_for_status()
            data = response.json()
            return data.get("person")  # None if no match

    async def enrich_people_bulk(self, apollo_ids: list) -> list:
        """
        Enrich multiple people at once. Max 10 per request (Apollo limit).
        CONSUMES credits — one per person.
        Returns list of enriched person dicts.
        """
        results = []
        # Apollo bulk match supports up to 10 per call
        batch_size = 10
        for i in range(0, len(apollo_ids), batch_size):
            batch = apollo_ids[i : i + batch_size]
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{APOLLO_BASE_URL}/v1/people/bulk_match",
                    headers=self._headers(),
                    json={"details": [{"id": aid} for aid in batch]},
                )
                response.raise_for_status()
                data = response.json()
                matches = data.get("matches", [])
                results.extend(matches)
        return results

    async def enrich_organization(self, domain: str) -> dict:
        """
        Get company info by domain.
        This CONSUMES Apollo credits.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{APOLLO_BASE_URL}/v1/organizations/enrich",
                headers=self._headers(),
                json={"domain": domain},
            )
            response.raise_for_status()
            return response.json()


# Singleton instance
apollo_service = ApolloService()
