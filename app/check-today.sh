#!/usr/bin/env bash
# 今日答题完成情况查询
DB="/Users/hanying/peixun/app/data/quiz.db"
TODAY=$(date '+%Y-%m-%d')

echo ""
echo "═══════════════════════════════════════════"
echo "  武汉地铁5号线 答题完成情况 · $TODAY"
echo "═══════════════════════════════════════════"

# 统计数字
read TOTAL DONE <<< $(sqlite3 "$DB" "
  SELECT
    (SELECT COUNT(*) FROM staff WHERE is_exempt=0 AND COALESCE(is_cp,0)=0),
    (SELECT COUNT(DISTINCT s.staff_id)
     FROM sessions s
     JOIN staff st ON st.id=s.staff_id
     WHERE date(s.created_at)='$TODAY'
       AND s.completed=1
       AND s.q_count >= 3
       AND COALESCE(s.is_practice,0)=0
       AND COALESCE(s.is_deleted,0)=0
       AND st.is_exempt=0
       AND COALESCE(st.is_cp,0)=0)
  ;" | tr '|' ' ')

PENDING=$((TOTAL - DONE))

echo ""
echo "  应答人数: $TOTAL    已完成: $DONE    未完成: $PENDING"
echo ""

# ── 已完成名单 ──────────────────────────────
echo "  ✅ 已完成（$DONE 人）"
echo "  ─────────────────────────────────────"
sqlite3 "$DB" "
  SELECT
    printf('  %-8s %-6s  %5.1f分  %d积分  %s',
      s.staff_id, s.staff_name,
      s.total_score, s.total_points,
      time(s.created_at))
  FROM sessions s
  JOIN staff st ON st.id=s.staff_id
  WHERE date(s.created_at)='$TODAY'
    AND s.completed=1
    AND COALESCE(s.is_practice,0)=0
    AND COALESCE(s.is_deleted,0)=0
    AND st.is_exempt=0
    AND COALESCE(st.is_cp,0)=0
    AND s.id IN (
      SELECT MIN(id) FROM sessions
      WHERE date(created_at)='$TODAY'
        AND completed=1
        AND q_count >= 3
        AND COALESCE(is_practice,0)=0
        AND COALESCE(is_deleted,0)=0
      GROUP BY staff_id
    )
  ORDER BY s.created_at ASC;
"

echo ""

# ── 未完成名单 ──────────────────────────────
echo "  ❌ 未完成（$PENDING 人）"
echo "  ─────────────────────────────────────"
sqlite3 "$DB" "
  SELECT printf('  %-8s %s', id, real_name)
  FROM staff
  WHERE is_exempt=0 AND COALESCE(is_cp,0)=0
    AND id NOT IN (
      SELECT DISTINCT s.staff_id
      FROM sessions s
      WHERE date(s.created_at)='$TODAY'
        AND s.completed=1
        AND s.q_count >= 3
        AND COALESCE(s.is_practice,0)=0
        AND COALESCE(s.is_deleted,0)=0
    )
  ORDER BY id;
"

echo ""
echo "═══════════════════════════════════════════"
echo ""
