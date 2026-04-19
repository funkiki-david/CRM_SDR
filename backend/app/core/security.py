"""
安全模块 — 密码哈希 + JWT Token 生成/验证
JWT = JSON Web Token，用于用户登录后的身份识别
流程：用户登录 → 服务器发一个 token → 用户每次请求都带上这个 token → 服务器验证身份
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

# 密码加密工具 — 用 bcrypt 算法，数据库里存的是加密后的密码，不是明文
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """把明文密码加密（注册时用）"""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码是否正确（登录时用）"""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(
    user_id: int,
    role: str,
    expires_minutes: Optional[int] = None,
) -> str:
    """
    登录成功后，生成一个 JWT token 返回给前端
    token 里包含：用户 ID、角色、过期时间

    expires_minutes: 可选，覆盖默认 ACCESS_TOKEN_EXPIRE_MINUTES。
    用于 Remember me —— login 时传入 43200 (30 天)。
    """
    minutes = expires_minutes if expires_minutes is not None else settings.ACCESS_TOKEN_EXPIRE_MINUTES
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {
        "sub": str(user_id),   # sub = subject，即"这个 token 是谁的"
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """
    解析 token，取出用户信息
    如果 token 无效或过期，返回 None
    """
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except JWTError:
        return None
