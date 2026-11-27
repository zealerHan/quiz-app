#!/bin/sh
# 周三 16:50 申报窗口关闭前的预览通知（乘务四组）
#
# 流程（老韩 2026-11-25 定）：
#   16:50 本脚本 → 把「文案+日历图」发到「四组办事情群」让三个管理员先看
#   三人中任一位确认后 → 后台点「确认发到大群」按钮
#                       → POST /api/leave/window-closed {"mode":"send"}
#                       → 才发到「乘务四组大群」（全体组员）
#
# 为什么不 17:00 直接发大群：车场组已经定表，发错了要重新解释一遍。
# 宁可多一次人工确认。
#
# 前置检查：只有确实过了申报截止时间才发（防止 cron 延迟到周四还发「已截止」）。
# 提前跑（比如上午 10 点）不发 —— 那时窗口还开着，说「已截止」是错的。

BASE=http://192.168.100.20:13000
PWD_HDR="${PEIXUN_ADMIN_PWD:-admin530}"   # 韩颖的管理员密码（cron 环境无登录态）
LOG=/vol2/docker/peixun/logs/window-closed.log
mkdir -p "$(dirname "$LOG")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# ── 1. 查窗口状态 ──
WIN=$(curl -s --max-time 20 "$BASE/api/leave/apply-window")
if [ -z "$WIN" ]; then
  log "跳过：窗口接口无响应"
  exit 1
fi

# expired 字段为 true 才表示已过周三 17:00
EXPIRED=$(echo "$WIN" | sed -n 's/.*"expired":\(true\|false\).*/\1/p')
if [ "$EXPIRED" != "true" ]; then
  log "跳过：申报窗口还没截止（expired=$EXPIRED）"
  exit 0
fi

# ── 2. 发预览到「四组办事情群」 ──
RESP=$(curl -s --max-time 90 -X POST \
  -H "x-admin-password: $PWD_HDR" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"preview"}' \
  "$BASE/api/leave/window-closed")

echo "$RESP" | grep -q '"ok":true' || {
  log "预览发送失败：$RESP"
  exit 1
}

PEAK=$(echo "$RESP" | sed -n 's/.*"peak":\([0-9]*\).*/\1/p')
CNT=$(echo "$RESP" | sed -n 's/.*"people_count":\([0-9]*\).*/\1/p')
log "已发预览到办事情群：下周休假 ${CNT} 人，峰值 ${PEAK} 人顶班"

# ── 3. 给老韩发一条提醒（Bark），让他去确认 ──
# 老韩手机静音，普通推送不响；这里只发普通级 —— 不是告警，不用 critical。
#
# 2026-11-27 修：原来这里判的是 /Users/hanying/...（Mac 路径），
# 飞牛上不存在，分支体还是个空 `:`，所以从来发过通知。
BARK=/home/HanYing/.hermes/scripts/bark.sh
if [ -x "$BARK" ]; then
  "$BARK" "休假申报已截止" "下周休假 ${CNT} 人，峰值 ${PEAK} 人顶班。预览已发到办事群，请确认发大群。" \
    timeSensitive "乘务系统" 2>/dev/null \
    || log "Bark 提醒失败（不影响预览已发出）"
else
  log "找不到 bark.sh（$BARK），跳过提醒"
fi
