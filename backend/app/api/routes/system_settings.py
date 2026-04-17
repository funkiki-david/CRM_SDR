"""
System Settings API — Update API keys and system configuration at runtime
Only accessible by Admin users.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.deps import require_role
from app.models.user import User, UserRole
from app.services.apollo import apollo_service
from app.services.ai import ai_service
from app.core.config import settings

router = APIRouter(prefix="/api/settings", tags=["System Settings"])


class ApiKeyUpdate(BaseModel):
    key: str


# === Apollo ===

@router.post("/apollo-key")
async def update_apollo_key(
    data: ApiKeyUpdate,
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    apollo_service.api_key = data.key
    settings.APOLLO_API_KEY = data.key
    return {"message": "Apollo API key updated successfully"}


@router.get("/apollo-key/status")
async def apollo_key_status(
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    return {
        "configured": apollo_service.is_configured,
        "key_preview": f"...{apollo_service.api_key[-6:]}" if apollo_service.is_configured else None,
    }


# === Anthropic (Claude) — single AI provider ===

@router.post("/anthropic-key")
async def update_anthropic_key(
    data: ApiKeyUpdate,
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    """Save Anthropic API key and validate it by making a test call"""
    ai_service.update_keys(anthropic_key=data.key)

    # Validate the key
    is_valid = await ai_service.validate_key()

    if is_valid:
        return {
            "message": "API Key is valid and working",
            "valid": True,
        }
    else:
        # Key was saved but doesn't work — keep it so user can see the error
        return {
            "message": "Invalid key. Please check and try again.",
            "valid": False,
        }


@router.get("/anthropic-key/status")
async def anthropic_key_status(
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    return {
        "configured": ai_service.ai_ready,
        "key_preview": f"...{settings.ANTHROPIC_API_KEY[-6:]}" if ai_service.ai_ready else None,
    }


# DISABLED: OpenAI key management — using Claude for all AI features
# @router.post("/openai-key")
# @router.get("/openai-key/status")
