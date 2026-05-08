"""
认证路由 — 处理登录、注册、查看个人信息
路径前缀：/api/auth
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import verify_password, hash_password, create_access_token
from app.core.deps import get_current_user, require_role
from app.models.user import User, UserRole
from app.schemas.auth import (
    LoginRequest, RegisterRequest, TokenResponse, UserResponse,
)

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    用户登录
    成功返回 JWT token，前端存起来后续每次请求都带上
    """
    # 查找用户
    result = await db.execute(select(User).where(User.email == request.email))
    user = result.scalar_one_or_none()

    # 验证密码
    if user is None or not verify_password(request.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account disabled, please contact your admin",
        )

    # 记录最后登录时间（Team Members 面板显示用）
    user.last_login_at = datetime.now(timezone.utc)
    await db.flush()

    # 生成 token —— Remember me 时延长到 30 天
    # Remember me → 30-day token; otherwise default ACCESS_TOKEN_EXPIRE_MINUTES (8h)
    expires_minutes = 30 * 24 * 60 if request.remember_me else None
    token = create_access_token(user.id, user.role.value, expires_minutes=expires_minutes)
    return TokenResponse(access_token=token)


@router.post(
    "/register",
    response_model=UserResponse,
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)
async def register(request: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    创建新用户（仅 Admin 可用）
    Admin 可以创建 Manager 和 SDR 账号
    """
    # 检查邮箱是否已存在
    result = await db.execute(select(User).where(User.email == request.email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This email is already registered",
        )

    # 验证角色值
    try:
        role = UserRole(request.role)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Options: {[r.value for r in UserRole]}",
        )

    # 创建用户
    user = User(
        email=request.email,
        hashed_password=hash_password(request.password),
        full_name=request.full_name,
        role=role,
        manager_id=request.manager_id,
    )
    db.add(user)
    await db.flush()  # 获取自增 ID
    return user


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """查看当前登录用户的信息"""
    return current_user
