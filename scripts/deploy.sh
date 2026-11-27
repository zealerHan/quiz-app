#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 乘务系统部署脚本 —— 飞牛 Docker
#
# 用法：bash /vol2/docker/peixun/deploy.sh
#
# 做的事：git pull → 重装依赖（如 package.json 变了）→ 重建镜像 → 重启容器 → 健康检查
#
# 铁律（踩过的坑）：
#   1. 改后端/新增 server 文件/改 .env 必须重建镜像，docker restart 无效
#   2. .env 打包进镜像，改完必须 build + --force-recreate
#   3. 飞牛直连 GitHub 被墙，必须走本机 7890 代理
# ─────────────────────────────────────────────────────────────
set -uo pipefail

DIR=/vol2/docker/peixun
cd "$DIR" || { echo "❌ 进不去 $DIR"; exit 1; }

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
info() { echo "${GRN}▸${RST} $*"; }
warn() { echo "${YEL}⚠${RST}  $*"; }
die()  { echo "${RED}❌${RST} $*"; exit 1; }

echo "════════ 乘务系统部署 $(date '+%Y-%m-%d %H:%M:%S') ════════"

# ── 0. .env 存在性检查（没有它整个系统起不来）──
[ -f app/.env ] || die "app/.env 不存在！先恢复再部署"

# ── 1. 拉取代码 ──
info "拉取最新代码…"
OLD=$(git rev-parse --short HEAD 2>/dev/null || echo "none")

# 飞牛直连 GitHub 会被墙，走本机代理
if ! git fetch origin --quiet 2>/dev/null; then
  warn "直连失败，改用 7890 代理"
  export https_proxy=http://127.0.0.1:7890
  export http_proxy=http://127.0.0.1:7890
  git fetch origin --quiet || die "拉取失败：GitHub 连不上（代理也没通）"
fi

# 本地有改动时拒绝覆盖（避免手改代码被冲掉）
if ! git diff --quiet; then
  warn "工作区有未提交改动，可能有人在飞牛上直接改过代码"
  git status --short | head -10
  echo ""
  read -p "仍要继续？会丢弃这些改动 (y/N) " ans
  [ "$ans" = "y" ] || die "已取消"
fi

git reset --hard origin/main --quiet || die "reset 失败"
NEW=$(git rev-parse --short HEAD)

if [ "$OLD" = "$NEW" ]; then
  info "代码无变化（$NEW），跳过重建"
  CMD_SHOW=$(docker inspect peixun --format '{{.Created}}' 2>/dev/null | cut -c1-19)
  warn "当前容器创建于 $CMD_SHOW"
  read -p "仍然重建镜像？(y/N) " ans
  [ "$ans" = "y" ] || { info "已退出"; exit 0; }
else
  info "代码更新 $OLD → $NEW"
  git log --oneline "$OLD..$NEW" 2>/dev/null | head -5 | sed 's/^/    /'
fi

# ── 2. 备份数据库（改代码前先兜底）──
if [ -x "$DIR/backup-db.sh" ]; then
  info "备份数据库…"
  bash "$DIR/backup-db.sh" >/dev/null 2>&1 && info "备份完成" || warn "备份失败（不阻断部署，但要查）"
fi

# ── 3. 重建镜像 ──
info "重建镜像（约 1-3 分钟）…"
docker compose build peixun 2>&1 | tail -3 || die "构建失败"

# ── 4. 重启容器 ──
info "重启容器…"
docker compose up -d --force-recreate peixun 2>&1 | tail -2 || die "启动失败"

# ── 5. 健康检查（等它真的 healthy，不是启动就算）──
info "等健康检查…"
for i in $(seq 1 40); do
  S=$(docker inspect peixun --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)
  [ "$S" = "healthy" ] && break
  [ "$i" = "40" ] && die "60 秒了还没 healthy，状态=$S，查日志：docker logs peixun --tail 50"
  sleep 2
done

echo ""
echo "════════ 部署完成 ════════"
echo "  提交:    $NEW"
echo "  容器:    $(docker ps --filter name=peixun --format '{{.Status}}')"
echo "  公网:    $(curl -s -o /dev/null -w '%{http_code}' https://peixun.zealerhan.cn/ 2>/dev/null || echo '?')"
echo ""
echo "  前端产物:"
docker exec peixun ls /app/dist/assets/ 2>/dev/null | sed 's/^/    /'
