#!/usr/bin/env bash
# 定时钉钉推送
# 用法:
#   ./auto-push.sh 白班        — 答题进度（白班 15:30）
#   ./auto-push.sh 夜班        — 答题进度（夜班 16:00）
#   ./auto-push.sh 早班        — 答题进度（早班 09:00）
#   ./auto-push.sh preview     — 次日早班培训预告（夜班 15:00）
#   ./auto-push.sh reminder    — 当天早班培训提醒（早班 08:00）
set -euo pipefail

MODE="${1:-}"
DB="/Users/hanying/peixun/app/data/quiz.db"
LOG="/Users/hanying/peixun/app/logs/auto-push.log"
TODAY=$(TZ=Asia/Shanghai date '+%Y-%m-%d')
NOW=$(TZ=Asia/Shanghai date '+%H:%M')

log() { echo "[${TODAY} ${NOW}] $*" >> "$LOG"; }

# 读取管理员密码
ADMIN_PWD=$(grep '^ADMIN_PASSWORD=' /Users/hanying/peixun/app/.env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)
ADMIN_PWD="${ADMIN_PWD:-admin888}"

call_api() {
  local endpoint="$1"
  curl -s --max-time 15 -X POST "http://localhost:3000${endpoint}" \
    -H "Content-Type: application/json" \
    -H "x-admin-password: ${ADMIN_PWD}" 2>/dev/null || echo '{"ok":false,"error":"curl失败"}'
}

# 查今日班次
TODAY_SHIFT=$(sqlite3 "$DB" "SELECT shift FROM shift_calendar WHERE date='${TODAY}';" 2>/dev/null || true)
TODAY_SHIFT="${TODAY_SHIFT:-}"

# ── 培训预告（夜班 15:00 发次日预告）─────────────────────────────────────────
if [ "$MODE" = "preview" ]; then
  if [ "$TODAY_SHIFT" != "夜班" ]; then
    log "[preview] 今日班次=${TODAY_SHIFT}，非夜班，跳过"
    exit 0
  fi
  RESP=$(call_api "/api/admin/dingtalk/notify-training-preview")
  log "[preview] 结果: ${RESP}"
  echo "$RESP"
  exit 0
fi

# ── 当天培训提醒（早班 08:00）────────────────────────────────────────────────
if [ "$MODE" = "reminder" ]; then
  if [ "$TODAY_SHIFT" != "早班" ]; then
    log "[reminder] 今日班次=${TODAY_SHIFT}，非早班，跳过"
    exit 0
  fi
  RESP=$(call_api "/api/admin/dingtalk/notify-training-reminder")
  log "[reminder] 结果: ${RESP}"
  echo "$RESP"
  exit 0
fi

# ── 答题进度推送（班次匹配检查）──────────────────────────────────────────────
TRIGGER_SHIFT="$MODE"

if [ -z "$TODAY_SHIFT" ]; then
  log "未找到 ${TODAY} 排班记录，跳过推送"
  exit 0
fi
if [ "$TODAY_SHIFT" = "休息" ]; then
  log "今日为休息，跳过推送"
  exit 0
fi
if [ -n "$TRIGGER_SHIFT" ] && [ "$TODAY_SHIFT" != "$TRIGGER_SHIFT" ]; then
  log "今日班次=${TODAY_SHIFT}，触发班次=${TRIGGER_SHIFT}，不匹配，跳过"
  exit 0
fi

RESP=$(call_api "/api/admin/dingtalk/push")
log "班次=${TODAY_SHIFT} 推送结果: ${RESP}"
echo "$RESP"
