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


# === Anthropic (Claude) ===

@router.post("/anthropic-key")
async def update_anthropic_key(
    data: ApiKeyUpdate,
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    ai_service.update_keys(anthropic_key=data.key)
    return {"message": "Anthropic API key updated successfully"}


@router.get("/anthropic-key/status")
async def anthropic_key_status(
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    return {
        "configured": ai_service.claude_ready,
        "key_preview": f"...{settings.ANTHROPIC_API_KEY[-6:]}" if ai_service.claude_ready else None,
    }


# === OpenAI ===

@router.post("/openai-key")
async def update_openai_key(
    data: ApiKeyUpdate,
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    ai_service.update_keys(openai_key=data.key)
    return {"message": "OpenAI API key updated successfully"}


@router.get("/openai-key/status")
async def openai_key_status(
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    return {
        "configured": ai_service.embeddings_ready,
        "key_preview": f"...{settings.OPENAI_API_KEY[-6:]}" if ai_service.embeddings_ready else None,
    }
