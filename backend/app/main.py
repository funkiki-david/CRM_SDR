"""
SDR CRM — FastAPI 主应用入口
启动命令：uvicorn app.main:app --reload
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.init_db import init_db
from app.api.routes.auth import router as auth_router
from app.api.routes.contacts import router as contacts_router
from app.api.routes.activities import router as activities_router
from app.api.routes.activity_social import router as activity_social_router
from app.api.routes.dashboard import router as dashboard_router
# Templates router registered only to return 501 EMAIL_FROZEN on every verb
# while the email module is frozen; `email_templates` table is preserved.
from app.api.routes.templates import router as templates_router
from app.api.routes.emails import router as emails_router
from app.api.routes.apollo import router as apollo_router
from app.api.routes.system_settings import router as settings_router
from app.api.routes.ai import router as ai_router
from app.api.routes.users import router as users_router
from app.api.routes.tasks import router as tasks_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动时自动初始化数据库（建表 + 创建默认 Admin）"""
    await init_db()
    yield


# 创建 FastAPI 应用
app = FastAPI(
    title="SDR CRM API",
    description="SDR 智能 CRM 系统后端 API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow frontend to call backend API
# 白名单方式（保留 credentials=True，浏览器规范禁止 * + credentials 组合）
# Whitelist approach: keep credentials=True (browsers reject * + credentials combo)
_origins = [
    "http://localhost:3000",
    "https://crmsdr-production.up.railway.app",
    "https://natural-generosity-production.up.railway.app",
]
# 可选：FRONTEND_URL 环境变量追加额外 origin
if os.getenv("FRONTEND_URL") and os.getenv("FRONTEND_URL") not in _origins:
    _origins.append(os.getenv("FRONTEND_URL"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Register API routes ===
app.include_router(auth_router)
app.include_router(contacts_router)
app.include_router(activities_router)
app.include_router(activity_social_router)
app.include_router(dashboard_router)
app.include_router(templates_router)  # returns 501 EMAIL_FROZEN (see templates.py)
app.include_router(emails_router)
app.include_router(apollo_router)
app.include_router(settings_router)
app.include_router(ai_router)
app.include_router(users_router)
app.include_router(tasks_router)


@app.get("/")
async def root():
    """健康检查 — 打开浏览器访问 localhost:8000 看到这个就说明后端在运行"""
    return {"status": "ok", "message": "SDR CRM API is running"}


@app.get("/health")
async def health_check():
    """系统健康检查接口"""
    return {"status": "healthy"}
