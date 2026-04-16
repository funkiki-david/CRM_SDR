"""
Contact data schemas — request/response formats for the contacts API
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr


class ContactCreate(BaseModel):
    """Create a new contact"""
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    company_name: Optional[str] = None
    company_domain: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    linkedin_url: Optional[str] = None


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
    linkedin_url: Optional[str] = None


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
    linkedin_url: Optional[str] = None
    ai_person_report: Optional[str] = None
    ai_company_report: Optional[str] = None
    ai_tags: Optional[str] = None
    apollo_id: Optional[str] = None
    owner_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContactListResponse(BaseModel):
    """Paginated contact list"""
    contacts: List[ContactResponse]
    total: int
