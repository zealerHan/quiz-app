# 培训系统 开发文档

> 这份文档面向开发者或 AI 协作者，描述系统的全貌、架构、核心逻辑和迭代历史。  
> 读完此文档，任何人（或模型）都应能独立理解项目并继续维护。

---

## 一、项目背景

**武汉地铁5号线乘务工班组业务考核系统**，内部简称"培训系统"或"peixun"。

使用场景：班组内部（约20人规模），每套班由管理员指定抽问题目，乘务员通过手机答题（语音或文字），系统 AI 评分，答题结果实时推送钉钉群。管理员可在后台查看答题情况、题库、排行榜。

访问地址：`https://peixun.zealerhan.cn`（Nginx 反代，本机 `localhost:3000`）

---

## 二、技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite（单文件 `App.jsx`，约7000行） |
| 后端 | Node.js + Express（单文件 `server/index.js`） |
| 数据库 | SQLite（`better-sqlite3`，文件位于 `data/quiz.db`） |
| 实时语音 | DashScope WebSocket（Paraformer-realtime-v2） |
| AI 评分 | DashScope HTTP API（qwen-plus） |
| 推送 | 钉钉 Webhook（加签模式） |
| 构建 | `npm run build` → `dist/`，由 Express 静态托管 |

前端构建产物（`dist/`）已提交到 git，部署时无需单独构建步骤，直接 `node server/index.js` 即可。

---

## 三、目录结构

```
peixun/
├── app/
│   ├── src/App.jsx          # 全部前端代码（React）
│   ├── server/index.js      # 全部后端代码（Express + WS）
│   ├── data/quiz.db         # SQLite 数据库（不进 git）
│   ├── dist/                # Vite 构建产物（已提交，方便部署）
│   ├── uploads/             # 上传的图片/文件
│   ├── .env                 # 环境变量（不进 git）
│   └── package.json
├── DEV.md                   # 本文档
└── README.md                # 面向用户的操作指南
```

---

## 四、环境变量（.env）

```env
PORT=3000
ADMIN_PASSWORD=...          # 管理员登录密码

# DashScope（阿里云）——语音识别 + AI评分共用同一个 key
DASHSCOPE_API_KEY=sk-...

# 阿里云 NLS（已废弃，迁移到 Paraformer 后不再使用）
ALI_APPKEY=...
ALI_AK_ID=...
ALI_AK_SEC=...

# 钉钉推送（主群：四组一班抽问通知）
DINGTALK_WEBHOOK=https://oapi.dingtalk.com/robot/send?access_token=...
DINGTALK_SECRET=SEC...

# 钉钉推送（四组办事群：无抽问提醒）
DINGTALK_GROUP_WEBHOOK=...
DINGTALK_GROUP_SECRET=...

PUBLIC_URL=https://peixun.zealerhan.cn  # 推送消息中的答题链接
```

---

## 五、数据库核心表

### 业务主表

| 表 | 作用 |
|----|------|
| `staff` | 乘务员名册，字段：`id`, `name`, `real_name`, `is_exempt`（免考）, `is_cp`（车峰）, `is_instructor`（教员）, `is_leader`（班长）, `is_tester`（测试账号） |
| `cycles` | 轮班周期，每个周期对应一套班（白班+夜班+早班），`cycle_id` 格式 `cycle_YYYY-MM-DD`（以早班日期命名） |
| `shift_calendar` | 日期→班次映射表，`shift` 值：`白班`/`夜班`/`早班`/`休` |
| `sessions` | 答题会话，每人每周期一条，`completed=1` 表示完成 |
| `answers` | 具体答题记录，每题一条，含 AI 评分结果 |
| `questions` | 题库题目，`category` 分：`故障处置`/`应急处置`/`安全事件`/`隐患排查` |
| `question_banks` | 题库分组，`q_type` 区分类型 |
| `settings` | key-value 配置，包含 `pinned_questions`（抽问设置）、`exam_mode`、`shift_label` 等 |

### 培训相关表（v3 新增）

| 表 | 作用 |
|----|------|
| `monthly_training_plans` | 月度培训计划（每行一场培训） |
| `training_attendance` | 培训签到记录 |
| `training_groups` | 培训小组 |
| `training_year_plan` | 年度培训计划（JSON 结构） |

---

## 六、班次周期系统（核心业务逻辑）

### 周期规则

- 4天一个轮班：**白班 → 夜班 → 早班 → 休**
- 一个"周期"（cycle）= 一套班，以**早班日期**作为 `cycle_id`（`cycle_YYYY-MM-DD`）
- 答题截止时间：早班当天 **09:30**
- `shift_calendar` 表记录每天的班次，`getCurrentCycle()` 函数根据今天是哪个班次推算出当前周期

### 抽问设置（`settings.pinned_questions`，JSON）

```json
{
  "ids": [101, 205],          // 手动指定的题目 ID 列表
  "mode": "manual",           // "manual" | "random" | "emergency"
  "scope": "shift",           // "shift"（本套班）| "today"（今天）
  "bank_id": 3,               // random 模式：单题库随机
  "bank_ids": [3, 5],         // random 模式：多题库随机
  "pin_counts": {"3": 2},     // random 模式：各题库抽几题
  "created_date": "2026-05-27" // 设置日期，用于判断是否属于当前周期
}
```

- `scope=shift`：本套班有效（白班+夜班+早班），默认值
- `scope=today`：仅当天有效，特殊情况（如早班想单独出题）用此选项
- `mode=emergency`：应急模式，从应急/故障处置题库随机抽

---

## 七、语音识别（WebSocket）

### 当前方案：DashScope Paraformer-realtime-v2

- **连接地址**：`wss://dashscope.aliyuncs.com/api-ws/v1/inference/`
- **鉴权**：HTTP Header `Authorization: bearer $DASHSCOPE_API_KEY`
- **协议**：
  - 客户端（服务端代理）→ 服务：`run-task`（启动），binary PCM 帧（音频），`finish-task`（停止）
  - 服务 → 客户端：`task-started`，`result-generated`（含 `sentence_end: bool`），`task-finished`，`task-failed`
- **参数**：`format: pcm`, `sample_rate: 16000`, `sentence_silence_duration: 800`（ms）
- **超时保障**：服务端收到 `stop` 后启动 5s stopTimer，若 `task-finished` 未到则强制返回已有内容

### 前端↔服务端代理协议（`/ws/ali-asr`，路径名历史遗留未改）

| 方向 | 消息 |
|------|------|
| 前端 → 服务 | 二进制 PCM 帧（录音数据）|
| 前端 → 服务 | `{type: 'stop'}` JSON（录音结束）|
| 服务 → 前端 | `{type: 'partial', text: '...'}` 中间结果 |
| 服务 → 前端 | `{type: 'final', text: '...'}` 最终结果 |
| 服务 → 前端 | `{type: 'error', text: '...'}` 识别失败 |

### 超时机制（历史演进）

| 时期 | 客户端 timeout | 服务端 stopTimer | 问题 |
|------|---------------|-----------------|------|
| 早期 | 无 | 无 | 偶发死锁（识别不返回） |
| 中期 | 15s | 10s | 15s > 10s，服务先超时但客户端仍等，UI 无反馈 |
| 当前 | 8s | 5s | 服务端5s先触发 → 客户端8s前已收到 final，避免竞态 |

### 历史方案（已废弃）

- **阿里云 NLS SpeechTranscriber**：需要 AK_ID+AK_SEC 换 token（约24h有效期），token 刷新本身是一个故障点。2026-05-27 迁移至 Paraformer，删除了 `getCachedAliToken` 相关约50行代码。
- **讯飞 IAT**：服务端有 `/ws/iat` handler（`wssXunfei`），从未正式启用，XFYUN 的 key 在 .env 里但标记为"你的AppID"。

---

## 八、AI 评分

- **模型**：`qwen-plus`（DashScope HTTP API，同一个 `DASHSCOPE_API_KEY`）
- **接口**：`POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- **评分方式**：将题目参考答案、关键词、学员回答拼成 prompt，返回 JSON `{score, level, summary, correct_points, missing_points, suggestion}`
- **降级**：若 DashScope 不可用，回退到关键词匹配模式（服务启动时打印 `AI评分: ⚠ 关键词模式`）

---

## 九、钉钉推送

### 两个 Webhook

| 变量 | 群 | 用途 |
|------|----|------|
| `DINGTALK_WEBHOOK` + `DINGTALK_SECRET` | 主通知群 | 每套班开始时推送抽问内容+截止时间 |
| `DINGTALK_GROUP_WEBHOOK` + `DINGTALK_GROUP_SECRET` | 四组办事群 | 无抽问内容时"狗蛋"提醒 |

### 自动提醒逻辑（server 内 setInterval，每分钟检查）

- **白班 11:00**：若当天是白班且未设置本套班抽问 → 推送提醒到四组办事群
- **夜班 17:30**：若当天是夜班且未设置本套班抽问 → 推送提醒到四组办事群
- 判断"是否已设置"：`hasActiveShiftQuiz()` 检查 `pinned_questions` 的 `scope`、`created_date`、是否有内容

### 推送内容格式（`/api/notify-start`）

```
📋 本套班抽问 | 白班 5月27日

📌 题目内容：
  题池：3题应急，2题隐患排查，随机抽3题
  （或列出具体题目编号和文字）

⏰ 截止时间：5月29日 09:30前
🔗 答题入口：https://peixun.zealerhan.cn
```

---

## 十、计分规则

- 基础分：每题有分值（`questions.difficulty` 决定），答对得分
- 速度加分：答题耗时越短，额外加分
- 总分 = 基础分 + 速度加分
- `sessions` 表中：`base_points`（基础）, `bonus_points`（速度），`total_points` = 二者之和
- 排行榜：同周期内按 `total_points` 降序，并列时按 `created_at` 先后排

---

## 十一、迭代历史

### v1-v2（2025年底）
- 系统初建，基本答题流程，关键词评分
- 目录名 `quiz-v3`

### 2026年3月初（b918793）
- 语音评分上线（接入讯飞星火）
- 语音流式输出：最初实时显示识别文字（体验差），后改为波浪动画遮盖中间过程，仅展示最终结果
- `max_sentence_silence` 调整历史：500ms（切断太快）→ 800ms（当前值）

### 2026年3月底（d9bec79）
- 车峰（`is_cp`）标签
- 手动选题支持跨题库混选
- AI 出题功能（管理员上传文档，AI 提取题目）
- 计分体系重构

### 2026年4月（d9dcded）
- 项目目录从 `quiz-v3` 重命名为 `app`
- 培训模块全面上线：签到、小组、年度计划
- 切屏检测（答题中切换 tab 记录次数）
- 答题结束拍照上传头像

### 2026年5月上旬（fe87641）
- **题目明牌**：任务中心显示具体抽问题目（手动模式列题目全文；随机模式显示类别分布）
- **题库搜索**：管理员后台题库卡片内加全局搜索框
- **默认本套班**：抽问范围默认改为 `scope=shift`（原为 `today`），同时调整按钮顺序
- **钉钉推送优化**：增加截止时间（09:30）、显示题目明细
- **无抽问自动提醒**：白班11:00 / 夜班17:30 检测，推送"狗蛋"提醒到四组办事群
- **识别超时 UI**：超时从无提示改为显示 ⚠️ 红色错误文字，引导重试
- **服务端 stopTimer**：10s → 5s，配合客户端 8s 形成正确的超时层级
- **语音迁移**：阿里云 NLS → DashScope Paraformer-realtime-v2，删除 token 刷新逻辑

### 2026年5月27日（当前版本）
- **培训确认着色**：日程卡成员名字实时着色（绿=教员已确认，红=未确认），`buildPlanResponse` 追加批量查询 `training_evaluations`，前端零额外请求
- **重复答题 bug 修复**：`/api/session/start` 的 `alreadyDone` 检查去掉 `q_count>=3` 条件，改为只要有 `completed=1` 的 session 即拦截，防止已完成后再次创建 session 覆盖成绩
- **Cloudflare Tunnel 修复**：`peixun.zealerhan.cn` 的 DNS CNAME 从失效隧道 `44fe9512` 改指向活跃隧道 `a203663e`，更新 `zealerhan.yml` 中 `host-gateway` → `localhost`

---

## 十二、已知注意事项

1. **单文件架构**：`App.jsx`（前端）和 `server/index.js`（后端）都是 6000-7000 行的单文件。优点是改动定位直接，缺点是需要 AI 辅助时要明确指定行号范围。

2. **重启命令**：端口 3000 若被占用，用 `lsof -ti :3000 | xargs kill -9`。cloudflared 用 `launchctl kickstart -k gui/$(id -u)/com.cloudflare.cloudflared`。

3. **构建后才生效**：前端改完要 `npm run build`，否则浏览器看到的是旧版。

4. **quiz.db 不进 git**：数据库文件在 `.gitignore` 里。线上数据库只在服务器本地。

5. **`/ws/ali-asr` 路径未改**：迁移 Paraformer 后，WebSocket 路由路径名历史遗留仍是 `/ws/ali-asr`，实际后端已连接 DashScope，前端无需改动。

6. **讯飞 IAT 残留**：`wssXunfei` handler 在 `server/index.js` 底部，未使用，保留未删。

7. **`cycle_id` 命名规则**：以早班日期命名，例如白班 5月27日、夜班 5月28日、早班 5月29日，对应的 `cycle_id = cycle_2026-05-29`。查历史数据时注意这个偏移。

8. **Cloudflare Tunnel 双配置**：两个隧道配置文件并存。`config.yml`（隧道 `a203663e`）由 launchd 服务管理，是当前活跃隧道，覆盖所有域名。`zealerhan.yml`（隧道 `44fe9512`）为旧 Docker 配置，已失效。DNS 应全部指向 `a203663e.cfargotunnel.com`。

9. **重复答题防护**：`/api/session/start` 的 `alreadyDone` 检查不依赖 `q_count`，只要当前周期有 `completed=1` 且未删除的正式 session，就拒绝新建。唯一重置途径是管理员操作。
