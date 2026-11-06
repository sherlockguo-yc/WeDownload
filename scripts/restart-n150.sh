#!/bin/bash
# WeDownload 重启脚本（N150 生产环境）
# 由 deploy-agent.sh 调用
set -e

DIR="$HOME/wedownload"
PORT=8080

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

# 3. 解压工具：7z 覆盖 zip/rar/7z 全格式，缺了就补（失败不影响主流程，回退 unzip/unrar）
if ! command -v 7z >/dev/null 2>&1; then
    echo "[WeDownload] Installing p7zip-full..."
    sudo apt-get install -y p7zip-full >/dev/null 2>&1 || echo "[WeDownload] p7zip install skipped"
fi

# 4. Node 服务单元
sudo tee /etc/systemd/system/wedownload.service > /dev/null <<SVC
[Unit]
Description=WeDownload web (Node)
After=network.target aria2.service

[Service]
Type=simple
User=sherlockguo
Group=sherlockguo
WorkingDirectory=$DIR
ExecStart=/usr/bin/node $DIR/server/index.js
Environment=PORT=$PORT
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC

sudo systemctl daemon-reload

# 5. 让出 8080：旧 Python 代理退役
sudo systemctl disable --now ariang 2>/dev/null || true

# 6. 启动新版 Web 服务
sudo systemctl enable wedownload >/dev/null 2>&1 || true
sudo systemctl restart wedownload

# 7. 健康检查，失败则回退到旧代理，避免整站不可用
sleep 3
if curl -sf -m 5 "http://127.0.0.1:$PORT/" | grep -q WeDownload; then
    echo "[WeDownload] Restart OK (node)"
else
    echo "[WeDownload] Node service FAILED, falling back to ariang proxy"
    sudo systemctl stop wedownload 2>/dev/null || true
    sudo systemctl enable --now ariang 2>/dev/null || true
    exit 1
fi
