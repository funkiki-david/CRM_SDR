"""
Database models — all table definitions exported here
"""

from app.models.user import User, UserRole
from app.models.contact import Contact
from app.models.lead import Lead, LeadStatus
from app.models.activity import Activity, ActivityType
from app.models.embedding import Embedding
from app.models.email_account import EmailAccount
from app.models.email_template import EmailTemplate
from app.models.sent_email import SentEmail, EmailStatus
from app.models.ai_usage_log import AIUsageLog
from app.models.app_setting import AppSetting
from app.models.enrichment_log import EnrichmentLog

__all__ = [
    "User", "UserRole",
    "Contact",
    "Lead", "LeadStatus",
    "Activity", "ActivityType",
    "Embedding",
    "EmailAccount",
    "EmailTemplate",
    "SentEmail", "EmailStatus",
    "AIUsageLog",
    "AppSetting",
    "EnrichmentLog",
]
