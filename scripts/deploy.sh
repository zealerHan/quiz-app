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
  # ⚠ 代码没变 ≠ 容器已是这个代码（2026-11-27 踩过）
  #
  # 场景：上次部署被前面的自检拦下（或 SSH 断了），git 已经 reset 到新提交，
  #       但容器没重建。再跑 deploy.sh 时 OLD==NEW，直接"跳过重建"退出，
  #       于是 git 和容器长期分叉，而且每次都说"已退出"看不出问题。
  #
  # 判据：容器创建时间 早于 HEAD 提交时间 → 说明容器里跑的是旧代码 → 强制重建。
  HEAD_TS=$(git log -1 --format=%ct 2>/dev/null || echo 0)
  CMD_TS=$(docker inspect peixun --format '{{.Created}}' 2>/dev/null | xargs -I{} date -d {} +%s 2>/dev/null || echo 0)
  CMD_SHOW=$(docker inspect peixun --format '{{.Created}}' 2>/dev/null | cut -c1-19)

  if [ "${CMD_TS:-0}" -gt 0 ] && [ "${HEAD_TS:-0}" -gt 0 ] && [ "$CMD_TS" -lt "$HEAD_TS" ]; then
    warn "代码无变化（$NEW），但容器比这个提交旧 —— git 和容器已分叉"
    warn "  容器创建: $CMD_SHOW"
    warn "  最后提交: $(git log -1 --format='%ci' 2>/dev/null | cut -c1-19)"
    warn "上次部署可能被中断，容器里跑的是旧代码。这次强制重建。"
    # 不询问，直接继续往下走重建
  else
    info "代码无变化（$NEW），容器已是最新（创建于 $CMD_SHOW）"
    read -p "仍然重建镜像？(y/N) " ans
    [ "$ans" = "y" ] || { info "已退出"; exit 0; }
  fi
else
  info "代码更新 $OLD → $NEW"
  git log --oneline "$OLD..$NEW" 2>/dev/null | head -5 | sed 's/^/    /'
fi

# ── 2. 备份数据库（改代码前先兜底）──
if [ -x "$DIR/backup-db.sh" ]; then
  info "备份数据库…"
  bash "$DIR/backup-db.sh" >/dev/null 2>&1 && info "备份完成" || warn "备份失败（不阻断部署，但要查）"
fi

# ── 2.5 前端产物自检（踩过的坑，2026-11-27 加）──
#
# 坑 A：docker compose build 不构建前端。Dockerfile 是 COPY app/ ./，
#       前端 dist/ 必须是 Mac 上 npm run build 过、且已提交进 git 的。
#       改了 .jsx 没本地 build → 线上还是旧包，而 build 显示成功。
#
# 坑 B：dist/assets 属主是 root 时，vite 构建会静默失败
#       （显示 ✓ built 但宿主机文件没变）。
#
# 所以这里两道检查：属主不对就修；产物比源码旧就报错。

info "检查前端产物…"

# B. 属主检查
DIST_OWNER=$(stat -c '%U:%G' "$DIR/app/dist" 2>/dev/null || echo "?")
if [ "$DIST_OWNER" != "HanYing:Users" ]; then
  warn "dist 属主是 $DIST_OWNER（应为 HanYing:Users），vite 构建可能静默失败"
  chown -R HanYing:Users "$DIR/app/dist" 2>/dev/null && info "已修正属主" \
    || warn "修正失败，需要 sudo（下次构建可能不生效）"
fi

# A. 产物新鲜度：判定「最后一次源码提交」和「dist 产物」谁更新
#
# ⚠ 不能用文件 mtime 比 —— git checkout / reset --hard 会刷新所有文件的 mtime，
#   哪怕内容一个字没变，也会造成「源码比产物新」的假报警（2026-11-27 实测踩到）。
# 正确做法：比 git 里最后一次动 src/ 的提交时间 与 dist 产物的 mtime。
LAST_SRC_COMMIT=$(git log -1 --format=%ct -- app/src 2>/dev/null || echo 0)
NEWEST_DIST=$(find "$DIR/app/dist/assets" -name '*.js' 2>/dev/null | xargs stat -c '%Y' 2>/dev/null | sort -rn | head -1)

# 还有未提交的 src 改动也要算进来（工作区改了但没 commit）
UNCOMMITTED_SRC=$(git status --porcelain -- app/src 2>/dev/null | head -1)

if [ "${LAST_SRC_COMMIT:-0}" -gt 0 ] && [ -n "${NEWEST_DIST:-}" ]; then
  if [ -n "$UNCOMMITTED_SRC" ]; then
    warn "app/src 有未提交的改动，前端产物可能不对应"
    warn "改了 .jsx 请在 Mac 上 npm run build 并提交 dist"
    read -p "仍要继续？(y/N) " ans
    [ "$ans" = "y" ] || die "已取消——请先在 Mac 上 build 并提交"
  elif [ "$LAST_SRC_COMMIT" -gt "$NEWEST_DIST" ]; then
    warn "src 最后一次提交比前端产物新（commit $LAST_SRC_COMMIT > dist $NEWEST_DIST）"
    warn "说明改了 .jsx 但没重新 build，线上会是旧包"
    read -p "仍要继续？(y/N) " ans
    [ "$ans" = "y" ] || die "已取消——请先在 Mac 上 npm run build 并提交 dist"
  else
    info "前端产物不旧于源码提交，正常"
  fi
else
  warn "取不到 git 提交时间或产物时间，跳过新鲜度检查"
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

# ── 6. 代码一致性校验（最后一道闸，2026-11-27 加）──
#
# ⚠ 为什么必须有这一步：
#   「exit 0」和「事情办成了」是两件事。
#   今天出现过 deploy.sh 连续三次输出「部署完成」，但容器里跑的还是 18:00 的旧代码，
#   因为中间一次部署被自检拦下、git 已更新而容器没重建，后续每次都说「代码无变化」退出。
#   所有输出都正常，只有比对文件哈希才能发现不对。
#
# 判据：git 里 HEAD 版本的源码，必须和容器内 /app 下同一文件逐字节一致。
info "校验容器内代码与 git 一致…"

MISMATCH=""
CHECKED=0
MISSING=0
for f in $(git ls-files app/server app/src 2>/dev/null); do
  HOST_F="$DIR/$f"
  # 容器内路径：仓库里是 app/server/x.js，容器 WORKDIR 是 /app，所以是 /app/server/x.js
  CONT_F="/$f"
  [ -f "$HOST_F" ] || continue
  H=$(md5sum "$HOST_F" 2>/dev/null | cut -d' ' -f1)
  C=$(docker exec peixun md5sum "$CONT_F" 2>/dev/null | cut -d' ' -f1)
  CHECKED=$((CHECKED+1))
  # ⚠ 容器里读不到这个文件，本身就是不一致（不能因为 C 为空就跳过）
  if [ -z "$C" ]; then
    MISSING=$((MISSING+1))
    MISMATCH="$MISMATCH\n    $f  （容器内不存在 $CONT_F）"
  elif [ "$H" != "$C" ]; then
    MISMATCH="$MISMATCH\n    $f  （内容不同）"
  fi
done

if [ -n "$MISMATCH" ]; then
  echo ""
  echo "${RED}❌ 部署未真正生效 —— 以下文件容器内与 git 不一致：${RST}"
  echo -e "$MISMATCH"
  echo ""
  echo "  这通常意味着：上次部署被中断、镜像没重建、或 dist 权限问题导致构建静默失败。"
  echo "  手动排查："
  echo "    docker exec peixun md5sum <文件>"
  echo "    md5sum $DIR/app/<文件>"
  echo "    docker compose build peixun && docker compose up -d --force-recreate peixun"
  exit 1
fi

info "代码一致（校验了 $CHECKED 个文件）"

echo ""
echo "════════ 部署完成 ════════"
echo "  提交:    $NEW"
echo "  容器:    $(docker ps --filter name=peixun --format '{{.Status}}')"
echo "  公网:    $(curl -s -o /dev/null -w '%{http_code}' https://peixun.zealerhan.cn/ 2>/dev/null || echo '?')"
echo "  代码:    $CHECKED 个文件与 git 一致 ✓"
echo ""
echo "  前端产物:"
docker exec peixun ls /app/dist/assets/ 2>/dev/null | sed 's/^/    /'
