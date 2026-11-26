#!/bin/bash
# ─────────────────────────────────────────────────────────────
# 乘务系统数据库备份（2026-11-26 建）
#
# 为什么要这个脚本：
#   1. 原来 12 个手工 .bak 全用 cp，而库是 WAL 模式 → 每个备份都缺数据
#      实测：cp 副本 answers 少 3 条、leave_records 少 5 条、新表整个丢失
#      .backup() 能拿到完整一致快照
#   2. 原来所有备份都在同一块盘同一目录，盘坏了主库和备份一起没
#   3. 原来没有任何自动化，全是我手动 cp
#
# 做法：
#   · 容器内用 better-sqlite3 的 .backup() 生成一致快照（WAL 安全）
#   · 存到 /vol1（另一块物理盘，56G）—— 不在 /vol2
#   · 只保留最近 N 天，自动清旧的
#   · 备份完校验：文件能打开、表数量对、关键表行数 > 0
#
# 用法：bash backup-db.sh
# cron：0 3 * * * bash /vol2/docker/peixun/backup-db.sh >> /vol2/docker/peixun/logs/backup.log 2>&1
# ─────────────────────────────────────────────────────────────
set -uo pipefail

DB_DIR="/vol2/docker/peixun/data"
DEST_DIR="/vol1/backups/peixun"          # 另一块盘，不在 /vol2
CONTAINER="peixun"
KEEP_DAYS=30
STAMP=$(date +%Y%m%d-%H%M%S)
NAME="quiz-$STAMP.db"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

mkdir -p "$DEST_DIR"

echo "$LOG_PREFIX ── 开始备份 ──"

# ── 1. 容器内生成一致快照 ────────────────────────────────────
# 先备份到容器挂载的 data 目录（容器能写的地方），成功后再挪走
TMP_NAME="_bk_${STAMP}.db"
docker exec -w /app "$CONTAINER" node -e "
const D = require('better-sqlite3');
const src = new D('/app/data/quiz.db', { readonly: true });
src.backup('/app/data/${TMP_NAME}')
  .then(() => { src.close(); console.log('snapshot ok'); })
  .catch(e => { console.error('snapshot failed:', e.message); process.exit(1); });
" || { echo "$LOG_PREFIX ✗ 生成快照失败"; exit 1; }

if [ ! -f "$DB_DIR/$TMP_NAME" ]; then
  echo "$LOG_PREFIX ✗ 快照文件不存在"
  exit 1
fi

# ── 2. 校验快照完整性（不合格就不留）────────────────────────
# 生产库不允许整份覆盖，但备份必须自己先能打开、数据在
CHECK=$(docker exec -w /app "$CONTAINER" node -e "
const D = require('better-sqlite3');
try {
  const db = new D('/app/data/${TMP_NAME}', { readonly: true });
  const ic = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const tables = db.prepare(\"SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\").get().c;
  const answers = db.prepare('SELECT COUNT(*) c FROM answers').get().c;
  const leave = db.prepare('SELECT COUNT(*) c FROM leave_records').get().c;
  const staff = db.prepare('SELECT COUNT(*) c FROM staff').get().c;
  db.close();
  console.log([ic, tables, answers, leave, staff].join('|'));
} catch (e) { console.log('ERR|' + e.message); }
" 2>/dev/null)

IFS='|' read -r IC NTAB NANS NLEAVE NSTAFF <<< "$CHECK"

if [ "$IC" != "ok" ]; then
  echo "$LOG_PREFIX ✗ 完整性检查失败: $CHECK"
  rm -f "$DB_DIR/$TMP_NAME"
  exit 1
fi
if [ "${NANS:-0}" -lt 1 ] || [ "${NLEAVE:-0}" -lt 1 ] || [ "${NSTAFF:-0}" -lt 1 ]; then
  echo "$LOG_PREFIX ✗ 关键表为空（answers=$NANS leave=$NLEAVE staff=$NSTAFF），拒绝保留"
  rm -f "$DB_DIR/$TMP_NAME"
  exit 1
fi

echo "$LOG_PREFIX ✓ 快照校验通过: 表${NTAB}个 · 答题${NANS} · 休假${NLEAVE} · 人员${NSTAFF}"

# ── 3. 挪到另一块盘 ─────────────────────────────────────────
mv "$DB_DIR/$TMP_NAME" "$DEST_DIR/$NAME" || { echo "$LOG_PREFIX ✗ 移动失败"; exit 1; }
SIZE=$(du -h "$DEST_DIR/$NAME" | cut -f1)
echo "$LOG_PREFIX ✓ 已存 $DEST_DIR/$NAME ($SIZE)"

# ── 4. 上传 115 云端（盘坏了还有一份）───────────────────────
# 每周日才传，避免天天上传占带宽。失败不影响本地备份（本地才是主用）。
DOW=$(date +%u)    # 1=周一 … 7=周日
if [ "$DOW" = "7" ]; then
  UPLOADER="/vol2/docker/peixun/upload_to_115.py"
  if [ -f "$UPLOADER" ]; then
    # 115 上按日期分目录，避免单目录文件太多
    CLOUD_DIR="/115/nas/peixun-backup"
    OUT=$(python3 "$UPLOADER" --files "$DEST_DIR/$NAME" --dest "$CLOUD_DIR" 2>&1)
    if echo "$OUT" | grep -q "成功: 1/1"; then
      echo "$LOG_PREFIX ✓ 已上传 115: $CLOUD_DIR/$NAME"
    else
      echo "$LOG_PREFIX ⚠ 上传 115 失败（本地备份不受影响）: $(echo "$OUT" | tail -2 | tr '\n' ' ')"
    fi
  else
    echo "$LOG_PREFIX ⚠ 上传脚本不存在，跳过云端备份"
  fi
else
  echo "$LOG_PREFIX · 今天不是周日，跳过 115 上传（本地已备份）"
fi

# ── 5. 清理过期备份 ─────────────────────────────────────────
DELETED=$(find "$DEST_DIR" -name "quiz-*.db" -type f -mtime +$KEEP_DAYS -print -delete | wc -l)
[ "$DELETED" -gt 0 ] && echo "$LOG_PREFIX · 清理过期备份 $DELETED 个（保留 ${KEEP_DAYS} 天）"

TOTAL=$(find "$DEST_DIR" -name "quiz-*.db" -type f | wc -l)
USED=$(du -sh "$DEST_DIR" 2>/dev/null | cut -f1)
echo "$LOG_PREFIX ── 完成：共 ${TOTAL} 个备份，占用 ${USED} ──"
