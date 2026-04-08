# 乘务培训系统 v3

武汉地铁5号线乘务工班组业务考核答题系统。支持语音答题、AI 评分、倒班日历管理、钉钉自动推送。

## 功能概览

### 答题者端
- 工号 + 手机尾号登录
- 语音/文字答题，AI 实时评分（百分制，满分100）
- 每套班（白夜早）限答一次正式题，早班截止时间 09:30
- 练习模式：不限次数，每月最多 +3 积分加成
- 轮班榜、总榜查看个人成绩趋势

### 管理员端
- 概览页：实时查看全员答题状态（已完成 / 中断 / 逾期 / 未答）
- 手动选题：指定本套班抽问内容，未发布时答题按钮置灰
- 人员管理：批量导入、设置免答/测试/副职标识
- 题库管理：多题库、Word/PDF 导入、AI 批量出题
- 补答授权：对早班逾期人员授权 30 分钟补答窗口
- 中断重置：重置答题中断人员本轮答题机会
- 钉钉推送：手动/自动推送完成情况报告

### 自动化
- 倒班日历（白班→夜班→早班→休息，四天循环）
- 定时钉钉推送：早班 09:00、白班 15:30、夜班 16:00
- 服务开机自启（macOS LaunchAgent）

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite，单文件 App.jsx |
| 后端 | Node.js + Express |
| 数据库 | SQLite（better-sqlite3） |
| AI 评分 | 阿里云 DashScope（通义千问），降级为关键词匹配 |
| 语音识别 | 讯飞 IAT WebSocket API |
| 实时通信 | WebSocket（ws） |
| 推送 | 钉钉机器人 Webhook |
| 部署 | macOS Mac Mini，LaunchAgent 守护进程 |

## 目录结构

```
app/
├── server/
│   └── index.js          # 后端全部逻辑（Express + SQLite，~2300行）
├── src/
│   ├── App.jsx            # 前端全部页面（React，~3000行）
│   └── main.jsx           # React 入口
├── public/                # 静态图片资源
├── dist/                  # Vite 构建产物（生产环境）
├── data/
│   ├── quiz.db            # SQLite 数据库（不入库）
│   └── shift_calendar_2026.json  # 2026年全年倒班日历
├── auto-push.sh           # 钉钉定时推送脚本
├── check-today.sh         # 今日答题情况查询脚本
├── update-tools-md.sh     # AI agent 状态同步脚本
├── .env                   # 环境变量（不入库）
├── .env.example           # 环境变量模板
├── vite.config.js
└── package.json
```

## 快速启动

```bash
# 安装依赖并构建前端
cd app
npm run setup

# 启动服务（开发）
npm run dev        # 前端热更新
npm start          # 后端

# 生产环境（macOS LaunchAgent 已配置开机自启）
npm run build      # 重新构建前端
```

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

```env
PORT=3000
ADMIN_PASSWORD=admin888
DB_PATH=./data/quiz.db

# 阿里云 DashScope（AI 评分，可选）
ALI_APPKEY=
ALI_AK_ID=
ALI_AK_SEC=
DASHSCOPE_API_KEY=

# 讯飞 IAT（语音识别，可选）
XFYUN_APP_ID=
XFYUN_API_KEY=
XFYUN_API_SECRET=

# 钉钉推送（可选）
DINGTALK_WEBHOOK=
DINGTALK_SECRET=

# 对外访问域名（二维码使用）
PUBLIC_URL=https://peixun.zealerhan.cn
```

## 访问地址

- 本地：http://localhost:3000
- 外网：https://peixun.zealerhan.cn

## 默认账号

- 管理员密码：见 `.env` 中 `ADMIN_PASSWORD`
- 普通用户：工号 + 手机后4位登录
