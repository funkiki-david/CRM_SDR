# SDR CRM - Project Memory

## 项目简介
SDR 销售流程记录 CRM，集成 Apollo.io + Claude AI。
当前定位：Sales Pipeline 记录工具；发信/AI Draft 模块暂冻结（SDR 在自己 Gmail 里发）。

## Tech Stack
- Frontend: Next.js 16 (Turbopack), React 19, TypeScript 5, Tailwind, shadcn/ui
- Backend: Python 3.12, FastAPI, SQLAlchemy 2.0 (async)
- Database: PostgreSQL 16 + pgvector (Railway)
- AI: Anthropic Claude Haiku 4.5 (research / AI to-do / keyword suggest)
- Deployment: Railway (前端 + 后端 + Postgres)

## 页面
- `/login` — 登录（记住我）
- `/dashboard` — Follow-Ups Needed / Activity Feed / AI Suggested To-Do
- `/contacts` — 联系人列表 + 详情 + 活动时间线（分页、后端搜索、inline 编辑）
- `/emails` — 统一收发件列表（只读 + IMAP 同步；发送已冻结）
- `/finder` — Apollo 搜索（State + City 主搜，AI Keyword Finder 细化）
- `/settings` — API keys / Email accounts（只读）/ Team members / AI usage

## 用户角色
- Admin: 全部权限 (info@amazonsolutions.us)
- Manager: 团队共享视图 (marketing@graphictac.biz / graphictac.doug@gmail.com / graphictac.steve@gmail.com)
- SDR: 预留角色（当前所有数据团队共享，无角色级过滤）

## UI 设计规范
- 色板：slate (主) / blue-600 (强调) / red-500 (警示) / white / slate-50
- 不要彩色分类标签（Industry / Seniority 这类已移除）
- 深色导航栏 (bg-slate-900)，主内容区浅灰 (bg-slate-50)
- 活动图标用单色 unicode (☎ ✉ ◆ ✎)，不用 emoji（emoji 无法被 CSS 染色）

## 核心规则
- Apollo / Anthropic API key 全部走后端（不暴露）
- 所有时间用 UTC，前端渲染时转本地时区
- 联系人导入时自动去重：有 email → 按 email；无 email → 按 (first_name, last_name, company, office_phone)
- 邮件模块当前冻结：所有发送端点返回 501 EMAIL_FROZEN；UI 按钮灰 + tooltip

## 数据库架构要点
- `contacts` — 联系人主表（mobile_phone + office_phone 拆分、assigned_to、ai_person/company_generated_at）
- `activities` — 活动时间线（call/email/meeting/note/linkedin）
- `leads` — 跟进管道
- `sent_emails` — 邮件收发记录（direction=sent|received，message_id / in_reply_to / is_read）
- `email_accounts` — SMTP 账号（password_encrypted Fernet）
- `email_templates` — 冻结中，schema 保留
- `ai_usage_log` — 每次 AI 调用的 token/成本记录

## 开发规范
- 代码注释中英混排
- 每个模块先跑通再合并
- 前后端分离走 REST，JSON 格式
- DB schema 用 idempotent ALTER migration（不用 alembic）

## Context Management
Context is your most important resource:
1. Use subagents (Agent) for exploration — never read >3 files in main session.
2. Subagent routing: file search → haiku; code review → sonnet; architecture → main (opus).
3. Spawn Explore agent before editing to find relevant files.
4. For parallel independent tasks, send multiple Agent calls in one message.
