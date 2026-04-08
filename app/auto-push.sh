#!/usr/bin/env bash
# 定时钉钉推送 — 检查今日班次后触发
# 用法: ./auto-push.sh 早班|白班|夜班
set -euo pipefail

TRIGGER_SHIFT="${1:-}"
DB="/Users/hanying/peixun/app/data/quiz.db"
LOG="/Users/hanying/peixun/app/logs/auto-push.log"
TODAY=$(TZ=Asia/Shanghai date '+%Y-%m-%d')
NOW=$(TZ=Asia/Shanghai date '+%H:%M')

log() { echo "[${TODAY} ${NOW}] $*" >> "$LOG"; }

# 查今日班次
TODAY_SHIFT=$(sqlite3 "$DB" "SELECT shift FROM shift_calendar WHERE date='${TODAY}';" 2>/dev/null || echo "")

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

# 读取管理员密码
ADMIN_PWD=$(grep '^ADMIN_PASSWORD=' /Users/hanying/peixun/app/.env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
ADMIN_PWD="${ADMIN_PWD:-admin888}"

# 调用推送接口
RESP=$(curl -s --max-time 15 -X POST "http://localhost:3000/api/admin/dingtalk/push" \
  -H "Content-Type: application/json" \
  -H "x-admin-password: ${ADMIN_PWD}" 2>/dev/null || echo '{"ok":false,"error":"curl失败"}')

log "班次=${TODAY_SHIFT} 推送结果: ${RESP}"
echo "$RESP"
