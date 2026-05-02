"""
Users (Team Members) API — 列出、创建、编辑、停用团队成员
Only Admin can create / edit / deactivate. Everyone can view the list.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.core.security import hash_password
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/users", tags=["Team Members"])


# === Schemas ===

class UserListItem(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    manager_id: Optional[int] = None
    last_login_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    """Admin 添加新用户"""
    email: EmailStr
    password: str
    full_name: str
    role: str = "sdr"
    manager_id: Optional[int] = None


class UserEdit(BaseModel):
    """Admin 编辑用户 —— 所有字段可选"""
    full_name: Optional[str] = None
    role: Optional[str] = None
    manager_id: Optional[int] = None
    password: Optional[str] = None  # 可选重置密码


# === Endpoints ===

@router.get("", response_model=list[UserListItem])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    列出所有用户（含停用的）。任何登录用户都能查（方便 Manager 看团队）。
    按 id 排序保证列表稳定。
    """
    result = await db.execute(select(User).order_by(User.id))
    return result.scalars().all()


@router.post("", response_model=UserListItem, status_code=status.HTTP_201_CREATED)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    """Admin 创建团队成员"""
    # 校验邮箱唯一
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="This email is already registered")

    # 校验角色值
    try:
        role = UserRole(data.role)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role. Options: {[r.value for r in UserRole]}",
        )

    # 校验 manager_id（如有）指向的用户存在且是 Manager/Admin
    if data.manager_id is not None:
        mgr = await db.get(User, data.manager_id)
        if mgr is None or mgr.role == UserRole.SDR:
            raise HTTPException(
                status_code=400,
                detail="manager_id must point to a Manager or Admin user",
            )

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        role=role,
        manager_id=data.manager_id,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


@router.patch("/{user_id}", response_model=UserListItem)
async def edit_user(
    user_id: int,
    data: UserEdit,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    """Admin 编辑团队成员 —— name / role / manager / 重置密码"""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if data.full_name is not None:
        user.full_name = data.full_name

    if data.role is not None:
        try:
            user.role = UserRole(data.role)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid role. Options: {[r.value for r in UserRole]}",
            )

    if data.manager_id is not None:
        mgr = await db.get(User, data.manager_id)
        if mgr is None or mgr.role == UserRole.SDR:
            raise HTTPException(
                status_code=400,
                detail="manager_id must point to a Manager or Admin user",
            )
        user.manager_id = data.manager_id

    if data.password:
        user.hashed_password = hash_password(data.password)

    user.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return user


@router.patch("/{user_id}/deactivate", response_model=UserListItem)
async def deactivate_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    """Admin 停用账号（防自锁：不能停用自己）"""
    if user_id == current_user.id:
        raise HTTPException(
            status_code=400,
            detail="You cannot deactivate your own account",
        )

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = False
    user.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return user


@router.patch("/{user_id}/activate", response_model=UserListItem)
async def activate_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    """Admin 重新启用账号"""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = True
    user.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return user
