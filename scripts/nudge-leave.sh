#!/bin/bash
# 乘务四组休假申报提醒（钉钉群，狗蛋）
# 老韩 2026-11-25 定，三条推送分两个群：
#
#   周一 12:00  preview  申报预告            → 「乘务四组」大群（全体组员）
#   周二 12:00  tuesday  提醒确认顶班        → 「四组办事情」群（管理员+车场组）
#   周三 12:00  remind   申报提醒(还剩5小时) → 「乘务四组」大群（全体组员）
#
# 为什么分群：大群是全体组员，只发他们需要知道的申报窗口；
# 顶班协调是管理员和车场组之间的事，发办事情群，不打扰组员。
#
# 为什么周一周三文案不同：周一距截止还有两天多，算出来「还剩53小时」没意义，
# 周一只报截止日期；周三中午距 17:00 正好 5 小时，才写「还剩5小时」。
#
# 宿主 cron 调用（容器内无 cron）：
#   0 12 * * 1 /vol2/docker/peixun/nudge-leave.sh preview
#   0 12 * * 2 /vol2/docker/peixun/nudge-leave.sh tuesday
#   0 12 * * 3 /vol2/docker/peixun/nudge-leave.sh remind
#
# 脚本自己先查窗口状态，窗口没开或已截止就跳过（防止调度延迟跑出错文案）。

set -u
LOG=/vol2/docker/peixun/logs/nudge-leave.log
MODE="${1:-remind}"
mkdir -p "$(dirname "$LOG")"
TS=$(date '+%Y-%m-%d %H:%M:%S')

API=http://127.0.0.1:13000
AUTH='x-admin-password: admin888'

# 先问窗口状态
WIN=$(curl -s --max-time 15 "$API/api/leave/apply-window" 2>/dev/null || echo '{}')
STATE=$(printf '%s' "$WIN" | /usr/bin/python3 -c "
import sys,json
d=json.load(sys.stdin)
print('open' if d.get('open') else 'closed')
" 2>/dev/null || echo closed)

if [ "$STATE" != "open" ]; then
  echo "[$TS] [$MODE] 跳过：申报窗口未开或已截止" >> "$LOG"
  exit 0
fi

case "$MODE" in
  tuesday)
    URL="$API/api/leave/tuesday-confirm"
    ;;
  preview|remind)
    URL="$API/api/leave/nudge"
    ;;
  *)
    echo "[$TS] 未知模式 $MODE，退出" >> "$LOG"
    exit 1
    ;;
esac

RESP=$(curl -s --max-time 60 -X POST \
  -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d "{\"with_image\":true,\"mode\":\"$MODE\"}" \
  "$URL" 2>&1)

echo "[$TS] [$MODE] 已发送: $RESP" >> "$LOG"
