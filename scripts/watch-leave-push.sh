#!/bin/bash
# 周三钉钉推送看护（2026-11-27 建）
#
# 背景：2026-11-26（周三）nudge-leave.sh 和 window-closed.sh 一次都没执行。
#   crontab 里有记录、系统没重启、同时段其他 cron 任务（auto-push 等）都正常。
#   11-27 重载 crontab 后实测能跑，但真正确认要等到下个周三。
#   这个脚本就是那个确认动作——如果没发出去，用 Bark 告诉老韩。
#
# 装法（宿主 crontab）：
#   10 17 * * 3 /vol2/docker/peixun/watch-leave-push.sh >> /vol2/docker/peixun/logs/watch-leave-push.log 2>&1
#
# 检查两条：
#   1. nudge-leave.log 今天有没有 12:00 的 remind 记录（或跳过记录）
#   2. window-closed.log 今天有没有 16:50 的发送记录
#
# 判据：日志里出现今天的日期就算跑过。只判定「脚本有没有被 cron 唤起」，
#       不判断钉钉是否真的收到（那要看钉钉群）。
#
# 静默原则：一切正常就什么都不发。

set -u

LOG_DIR=/vol2/docker/peixun/logs
BARK=/home/HanYing/.hermes/scripts/bark.sh
TODAY=$(date '+%Y-%m-%d')
NOW=$(date '+%Y-%m-%d %H:%M:%S')

OUT="$LOG_DIR/watch-leave-push.log"

# ── 检查 nudge-leave（周三 12:00 remind）──
NUDGE_OK=no
if [ -f "$LOG_DIR/nudge-leave.log" ]; then
  if grep -q "^\[$TODAY 12:" "$LOG_DIR/nudge-leave.log" 2>/dev/null; then
    NUDGE_OK=yes
  fi
fi

# ── 检查 window-closed（周三 16:50 预览）──
WINDOW_OK=no
if [ -f "$LOG_DIR/window-closed.log" ]; then
  if grep -q "^\[$TODAY 16:5" "$LOG_DIR/window-closed.log" 2>/dev/null; then
    WINDOW_OK=yes
  fi
fi

echo "[$NOW] nudge=$NUDGE_OK window=$WINDOW_OK" >> "$OUT"

# ── 都正常就静默退出 ──
if [ "$NUDGE_OK" = "yes" ] && [ "$WINDOW_OK" = "yes" ]; then
  exit 0
fi

# ── 有异常，Bark 推给老韩 ──
MSG=""
if [ "$NUDGE_OK" = "no" ] && [ "$WINDOW_OK" = "no" ]; then
  MSG="周三两条定时推送都没执行：12:00 申报提醒 + 16:50 截止预览。可能 cron 又没加载 crontab。"
elif [ "$NUDGE_OK" = "no" ]; then
  MSG="周三 12:00 申报提醒没执行（16:50 预览正常）。"
else
  MSG="周三 16:50 截止预览没执行（12:00 提醒正常）。"
fi

MSG="$MSG
时间 $NOW
查：tail -20 /vol2/docker/peixun/logs/nudge-leave.log"

if [ -x "$BARK" ]; then
  "$BARK" "乘务系统推送异常" "$MSG" critical "乘务系统" 2>/dev/null || \
    echo "[$NOW] Bark 调用失败" >> "$OUT"
else
  echo "[$NOW] 找不到 bark.sh，无法通知" >> "$OUT"
fi
