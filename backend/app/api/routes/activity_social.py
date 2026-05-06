"""Activity social endpoints — comments only (stars / 5-emoji reactions stay
mockup for now).

Comments live under /api/activities so all activity-related routes share a
prefix. The four endpoints:

  GET    /api/activities/{activity_id}/comments    list comments on an activity
  POST   /api/activities/{activity_id}/comments    create a new comment
  PATCH  /api/activities/comments/{comment_id}     edit own comment (preserves previous_text)
  DELETE /api/activities/comments/{comment_id}     delete (author or admin)
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.activity import Activity
from app.models.activity_comment import ActivityComment
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/activities", tags=["Activity Comments"])


# ============================================================================
# Schemas
# ============================================================================

class CommentCreate(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)


class CommentUpdate(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)


class CommentResponse(BaseModel):
    id: int
    activity_id: int
    user_id: Optional[int]
    user_name: Optional[str]
    text: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ============================================================================
# Helpers
# ============================================================================

async def _ensure_activity_exists(db: AsyncSession, activity_id: int) -> None:
    a = await db.get(Activity, activity_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Activity not found")


def _serialize(c: ActivityComment) -> CommentResponse:
    return CommentResponse(
        id=c.id,
        activity_id=c.activity_id,
        user_id=c.user_id,
        user_name=c.user.full_name if c.user else None,
        text=c.text,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/{activity_id}/comments", response_model=List[CommentResponse])
async def list_comments(
    activity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user  # auth required, but no per-user filtering
    await _ensure_activity_exists(db, activity_id)
    result = await db.execute(
        select(ActivityComment)
        .options(selectinload(ActivityComment.user))
        .where(ActivityComment.activity_id == activity_id)
        .order_by(ActivityComment.created_at.asc())
    )
    return [_serialize(c) for c in result.scalars().all()]


@router.post(
    "/{activity_id}/comments",
    response_model=CommentResponse,
    status_code=201,
)
async def create_comment(
    activity_id: int,
    body: CommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _ensure_activity_exists(db, activity_id)
    c = ActivityComment(
        activity_id=activity_id,
        user_id=current_user.id,
        text=body.text.strip(),
    )
    db.add(c)
    await db.commit()
    # Re-fetch with user eagerly loaded so serialize() can read full_name.
    result = await db.execute(
        select(ActivityComment)
        .options(selectinload(ActivityComment.user))
        .where(ActivityComment.id == c.id)
    )
    return _serialize(result.scalar_one())


@router.patch("/comments/{comment_id}", response_model=CommentResponse)
async def update_comment(
    comment_id: int,
    body: CommentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = await db.get(ActivityComment, comment_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="You can only edit your own comments",
        )
    # Preserve previous text for audit (single-level history).
    c.previous_text = c.text
    c.text = body.text.strip()
    c.updated_at = datetime.now(timezone.utc)
    await db.commit()
    result = await db.execute(
        select(ActivityComment)
        .options(selectinload(ActivityComment.user))
        .where(ActivityComment.id == comment_id)
    )
    return _serialize(result.scalar_one())


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = await db.get(ActivityComment, comment_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    is_author = c.user_id == current_user.id
    is_admin = current_user.role == UserRole.ADMIN
    if not (is_author or is_admin):
        raise HTTPException(
            status_code=403,
            detail="Only the author or an admin can delete this comment",
        )
    await db.delete(c)
    await db.commit()
    return None
