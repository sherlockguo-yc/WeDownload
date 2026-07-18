#!/bin/bash
# WeDownload 重启脚本（N150 生产环境）
# 由 deploy-agent.sh 调用
set -e

DIR="$HOME/wedownload"

echo "[WeDownload] Restarting..."

# 1. 同步 systemd unit
sudo cp "$DIR/config/qbittorrent-nox.service" /etc/systemd/system/
sudo systemctl daemon-reload

# 2. 更新 cloudflared ingress（如果 wedownload 路由还没有则添加）
INGRESS_FILE="/etc/cloudflared/config.yml"
if [ -f "$DIR/config/cloudflared-ingress.conf" ] && [ -f "$INGRESS_FILE" ]; then
    if ! grep -q 'wedownload.sherlockguo.com' "$INGRESS_FILE"; then
        sudo python3 -c "
with open('$INGRESS_FILE', 'r') as f:
    content = f.read()
entry = open('$DIR/config/cloudflared-ingress.conf').read().strip() + '\n'
catchall = '  - service: http_status:404'
if entry not in content:
    content = content.replace(catchall, entry + catchall)
    with open('$INGRESS_FILE', 'w') as f:
        f.write(content)
"
        sudo systemctl restart cloudflared
    fi
fi

# 3. 重启 qbittorrent
sudo systemctl restart qbittorrent-nox

# 4. 等待并验证
sleep 2
if systemctl is-active --quiet qbittorrent-nox; then
    echo "[WeDownload] Restart OK"
else
    echo "[WeDownload] Restart FAILED"
    exit 1
fi
