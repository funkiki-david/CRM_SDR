"""
Contacts API — CRUD operations for contacts
Includes ownership-based access control and dedup checking.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.contact import Contact
from app.models.activity import Activity, ActivityType
from app.schemas.contact import (
    ContactCreate, ContactUpdate, ContactResponse, ContactListResponse,
    DedupCheckResponse,
)

router = APIRouter(prefix="/api/contacts", tags=["Contacts"])


def _apply_ownership_filter(query, user: User):
    """
    Role-based data filtering:
      Admin & Manager → see all contacts
      SDR → only see contacts they own
    """
    if user.role in (UserRole.ADMIN, UserRole.MANAGER):
        return query  # Full access
    else:
        return query.where(Contact.owner_id == user.id)


@router.get("", response_model=ContactListResponse)
async def list_contacts(
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List contacts with search and pagination"""
    query = select(Contact)
    query = _apply_ownership_filter(query, current_user)

    if search:
        search_term = f"%{search}%"
        query = query.where(
            or_(
                Contact.first_name.ilike(search_term),
                Contact.last_name.ilike(search_term),
                Contact.email.ilike(search_term),
                Contact.company_name.ilike(search_term),
                Contact.title.ilike(search_term),
            )
        )

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    query = query.order_by(Contact.updated_at.desc()).offset(skip).limit(limit)
    result = await db.execute(query)
    contacts = result.scalars().all()

    return ContactListResponse(contacts=contacts, total=total)


@router.get("/check-email")
async def check_email_dedup(
    email: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Check if an email already exists in the database.
    Used by the Add Contact modal for dedup detection.
    """
    result = await db.execute(
        select(Contact).where(Contact.email == email.lower().strip())
    )
    existing = result.scalar_one_or_none()

    if existing is None:
        return {"exists": False, "existing_contact": None, "last_activity_date": None}

    # Get last activity date
    act_result = await db.execute(
        select(Activity.created_at)
        .where(Activity.contact_id == existing.id)
        .order_by(Activity.created_at.desc())
        .limit(1)
    )
    last_act = act_result.scalar_one_or_none()

    return {
        "exists": True,
        "existing_contact": ContactResponse.model_validate(existing),
        "last_activity_date": str(last_act) if last_act else None,
    }


@router.get("/{contact_id}", response_model=ContactResponse)
async def get_contact(
    contact_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single contact by ID"""
    query = select(Contact).where(Contact.id == contact_id)
    query = _apply_ownership_filter(query, current_user)

    result = await db.execute(query)
    contact = result.scalar_one_or_none()

    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@router.post("", response_model=ContactResponse, status_code=status.HTTP_201_CREATED)
async def create_contact(
    data: ContactCreate,
    force_create: bool = Query(False, description="Create even if email exists (duplicate)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new contact.
    If email already exists and force_create=False, returns 409 with existing contact info.
    """
    # Dedup check (unless force_create)
    if not force_create and data.email:
        result = await db.execute(
            select(Contact).where(Contact.email == data.email.lower().strip())
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Email already exists",
                    "existing_contact_id": existing.id,
                    "existing_name": f"{existing.first_name} {existing.last_name}",
                    "existing_title": existing.title,
                    "existing_company": existing.company_name,
                },
            )

    # Build contact from data
    contact_data = data.model_dump(exclude={"industry_tags"})
    contact = Contact(
        **contact_data,
        owner_id=current_user.id,
        import_source="manual",
    )

    # Handle industry tags
    if data.industry_tags:
        contact.industry_tags_array = data.industry_tags
        # Also store as JSON string in ai_tags for backward compat
        import json
        contact.ai_tags = json.dumps(data.industry_tags)

    db.add(contact)
    await db.flush()

    # Log an activity for the creation
    activity = Activity(
        activity_type=ActivityType.NOTE,
        subject=f"Contact added manually",
        content=f"Added {data.first_name} {data.last_name} ({data.email})",
        contact_id=contact.id,
        user_id=current_user.id,
    )
    db.add(activity)
    await db.flush()

    return contact


@router.put("/{contact_id}", response_model=ContactResponse)
async def update_contact_full(
    contact_id: int,
    data: ContactCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update an existing contact with new data (used by dedup "Update existing" flow).
    Replaces all fields with the new data.
    """
    query = select(Contact).where(Contact.id == contact_id)
    query = _apply_ownership_filter(query, current_user)

    result = await db.execute(query)
    contact = result.scalar_one_or_none()

    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    update_data = data.model_dump(exclude={"industry_tags"})
    for field, value in update_data.items():
        if value is not None:
            setattr(contact, field, value)

    if data.industry_tags:
        contact.industry_tags_array = data.industry_tags
        import json
        contact.ai_tags = json.dumps(data.industry_tags)

    await db.flush()
    return contact


@router.patch("/{contact_id}", response_model=ContactResponse)
async def update_contact(
    contact_id: int,
    data: ContactUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a contact's info (partial update)"""
    query = select(Contact).where(Contact.id == contact_id)
    query = _apply_ownership_filter(query, current_user)

    result = await db.execute(query)
    contact = result.scalar_one_or_none()

    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    update_data = data.model_dump(exclude_unset=True)

    # Handle industry_tags separately
    tags = update_data.pop("industry_tags", None)
    if tags is not None:
        contact.industry_tags_array = tags
        import json
        contact.ai_tags = json.dumps(tags)

    for field, value in update_data.items():
        setattr(contact, field, value)

    await db.flush()
    return contact
