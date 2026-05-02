# Claude Code 执行计划 — AI Suggested To-Do 功能

**配套文档**:`docs/AI-TODO-SPEC-2026-05-02.md`(必须先读)
**预计总耗时**:5-7 个工作日(单人,Claude Code 实际执行)
**执行方式**:5 个 Checkpoint,每个 checkpoint 完成后停下让 David 验收
**最后更新**:2026-05-02

---

## 🎯 设计原则(Claude Code 必须遵守)

1. **小步推进,不要一次做完所有功能**——每 Checkpoint 只做一件事,做完 commit + push,等 David 验收
2. **每条规则独立函数 + 独立单测**——出 bug 不影响别的规则
3. **不重做已有功能**——dashboard 的"今日 Follow-Ups"已经存在,不要碰它
4. **不引入新表**——所有数据来自现有 13 张表,只加字段不加表
5. **不上线就不通过 Phase 5**——P0 安全问题修复前,Resend / Cron 不上 Railway
6. **遇到 spec 模糊的地方,停下问 David,不要自己脑补**

---

## 📋 Checkpoint 全景图

```
Checkpoint 1: 骨架(0.5 天)
  ↓ David 验收 ✅
Checkpoint 2: 12 条 A 类规则 + 单测(2 天)
  ↓ David 验收 ✅
Checkpoint 3: API 替换 + 前端改造(1 天)
  ↓ David 灰度验收 ✅(Manager 真实使用 3-5 天)
Checkpoint 4: B + D 类规则(2 天)
  ↓ David 验收 ✅
Checkpoint 5: Phase 5 邮件推送(1 天)
  ↓ Resend domain 验证 + Cron 配置 + 真实邮件验收
```

⚠️ **C 类(Discipline)和 E 类(Relationship)放到 Checkpoint 4 之后再说**,因为它们触发条件更复杂,等基础规则跑稳定了再加。

---

## ✅ Checkpoint 1 — 骨架(0.5 天)

### 目标

搭好规则注册系统的"骨架",但不实现任何业务规则。让架构先跑通。

### 给 Claude Code 的指令(直接复制)

```
请读 docs/AI-TODO-SPEC-2026-05-02.md(v1.2)第二节、第五节。

本次任务(Checkpoint 1)只做骨架,不做任何业务规则:

1. 新建 backend/app/services/ai_todo_engine.py
   - 定义 TodoSuggestion Pydantic model
   - 实现 register_rule decorator
   - 实现 generate_todos_for_user(db, user, max_count) 函数
   - 函数内部:遍历 TODO_RULES 列表,跑每条规则,合并结果
   - 排序:urgency=high > medium > low,同 urgency 按 contact_id 稳定排序
   - 截断:最多返回 max_count 条
   - 过滤:已 snooze 的规则不返回
   
2. 实现一条 dummy 规则用于验证骨架:
   @register_rule("dummy_test_rule", "pacing")
   async def rule_dummy(db, user) -> list[TodoSuggestion]:
       return []  # 永远空,只测试调用链
   
3. 暂时不动 /api/ai/suggest-todos 这个接口,保持原样
   
4. 写一个 backend/tests/test_ai_todo_engine.py:
   - test_engine_runs_with_no_rules() — 没规则时返回空列表
   - test_engine_filters_snoozed() — snooze 表里的 hash 不出现在结果里
   - test_engine_respects_max_count() — 多条规则总和超过 max_count,只返回 max_count 条
   - test_engine_sorts_by_urgency() — high 永远在 medium 前面

5. 不改前端

完成后:
- 跑测试: pytest backend/tests/test_ai_todo_engine.py -v
- 确认全绿
- commit message: "feat(ai-todo): scaffold rule engine and snooze filtering"
- push 到 GitHub main

完成后停下,告诉我测试输出截图,等我验收。
```

### 验收清单

- [ ] `ai_todo_engine.py` 文件存在,有 decorator + generate_todos_for_user
- [ ] `TodoSuggestion` model 字段对齐 spec 第 2 节(rule_id / urgency / category / suggested_action / rationale / contact_id)
- [ ] 4 个单测全部通过
- [ ] `/api/ai/suggest-todos` 接口**没动**(保持向后兼容)
- [ ] 前端**没动**

---

## ✅ Checkpoint 2 — 12 条 A 类规则(2 天)

### 目标

把 spec 第三节 A 类的 12 条规则全部实现 + 单测覆盖。仍不接 API,仍不动前端。

### 给 Claude Code 的指令

```
请读 docs/AI-TODO-SPEC-2026-05-02.md 第三节 A 类(跟进节奏类 12 条)。

本次任务(Checkpoint 2):

1. 在 ai_todo_engine.py 里实现 12 条 A 类规则,每条一个独立 async 函数
   - 函数名格式: rule_<rule_id>(db, user)
   - 每条函数返回 list[TodoSuggestion]
   - 用 decorator @register_rule("<id>", "pacing") 注册
   - rationale 字段必须用中文,简洁(< 30 字),包含具体 contact 名 + 公司
   
2. 删除 Checkpoint 1 那条 dummy_test_rule

3. 12 条规则按 spec 第三节表格实现,id 严格按表格命名

4. 注意 4 条特殊规则:
   - pacing_inbound_call_2h: 检测 activity.content 里的关键词,关键词列表先写死: ["客户来电", "inbound", "incoming call", "called in"]
   - pacing_call_no_answer_2d: 关键词: ["未接通", "voicemail", "no answer", "left message"]
   - pacing_quote_5d / pacing_quote_10d: 看 lead.status IN (price_negotiation, talking_potential_order)
   - pacing_email_received_today: 看 sent_emails.direction = received,当天到达,且该 contact 之后无新 sent

5. 单元测试: backend/tests/test_ai_todo_rules_pacing.py
   - 每条规则 ≥ 2 个测试用例(正例 + 反例)
   - 用 pytest fixture 构造测试数据(contacts + activities + leads)
   - 共 24+ 个测试

6. 跑测试 pytest backend/tests/test_ai_todo_rules_pacing.py -v 全绿

7. 不改前端,不改 API 接口

8. commit: "feat(ai-todo): implement 12 pacing rules with unit tests"
9. push

完成后停下,把测试输出和 12 条规则的代码 diff 发我。
```

### 验收清单

- [ ] 12 条规则全部实现,函数名 / id 与 spec 一致
- [ ] 24+ 单测通过
- [ ] 关键词列表(inbound / no answer)放在文件顶部常量,方便后续调整
- [ ] 没有规则相互调用 / 共享状态
- [ ] 数据库查询用 SQLAlchemy ORM,不写裸 SQL

### David 自测

挑 3 条规则,在本地数据库构造场景,手动调 `await rule_pacing_silent_14d(db, user)`,确认返回值符合预期。

---

## ✅ Checkpoint 3 — API 替换 + 前端改造(1 天)

### 目标

让 Manager 真的能在 dashboard 上看到新引擎产生的 todo,并能 dismiss/snooze。

### 给 Claude Code 的指令

```
请读 docs/AI-TODO-SPEC-2026-05-02.md 第 5.2 节 + 5.3 节 + 5.4 节。

本次任务(Checkpoint 3):

后端:
1. 修改 backend/app/api/routes/ai.py 的 /api/ai/suggest-todos 接口
   - 替换原 Claude-driven 实现
   - 调用 generate_todos_for_user(db, current_user, max_count=7)
   - 返回 {"suggestions": [...]} 格式

2. 暂时不调 Claude 做 rationale 润色(成本控制,留到 Checkpoint 5 再加)

前端:
3. 修改 frontend/src/app/dashboard/page.tsx 的 AI Suggested To-Do 卡片(line 745 附近)
   - 删除 dismissed Set 的 localStorage 逻辑
   - 新增 useEffect 拉 GET /api/tasks/snooze-suggestion?active=true 的 hash 列表(后端这个接口可能要新增,见下面 step 4)
   - dismiss 按钮改成调 POST /api/tasks/snooze-suggestion(已有接口),传 days=7
   - 每条 suggestion 卡片新增:
     * 左侧 3px 颜色条: high=red-500, medium=amber-500, low=slate-400
     * Category 标签(右上角): Pacing / Stage / Data / Relationship / Discipline
     * 3 个 snooze 按钮: 1天 / 3天 / 7天
     * 完成按钮: ✓ Done(标记 dismiss=forever)
     * "Why?" 折叠区: 点开显示 rationale

4. 后端新增 GET /api/tasks/snooze-suggestion?active=true
   - 返回当前用户所有 snooze_until > NOW() 的 suggestion_hash 列表
   - 用于前端启动时拉取已 snooze 的列表

5. 不改其他 dashboard 部分(今日 Follow-Ups 不动)

6. 本地测试:
   - 启动后端 + 前端
   - 用 4 个真实账号轮流登录看 dashboard
   - 截图每个账号看到的 to-do
   - dismiss 一条,刷新页面,确认不再出现

7. commit: "feat(ai-todo): wire engine to API and redesign dashboard cards"
8. push

完成后停下,发我:
- 后端两个接口的 curl 测试结果
- 前端 4 个账号的 dashboard 截图
等我验收。
```

### 验收清单

- [ ] 4 个账号都能看到 to-do(空也算正常,如果 Doug 数据少)
- [ ] dismiss 一条后,刷新不再出现
- [ ] dismiss 7 天后(可手动改 snooze_until 测试)重新出现
- [ ] localStorage 完全没有 `ai_todos_dismissed` 这个 key
- [ ] urgency 颜色条对了
- [ ] "Why?" 能展开看 rationale

### David 灰度验收(关键)

**这一步非常重要**:Checkpoint 3 完成后**先别做 Checkpoint 4**。

让 3 个 Manager 真实使用 **3-5 天**,收集反馈:
- 哪条规则被高频 dismiss?(说明阈值不对或没用)
- 哪条规则从未触发?(可能 bug 或数据不够)
- 哪条规则 Manager 反馈"看到就想做"?(留住,加大权重)
- 7 条够不够?太多还是太少?

把反馈整理成 1 页 markdown 给我,我们一起调,再决定 Checkpoint 4 的优先级。

---

## ✅ Checkpoint 4 — B 类 + D 类规则(2 天)

⚠️ **前提**:Checkpoint 3 灰度反馈整理完毕,A 类规则没有重大 bug。

### 目标

实现 B 类(12 条 stage 卡顿)+ D 类(6 条数据健康),共 18 条。

### 给 Claude Code 的指令

```
请读 docs/AI-TODO-SPEC-2026-05-02.md 第三节 B 类 + D 类。

本次任务(Checkpoint 4):

1. 在 ai_todo_engine.py 里增加 B 类 12 条规则
   - 每条对应一个 lead.status 的"卡住"检测
   - 停留天数严格按 spec 第三节 B 类表格(David 已确认采用)
   - 函数命名: rule_stage_<status>_stuck
   - category="stage"
   - 注意 lead.status 是 enum,要用枚举值比较,不要用字符串

2. 在 ai_todo_engine.py 里增加 D 类 6 条规则
   - data_missing_phone: contact 创建时间 > 7 天前(上周)且 mobile_phone 和 office_phone 都为 NULL
   - data_missing_linkedin: linkedin_url 为 NULL
   - data_missing_industry: industry 或 company_size 为 NULL
   - data_dead_contact_30d: contact 创建 > 30d 但 0 条 activity 关联
   - data_lead_stuck_60d: lead 在某 status > 60d 没动(用 lead.updated_at 判断)
   - data_collision_7d: 同一 contact 7 天内有 ≥ 2 个不同 owner_id 的 activity

3. 单元测试 ≥ 36 个(每条 ≥ 2 个,共 18 条)
   放在 backend/tests/test_ai_todo_rules_stage_data.py

4. 不动 API,不动前端(规则会自动通过 generate_todos_for_user 暴露)

5. 跑测试全绿

6. commit: "feat(ai-todo): add 18 stage and data-health rules"
7. push

完成后发我测试输出 + 4 个真实账号的 dashboard 新截图。
```

### 验收清单

- [ ] 18 条规则全部实现
- [ ] 36+ 单测通过
- [ ] 4 个账号的 dashboard 现在能看到 stage / data 类规则混进去
- [ ] urgency 排序正确(stage_verbal_order_stuck = high,会置顶)

---

## ✅ Checkpoint 5 — Phase 5 每日邮件推送(1 天)

⚠️ **前提**:
1. P0 安全问题已经修复(SECRET_KEY、SSRF 等)
2. Resend 账号已注册,domain 已验证
3. Railway 环境变量已配置:`RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `CRON_SECRET`
4. A + B + D 类规则跑稳定 ≥ 1 周

### 目标

按 spec 第十节,实现 Resend + Railway Cron 的每日邮件推送。

### 给 Claude Code 的指令

```
请读 docs/AI-TODO-SPEC-2026-05-02.md 第十节(完整 Phase 5 规格)。

本次任务(Checkpoint 5):

1. requirements.txt 加 resend==2.0.0,pip install
2. 修改 backend/app/core/config.py 加 RESEND_API_KEY / RESEND_FROM_EMAIL / CRON_SECRET 三个环境变量(都不设默认值,fail-fast)
3. 新建 backend/app/services/email_digest.py(spec 10.3 步骤 3 完整代码)
4. 新建 backend/app/api/routes/internal_cron.py(spec 10.3 步骤 4 完整代码)
5. 在 main.py 注册 internal_cron router
6. User 表加字段: 
   ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_digest_enabled BOOLEAN NOT NULL DEFAULT TRUE
   (加在 init_db.py 的 field_migrations 列表里,不要单独写迁移脚本)
7. send_daily_digest 函数:开头检查 user.daily_digest_enabled,False 直接 return {"skipped": True, "reason": "user disabled"}
8. 实现 render_digest_html(user, todos) 和 render_digest_text(user, todos)
   按 spec 10.4 节模板,Jinja2 风格但用 Python f-string 简化
9. 加取消订阅端点: GET /api/auth/unsubscribe-digest?token=<jwt>
   - 解析 jwt,拿 user_id
   - 把 user.daily_digest_enabled 改 False
   - 返回 HTML "已取消订阅" 简单页面
10. 单元测试 backend/tests/test_email_digest.py:
    - test_skip_user_disabled() — daily_digest_enabled=False 时跳过
    - test_skip_no_todos() — 没 todo 时跳过(不发空邮件)
    - test_cron_secret_required() — 没带 secret 调端点返 401
    - test_cron_secret_correct() — 带对的 secret 正常调用
    - test_render_html_contains_contact_name() — 邮件里有 contact 名字
    
11. 不要在本次直接连真 Resend API 测试,用 mock(避免重复发邮件)
12. commit: "feat(ai-todo): daily digest email via Resend + Railway cron"
13. push

完成后停下。我会:
- 在 Railway 配置好环境变量
- 在 Resend 后台验证 domain
- 配置 Railway Cron Job: 0 16 * * * (UTC,= PST 8:00)
- 用 Railway "Run Now" 触发一次,看 4 个账号是否收到邮件
然后才算这步完成。
```

### 验收清单(Claude Code 完成代码后)

- [ ] 5 个单测通过
- [ ] internal_cron.py 端点带 X-Cron-Secret 校验
- [ ] 取消订阅端点能用
- [ ] users 表有 `daily_digest_enabled` 字段(本地 + 线上都加)

### David 部署验收(代码 push 之后)

- [ ] Resend 后台验证 amazonsolutions.us domain
- [ ] Railway 后端服务环境变量加好 3 个 key
- [ ] Railway Cron Job 配置: `0 16 * * *` + 调 `/api/internal/cron/daily-digest` + header `X-Cron-Secret`
- [ ] 手动 "Run Now" 触发,4 个账号都收到邮件
- [ ] 邮件样式正确,链接点了能跳 dashboard
- [ ] 取消订阅链接能用
- [ ] 等到第二天 PST 8:00,自动触发再收一封

---

## 🚨 Claude Code 的"不要做"清单

无论哪个 Checkpoint,都不要做这些事情:

1. ❌ **不要重做 dashboard 的"今日 Follow-Ups"** — 已存在,这是补充不是替代
2. ❌ **不要新建数据库表** — 所有数据从现有 13 张表来,只能加字段
3. ❌ **不要写裸 SQL** — 用 SQLAlchemy ORM
4. ❌ **不要改 lead.status 枚举值** — 12 阶段是业务流程,代码只读不改
5. ❌ **不要把规则写成一个大函数 / 大 if-else** — 每条规则独立函数 + decorator
6. ❌ **不要在 Checkpoint 5 之前接 Resend** — 提前接会浪费免费额度
7. ❌ **不要绕过 X-Cron-Secret 校验** — 公网暴露的 cron 端点是 abuse 风险
8. ❌ **不要跳过单测直接 push** — 没单测的代码一律打回重做
9. ❌ **不要一次做完所有 Checkpoint** — 5 个 Checkpoint 必须分 5 次 commit/push,每次等 David 验收

---

## 📊 进度追踪表(David 用)

```
Checkpoint 1: 骨架                       [ ] 完成   [ ] 验收
Checkpoint 2: 12 条 A 类规则             [ ] 完成   [ ] 验收
Checkpoint 3: API + 前端 + 灰度反馈      [ ] 完成   [ ] 验收
Checkpoint 4: 18 条 B + D 规则           [ ] 完成   [ ] 验收
Checkpoint 5: Phase 5 邮件推送           [ ] 完成   [ ] 验收

(C 类 Discipline 6 条 + E 类 Relationship 4 条 留到下一轮迭代,
 上线后看反馈再决定优先级)
```

---

## 💬 给 David 的 1 个建议

每个 Checkpoint 之间**间隔 ≥ 1 天**,不要催 Claude Code 当天连做两个 Checkpoint。

理由:
- 每个 Checkpoint 完成后,你需要时间真实验收
- A 类规则做完之后让 Manager 用 3-5 天才能看出问题
- 一次性做完所有功能,bug 累积起来排错代价更大

这个项目最大的风险**不是"做不完"**,而是 **"做完了但没人用 / 用了被淹没"**。慢慢推进比一口气怼完更稳。

---

## 📎 配套交付物

执行过程中,Claude Code 应在 `docs/` 下生成这些文档(用今天日期命名,YYYY-MM-DD):

- `docs/CHECKPOINT-1-REPORT-<date>.md` — 骨架完成报告
- `docs/CHECKPOINT-2-REPORT-<date>.md` — A 类规则实现 + 测试结果
- `docs/CHECKPOINT-3-FEEDBACK-<date>.md` — Manager 灰度使用反馈(David 写)
- `docs/CHECKPOINT-4-REPORT-<date>.md` — B + D 类规则实现报告
- `docs/CHECKPOINT-5-DEPLOY-<date>.md` — Resend + Cron 部署记录

每份报告 ≤ 1 页,用列表格式,只记关键事实和决策,不写散文。
