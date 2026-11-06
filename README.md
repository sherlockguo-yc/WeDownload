# WeDownload

家庭服务器上的下载管理应用。把链接丢给它，让 N150 7×24 挂着下载，不占用手机和电脑。

- 入口：**https://wedownload.sherlockguo.com**
- 引擎：aria2 1.37.0（HTTP / HTTPS / FTP / SFTP，16 线程，断点续传）
- 界面：AriaNg，手机浏览器可直接用

---

## 怎么用

1. 浏览器打开 https://wedownload.sherlockguo.com
2. 点左上角 **新建**
3. 把下载链接粘贴进输入框，一行一个，可以一次粘多条
4. 点 **立即下载**
5. 在 **正在下载** 看实时速度和进度，下载完自动进入 **已完成 / 已停止**

任务可以随时暂停、继续、删除（删除时可勾选「同时删除文件」）。

---

## 它能接手什么样的链接

关键是 **直链**：在浏览器地址栏打开就会直接开始下载文件的那种 URL。

| 类型 | 支持 | 说明 |
|------|------|------|
| 镜像站文件地址 | 可以 | 清华 TUNA、阿里云、腾讯云等，实测 4~5 MB/s |
| 软件官网安装包直链 | 可以 | 直接指向 `.dmg` / `.exe` / `.zip` 的 URL |
| 网盘离线下载产出的直链 | 可以 | 先把资源转存到网盘，再取它的下载直链 |
| FTP / SFTP 地址 | 可以 | aria2 原生支持 |
| 网页地址（视频页、网盘分享页） | 不行 | 只会把 HTML 存成一个文件，没有意义 |
| 磁力链 / `.torrent` | 不行 | N150 在移动 CGNAT 后，拿不到 peer，实测速度为 0 |

**判断是不是直链**：把链接粘到浏览器地址栏回车。直接弹出下载框、或页面变成播放器/纯文本内容，就是直链；如果打开的是一个有导航栏和按钮的网页，就不是。

---

## 下载好的文件在哪

文件落在服务器的 `~/downloads/`，**网页上目前拿不到文件本身**。

从 Mac 取回（走 Cloudflare 隧道，不需要和 N150 在同一网络）：

```bash
# 依赖 ~/.ssh/config 中的 n150 别名（ProxyCommand 为 cloudflared access ssh）
scp n150:'/home/sherlockguo/downloads/文件名' ~/Downloads/
```

也可以先 `ssh n150` 登录服务器，再用 `ls -lah ~/downloads` 确认文件。

**手机上目前没有取文件的入口**，原因见下方「已知限制」。

---

## 已知限制

1. **没有文件取回 / 在线播放**：网页只能管理任务，不能把文件下回手机，也不能在线看视频。这是阶段二的 P1 功能，尚未实现。
2. **BT 不可用**：中国移动 CGNAT，没有公网 IP，无法获取 peer。已从 qBittorrent 全面切换到 HTTP 直链。
3. **单人使用**：没有多用户和权限系统，靠 Cloudflare Tunnel 隐藏真实 IP + aria2 RPC secret 认证。

所以它现在的定位是：**挂机下载 + 回家用电脑取文件**。如果只是想在手机上直接拿到文件，用手机浏览器下载更快。

---

## 常见问题

| 现象 | 原因 / 处理 |
|------|------------|
| 打开页面后一直显示「正在连接」 | 刷新页面；确认服务器上 `aria2` 与 `ariang` 服务正常 |
| 任务一直是 0 B/s | 链接多半不是直链，或源站需要登录态 / Referer |
| 下回来是一个 `.html` 文件 | 加的是网页地址，不是文件直链 |
| 添加任务报错 `could not be retrieved` | 链接已失效，或源站拒绝服务器 IP |
| 速度比预期慢 | 取决于源站；国内镜像通常 4~5 MB/s，境外站点可能很慢 |

---

## 技术构成

```
浏览器 (手机/电脑)
      │ HTTPS
      ▼
Cloudflare CDN ── cloudflared 出站隧道 ──▶ N150
                                            │
                                  127.0.0.1:8080  ariang-proxy.py
                                    ├─ 静态文件：~/AriaNg
                                    └─ /jsonrpc → 127.0.0.1:6800
                                            │
                                      aria2（下载引擎）
                                            │
                                      ~/downloads/
```

| 组件 | 说明 |
|------|------|
| `aria2` | systemd 服务，监听 `127.0.0.1:6800`，配置在 `config/aria2.conf` |
| `ariang` | systemd 服务，运行 `scripts/ariang-proxy.py`，监听 `127.0.0.1:8080` |
| `cloudflared` | Cloudflare Tunnel，`wedownload.sherlockguo.com` → `localhost:8080` |
| WeMonitor | 部署状态 + TCP 8080 健康检查 |

`ariang-proxy.py` 除了转发 RPC，还会在返回 `index.html` 时注入一小段启动脚本，把 AriaNg 的同源 RPC 配置（host / 端口 / 协议 / secret）自动对齐。没有这段注入时，AriaNg 默认会去连 `:6800`，而公网只暴露 8080，新设备打开会一直连不上。

---

## 部署与运维

改动 push 到 `master` 即自动发布：

```
push → GitHub Actions（打包 tar.gz → Release）→ webhook → N150 deploy-agent.sh → scripts/restart-n150.sh
```

`restart-n150.sh` 负责：复制 aria2 配置到 `~/.aria2/`、更新代理脚本到 `~/ariang-proxy.py`、重启 `ariang` 服务。

服务异常由 N150 上的 deploy-agent cron 每分钟健康检查自动恢复，**不要手动重启**。

---

## 相关文档

- [docs/需求文档.md](docs/需求文档.md)：背景、方案取舍、实施记录、阶段二规划
