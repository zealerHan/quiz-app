#!/usr/bin/env bash
# 定时钉钉推送 — 飞牛 Docker 版
# 用法:
#   ./auto-push.sh 白班        — 答题进度（白班 15:30）
#   ./auto-push.sh 夜班        — 答题进度（夜班 16:00）
#   ./auto-push.sh 早班        — 答题进度（早班 09:00）
#   ./auto-push.sh preview     — 次日早班培训预告（夜班 15:00）
#   ./auto-push.sh reminder    — 当天早班培训提醒（早班 08:00）
#
# 迁移自 Mac 版：原脚本写死 /Users/hanying 路径 + localhost:3000 + sqlite3，
# 2026-11-08 迁飞牛后路径全失效且未配 crontab，导致 11-07 之后推送全断。
set -uo pipefail

MODE="${1:-}"
HOST_DIR="/vol2/docker/peixun"
CONTAINER="peixun"
API="http://localhost:13000"
LOG="$HOST_DIR/logs/auto-push.log"
TODAY=$(TZ=Asia/Shanghai date '+%Y-%m-%d')
NOW=$(TZ=Asia/Shanghai date '+%H:%M')

mkdir -p "$(dirname "$LOG")"
log() { echo "[${TODAY} ${NOW}] $*" >> "$LOG"; }

# 读取管理员密码（飞牛 .env 用 ADMIN1/2/3_PASSWORD，无 ADMIN_PASSWORD）
ADMIN_PWD=$(docker exec "$CONTAINER" sh -c 'grep -m1 "^ADMIN1_PASSWORD=" /app/.env' 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)
ADMIN_PWD="${ADMIN_PWD:-admin888}"

call_api() {
  local endpoint="$1"
  curl -s --max-time 20 -X POST "${API}${endpoint}" \
    -H "Content-Type: application/json" \
    -H "x-admin-password: ${ADMIN_PWD}" 2>/dev/null || echo '{"ok":false,"error":"curl失败"}'
}

# 查今日班次（容器内无 sqlite3，用 python3 读挂载库）
TODAY_SHIFT=$(docker exec "$CONTAINER" python3 -c "
import sqlite3, sys
try:
    c = sqlite3.connect('/app/data/quiz.db').cursor()
    c.execute('SELECT shift FROM shift_calendar WHERE date=?', ('${TODAY}',))
    r = c.fetchone()
    print(r[0] if r else '')
except Exception as e:
    print('')
" 2>/dev/null || true)
TODAY_SHIFT=$(echo "$TODAY_SHIFT" | tr -d '[:space:]')

# ── 培训预告（夜班 15:00 发次日预告）─────────────────────────────────────────
if [ "$MODE" = "preview" ]; then
  if [ "$TODAY_SHIFT" != "夜班" ]; then
    log "[preview] 今日班次=${TODAY_SHIFT}，非夜班，跳过"; exit 0
  fi
  RESP=$(call_api "/api/admin/dingtalk/notify-training-preview")
  log "[preview] 结果: ${RESP}"; echo "$RESP"; exit 0
fi

# ── 当天培训提醒（早班 08:00）────────────────────────────────────────────────
if [ "$MODE" = "reminder" ]; then
  if [ "$TODAY_SHIFT" != "早班" ]; then
    log "[reminder] 今日班次=${TODAY_SHIFT}，非早班，跳过"; exit 0
  fi
  RESP=$(call_api "/api/admin/dingtalk/notify-training-reminder")
  log "[reminder] 结果: ${RESP}"; echo "$RESP"; exit 0
fi

# ── 答题进度推送（班次匹配检查）──────────────────────────────────────────────
TRIGGER_SHIFT="$MODE"

if [ -z "$TODAY_SHIFT" ]; then
  log "未找到 ${TODAY} 排班记录，跳过推送"; exit 0
fi
if [ "$TODAY_SHIFT" = "休息" ] || [ "$TODAY_SHIFT" = "正休" ]; then
  log "今日为休息，跳过推送"; exit 0
fi
if [ -n "$TRIGGER_SHIFT" ] && [ "$TODAY_SHIFT" != "$TRIGGER_SHIFT" ]; then
  log "今日班次=${TODAY_SHIFT}，触发班次=${TRIGGER_SHIFT}，不匹配，跳过"; exit 0
fi

RESP=$(call_api "/api/admin/dingtalk/push")
log "班次=${TODAY_SHIFT} 推送结果: ${RESP}"
echo "$RESP"
