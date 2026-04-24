"""
Tasks API — to-dos created by users (manual) or by clicking "Create Task" on
an AI Suggested To-Do card. Mixed into the dashboard Follow-Ups list.
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.contact import Contact
from app.models.task import Task, AISuggestionSnooze
from app.models.user import User

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])


class TaskCreate(BaseModel):
    contact_id: Optional[int] = None
    task_type: str = "follow_up"
    description: str
    due_date: Optional[date] = None  # defaults to today
    source: str = "manual"


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_task(
    data: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.contact_id:
        c = await db.get(Contact, data.contact_id)
        if c is None:
            raise HTTPException(status_code=400, detail="contact_id not found")
    t = Task(
        contact_id=data.contact_id,
        user_id=current_user.id,
        task_type=data.task_type,
        description=data.description,
        due_date=data.due_date or date.today(),
        source=data.source,
        status="pending",
    )
    db.add(t)
    await db.flush()
    return _serialize(t, contact_name=None)


@router.get("")
async def list_tasks(
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Team-shared list. Pass ?status=pending to filter."""
    _ = current_user
    q = select(Task).order_by(Task.due_date.asc().nullslast(), Task.created_at.desc())
    if status_filter:
        q = q.where(Task.status == status_filter)
    rows = (await db.execute(q)).scalars().all()
    # Look up contact names in one pass
    contact_ids = {t.contact_id for t in rows if t.contact_id}
    contact_map: dict[int, str] = {}
    if contact_ids:
        cres = await db.execute(select(Contact).where(Contact.id.in_(contact_ids)))
        for c in cres.scalars().all():
            contact_map[c.id] = f"{c.first_name} {c.last_name}".strip()
    return [_serialize(t, contact_map.get(t.contact_id)) for t in rows]


class TaskPatch(BaseModel):
    status: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[date] = None
    task_type: Optional[str] = None


@router.patch("/{task_id}")
async def update_task(
    task_id: int,
    data: TaskPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    t = await db.get(Task, task_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if data.status is not None:
        t.status = data.status
        if data.status == "done" and t.completed_at is None:
            t.completed_at = datetime.now(timezone.utc)
    if data.description is not None:
        t.description = data.description
    if data.due_date is not None:
        t.due_date = data.due_date
    if data.task_type is not None:
        t.task_type = data.task_type
    await db.flush()
    return _serialize(t, None)


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    t = await db.get(Task, task_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(t)


# === AI Suggestion Snooze (Problem 5) ===

def hash_suggestion(title: str, action: str = "") -> str:
    return hashlib.sha256(f"{title}|{action}".encode("utf-8")).hexdigest()[:32]


class SnoozeCreate(BaseModel):
    title: str
    action: str = ""
    days: int = 1  # 1 / 3 / 7


@router.post("/snooze-suggestion")
async def snooze_suggestion(
    data: SnoozeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hide an AI suggestion until the snooze date."""
    h = hash_suggestion(data.title, data.action)
    until = datetime.now(timezone.utc) + timedelta(days=data.days)
    db.add(AISuggestionSnooze(
        user_id=current_user.id,
        suggestion_hash=h,
        snooze_until=until,
    ))
    await db.flush()
    return {"hash": h, "snooze_until": until.isoformat()}


def _serialize(t: Task, contact_name: Optional[str]) -> dict:
    return {
        "id": t.id,
        "contact_id": t.contact_id,
        "contact_name": contact_name,
        "task_type": t.task_type,
        "description": t.description,
        "due_date": t.due_date.isoformat() if t.due_date else None,
        "status": t.status,
        "source": t.source,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
    }
