"""
应用配置 — 从环境变量读取所有敏感信息
所有 API Key 都不会硬编码在代码里
"""

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # === 数据库 ===
    DATABASE_URL: str = "postgresql+asyncpg://sdrcrm:sdrcrm_dev@localhost:5432/sdrcrm"

    # === Redis 缓存 ===
    REDIS_URL: str = "redis://localhost:6379/0"

    # === JWT 认证 ===
    SECRET_KEY: str = "change-me-to-a-random-secret-key"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 小时，一个工作日

    # === Apollo.io ===
    APOLLO_API_KEY: str = ""

    # === AI (Anthropic only — single provider) ===
    ANTHROPIC_API_KEY: str = ""

    # === Google OAuth (Gmail send + profile) ===
    # 在 Google Cloud Console → APIs & Services → Credentials 建 OAuth 2.0 Client (Web)
    # 授权回调地址必须跟 GOOGLE_OAUTH_REDIRECT_URI 一致
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_OAUTH_REDIRECT_URI: str = "http://localhost:8000/api/auth/google/callback"

    # 前端基地址 —— OAuth 回调完成后跳回前端
    # Frontend base URL — where to send the user after OAuth completes
    FRONTEND_BASE_URL: str = "http://localhost:3000"

    # DISABLED: Using Claude direct search instead of OpenAI embeddings
    # OPENAI_API_KEY: str = ""

    @field_validator("DATABASE_URL", mode="after")
    @classmethod
    def coerce_asyncpg_driver(cls, v: str) -> str:
        """
        Railway / Heroku / Render 的 Postgres 插件暴露的 DATABASE_URL 格式是
        `postgresql://...`，但 SQLAlchemy 异步引擎需要 `postgresql+asyncpg://...`。
        自动补齐驱动前缀，兼容这些平台。

        Auto-coerce bare postgresql:// to postgresql+asyncpg:// so Railway's
        native DATABASE_URL works without manual rewriting.
        """
        if v.startswith("postgres://"):
            # Heroku legacy prefix
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://") and "+asyncpg" not in v:
            return "postgresql+asyncpg://" + v[len("postgresql://"):]
        return v

    class Config:
        env_file = ".env"


# 全局配置实例 — 其他文件直接 import 使用
settings = Settings()


# === AI Model Configuration ===
# All AI features use Haiku 4.5 — change here to switch model everywhere
CLAUDE_MODEL = "claude-haiku-4-5-20251001"
CLAUDE_MAX_TOKENS_RESEARCH = 2000   # Person/company research reports
CLAUDE_MAX_TOKENS_EMAIL = 800       # Email drafting
CLAUDE_MAX_TOKENS_SEARCH = 1000     # Smart search
AI_SEARCH_ACTIVITY_LIMIT = 500      # How many activities to feed into search context

# === AI 成本保护 Cost Guardrails ===
# 价格 per 1M tokens (Claude Haiku 4.5 官方价)
# Pricing reference: https://www.anthropic.com/pricing
AI_PRICE_INPUT_PER_M = 1.0          # $1 / 1M input tokens
AI_PRICE_OUTPUT_PER_M = 5.0         # $5 / 1M output tokens
AI_PRICE_CACHE_READ_PER_M = 0.10    # $0.10 / 1M cache-read tokens (10% of input)
AI_PRICE_CACHE_WRITE_PER_M = 1.25   # $1.25 / 1M cache-write tokens (125% of input)

# 每日/月度预算上限（美元）— 超过即熔断
AI_DAILY_BUDGET_USD = 3.0           # Daily cap
AI_MONTHLY_BUDGET_USD = 50.0        # Monthly cap

# 研究报告缓存：同一个联系人多少天内复用已有报告
AI_REPORT_CACHE_DAYS = 30
