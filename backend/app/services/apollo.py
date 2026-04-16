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

APOLLO_BASE_URL = "https://api.apollo.io"


class ApolloService:
    """Wrapper around Apollo.io REST API"""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.APOLLO_API_KEY

    def _headers(self) -> dict:
        return {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "X-Api-Key": self.api_key,
        }

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def search_people(
        self,
        person_titles: Optional[list] = None,
        person_locations: Optional[list] = None,
        organization_industry_tag_ids: Optional[list] = None,
        organization_num_employees_ranges: Optional[list] = None,
        q_organization_domains: Optional[str] = None,
        page: int = 1,
        per_page: int = 25,
    ) -> dict:
        """
        Search for people matching ICP criteria.
        This does NOT consume Apollo credits.
        Returns a list of prospects with basic info.
        """
        payload = {
            "page": page,
            "per_page": per_page,
        }

        if person_titles:
            payload["person_titles"] = person_titles
        if person_locations:
            payload["person_locations"] = person_locations
        if organization_industry_tag_ids:
            payload["organization_industry_tag_ids"] = organization_industry_tag_ids
        if organization_num_employees_ranges:
            payload["organization_num_employees_ranges"] = organization_num_employees_ranges
        if q_organization_domains:
            payload["q_organization_domains"] = q_organization_domains

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{APOLLO_BASE_URL}/v1/mixed_people/search",
                headers=self._headers(),
                json=payload,
            )
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
