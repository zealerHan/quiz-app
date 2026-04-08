#!/usr/bin/env bash
# 每5分钟把答题情况写入总指挥的 TOOLS.md，让模型直接读到不需要调工具
TOOLS_MD="/Users/hanying/.openclaw/workspace-zongzhihui/TOOLS.md"
RESULT=$(curl -s --max-time 5 "http://localhost:3000/api/monitor/today/text?token=monitor_quiz_5line" 2>/dev/null)

if [ -z "$RESULT" ]; then
  RESULT="⚠️ 答题系统无响应"
fi

cat > "$TOOLS_MD" << EOF
# TOOLS.md - 班组答题实时情况

> 自动更新：$(date '+%Y-%m-%d %H:%M')

## 今日答题完成情况

${RESULT}

---

## 基础设施

- **Mac Mini**：192.168.100.22，用户 hanying
- **培训系统**：http://localhost:3000（武汉地铁5号线乘务答题系统）
- **NAS**：192.168.100.52，端口33，用户 HanYing
EOF
