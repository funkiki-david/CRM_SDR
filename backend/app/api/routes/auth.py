"""
认证路由 — 处理登录、注册、查看个人信息 + Google OAuth
路径前缀：/api/auth
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import verify_password, hash_password, create_access_token
from app.core.deps import get_current_user, require_role
from app.models.user import User, UserRole
from app.models.email_account import EmailAccount
from app.schemas.auth import (
    LoginRequest, RegisterRequest, TokenResponse, UserResponse,
)
from app.services.gmail_oauth import (
    build_authorization_url,
    parse_state,
    exchange_code_for_tokens,
    GmailOAuthError,
)

router = APIRouter(prefix="/api/auth", tags=["认证"])


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


# ============================================================================
# Google OAuth flow — connect a Gmail account for outgoing mail
# ============================================================================

@router.get("/google/start")
async def google_oauth_start(
    current_user: User = Depends(get_current_user),
):
    """
    Step 1: 前端点 "Connect Gmail" 时调这个。
    返回 Google 授权 URL —— 前端用 window.location = auth_url 跳过去。
    用户在 Google 授权后，Google 会 302 到 /api/auth/google/callback。
    """
    try:
        auth_url, _state = build_authorization_url({"user_id": current_user.id})
    except GmailOAuthError as e:
        raise HTTPException(status_code=501, detail=str(e))
    return {"auth_url": auth_url}


@router.get("/google/callback")
async def google_oauth_callback(
    code: str = Query(..., description="OAuth authorization code from Google"),
    state: str = Query(..., description="CSRF state token we set on /start"),
    error: Optional[str] = Query(None, description="Google returns this if user declines"),
    db: AsyncSession = Depends(get_db),
):
    """
    Step 2: Google 302 回来落地 —— 交换 code 换 tokens，把加密的 tokens 写进 email_accounts。
    最后 redirect 回前端 /settings?gmail=connected|error。
    """
    frontend_back = f"{settings.FRONTEND_BASE_URL}/settings"

    if error:
        return RedirectResponse(f"{frontend_back}?gmail=error&reason={error}")

    # 恢复 user_id — state 是我们自己构造的 base64 JSON，里面带 user_id
    try:
        state_data = parse_state(state)
        user_id = int(state_data.get("user_id", 0))
    except (ValueError, TypeError):
        return RedirectResponse(f"{frontend_back}?gmail=error&reason=bad_state")

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        return RedirectResponse(f"{frontend_back}?gmail=error&reason=user_not_found")

    # 换 token
    try:
        tokens = exchange_code_for_tokens(code)
    except GmailOAuthError as e:
        return RedirectResponse(
            f"{frontend_back}?gmail=error&reason={str(e)[:100]}"
        )

    google_email = tokens["email"]

    # 查是否已有同邮箱账号 —— 有就刷新 tokens；没有就新建
    result = await db.execute(
        select(EmailAccount).where(
            EmailAccount.user_id == user_id,
            EmailAccount.email_address == google_email,
        )
    )
    account = result.scalar_one_or_none()

    if account is None:
        account = EmailAccount(
            user_id=user_id,
            email_address=google_email,
            display_name=user.full_name or google_email,
            provider_type="gmail_oauth",
            access_token=tokens["access_token_encrypted"],
            refresh_token=tokens["refresh_token_encrypted"],
            token_expires_at=tokens["token_expires_at"],
            is_active=True,
        )
        db.add(account)
    else:
        account.provider_type = "gmail_oauth"
        account.access_token = tokens["access_token_encrypted"]
        account.refresh_token = tokens["refresh_token_encrypted"]
        account.token_expires_at = tokens["token_expires_at"]
        account.is_active = True

    await db.flush()
    return RedirectResponse(f"{frontend_back}?gmail=connected&email={google_email}")
