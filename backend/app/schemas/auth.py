"""
认证相关的数据格式定义
定义前端发什么格式的数据、后端返回什么格式的数据
"""

from typing import Optional

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    """登录请求 — 前端发来的"""
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    """注册请求 — Admin 创建新用户时发来的"""
    email: EmailStr
    password: str
    full_name: str
    role: str = "sdr"                        # 默认注册为 SDR
    manager_id: Optional[int] = None         # SDR 需要指定所属 Manager


class TokenResponse(BaseModel):
    """登录成功后返回的 token"""
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    """返回给前端的用户信息（不含密码）"""
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    manager_id: Optional[int] = None

    model_config = {"from_attributes": True}
