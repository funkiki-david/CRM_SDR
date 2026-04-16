"""
依赖注入 — 用于 API 路由中获取当前登录用户 + 权限校验
FastAPI 的「依赖注入」= 在 API 函数参数里声明需要什么，框架自动提供
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User, UserRole

# 告诉 FastAPI：前端登录后，token 放在请求头的 Authorization: Bearer xxx
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    从请求的 token 中解析出当前登录用户
    如果 token 无效或用户不存在，返回 401 错误
    """
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired, please sign in again",
        )

    user_id = int(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or disabled",
        )
    return user


def require_role(*allowed_roles: UserRole):
    """
    权限校验装饰器 — 限制某些接口只有特定角色能访问
    用法：require_role(UserRole.ADMIN, UserRole.MANAGER)
    """
    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: {[r.value for r in allowed_roles]}",
            )
        return current_user
    return role_checker
