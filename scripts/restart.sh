#!/bin/bash
# WeDownload 重启脚本（N150 生产环境）
set -e

DIR="$HOME/wedownload"

echo "[WeDownload] Restarting services..."

# 1. 停止 qbittorrent
systemctl stop qbittorrent-nox 2>/dev/null || true

# 2. 同步配置文件
cp "$DIR/config/qbittorrent-nox.service" /etc/systemd/system/
systemctl daemon-reload

# 3. 更新 cloudflared ingress（如果 wedownload 路由还没有则添加）
INGRESS_FILE="/etc/cloudflared/config.yml"
if [ -f "$DIR/config/cloudflared-ingress.conf" ] && [ -f "$INGRESS_FILE" ]; then
    if ! grep -q 'wedownload.sherlockguo.com' "$INGRESS_FILE"; then
        python3 -c "
with open('$INGRESS_FILE', 'r') as f:
    content = f.read()
entry = open('$DIR/config/cloudflared-ingress.conf').read().strip() + '\n'
catchall = '  - service: http_status:404'
if entry not in content:
    content = content.replace(catchall, entry + catchall)
    with open('$INGRESS_FILE', 'w') as f:
        f.write(content)
"
        systemctl restart cloudflared
    fi
fi

# 4. 启动 qbittorrent
systemctl start qbittorrent-nox

sleep 2

# 5. 健康检查
if systemctl is-active --quiet qbittorrent-nox; then
    echo "[WeDownload] Restart OK"
else
    echo "[WeDownload] Restart FAILED"
    exit 1
fi
