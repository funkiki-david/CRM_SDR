# SDR ProCRM - Project Memory

## 项目简介
专为 SDR 销售员设计的智能 CRM，集成 Apollo.io + AI + 向量数据库。

## Tech Stack
- Frontend: Next.js 15, TypeScript, Tailwind CSS, shadcn/ui
- Backend: Python 3.12, FastAPI, SQLAlchemy 2.0
- Database: PostgreSQL 16 + pgvector (Supabase)
- Cache: Redis
- AI: Claude API + OpenAI Embeddings
- Email: Gmail API (多邮箱)
- Voice: OpenAI Whisper API

## UI 设计规范
- 纯白/浅色底，干净简洁
- 不要深色模式
- 不要复杂图表、看板、热力图
- 首页是行动清单，不是仪表板
- Pipeline 用 Activity Feed 形式，不用 Kanban

## 用户角色
- Admin: 全部权限
- Manager: 查看团队数据，分配 lead
- SDR: 只看自己的客户，互相隔离

## 核心规则
- Apollo API 调用全部走后端（不暴露 API Key）
- 所有时间用 UTC，前端转本地时区
- 联系人导入时自动去重检测（email + company_domain）
- 每条活动录入后自动生成 embedding 存入 pgvector

## 开发规范
- 所有代码写清楚中英文注释
- 每个模块完成后确保可运行
- 前后端分离，通过 REST API 通信
