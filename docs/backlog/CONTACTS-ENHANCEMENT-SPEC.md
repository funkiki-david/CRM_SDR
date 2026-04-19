# SDR CRM — Contacts 页面增强功能详细规格

> **功能**: Add Contact + Import CSV + Export CSV  
> **目标**: 把手动指令给 Claude Code，不需要反复修改  
> **原则**: 每个按钮、每个状态、每个错误都讲清楚

---

## 第一部分：页面布局（视觉位置）

### 新的布局（加了 3 个按钮 + 多选 checkbox）

```
┌────────────────────────────────────────────────────┐
│  [Search Box...]   [+ Add]  [↓ Import]  [↑ Export] │
├─────────────┬──────────────────────────────────────┤
│ ☐ Select all │                                     │
│ ─────────── │                                      │
│ ☐ John S.   │   (详情区域不变)                     │
│ ☐ Sarah L.  │                                      │
└─────────────┴──────────────────────────────────────┘
```

**按钮样式**:
- `[+ Add Contact]` — primary
- `[↓ Import]` — outline
- `[↑ Export]` — outline

---

## 第二部分：Add Contact

### 字段规格

| 字段 | 必填 | 最大长度 | 验证 | 错误提示 |
|------|:---:|:---:|------|--------|
| First Name | ✓ | 50 | 非空 | "Please enter a first name" |
| Last Name | ✓ | 50 | 非空 | "Please enter a last name" |
| Email | ✓ | 255 | email格式 | "Please enter a valid email" |
| Phone | ✗ | 30 | 数字+空格+-() | "Phone can only contain numbers and +-()." |
| Title | ✗ | 100 | 无 | — |
| Company Name | ✗ | 100 | 无 | — |
| LinkedIn URL | ✗ | 500 | 含linkedin.com | "Must be a LinkedIn URL" |
| Industry Tags | ✗ | 30/tag | 最多10个 | "Maximum 10 tags" |
| Notes | ✗ | 2000 | 无 | "Notes too long (max 2000 chars)" |

### 保存后行为
- 成功: Toast + 列表刷新 + 自动选中新联系人
- 去重: 弹出选择框 (View existing / Update / Create duplicate)
- 失败: 红色横幅错误提示

### Cancel 行为
- 未修改: 直接关闭
- 已修改: 二次确认 "Discard changes?"

---

## 第三部分：Import CSV（三步向导）

Step 1: 上传 (.csv/.xlsx, max 10MB, max 10,000行)
Step 2: 字段映射 (自动+手动)
Step 3: 预览+去重+导入 (new/existing/invalid统计)

---

## 第四部分：Export CSV

- 导出范围: All / Search results / Selected
- 字段选择: Basic / LinkedIn+Tags / Activity / AI report / Timestamps
- 格式: CSV / JSON

---

## 数据库新增字段
- industry_tags (TEXT[] 数组)
- notes (TEXT)
- import_source (VARCHAR 50)
- import_batch_id (UUID)
