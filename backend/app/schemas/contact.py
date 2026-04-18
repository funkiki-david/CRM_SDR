"""
Contact data schemas — request/response formats for the contacts API
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, field_validator
import re


class ContactCreate(BaseModel):
    """Create a new contact — matches Add Contact modal spec"""
    first_name: str
    last_name: str
    email: str
    phone: Optional[str] = None
    title: Optional[str] = None
    company_name: Optional[str] = None
    company_domain: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    linkedin_url: Optional[str] = None
    website: Optional[str] = None
    industry_tags: Optional[List[str]] = None
    notes: Optional[str] = None

    @field_validator("first_name")
    @classmethod
    def first_name_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Please enter a first name")
        return v.strip()[:50]

    @field_validator("last_name")
    @classmethod
    def last_name_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Please enter a last name")
        return v.strip()[:50]

    @field_validator("email")
    @classmethod
    def email_valid(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Please enter a valid email")
        v = v.strip()[:255]
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Please enter a valid email (like name@company.com)")
        return v.lower()

    @field_validator("phone")
    @classmethod
    def phone_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()[:30]
        if v and not re.match(r"^[\d\s+\-()]+$", v):
            raise ValueError("Phone can only contain numbers and +-().")
        return v or None

    @field_validator("linkedin_url")
    @classmethod
    def linkedin_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        v = v.strip()[:500]
        if "linkedin.com" not in v.lower():
            raise ValueError("Must be a LinkedIn URL (contains linkedin.com)")
        return v

    @field_validator("industry_tags")
    @classmethod
    def tags_limit(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return None
        tags = [t.strip()[:30] for t in v if t.strip()]
        if len(tags) > 10:
            raise ValueError("Maximum 10 tags")
        return tags

    @field_validator("notes")
    @classmethod
    def notes_length(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if len(v) > 2000:
            raise ValueError("Notes too long (max 2000 chars)")
        return v


class ContactUpdate(BaseModel):
    """Update an existing contact (all fields optional)"""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    company_name: Optional[str] = None
    company_domain: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    linkedin_url: Optional[str] = None
    website: Optional[str] = None
    industry_tags: Optional[List[str]] = None
    notes: Optional[str] = None


class ContactResponse(BaseModel):
    """Contact data returned to frontend"""
    id: int
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    company_name: Optional[str] = None
    company_domain: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    linkedin_url: Optional[str] = None
    website: Optional[str] = None
    ai_person_report: Optional[str] = None
    ai_company_report: Optional[str] = None
    ai_tags: Optional[str] = None
    ai_person_generated_at: Optional[datetime] = None
    ai_company_generated_at: Optional[datetime] = None
    ai_report_model: Optional[str] = None
    industry_tags_array: Optional[List[str]] = None
    notes: Optional[str] = None
    import_source: Optional[str] = None
    apollo_id: Optional[str] = None
    owner_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContactListResponse(BaseModel):
    """Paginated contact list"""
    contacts: List[ContactResponse]
    total: int


class DedupCheckResponse(BaseModel):
    """Response for email dedup check"""
    exists: bool
    existing_contact: Optional[ContactResponse] = None
    last_activity_date: Optional[str] = None
