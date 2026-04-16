"""
Contacts API — CRUD operations for contacts
Includes ownership-based access control:
  - SDR: can only see contacts they own
  - Manager: can see contacts owned by their team SDRs
  - Admin: can see all contacts
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.contact import Contact
from app.schemas.contact import (
    ContactCreate, ContactUpdate, ContactResponse, ContactListResponse,
)

router = APIRouter(prefix="/api/contacts", tags=["Contacts"])


def _apply_ownership_filter(query, user: User):
    """
    Apply role-based data filtering:
    - Admin sees everything
    - Manager sees contacts owned by their team SDRs
    - SDR sees only their own contacts
    """
    if user.role == UserRole.ADMIN:
        return query  # Admin sees all
    elif user.role == UserRole.MANAGER:
        # Manager sees contacts owned by SDRs in their team + their own
        return query.where(
            or_(
                Contact.owner_id == user.id,
                Contact.owner_id.in_(
                    select(User.id).where(User.manager_id == user.id)
                ),
            )
        )
    else:
        # SDR sees only their own contacts
        return query.where(Contact.owner_id == user.id)


@router.get("", response_model=ContactListResponse)
async def list_contacts(
    search: Optional[str] = Query(None, description="Search by name, email, or company"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List contacts with search and pagination"""
    query = select(Contact)
    query = _apply_ownership_filter(query, current_user)

    # Search filter
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

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # Fetch page
    query = query.order_by(Contact.updated_at.desc()).offset(skip).limit(limit)
    result = await db.execute(query)
    contacts = result.scalars().all()

    return ContactListResponse(contacts=contacts, total=total)


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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact not found",
        )
    return contact


@router.post("", response_model=ContactResponse, status_code=status.HTTP_201_CREATED)
async def create_contact(
    data: ContactCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new contact (owned by the current user)"""
    contact = Contact(
        **data.model_dump(),
        owner_id=current_user.id,
    )
    db.add(contact)
    await db.flush()
    return contact


@router.patch("/{contact_id}", response_model=ContactResponse)
async def update_contact(
    contact_id: int,
    data: ContactUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a contact's info"""
    query = select(Contact).where(Contact.id == contact_id)
    query = _apply_ownership_filter(query, current_user)

    result = await db.execute(query)
    contact = result.scalar_one_or_none()

    if contact is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact not found",
        )

    # Only update fields that were provided
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(contact, field, value)

    await db.flush()
    return contact
