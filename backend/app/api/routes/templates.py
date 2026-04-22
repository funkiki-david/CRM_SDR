"""
Email Templates API — TEMPORARILY FROZEN.

Every endpoint short-circuits with a 501 EMAIL_FROZEN response while
the email module is deferred. Routes, handler signatures, schemas, the
`email_templates` table, and the seed data are all preserved so
unfreezing is a matter of deleting the `_frozen` early returns.
"""

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.email import TemplateCreate, TemplateUpdate

router = APIRouter(prefix="/api/templates", tags=["Email Templates"])

_FROZEN_BODY = {"error": "Email module is temporarily frozen", "code": "EMAIL_FROZEN"}


def _frozen() -> JSONResponse:
    return JSONResponse(status_code=501, content=_FROZEN_BODY)


@router.get("")
async def list_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = db, current_user
    return _frozen()


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_template(
    data: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = data, db, current_user
    return _frozen()


@router.patch("/{template_id}")
async def update_template(
    template_id: int,
    data: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = template_id, data, db, current_user
    return _frozen()


@router.delete("/{template_id}")
async def delete_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = template_id, db, current_user
    return _frozen()
