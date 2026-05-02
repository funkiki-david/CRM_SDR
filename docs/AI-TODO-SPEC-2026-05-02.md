# AI Suggested To-Do — 功能开发规格书

**项目**:SDR CRM
**功能模块**:AI Suggested To-Do(Dashboard 面板)
**版本**:v1.3 — CP4 范围调整(B 类适配现有 7 个 LeadStatus enum)
**最后更新**:2026-05-02
**目标读者**:Claude Code

---

## 一、背景 & 目标

### 业务场景

SDR CRM 当前定位为**关系维护型 CRM**——服务对象是 3 个 Manager(marketing@graphictac.biz / graphictac.doug / graphictac.steve),管理的是已合作或洽谈中的真实客户(180 条 contacts)。

不是冷启动 outbound,所以提醒规则不抄 Salesloft/Outreach 那套 16-touch cadence。

### 这个功能要解决什么

> Manager 经常忘了"该跟进谁、该做什么、什么时候做"。AI Suggested To-Do 通过分析 contacts / activities / leads 数据,**主动告诉 Manager 今天该做哪几件事**。

### 不要做什么(避免范围蔓延)

- ❌ 不要做客户生日提醒(没数据)
- ❌ 不要做邮件 bounce 检测(邮件模块已冻结)
- ❌ 不要做 NPS / 满意度打分(没数据)
- ❌ 不要一次性上线全部规则(Manager 会被淹没)
- ❌ 不要重做"今日 Follow-Ups"(已在 dashboard,不重复)

---

## 二、整体架构

### 三类提醒来源

```
┌─────────────────────────────────────────────────────┐
│            AI Suggested To-Do Dashboard             │
└─────────────────────────────────────────────────────┘
            ┃
   ┌────────╋────────────┬────────────────┐
   ▼        ▼            ▼                ▼
Trigger  时间型        阶段型          全局型
驱动     (基于互动)    (基于状态)      (周期任务)
   │        │            │                │
   │   "X 天没联系       "lead 在某      "本周扫一遍
   │    某联系人"         status 卡住"    pipeline 健康度"
   │
   └─ 大部分提醒在前两层
```

### 数据来源

依赖现有表(无需新建表):
- `contacts` — 联系人
- `activities` — 活动时间线(call / email / meeting / note / linkedin)
- `leads` — 跟进管道,有 `status`(12 阶段枚举)和 `next_follow_up`
- `sent_emails` — 邮件收发(direction = sent / received)
- `tasks` — 已存在,Mixed-in dashboard
- `ai_suggestion_snoozes` — 已存在,记录用户 dismiss

**新增字段**(每条规则触发时带的字段,不入库,运行时计算):
- `rule_id` — 规则唯一标识(eg `follow_up_14d`)
- `urgency` — `high` / `medium` / `low`
- `category` — `pacing` / `stage` / `data_health` / `relationship` / `discipline`
- `suggested_action` — `call` / `email` / `linkedin` / `review`
- `rationale` — 一句话解释为什么(给 Manager 看)
- `contact_id` — 关联人(全局规则可空)

---

## 三、规则清单(MVP — 全部 26 条)

### A. 跟进节奏类(13 条) — 最重要,占 50% 价值

每条规则的"上次互动"定义统一为:**最近一条 `activities` 记录的 `created_at`**(call/email/meeting/note 都算)。

| ID | 触发条件 | 建议动作 | Urgency |
|---|---|---|---|
| `pacing_hot_48h` | 最近一次 activity_type IN (call, meeting) 且 created_at < 48h | 24h 内发感谢 + 总结邮件 | high |
| `pacing_email_no_reply_3d` | 上次 activity_type = email 且 > 3d,且无后续 activity | 打电话(switch channel) | medium |
| `pacing_call_no_answer_2d` | 上次 activity content 含"未接通"/"voicemail"/"no answer"且 > 2d | 发邮件 + LinkedIn | medium |
| `pacing_silent_7d` | 上次 activity > 7d 且 < 14d | 轻 touch(分享文章/新闻) | low |
| `pacing_silent_14d` | 上次 activity > 14d 且 < 30d | 写 check-in 邮件 | medium |
| `pacing_silent_30d` | 上次 activity > 30d 且 < 60d | 触发挽回 cadence | high |
| `pacing_silent_60d` | 上次 activity > 60d 且 < 90d | 考虑 break-up 邮件或归档 | medium |
| `pacing_silent_90d` | 上次 activity > 90d | 决定 archive 还是激活 | low |
| `pacing_quote_5d` | lead.status IN (price_negotiation, talking_potential_order) 且最后 activity > 5d | 打电话问反馈 | high |
| `pacing_quote_10d` | 同上但 > 10d | 发"still interested?"短邮 | medium |
| `pacing_inbound_call_2h` | 最近 activity content 含"客户来电"/"inbound"且 < 2h 且无后续 activity | 立即回拨 | high |
| `pacing_email_received_today` | sent_emails.direction = received 且当天到达且无后续 sent | 当天回 | high |

### B. 阶段型(6 条) — 基于现有 lead.status 卡顿检测

⚠️ **v1.3 重要变更**:本节从 v1.2 的"12 阶段细化版"改回**基于现有 LeadStatus enum 的 7 阶段简化版**。原因:数据库现有 7 个 enum(NEW/CONTACTED/INTERESTED/MEETING_SET/PROPOSAL/CLOSED_WON/CLOSED_LOST)是抽象漏斗维度,不强行扩成 12 阶段以避免技术债。详见第十一节 Activity-Status 联动改造。

**LeadStatus 现有 7 个 enum 值**:
```python
class LeadStatus(str, Enum):
    NEW = "new"
    CONTACTED = "contacted"
    INTERESTED = "interested"
    MEETING_SET = "meeting_set"
    PROPOSAL = "proposal"
    CLOSED_WON = "closed_won"
    CLOSED_LOST = "closed_lost"
```

**6 条规则**(CLOSED_LOST 不做规则,已死的 lead 不打扰):

| ID | 触发条件 | 建议动作 | Urgency |
|---|---|---|---|
| `stage_new_stuck_7d` | lead.status = NEW 且最后 activity > 7d | 该首次 reach out 了 | medium |
| `stage_contacted_stuck_5d` | lead.status = CONTACTED 且最后 activity > 5d | 跟进或 switch channel | medium |
| `stage_interested_stuck_14d` | lead.status = INTERESTED 且最后 activity > 14d | 推进到 meeting | high |
| `stage_meeting_set_stuck_7d` | lead.status = MEETING_SET 且最后 activity > 7d | 记录 meeting outcome 或推进下一步 | high |
| `stage_proposal_stuck_5d` | lead.status = PROPOSAL 且最后 activity > 5d | 打电话问反馈 | high |
| `stage_won_repurchase_90d` | lead.status = CLOSED_WON 且最后 activity > 90d | 复购检查 | medium |

**实现注意事项**:
- 函数命名:`rule_<id>`,例如 `rule_stage_proposal_stuck_5d`
- category="stage",每条规则用 `@register_rule("<id>", "stage")` 装饰
- "最后 activity"统一定义为 `activities` 表里 `lead_id`(或通过 `contact_id` 关联)的 `MAX(created_at)`
- 单条规则触发时,rationale 用中文,< 30 字,例:"Sarah Chen @ Acme — 提案 6 天没回应"

### C. 管理纪律类(7 条) — 全局周期任务

不绑定 contact,定时触发。

| ID | 触发(cron-like) | 内容 | Urgency |
|---|---|---|---|
| `discipline_daily_followups` | 每日 8:30 | 今日到期 follow-up 数(已在 dashboard,**不重做**,跳过) | — |
| `discipline_weekly_volume` | 每周一 9:00 | 上周联络数量 vs 目标 | medium |
| `discipline_weekly_review` | 每周五 16:00 | 本周哪些 lead 没推进,改下一步 | medium |
| `discipline_power_hour` | 每周二 / 周四 10:00 | Power Hour 提醒(集中打电话 1 小时) | low |
| `discipline_monthly_recap` | 每月 1 号 9:00 | 上月 closed-won/lost 复盘 | medium |
| `discipline_pipeline_health` | 每月 15 号 9:00 | pipeline 各 stage 数量是否平衡 | medium |
| `discipline_quarterly_cleanup` | 每季度第一天 9:00 | 全部 contacts 扫一遍清理 | low |

⚠️ **目标值配置**(`discipline_weekly_volume`):MVP 写死 = `每周 50 通联络`,后续做 Settings 页配置。

### D. 数据健康类(6 条) — 让 CRM 数据不腐烂

| ID | 触发 | 动作 | Urgency |
|---|---|---|---|
| `data_missing_phone` | 上周新增 contact 缺 mobile_phone 和 office_phone | 补全 | low |
| `data_missing_linkedin` | contact 缺 linkedin_url | 补全 | low |
| `data_missing_industry` | contact 缺 industry 或 company_size | enrich | low |
| `data_dead_contact_30d` | contact 创建 > 30d 但**0 条 activity** | 判断是不是 dead | medium |
| `data_lead_stuck_60d` | lead 在某 status > 60d 没动 | 推进或 archive | medium |
| `data_collision_7d` | 同一 contact 7 天内有 ≥ 2 个 owner_id 不同的 activity | 检查撞车 | high |

### E. 关系维护类(8 条) — 适合存量客户

⚠️ **本批一半触发条件依赖外部数据**——MVP 阶段**只做能落地的 4 条**,其余 4 条标记为 backlog。

| ID | 触发 | 动作 | Urgency | MVP? |
|---|---|---|---|---|
| `relate_company_anniversary` | 客户公司创立日(需 enrich)+/- 7d | 发祝贺 | low | ❌ backlog |
| `relate_company_news` | website_scraper 检测到首页内容明显变化(diff vs 上次) | 借机 reach out | medium | ✅ MVP(已有 scraper) |
| `relate_job_change` | 需 LinkedIn 数据(贵) | 双重机会 | medium | ❌ backlog |
| `relate_funding` | 需新闻 API | 借势触达 | low | ❌ backlog |
| `relate_repurchase_90d` | lead.status = Order delivered 且 > 90d | 复购检查 | high | ✅ MVP |
| `relate_quarterly_thanks` | 季度结束日,所有 status = Order delivered 或 Future order follow up | 发 thank-you | low | ✅ MVP |
| `relate_health_check_180d` | lead.status = Order delivered 且 > 180d 且无后续 order | health check 电话 | medium | ✅ MVP |
| `relate_testimonial_request` | 同一客户有 ≥ 2 次 lead.status = Order delivered | 请求 testimonial | low | ✅ MVP |

---

## 四、规则总数 & MVP 范围

```
A. 跟进节奏类       12 条  ✅ 全部 MVP(已在 CP1-3 完成)
B. 阶段型            6 条  ✅ 全部 MVP(v1.3 调整,适配现有 7 个 enum)
C. 管理纪律类        6 条  ✅ MVP(扣除已存在的 daily followups)
D. 数据健康类        6 条  ✅ 全部 MVP
E. 关系维护类        8 条  ✅ 4 条 MVP / 4 条 backlog
─────────────────────────
共 34 条已锁定 / MVP 落地 30 条
```

---

## 五、技术实现规格

### 5.1 后端架构

**文件位置**:`backend/app/services/ai_todo_engine.py`(新建)

**核心函数**:
```python
async def generate_todos_for_user(
    db: AsyncSession,
    user: User,
    max_count: int = 7,  # 一天最多展示
) -> list[TodoSuggestion]:
    """
    For the given user, run all enabled rules and return prioritized suggestions.
    Excludes any rule+contact combo currently in ai_suggestion_snoozes.
    """
    ...
```

**规则注册方式**:用 decorator + 列表
```python
TODO_RULES = []

def register_rule(rule_id: str, category: str):
    def decorator(fn):
        TODO_RULES.append({"id": rule_id, "category": category, "fn": fn})
        return fn
    return decorator

@register_rule("pacing_hot_48h", "pacing")
async def rule_pacing_hot_48h(db, user) -> list[TodoSuggestion]:
    # 查最近 48h 内有 call / meeting 但没后续邮件的 contact
    ...
```

每条规则**独立函数**——好处:
- 加新规则只需写一个函数 + 一个 decorator
- 单条规则出 bug 不影响别的规则
- 测试可以单独跑某条规则

### 5.2 API 接口

**已存在**:`GET /api/ai/suggest-todos`(在 `backend/app/api/routes/ai.py:570`)

**修改**:把现在的 Claude-driven 实现替换为 rule-based + Claude 增强模式:

```python
@router.get("/suggest-todos")
async def suggest_todos(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 1. 跑所有规则 → 拿到 raw suggestions
    raw = await generate_todos_for_user(db, current_user, max_count=15)
    
    # 2. 按 urgency + recency 排序,取 top 7
    sorted_top = sorted(raw, key=lambda s: (URGENCY_WEIGHT[s.urgency], s.contact_id))[:7]
    
    # 3. (可选)用 Claude 给每条 rationale 润色,使更人性化
    #    成本控制:只对 top 7 调用,且批量一次调用
    
    return {"suggestions": [s.dict() for s in sorted_top]}
```

### 5.3 频率控制 / 防淹没

**关键约束**:
1. 一天给同一 user 最多展示 **7 条**
2. 同一 `(rule_id, contact_id)` 组合 24h 内不重复出现
3. 已 snooze 的 suggestion 直到 `snooze_until` 之后才再出现
4. urgency = high 优先(置顶),其次 medium,最后 low

**实现**:在 `ai_suggestion_snoozes` 表里,suggestion_hash 由 `sha256(f"{rule_id}|{contact_id}")[:32]` 生成。前端 dismiss / snooze 时把这个 hash 写入。

### 5.4 前端改造

**文件位置**:`frontend/src/app/dashboard/page.tsx`(line 745 附近的 `dismissed` Set)

**关键改动**:
1. **去掉 localStorage**——`dismissed` 改成从 `GET /api/tasks/snooze-suggestion?active=true` 拉
2. dismiss 按钮改成调 `POST /api/tasks/snooze-suggestion`(后端已实现)
3. 每条 suggestion 卡片新增:
   - **Urgency 颜色条**(red / amber / slate)
   - **Category 标签**(Pacing / Stage / Data / Relationship / Discipline)
   - **3 个 snooze 按钮**:1d / 3d / 7d / Done
   - **"Why this?" 折叠区**(显示 rationale)

### 5.5 周期任务调度(Discipline 类)

**问题**:Discipline 类规则需要"周一早上触发"这种定时,但现在是 user 打开 dashboard 才触发。

**MVP 解决**:不引入 cron / Celery,**懒加载触发**——
- 用户当天第一次打开 dashboard 时,检查"今天是否周一" → 是则把 weekly_volume 加进结果
- 缺点:用户周末不开就错过(可接受)

**后续优化**:接 APScheduler 或 Railway 的 cron 服务,主动推送邮件提醒。

---

## 六、验收标准(必跑)

### 单元测试

每条规则函数都要有对应单测,放在 `backend/tests/test_ai_todo_rules.py`。

### 集成测试

构造测试场景验证:

1. **场景 1:Hot lead 检测**
   - 创建 contact + 1 小时前的 call activity → 应触发 `pacing_hot_48h`
   - 创建 contact + 50 小时前的 call → 不该触发
   
2. **场景 2:静默检测**
   - 创建 contact,activity 是 8 天前 → 触发 `pacing_silent_7d`
   - 创建 contact,activity 是 15 天前 → 触发 `pacing_silent_14d`(不该触发 7d)
   
3. **场景 3:Stage 卡顿**
   - lead.status = `Verbal order` 且 6 天没动 → 触发 `stage_verbal_order_stuck`
   
4. **场景 4:Snooze**
   - 用户 dismiss 某 suggestion → 当天再请求,该 suggestion 不该出现
   - 7 天后再请求,应重新出现
   
5. **场景 5:数量上限**
   - 构造 50 条都该触发的场景 → API 只返 7 条,且按 urgency 排序

### 烟雾测试(Manager 灰度上线前)

用 4 个真实账号登录 dashboard,检查:
- AI Suggested To-Do 卡片显示 ≤ 7 条
- 每条都有 contact 名 + rationale
- dismiss 后刷新页面不再出现
- 1 天后(测试时手动改 snooze_until)重新出现

---

## 七、开发顺序建议

**Phase 1**(本周):骨架 + A 类
1. 建 `ai_todo_engine.py` + decorator 注册系统
2. 实现 A 类 12 条规则
3. 修改 `/api/ai/suggest-todos` 用新引擎
4. 前端去 localStorage,改后端 snooze

**Phase 2**(下周):B 类 + D 类
5. 实现 B 类 12 条 stage 规则
6. 实现 D 类 6 条 data health 规则

**Phase 3**(下下周):E 类 + C 类
7. 实现 E 类 4 条 MVP 规则
8. 实现 C 类 6 条 discipline 规则(懒加载触发)

**Phase 4**(上线后):反馈调整
9. 监控哪些规则被高频 dismiss → 调整阈值或砍掉
10. 监控哪些规则从未触发 → 检查实现 bug

**Phase 5**(每日邮件推送 — 可与 Phase 1-4 并行):
11. 集成 Resend API 发邮件(替代 SMTP,绕过 Railway 封锁)
12. 配置 Railway Cron 每日触发(`0 8 * * *` UTC)
13. 实现 `send_daily_digest_email` 任务,每用户取 top 10 todo 发邮件
14. 邮件模板 HTML + 纯文本双版本

详见第十节。

---

## 八、设计决策(已由 David 拍板)

1. **Lead status 停留天数**:使用第三节 B 类表格中的默认值,无需调整
2. **Manager 角色定制**:**不分角色**,所有人看同一份 todo 列表
3. **`pacing_promise_due` 承诺检测**:**MVP 砍掉**,后续如有需要可用 Claude 分析 activity.notes 升级
4. **`discipline_weekly_volume` 目标值**:MVP 写死 = 每周 50 通联络
5. **Backlog 4 条**(company_anniversary / job_change / funding / collision):全部进 backlog,不影响 MVP

---

## 九、参考资料

### 已搜过的 SDR best practice 来源
- Apollo.io: SDR sales 2026 guide(strategic pre-contact)
- Prospeo: SDR follow-up strategy 2026 playbook(14 天 7 touch)
- ZoomInfo Pipeline: 16-touch sequence over 30 days
- MarketBetter: SDR daily playbook(8:00 review → power hour → admin)
- Highspot: Sales development playbook
- Belkins(16.5M cold emails): 优化 cadence 数据

### 项目内部文档
- `CLAUDE.md` — 项目记忆,UI 规范,核心规则
- `audit-report.md` — 4-19 自动审计基线
- `docs/OPTIMIZATIONS.md` — 优化待办
- `backend/app/api/routes/ai.py:570` — 现有 suggest_todos 实现(待替换)
- `backend/app/api/routes/tasks.py:131` — 已实现的 snooze 接口

### 数据库参考
- 13 表 schema 已在 4-30 体检报告中确认 99% 一致(仅 `industry_tags_arr` 类型微差)
- `tasks` + `ai_suggestion_snoozes` 已 ready

---

## 十、每日邮件推送(Phase 5)

### 10.1 目标

每天早上 **8:00 (UTC)** 给每个 active 用户发一封邮件,展示他今天的 top 10 todo。
邮件内点链接直达 dashboard,Manager 5 分钟内能扫完。

### 10.2 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 邮件服务 | **Resend** | 免费 100 封/天,HTTP API 绕过 Railway SMTP 封锁,3 个用户够用 |
| 调度 | **Railway Cron** | Plan 内置,cron 表达式 `0 8 * * *`,无需引入 Celery/APScheduler |
| 触发方式 | HTTP endpoint `POST /api/internal/cron/daily-digest` | Cron 调这个端点,内部跑 batch 任务 |

### 10.3 后端实现

**步骤 1**:在 `requirements.txt` 加:
```
resend==2.0.0
```

**步骤 2**:`backend/app/core/config.py` 加配置:
```python
RESEND_API_KEY: str = ""
RESEND_FROM_EMAIL: str = "noreply@yourdomain.com"  # 需在 Resend 后台验证 domain
CRON_SECRET: str = ""  # 用于验证 cron 调用来源
```

⚠️ Railway 环境变量同步设置 `RESEND_API_KEY`、`RESEND_FROM_EMAIL`、`CRON_SECRET`。

**步骤 3**:新建 `backend/app/services/email_digest.py`:
```python
import resend
from app.core.config import settings
from app.services.ai_todo_engine import generate_todos_for_user

resend.api_key = settings.RESEND_API_KEY

async def send_daily_digest(db, user) -> dict:
    """Send today's top-10 todos to a single user. Returns send result."""
    # 取 top 10(注意:不同于 dashboard 的 7,邮件容忍度高)
    todos = await generate_todos_for_user(db, user, max_count=10)
    
    if not todos:
        return {"skipped": True, "reason": "no todos"}
    
    html = render_digest_html(user, todos)
    text = render_digest_text(user, todos)
    
    result = resend.Emails.send({
        "from": settings.RESEND_FROM_EMAIL,
        "to": user.email,
        "subject": f"{user.full_name}, 今日 SDR 行动清单({len(todos)} 条)",
        "html": html,
        "text": text,
    })
    return {"sent": True, "id": result.get("id"), "count": len(todos)}
```

**步骤 4**:新建 `backend/app/api/routes/internal_cron.py`:
```python
from fastapi import APIRouter, Header, HTTPException
from app.core.config import settings
from app.services.email_digest import send_daily_digest
from app.models.user import User

router = APIRouter(prefix="/api/internal/cron", tags=["Internal Cron"])

@router.post("/daily-digest")
async def trigger_daily_digest(
    x_cron_secret: str = Header(None),
    db: AsyncSession = Depends(get_db),
):
    # 防止外部恶意调用 cron 端点
    if x_cron_secret != settings.CRON_SECRET:
        raise HTTPException(401, "Unauthorized cron call")
    
    # 拿所有 active user
    result = await db.execute(select(User).where(User.is_active == True))
    users = result.scalars().all()
    
    results = []
    for u in users:
        if not u.email:
            continue
        try:
            r = await send_daily_digest(db, u)
            results.append({"user": u.email, **r})
        except Exception as e:
            results.append({"user": u.email, "error": str(e)})
    
    return {"processed": len(results), "results": results}
```

记得在 `main.py` 注册:
```python
from app.api.routes.internal_cron import router as cron_router
app.include_router(cron_router)
```

### 10.4 邮件模板

**HTML 版**(`render_digest_html`):

```html
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1e293b;">
  <h2 style="color: #0f172a; margin-bottom: 8px;">你好 {full_name},</h2>
  <p style="color: #64748b; font-size: 14px;">按优先级整理了今天该做的事:</p>
  
  <!-- 高优先级 -->
  <div style="margin-top: 24px;">
    <h3 style="color: #dc2626; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 12px;">🔥 紧急 ({high_count} 条)</h3>
    {for todo in high_urgency_todos}
    <div style="border-left: 3px solid #dc2626; padding: 8px 12px; margin-bottom: 12px; background: #fef2f2;">
      <div style="font-weight: 600;">{contact_name} @ {company} — {action}</div>
      <div style="color: #64748b; font-size: 13px; margin-top: 4px;">{rationale}</div>
    </div>
    {endfor}
  </div>
  
  <!-- 中优先级 / 低优先级 同上,颜色用 #d97706 / #64748b -->
  
  <!-- CTA -->
  <a href="{dashboard_url}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 24px;">打开 Dashboard 查看全部 →</a>
  
  <p style="color: #94a3b8; font-size: 12px; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
    SDR CRM · 这封邮件是自动生成的<br/>
    不想再收?<a href="{unsubscribe_url}" style="color: #94a3b8;">取消订阅</a>
  </p>
</body>
</html>
```

**纯文本版**(部分客户端会用这个):

```
你好 {full_name},

按优先级整理了今天该做的事:

🔥 紧急 ({high_count} 条)
─────────────────────
1. {contact_name} @ {company} — {action}
   {rationale}

2. ...

📅 本周 ({medium_count} 条)
─────────────────────
3. ...

💡 全部细节在 Dashboard:
{dashboard_url}

—
SDR CRM · 自动生成
不想再收?{unsubscribe_url}
```

### 10.5 Railway Cron 配置

在 Railway 后端服务设置:

```
Cron Schedule: 0 8 * * *
Command: curl -X POST -H "X-Cron-Secret: $CRON_SECRET" https://crmsdr-production.up.railway.app/api/internal/cron/daily-digest
```

⚠️ 注意:
- `0 8 * * *` 是 **UTC 时间 8:00**,对应美西 PST 凌晨 0:00 / 美东 EST 凌晨 3:00 — **太早**
- 建议改成 `0 16 * * *` (UTC 16:00 = PST 8:00 / EST 11:00)
- 灰度上线后看 Manager 反馈再调整

### 10.6 取消订阅 / 偏好设置(MVP 简化版)

MVP 阶段先做最简的:
- `User` 表加字段 `daily_digest_enabled: bool = True`
- 邮件底部"取消订阅"链接 → `GET /api/auth/unsubscribe-digest?token=<jwt>` → 把字段改 False
- `send_daily_digest` 函数检查这个字段,False 直接 skip

后续优化(Phase 6+):
- Settings 页面加"邮件偏好"面板,选择时间 / 周末是否发 / 最少 urgency 阈值

### 10.7 验收标准

**集成测试**:
1. 调 `/api/internal/cron/daily-digest`(带正确 X-Cron-Secret) → 4 个用户都收到邮件
2. 不带 secret → 401
3. 用户 `daily_digest_enabled = False` → 跳过该用户
4. 用户没有 todos → 跳过(不发空邮件)

**端到端测试**:
1. 在 Resend 后台验证 domain
2. 在 Railway 配置 cron 和环境变量
3. 手动触发一次 cron(用 Railway dashboard 的 "Run Now")
4. 4 个真实账号(info@amazonsolutions.us / 3 个 Manager)都收到样式正确的邮件
5. 邮件里的链接能打开 dashboard

### 10.8 成本估算

- Resend: 免费(100 封/天 plan 内,3 用户 × 1 封/天 = 3 封/天)
- Railway Cron: plan 内置,无额外费用
- **总成本: $0/月**

### 10.9 后续扩展(下一步头脑风暴)

- 📱 **WhatsApp**:用 Twilio WhatsApp API,但有 24h 窗口 + 模板审批限制,先研究
- 💬 **SMS**:用 Twilio SMS,$0.0075/条,3 用户 × 1 条/天 × 30 天 ≈ $0.7/月
- ⏰ **WhatsApp Click-to-Chat**:用户主动点链接 push 到自己 WhatsApp,零成本但需用户主动触发

这三条独立讨论,见下次头脑风暴。

---

## 十一、Activity-Status 联动改造(CP4 子任务)

### 11.1 背景

v1.2 假设 Manager 会主动维护 lead.status,但实际工作流里很容易忘记。**v1.3 引入新设计**:把 status 选择嵌入 Log Activity 流程,SDR 每次记 activity 时顺手更新 status。

### 11.2 设计决策(David 已拍板)

| # | 决策点 | 选择 |
|---|---|---|
| 1 | Activity → Lead.status 关系 | **A. 直接更新,不留历史** |
| 2 | 哪些 activity 类型必选 status | **C. 全部可选** |
| 3 | Status 倒退处理 | **A. 允许,无提示** |

**核心逻辑**:
- 5 种 activity 类型(call/email/meeting/note/linkedin)**全部可选**填 status
- SDR 选了就直接 `UPDATE leads SET status = ?`,**没有任何确认弹窗**
- **不留历史轨迹**(原 lead.status 直接被覆盖)

### 11.3 后端改动

#### Schema:**不动**

不加任何字段,不动 enum,不改 lead 表结构。

#### API:`POST /api/activities`

文件:`backend/app/api/routes/activities.py`(具体路径以代码为准)

新增可选字段 `lead_status_update`:

```python
class ActivityCreate(BaseModel):
    contact_id: int
    type: ActivityType  # call / email / meeting / note / linkedin
    content: Optional[str] = None
    # ... 其他现有字段
    
    # v1.3 新增
    lead_status_update: Optional[LeadStatus] = None  # 可选,SDR 想填就填
```

请求处理逻辑:
```python
@router.post("/activities")
async def create_activity(
    data: ActivityCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 1. 创建 activity 记录(原有逻辑不变)
    activity = Activity(...)
    db.add(activity)
    
    # 2. v1.3 新增:如果传了 lead_status_update,同步更新 lead.status
    if data.lead_status_update is not None:
        # 找到这个 contact 关联的 lead
        lead_q = await db.execute(
            select(Lead).where(Lead.contact_id == data.contact_id).limit(1)
        )
        lead = lead_q.scalar_one_or_none()
        if lead:
            lead.status = data.lead_status_update
            # 不留历史,直接覆盖
    
    await db.commit()
    return activity
```

⚠️ **边界情况**:
- contact 没有关联 lead → 静默 skip,不报错(因为现在很多 contact 没 lead 数据)
- contact 有多个 lead → 只更新最新的一个(`ORDER BY created_at DESC LIMIT 1`)
- `lead_status_update` 是 NULL → 不动 lead.status

#### API:`PATCH /api/activities/{id}`(编辑活动)

同样支持 `lead_status_update` 字段,逻辑相同。

### 11.4 前端改动

#### `frontend/src/components/quick-entry.tsx`(376 行)

加一个**可选**的 status 下拉:

```tsx
// 7 个 enum 中文翻译(显示用)
const STATUS_OPTIONS = [
  { value: null, label: "(不更新)" },  // 默认值
  { value: "new", label: "新线索" },
  { value: "contacted", label: "已联系" },
  { value: "interested", label: "有兴趣" },
  { value: "meeting_set", label: "已约会议" },
  { value: "proposal", label: "已发提案" },
  { value: "closed_won", label: "成交" },
  { value: "closed_lost", label: "失败" },
];

// 在表单里加:
<Select value={leadStatus ?? "null"} onChange={...}>
  {STATUS_OPTIONS.map(o => <Option value={o.value}>{o.label}</Option>)}
</Select>

// 提交时:
await api.createActivity({
  ...formData,
  lead_status_update: leadStatus,  // null 时后端会跳过
});
```

⚠️ **UI 注意事项**:
- 默认选中 "(不更新)"——避免 SDR 不小心覆盖了正确的 status
- 5 种 activity 类型(call/email/meeting/note/linkedin)**都显示这个下拉**,不做差异化
- 下拉的 label 用中文,value 用英文 enum

#### `frontend/src/components/edit-activity.tsx`(227 行)

同样加这个下拉,行为一致。

### 11.5 验收标准

#### 单元测试

`backend/tests/test_activity_status_update.py`:

1. `test_create_activity_no_status_update` — 不传字段,lead.status 不变
2. `test_create_activity_with_status_update` — 传了字段,lead.status 被更新
3. `test_create_activity_status_update_no_lead` — contact 没 lead,静默 skip 不报错
4. `test_create_activity_status_update_multiple_leads` — contact 有多个 lead,只更新最新的
5. `test_create_activity_downgrade_allowed` — 从 PROPOSAL → INTERESTED 允许,无报错

#### 端到端测试

David 在本地手动验证:
1. 用 Doug 账号登录 → 给某 contact 创建一条 call,选 "已发提案" → 确认 lead.status 变成 PROPOSAL
2. 再创建一条 note,不选 status → 确认 lead.status 还是 PROPOSAL
3. 再创建一条 email,选 "有兴趣"(downgrade) → 确认 lead.status 变成 INTERESTED,无报错

### 11.6 与 CP4 B 类规则的关系

CP4 必须**先完成 11.3 的后端改造**,再实现 6 条 stage 规则。

理由:如果 lead.status 长期是错的(因为 SDR 不更新),stage 规则的触发会很离谱(eg "lead 在 NEW 状态 90 天 → 提醒"——但其实客户已经成交了)。**先把数据来源修对,再做基于数据的规则**。

实现顺序:
1. 后端 `POST /api/activities` 加字段 + 单测
2. 前端 quick-entry / edit-activity 加下拉
3. 部署 + 让 SDR 用 1-2 天,产生真实 status 数据
4. 实现 6 条 stage 规则
5. 6 条规则单测(每条 ≥ 2 个 case)
6. 部署 + 验收

### 11.7 后续扩展(不在 v1.3 范围)

- **Status 变更通知**:如果 SDR 把 lead 推到 CLOSED_WON,自动通知 Manager(slack/邮件)
- **Status 历史**:如果未来需要看变迁轨迹,再加 `lead_status_history` 表(现在不做)
- **Status 自动推断**:基于 activity 类型 + 内容,Claude 推断 SDR 应该选哪个 status(现在不做,先看人工填的数据质量)
