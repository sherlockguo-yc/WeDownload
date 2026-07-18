#!/bin/bash
# WeDownload 首次安装脚本
# 在 N150 上以 root 权限运行
set -e

echo "=== WeDownload Setup ==="

# 1. 安装 qBittorrent-nox
if ! command -v qbittorrent-nox &>/dev/null; then
    echo "Installing qBittorrent-nox..."
    apt update && apt install -y qbittorrent-nox unzip
fi

# 2. 创建下载目录
mkdir -p /home/sherlockguo/downloads

# 3. 配置 qBittorrent
#   - 密码由用户通过 Web UI 设置
#   - 下载目录指向 ~/downloads/
#   - 启用 VueTorrent 皮肤
#   - 启动后生成临时密码，用户需登录修改
echo "Starting qBittorrent to generate config..."
sudo -u sherlockguo qbittorrent-nox --webui-port=8080 &
QB_PID=$!
sleep 3
kill $QB_PID 2>/dev/null || true

# 4. 安装 VueTorrent 皮肤
VUETORRENT_DIR="/home/sherlockguo/.config/qBittorrent/vuetorrent"
if [ ! -d "$VUETORRENT_DIR" ]; then
    echo "Downloading VueTorrent..."
    mkdir -p "$VUETORRENT_DIR"
    curl -sL https://github.com/WDaan/VueTorrent/releases/latest/download/vuetorrent.zip \
        -o /tmp/vuetorrent.zip
    unzip -qo /tmp/vuetorrent.zip -d /tmp/vuetorrent
    mv /tmp/vuetorrent/vuetorrent/* "$VUETORRENT_DIR/"
    rm -rf /tmp/vuetorrent /tmp/vuetorrent.zip
fi

# 5. 写入 qBittorrent 基础配置
CONF="/home/sherlockguo/.config/qBittorrent/qBittorrent.conf"
cat > "$CONF" << 'CONFEOF'
[BitTorrent]
Session\BTProtocol=Both
Session\QueueingSystemEnabled=false

[Meta]
MigrationVersion=6

[Preferences]
Download\SavePath=/home/sherlockguo/downloads/
General\Locale=zh_CN
WebUI\AlternativeUIEnabled=true
WebUI\RootFolder=/home/sherlockguo/.config/qBittorrent/vuetorrent/
CONFEOF
chown sherlockguo:sherlockguo "$CONF"

# 6. 放行防火墙
ufw allow 8080/tcp 2>/dev/null || true

# 7. 安装 systemd unit
cp config/qbittorrent-nox.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now qbittorrent-nox

echo "=== Setup Complete ==="
echo "qBittorrent Web UI: http://$(hostname -I | awk '{print $1}'):8080"
echo "Check journal for temporary password: sudo journalctl -u qbittorrent-nox | grep temporary"
