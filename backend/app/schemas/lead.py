"""
Lead data schemas — request/response formats for leads
"""

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class LeadResponse(BaseModel):
    """Lead data returned to frontend"""
    id: int
    status: str
    notes: Optional[str] = None
    next_follow_up: Optional[date] = None
    follow_up_reason: Optional[str] = None
    contact_id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
