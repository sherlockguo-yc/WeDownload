#!/bin/bash
# WeDownload 自动更新脚本（N150 cron 兜底，每分钟检查）
# 放在 ~/wedownload/update.sh
set -e

LOCK="/tmp/wedownload-update.lock"
DIR="$HOME/wedownload"
VERSION_FILE="$DIR/.version"
REPO="sherlockguo-yc/WeDownload"
LOG="/tmp/wedownload-update.log"

exec 9>"$LOCK"
flock -n 9 || exit 0

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Checking..." >> "$LOG"

# 获取最新 Release 版本
REMOTE=$(curl -s "https://api.github.com/repos/$REPO/releases/tags/latest" | \
    grep -o '"body": "Auto build [a-f0-9]*"' | grep -o '[a-f0-9]\{7,\}')

if [ -z "$REMOTE" ]; then
    echo "  No remote version found" >> "$LOG"
    exit 0
fi

# 对比本地版本
if [ -f "$VERSION_FILE" ]; then
    LOCAL=$(cat "$VERSION_FILE")
else
    LOCAL=""
fi

if [ "$REMOTE" = "$LOCAL" ]; then
    echo "  Up-to-date ($LOCAL)" >> "$LOG"
    exit 0
fi

echo "  Update: $LOCAL → $REMOTE" >> "$LOG"

# 下载新版本（先试 ghproxy 镜像，再直连）
DL_URL="https://github.com/$REPO/releases/latest/download/wedownload.tar.gz"
TARBALL="/tmp/wedownload-update.tar.gz"
STAGE="/tmp/wedownload-stage"

for i in $(seq 1 5); do
    if curl -fsSL "https://ghproxy.net/$DL_URL" -o "$TARBALL" 2>/dev/null; then break; fi
    sleep 3
done
if [ ! -s "$TARBALL" ]; then
    for i in $(seq 1 8); do
        if curl -fsSL "$DL_URL" -o "$TARBALL" 2>/dev/null; then break; fi
        sleep 5
    done
fi

if [ ! -s "$TARBALL" ]; then
    echo "  Download failed" >> "$LOG"
    exit 1
fi

# 解压
rm -rf "$STAGE"
mkdir -p "$STAGE"
tar xzf "$TARBALL" -C "$STAGE"
rm -f "$TARBALL"

# 验证版本一致
STAGE_VERSION=$(cat "$STAGE/wedownload/.version" 2>/dev/null || echo "")
if [ "$STAGE_VERSION" != "$REMOTE" ]; then
    echo "  Version mismatch: stage=$STAGE_VERSION remote=$REMOTE" >> "$LOG"
    exit 1
fi

# 部署（排除运行时数据目录）
rsync -a --delete \
    --exclude 'data' \
    --exclude '.version' \
    "$STAGE/wedownload/" "$DIR/"

echo "$REMOTE" > "$VERSION_FILE"
rm -rf "$STAGE"

# 重启服务
bash "$DIR/scripts/restart.sh" 200>&-

echo "  Deployed $REMOTE" >> "$LOG"
