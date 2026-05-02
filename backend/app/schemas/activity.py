"""
Activity data schemas — request/response formats for the activities API
"""

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class ActivityCreate(BaseModel):
    """Create a new activity record"""
    contact_id: int
    activity_type: str   # call, email, linkedin, meeting, note
    subject: Optional[str] = None
    content: Optional[str] = None
    # Optional: set next follow-up when logging this activity
    next_follow_up: Optional[date] = None
    follow_up_reason: Optional[str] = None
    # v1.3 (spec § 11): SDR can optionally bump the linked lead's status
    # while logging the activity. None = leave lead.status alone.
    lead_status_update: Optional[str] = None


class ActivityResponse(BaseModel):
    """Activity data returned to frontend"""
    id: int
    activity_type: str
    subject: Optional[str] = None
    content: Optional[str] = None
    ai_summary: Optional[str] = None
    contact_id: int
    user_id: int
    created_at: datetime
    # Joined fields for display
    contact_name: Optional[str] = None
    user_name: Optional[str] = None

    model_config = {"from_attributes": True}
