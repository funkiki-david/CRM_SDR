"""
Email Templates API — CRUD for cold email templates
Templates support placeholder variables:
  {{first_name}}, {{last_name}}, {{company_name}},
  {{title}}, {{industry}}, {{sender_name}}
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.email_template import EmailTemplate
from app.schemas.email import TemplateCreate, TemplateUpdate, TemplateResponse

router = APIRouter(prefix="/api/templates", tags=["Email Templates"])


@router.get("", response_model=list[TemplateResponse])
async def list_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all email templates"""
    result = await db.execute(
        select(EmailTemplate).order_by(EmailTemplate.updated_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    data: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new email template"""
    template = EmailTemplate(
        name=data.name,
        subject=data.subject,
        body=data.body,
        created_by=current_user.id,
    )
    db.add(template)
    await db.flush()
    return template


@router.patch("/{template_id}", response_model=TemplateResponse)
async def update_template(
    template_id: int,
    data: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update an email template"""
    template = await db.get(EmailTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(template, field, value)

    await db.flush()
    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete an email template"""
    template = await db.get(EmailTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    await db.delete(template)
