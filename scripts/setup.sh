#!/bin/bash
# WeDownload 首次安装脚本
# 在 N150 上以 root 权限运行
set -e

echo "=== WeDownload Setup ==="

# 1. 安装 Aria2
if ! command -v aria2c &>/dev/null; then
    echo "Installing Aria2..."
    apt update && apt install -y aria2 unzip
fi

# 2. 创建下载目录
mkdir -p /home/sherlockguo/downloads

# 3. Aria2 配置
mkdir -p /home/sherlockguo/.aria2
cp config/aria2.conf /home/sherlockguo/.aria2/aria2.conf
chown -R sherlockguo:sherlockguo /home/sherlockguo/.aria2
chown -R sherlockguo:sherlockguo /home/sherlockguo/downloads

# 4. 安装 AriaNg Web UI
ARIANG_DIR="/home/sherlockguo/AriaNg"
if [ ! -f "$ARIANG_DIR/index.html" ]; then
    echo "Downloading AriaNg..."
    mkdir -p "$ARIANG_DIR"
    ARIANG_URL=$(curl -sS --max-time 10 'https://api.github.com/repos/mayswind/AriaNg/releases/latest' | \
        python3 -c "import sys,json; r=json.load(sys.stdin); [print(a['browser_download_url']) for a in r['assets'] if 'AllInOne' in a['name']]" 2>/dev/null | head -1)
    curl -sL "$ARIANG_URL" -o /tmp/ariang.zip
    unzip -qo /tmp/ariang.zip -d "$ARIANG_DIR"
    rm -f /tmp/ariang.zip
fi

# 5. 部署 AriaNg 代理（Python 脚本）
cp scripts/ariang-proxy.py /home/sherlockguo/ariang-proxy.py

# 6. systemd 服务
cat > /etc/systemd/system/aria2.service << 'SVC'
[Unit]
Description=Aria2 (HTTP download engine)
After=network.target

[Service]
Type=simple
User=sherlockguo
Group=sherlockguo
ExecStart=/usr/bin/aria2c --conf-path=/home/sherlockguo/.aria2/aria2.conf
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
SVC

cat > /etc/systemd/system/ariang.service << 'SVC'
[Unit]
Description=AriaNg Web UI + Aria2 RPC proxy
After=network.target aria2.service

[Service]
Type=simple
User=sherlockguo
Group=sherlockguo
ExecStart=/usr/bin/python3 /home/sherlockguo/ariang-proxy.py 8080
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable --now aria2 ariang

# 7. 放行防火墙
ufw allow 8080/tcp 2>/dev/null || true

echo "=== Setup Complete ==="
echo "Web UI: https://wedownload.sherlockguo.com"
