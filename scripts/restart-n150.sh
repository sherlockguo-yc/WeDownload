#!/bin/bash
# WeDownload 重启脚本（N150 生产环境）
# 由 deploy-agent.sh 调用
set -e

DIR="$HOME/wedownload"

echo "[WeDownload] Restarting..."

# 1. 复制 Aria2 配置
if [ -f "$DIR/config/aria2.conf" ]; then
    mkdir -p "$HOME/.aria2"
    cp "$DIR/config/aria2.conf" "$HOME/.aria2/aria2.conf"
fi

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

# 3. 更新 AriaNg 代理脚本
if [ -f "$DIR/scripts/ariang-proxy.py" ]; then
    cp "$DIR/scripts/ariang-proxy.py" "$HOME/ariang-proxy.py"
fi

# 4. 重启 AriaNg 代理
sudo systemctl restart ariang

# 5. 验证
sleep 2
if systemctl is-active --quiet ariang; then
    echo "[WeDownload] Restart OK"
else
    echo "[WeDownload] Restart FAILED"
    exit 1
fi
