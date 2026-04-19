# SDR CRM — 项目完整现状总结

> **日期**: 2026-04-17 (Day 7)
> **用途**: 把这份文档交给 Claude（或任何 AI 助手），即可获得项目完整上下文。也供 David 做全局盘点、决定删减方向。
> **仓库**: https://github.com/funkiki-david/CRM_SDR (Private)

---

## 一、项目是什么

专为 SDR 销售员设计的智能 CRM。非技术创始人用 Claude Code 从零搭建，0 行手写代码。

| 项 | 值 |
|------|------|
| 负责人 | David Zheng · Amazon Solutions |
| 搭建方式 | Claude Code（自然语言指挥 AI 写代码）|
| 前端 | Next.js 15 · TypeScript · Tailwind CSS · shadcn/ui |
| 后端 | Python FastAPI · SQLAlchemy 2.0 (async) |
| 数据库 | PostgreSQL 16 + pgvector（本地 Homebrew） |
| 缓存 | Redis（本地 Homebrew） |
| AI | Anthropic Claude Haiku 4.5 — 单一供应商处理所有 AI 功能 |
| 累计花费 | $100（Claude Max 订阅） |
| 进度 | Day 7 / 30 · 本地 MVP 完成 · 等待部署 |

---

## 二、本地可用的功能

所有功能在 `localhost:3000`（前端）+ `localhost:8000`（后端）正常运行：

| 页面 | URL | 状态 |
|------|-----|:---:|
| Login | /login | ✅ |
| Dashboard | /dashboard | ✅ Follow-up 清单 + Activity feed |
| Contacts | /contacts | ✅ 分栏视图 + 详情 + 新增联系人 |
| Finder | /finder | ✅ Apollo 搜索（需配 API Key）|
| AI Search | /ai-search | ✅ Claude 驱动（需配 API Key）|
| Templates | /templates | ✅ 邮件模板增删改查 |
| Settings | /settings | ✅ API Key 管理 |

### 已完成的 7 大功能模块

1. **登录 + 三级权限**: Admin / Manager / SDR，JWT 认证
2. **联系人 CRUD**: 列表、详情、新增、编辑、搜索、多选
3. **活动录入**: 电话/邮件/LinkedIn/会议/备注 + 语音输入
4. **Apollo.io 集成**: ICP 搜索、去重检测、批量导入
5. **邮件系统**: 模板库、撰写、发送（模拟 — 无 Gmail OAuth）
6. **AI 功能**: 人物/公司研究报告、邮件起草、智能搜索
7. **新增联系人弹窗**: 完整校验、邮箱去重、行业标签、备注

---

## 三、数据库现状（本地 PostgreSQL）

**连接串**: `postgresql://sdrcrm:sdrcrm_dev@localhost:5432/sdrcrm`

### 8 张表

| 表 | 记录数 | 用途 |
|---|:---:|------|
| users | 4 | 1 Admin + 3 Manager |
| contacts | 126 | 117 真实 + 9 测试 |
| leads | ~125 | 每个联系人一条 |
| activities | ~15 | 测试活动 |
| email_templates | 4 | 冷邮件模板 |
| email_accounts | 1 | 测试邮箱账号 |
| sent_emails | 1 | 测试已发邮件 |
| embeddings | 0 | 预留给向量搜索 |

### 用户账号

| ID | 名字 | 邮箱 | 角色 |
|:--:|------|------|:---:|
| 1 | David Zheng | info@amazonsolutions.us | Admin |
| 2 | GT Marketing | marketing@graphictac.biz | Manager |
| 3 | GT Doug | graphictac.doug@gmail.com | Manager |
| 4 | GT Steve | graphictac.steve@gmail.com | Manager |

密码: Admin = `admin123` · Manager = `manager123`
**部署后必须立即改密码。**

### 权限规则
- **Admin**: 看所有数据 + Settings + 用户管理
- **Manager**: 看所有数据（无 Settings、无用户管理）
- **SDR**: 只看自己的联系人和活动

---

## 四、GitHub 仓库状态

### Commits（5 次）
```
23f8803  chore: update frontend submodule ref
646503d  docs: 整合核心文档 v3
da6b1f2  Add deployment TODOs and optimizations checklist
72d4914  Add complete SDR CRM system
27dc26a  Initial commit
```

### ⚠️ 已知问题：前端 Submodule 损坏

`frontend/` 目录有一个**损坏的 git submodule 引用**：
- Git 以为 frontend 是 submodule，但 `.gitmodules` 文件不存在
- 前端源文件存在于本地（从备份恢复），但 **没有被 git 追踪**
- **意味着**：推到 GitHub 时**不包含前端代码**

**部署前必须修复**:
```bash
git rm --cached frontend
rm -rf frontend/.git
git add frontend/
git commit -m "fix: convert frontend from broken submodule to regular directory"
git push
```

---

## 五、完整文件结构

```
CRM_SDR/
├── CLAUDE.md                        # Claude Code 项目记忆
├── .gitignore
├── docker-compose.yml               # 本地开发用
│
├── backend/
│   ├── .env                         # 本地环境变量（不进 Git）
│   ├── .env.example                 # 环境变量模板
│   ├── .env.production.example      # 生产环境模板
│   ├── requirements.txt
│   ├── Procfile                     # Railway 启动命令
│   ├── railway.json                 # Railway 构建配置
│   ├── Dockerfile                   # Docker 构建（备用）
│   ├── runtime.txt                  # Python 3.12
│   ├── seed_data.py                 # 测试数据种子
│   ├── seed_emails.py               # 邮件模板种子
│   │
│   └── app/
│       ├── main.py                  # FastAPI 入口
│       ├── core/
│       │   ├── config.py            # 配置 + AI 模型常量
│       │   ├── database.py          # SQLAlchemy async 引擎
│       │   ├── security.py          # JWT + bcrypt
│       │   ├── deps.py              # 认证依赖注入
│       │   └── init_db.py           # 自动建表 + Admin 账号
│       ├── models/                  # 8 个 SQLAlchemy 模型
│       ├── schemas/                 # Pydantic 请求/响应模型
│       ├── api/routes/              # 9 个 API 路由文件
│       │   ├── auth.py              # 登录/注册/me
│       │   ├── contacts.py          # CRUD + 去重
│       │   ├── activities.py        # 创建 + 列表 + feed
│       │   ├── dashboard.py         # Follow-up 清单
│       │   ├── templates.py         # 邮件模板 CRUD
│       │   ├── emails.py            # 撰写 + 发送 + 邮箱账号
│       │   ├── apollo.py            # 搜索 + 导入
│       │   ├── ai.py                # 报告 + 起草 + 搜索
│       │   └── system_settings.py   # API Key 管理
│       └── services/
│           ├── ai.py                # Claude API 封装
│           └── apollo.py            # Apollo API 封装
│
├── frontend/                        # ⚠️ 本地有文件但 Git 未追踪
│   ├── package.json
│   ├── next.config.ts
│   ├── railway.json
│   └── src/
│       ├── app/                     # 7 个页面
│       ├── components/              # 4 业务组件 + 15 UI 组件
│       └── lib/
│           ├── api.ts               # API 客户端
│           └── utils.ts             # Tailwind 工具
│
└── docs/
    ├── SDR-CRM-Project-Plan-v2.md   # 项目规划 v2
    ├── OPTIMIZATIONS.md             # 优化待办（P0-P3）
    ├── LLM-COST-OPTIMIZATION.md     # AI 成本优化 4 步
    ├── Deployment.md                # Railway 部署手册
    ├── DEPLOY.md                    # ⚠️ 旧版部署指南
    ├── CONTACTS-ENHANCEMENT-SPEC.md # 联系人增删导入导出规格
    ├── contacts_clean_for_crm.csv   # 118 条真实联系人 CSV
    └── CHANGELOG-2026-04-16-17.md   # 部署日志
```

---

## 六、未完成事项

### 🔴 阻塞部署

| # | 事项 | 说明 |
|:--:|------|------|
| 1 | **前端 submodule 修复** | 必须先转成普通目录再 push（命令见第四节）|
| 2 | **Railway 部署** | 4/16-17 曾尝试，跑起来过但已回滚 |
| 3 | **DATABASE_URL 格式** | Railway 给 `postgresql://`，后端需要 `postgresql+asyncpg://`（自动转换代码写了但随部署一起回滚了）|

### 🟡 功能缺口

| # | 事项 | 说明 |
|:--:|------|------|
| 4 | Gmail OAuth | 邮件只记录不真发 |
| 5 | 邮件追踪 | 无打开/点击追踪 |
| 6 | 导入 CSV | UI 规格已写，未实现 |
| 7 | 导出 CSV | UI 规格已写，未实现 |
| 8 | API Key 加密 | Key 存内存，未加密持久化 |

### 🔵 锦上添花

| # | 事项 | 说明 |
|:--:|------|------|
| 9 | AI 语音解析 | Whisper 集成，从语音提取信息 |
| 10 | 相似客户发现 | 向量相似度匹配 |
| 11 | 审计日志 | 谁做了什么 |

---

## 七、API 端点汇总

| Method | Endpoint | Auth | 用途 |
|:---:|----------|:---:|------|
| POST | /api/auth/login | No | 登录，返回 JWT |
| POST | /api/auth/register | Admin | 创建用户 |
| GET | /api/auth/me | Yes | 当前用户信息 |
| GET | /api/contacts | Yes | 联系人列表 |
| POST | /api/contacts | Yes | 创建联系人 |
| GET | /api/contacts/{id} | Yes | 联系人详情 |
| PATCH | /api/contacts/{id} | Yes | 更新联系人 |
| GET | /api/contacts/check-email | Yes | 邮箱去重 |
| POST | /api/activities | Yes | 记录活动 |
| GET | /api/activities/feed | Yes | 团队动态流 |
| GET | /api/activities/contact/{id} | Yes | 联系人时间线 |
| GET | /api/dashboard/follow-ups | Yes | 今日 follow-up |
| GET/POST | /api/templates | Yes | 邮件模板 CRUD |
| POST | /api/emails/send | Yes | 发送邮件 |
| POST | /api/emails/preview | Yes | 预览模板 |
| GET | /api/emails/accounts | Yes | 邮箱账号列表 |
| POST | /api/apollo/search | Yes | Apollo 搜索 |
| POST | /api/apollo/import | Yes | 导入联系人 |
| GET | /api/ai/status | Yes | AI 就绪检查 |
| POST | /api/ai/report/person | Yes | 人物研究报告 |
| POST | /api/ai/report/company | Yes | 公司研究报告 |
| POST | /api/ai/draft-email | Yes | AI 邮件起草 |
| POST | /api/ai/search | Yes | 智能搜索 |
| POST | /api/settings/anthropic-key | Admin | 设置 API Key |
| POST | /api/settings/apollo-key | Admin | 设置 API Key |

---

## 八、docs/ 目录盘点与删减建议

### 现有文件

| 文件 | 作用 | 建议 |
|------|------|:---:|
| `CLAUDE.md`（根目录）| Claude Code 项目记忆 | ✅ 保留 |
| `SDR-CRM-Project-Plan-v2.md` | 产品规划 | ✂️ 见下方 |
| `OPTIMIZATIONS.md` | 45 条优化待办 | ✅ 保留 |
| `LLM-COST-OPTIMIZATION.md` | AI 成本 4 步 | ✅ 保留 |
| `Deployment.md` | Railway 部署手册（最新版） | ✅ 保留 |
| `DEPLOY.md` | 旧版部署指南 | 🗑️ 删除 |
| `CONTACTS-ENHANCEMENT-SPEC.md` | 联系人功能规格 | ✂️ 见下方 |
| `contacts_clean_for_crm.csv` | 118 条真实联系人 | ✅ 保留 |
| `CHANGELOG-2026-04-16-17.md` | 部署日志 | ✅ 保留 |

### 🗑️ 建议删除

| 文件 | 理由 |
|------|------|
| `DEPLOY.md` | 旧版部署指南，已被 `Deployment.md` 完全替代。同时存在两份会让 Claude Code 读到过时步骤做出错误操作 |

### ✂️ 建议精简

| 文件 | 当前 | 问题 | 建议 |
|------|:---:|------|------|
| `SDR-CRM-Project-Plan-v2.md` | ~410 行 | Tech Stack / 权限 / AI 功能 / 部署方案 / 成本估算这五块已被 CLAUDE.md / Deployment.md / LLM-COST-OPTIMIZATION.md 覆盖 | 只保留"页面功能清单"和"客制化需求表"两部分，砍到 ~150 行 |
| `CONTACTS-ENHANCEMENT-SPEC.md` | ? | 导入/导出 CSV 功能未实现。如果短期不做，规格文档放在 docs/ 会误导 Claude Code 以为要做 | 移到 `docs/backlog/` 子目录，或在文件顶部标注 `⏸ PAUSED — 不要执行` |

### 📝 建议补充

| 文件 | 理由 |
|------|------|
| `docs/schema.sql` | 从代码里导出 8 张表的完整 DDL，方便新环境快速建表、也给 Claude Code 查阅数据模型 |

### 精简后结构

```
CRM_SDR/
├── CLAUDE.md                            # 项目记忆（根目录）
├── docs/
│   ├── SDR-CRM-Project-Plan-v2.md       # ~150 行（只保留页面清单和需求表）
│   ├── OPTIMIZATIONS.md                 # 45 条优化待办
│   ├── LLM-COST-OPTIMIZATION.md         # AI 成本 4 步
│   ├── Deployment.md                    # Railway 部署手册
│   ├── CHANGELOG-2026-04-16-17.md       # 部署日志
│   ├── contacts_clean_for_crm.csv       # 真实联系人数据
│   ├── schema.sql                       # 8 张表 DDL（新建）
│   └── backlog/
│       └── CONTACTS-ENHANCEMENT-SPEC.md # 暂停的功能规格
├── backend/
├── frontend/
└── scripts/
```

**精简前**: docs/ 下 8 个文件，多处重叠
**精简后**: docs/ 下 7 个文件 + 1 个 backlog/，零重叠

---

## 九、总成本快照

| 项目 | 当前 | 运营后预估/月 |
|------|:---:|:---:|
| Claude Max 订阅 | $100/月 | $100（开发期 · 稳定后可降级）|
| Railway 托管 | $0（未部署）| $8-19 |
| Anthropic API（Haiku 4.5 优化后）| $0（未配 Key）| $25-35 |
| OpenAI API（Embedding）| $0（未配 Key）| $2-3 |
| Apollo.io | $0（未配 Key）| $0-49 |
| **总计** | **$100** | **$135-206/月** |

8 个 SDR 使用 = 每人每月 **$17-26**。对比 Salesforce $75/人/月。

---

## 十、本地启动命令

```bash
# 1. 启动 PostgreSQL 和 Redis
brew services start postgresql@16
brew services start redis

# 2. 启动后端
cd ~/CRM_SDR/backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 3. 启动前端（新终端）
cd ~/CRM_SDR/frontend
npm run dev

# 4. 浏览器打开
# http://localhost:3000
# 登录: info@amazonsolutions.us / admin123
```

---

## 十一、下一步行动排序

| 顺序 | 做什么 | 预计时间 | 对应文档 |
|:---:|------|:---:|------|
| **1** | 修复前端 submodule（阻塞一切后续） | 5 min | 本文档 § 四 |
| **2** | 审阅本文档，决定 docs/ 删减 | 10 min | 本文档 § 八 |
| **3** | AI 成本上限 + Haiku 硬编码 + 缓存 | 1 hr | LLM-COST-OPTIMIZATION.md |
| **4** | API Key 加密 + 幻觉警告标签 | 30 min | OPTIMIZATIONS.md P0-1, P0-3 |
| **5** | Railway 部署（第二次尝试） | 30-60 min | Deployment.md |
| **6** | 填入 API Key + 清空测试数据 | 10 min | Settings + Deployment.md § 13 |
| **7** | 发 LinkedIn Day 7 | 5 min | — |

---

*项目完整现状总结 · 2026-04-17 · 基于 GitHub 仓库真实状态 + David 提供的全部文档整合*
