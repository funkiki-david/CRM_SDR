# SDR ProCRM — Railway 部署指南

> **用途**: 从本地开发到 Railway 云端部署的完整步骤  
> **目标读者**: 非技术创始人 David（Amazon Solutions）  
> **预计时间**: 首次部署 30-60 分钟  
> **创建日期**: 2026-04-16

---

## 🎯 部署策略总览

**一个平台搞定全部：**

```
┌─────────────────────────────────────────┐
│          Railway 项目                   │
│                                         │
│  ┌──────────┐   ┌──────────────────┐    │
│  │ Next.js  │──>│ FastAPI 后端      │    │
│  │ 前端     │   │ (Python)         │    │
│  └──────────┘   └──────────────────┘    │
│                          │              │
│       ┌──────────────────┼──────┐       │
│       ▼                  ▼      ▼       │
│  ┌──────────┐    ┌───────────┐ ┌─────┐  │
│  │PostgreSQL│    │  Redis    │ │pgvec│  │
│  │ 数据库   │    │  缓存     │ │ tor │  │
│  └──────────┘    └───────────┘ └─────┘  │
│                                         │
└─────────────────────────────────────────┘
         │                    │
         ▼                    ▼
    前端公开 URL         后端 API URL
 crm.amazonsolutions.us   api.amazonsolutions.us
```

---

## 📋 部署前准备清单

在开始 Railway 部署之前，确认以下事项：

- [ ] 本地测试全部通过（你已完成 ✅）
- [ ] 代码已推到 GitHub（你已完成 ✅）
- [ ] 信用卡（Railway 需要绑定，有 $5 免费额度）
- [ ] 域名（可选，没有也能先用 Railway 默认域名）

**从 OPTIMIZATIONS.md P0 优先处理的事项**（部署前最好完成）：
- [ ] 1. API Key 加密存储 — 防止数据库泄露后损失
- [ ] 2. AI 成本上限保护 — 防止账单失控
- [ ] 3. AI 幻觉警告标签 — 防止误导客户

---

## 🚀 第一步：注册 Railway 账号

### 1.1 打开 Railway

浏览器访问：**https://railway.app**

### 1.2 用 GitHub 登录

点 **"Login"** → 选 **"Login with GitHub"**（跟你 Supabase 时一样）

### 1.3 授权 Railway 访问你的 GitHub

弹出授权页面，点 **"Authorize Railway"**

### 1.4 绑定信用卡

Railway 需要绑定信用卡（不会立刻扣费）：
- 免费额度：$5/月
- 实际使用：每月大约 $5-15（取决于流量）
- 可设置硬性上限，到达后自动停止，不会超支

---

## 🎬 第二步：创建项目并部署后端

### 2.1 新建 Railway 项目

Railway 主页点 **"New Project"**

### 2.2 选 "Deploy from GitHub repo"

会列出你的所有 GitHub 仓库。

### 2.3 选择 `CRM_SDR` 仓库

### 2.4 Railway 自动检测项目类型

Railway 会扫描你的代码，自动识别：
- ✅ 发现 `backend/` 目录有 `requirements.txt` → Python FastAPI
- ✅ 发现 `frontend/` 目录有 `package.json` → Next.js

此时会创建一个服务（Service）。

### 2.5 配置后端 Service

点刚创建的服务，进入 Settings：

**Source**:
- Root Directory: `backend`
- Build Command: （留空，Railway 自动识别）
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

**重要**：端口用 `$PORT` 环境变量，不要写死 8000。

---

## 🗄️ 第三步：添加 PostgreSQL 数据库

### 3.1 在项目里点 "New"

Railway 项目视图里会看到 **"+ New"** 按钮。

### 3.2 选 "Database" → "PostgreSQL"

Railway 会自动：
- 创建一个 PostgreSQL 实例
- 生成连接字符串
- 把 `DATABASE_URL` 自动注入到你的后端 Service

**不用复制粘贴密码！Railway 会自动连接。这是 Railway 最大的优势。**

### 3.3 启用 pgvector 扩展

点进 PostgreSQL 服务 → Data 标签 → Query → 粘贴：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

点运行。

---

## 💾 第四步：添加 Redis

### 4.1 项目里再点 "+ New"

### 4.2 选 "Database" → "Redis"

Railway 自动：
- 创建 Redis 实例
- 注入 `REDIS_URL` 到后端 Service

---

## 🌐 第五步：部署前端

### 5.1 在同一个项目里点 "+ New"

### 5.2 选 "GitHub Repo" → 选同一个 `CRM_SDR` 仓库

### 5.3 配置前端 Service

**Source**:
- Root Directory: `frontend`
- Build Command: `npm run build`
- Start Command: `npm start`

### 5.4 设置环境变量

前端需要知道后端 API 地址：

在前端 Service 的 Variables 标签添加：
```
NEXT_PUBLIC_API_URL=${{backend.RAILWAY_PUBLIC_DOMAIN}}
```

（Railway 支持服务间引用，这样前端自动指向后端）

---

## 🔑 第六步：配置敏感环境变量

后端 Service 的 Variables 标签，添加：

```
SECRET_KEY=<让 Claude Code 生成一个随机 32 位字符串>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
ANTHROPIC_API_KEY=<你的 Key>
OPENAI_API_KEY=<你的 Key>
```

**安全提示**：Railway 的环境变量是加密存储的，你在网页上看到的值其他人看不到（除非被邀请进项目）。

---

## 🌍 第七步：生成公开域名

### 7.1 为后端生成域名

后端 Service → Settings → Networking → **"Generate Domain"**

得到类似：`crm-sdr-backend-production.up.railway.app`

### 7.2 为前端生成域名

前端 Service → Settings → Networking → **"Generate Domain"**

得到类似：`crm-sdr-frontend-production.up.railway.app`

### 7.3 （可选）绑定自定义域名

如果你有 `amazonsolutions.us` 域名：
- 前端 Service → Settings → Custom Domain
- 输入 `crm.amazonsolutions.us`
- Railway 给你一个 CNAME 记录
- 你去域名服务商（如 Cloudflare）添加这条 CNAME
- 等几分钟 SSL 自动配好

---

## ✅ 第八步：验证部署

### 8.1 打开后端 API 测试

浏览器访问：`https://[你的后端域名]/docs`

应该能看到 FastAPI 自动生成的 API 文档页面。

### 8.2 打开前端测试

浏览器访问：`https://[你的前端域名]`

应该能看到登录页。尝试登录：
- 邮箱：`info@amazonsolutions.us`
- 密码：`admin123`（你本地数据库的测试账号）

**如果前端能连上后端，并且登录成功 → 部署完成！** 🎉

---

## 💰 成本预估

根据 Railway 2026 定价（基础使用估算）：

| 资源 | 月费（估计）|
|------|------|
| 前端 Next.js | ~$2-5 |
| 后端 FastAPI | ~$3-7 |
| PostgreSQL | ~$2-5 |
| Redis | ~$1-2 |
| **总计** | **$8-19/月** |

**说明**：
- Railway 按实际使用的 CPU/内存计费
- 有 $5/月免费额度（新账号还送 $5 试用）
- 可设置月度硬性上限
- 流量增加时才会线性增加

---

## 🚨 常见问题排查

### 问题 1：后端服务启动失败

**查日志**：后端 Service → Deployments → 最新部署 → View Logs

**常见原因**：
- Start Command 写错（应该是 `uvicorn app.main:app --host 0.0.0.0 --port $PORT`）
- 缺少环境变量（检查 Variables 标签）
- 依赖安装失败（查 Build Logs）

### 问题 2：前端连不上后端

**检查**：
- `NEXT_PUBLIC_API_URL` 是否正确设置
- 后端是否有生成公开域名
- 浏览器 Console 看具体错误（可能是 CORS 问题）

### 问题 3：数据库连接错误

**这次不会再有 Supabase 那种密码问题** — Railway 自动注入 `DATABASE_URL`，不用你手动填。

如果真有问题，检查：
- 后端 Service 和 PostgreSQL 是否在同一个 Railway 项目
- `DATABASE_URL` 环境变量是否出现在 Variables 里（应该自动有）

---

## 🔄 后续更新流程

代码改动后怎么更新到线上？

**超级简单**：
```bash
cd ~/CRM_SDR
git add .
git commit -m "update feature X"
git push origin main
```

Railway 自动检测 GitHub push → 重新构建 → 零停机部署到线上。

**大约 2-3 分钟完成**。

---

## 📞 遇到问题怎么办

**Railway 自己的资源**：
- 状态页：https://status.railway.app
- 社区 Discord：https://discord.gg/railway
- 文档：https://docs.railway.app

**找 Claude Code 帮忙**：

```
我的 Railway 部署有问题：
- 现象：[具体描述]
- 错误信息：[粘贴错误]
- 已经尝试：[你做了什么]

帮我诊断。
```

---

## 🎯 部署完成后的下一步

1. **发到 LinkedIn** — 分享你的第一个公开 URL：
   > "Day 7: My CRM is live. You can visit it at crm.amazonsolutions.us"

2. **邀请 3-5 个朋友试用** — 收集反馈

3. **开始处理 OPTIMIZATIONS.md** — 从 P0 开始

4. **配置自定义域名 + SSL** — 让产品更专业

5. **设置 Railway 的 usage alert** — 到 $10/月时发邮件提醒你

---

## 📝 当你准备好部署时，给 Claude Code 的指令

```
我准备部署到 Railway 了（改为单平台方案，放弃之前的 Supabase + Vercel + Upstash 四平台组合）。

请帮我：

1. 检查 backend/ 和 frontend/ 目录下是否需要添加 Railway 配置文件
2. 确认 FastAPI 的启动命令能接受 $PORT 环境变量
3. 确认 Next.js 的 API 请求地址能通过环境变量配置
4. 生成一个安全的 SECRET_KEY（32 位随机字符串）并告诉我
5. 把 Supabase 相关的连接代码注释掉（不删除，未来可能用）
6. 更新 README.md，加上 Railway 部署说明

做完告诉我，我去 Railway 网页创建项目并连接 GitHub。
遇到需要我手动操作 Railway 界面的地方，你详细告诉我怎么点。
```

---

*由 David Zheng 和 Claude 共同维护 · Amazon Solutions · SDR ProCRM*
