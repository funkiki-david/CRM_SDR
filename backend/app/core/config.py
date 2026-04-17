"""
应用配置 — 从环境变量读取所有敏感信息
所有 API Key 都不会硬编码在代码里
"""

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

    # DISABLED: Using Claude direct search instead of OpenAI embeddings
    # OPENAI_API_KEY: str = ""

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
