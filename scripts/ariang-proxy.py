import http.server, urllib.request, urllib.parse, json, os, sys, base64, mimetypes

ARIA2_RPC = 'http://localhost:6800/jsonrpc'
WEB_DIR = os.path.expanduser('~/AriaNg')
ARIA2_CONF = os.path.expanduser('~/.aria2/aria2.conf')
DOWNLOADS_DIR = os.path.realpath(os.path.expanduser('~/downloads'))
FALLBACK_SECRET = 'WeDownload2026!'

# AriaNg 在 localStorage 中以 base64 存储 RPC secret，注入时保持一致的编码方式
DEFAULTS = {
    'language': 'zh_Hans',
    'theme': 'light',
    'title': '${downspeed}, ${upspeed} - ${title}',
    'titleRefreshInterval': 5000,
    'browserNotification': False,
    'browserNotificationSound': True,
    'browserNotificationFrequency': 'unlimited',
    'rpcAlias': '',
    'rpcHost': '',
    'rpcPort': '',
    'rpcInterface': 'jsonrpc',
    'protocol': '',
    'httpMethod': 'POST',
    'rpcRequestHeaders': '',
    'secret': '',
    'extendRpcServers': [],
    'webSocketReconnectInterval': 5000,
    'globalStatRefreshInterval': 1000,
    'downloadTaskRefreshInterval': 1000,
    'keyboardShortcuts': True,
    'swipeGesture': True,
    'dragAndDropTasks': True,
    'rpcListDisplayOrder': 'recentlyUsed',
    'afterCreatingNewTask': 'task-list',
    'removeOldTaskAfterRetrying': False,
    'confirmTaskRemoval': True,
    'includePrefixWhenCopyingFromTaskDetails': True,
    'showPiecesInfoInTaskDetailPage': 'le10240',
    'afterRetryingTask': 'task-list-downloading',
    'taskListIndependentDisplayOrder': False,
    'displayOrder': 'default:asc',
    'waitingTaskListPageDisplayOrder': 'default:asc',
    'stoppedTaskListPageDisplayOrder': 'default:asc',
    'fileListDisplayOrder': 'default:asc',
    'peerListDisplayOrder': 'default:asc',
}

EXTRA_TYPES = {
    '.mkv': 'video/x-matroska',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.m4v': 'video/mp4',
    '.ts': 'video/mp2t',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.epub': 'application/epub+zip',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
    '.srt': 'text/plain; charset=utf-8',
    '.ass': 'text/plain; charset=utf-8',
    '.zip': 'application/zip',
    '.rar': 'application/vnd.rar',
    '.7z': 'application/x-7z-compressed',
}

MEDIA_TYPES = ('video/', 'audio/', 'image/', 'application/pdf')


def read_rpc_secret():
    """从 aria2 配置读取 RPC secret，保证前端与引擎始终一致。"""
    try:
        with open(ARIA2_CONF, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('rpc-secret'):
                    return line.split('=', 1)[1].strip()
    except OSError:
        pass
    return FALLBACK_SECRET


def build_inject():
    """
    AriaNg 内置默认 RPC 端口是 6800，而本服务是在 8080 上同源代理 /jsonrpc，
    新设备首次打开时因此连不上引擎；默认 secret 也为空。
    这里在 AriaNg 初始化前把 localStorage 里的同源配置协商成
    「当前页面 host + 当前端口 + base64 secret」，使其开箱即用。
    已存在配置时只改这四项，保留用户的主题、语言等偏好；
    若 rpcHost 指向别处（远程 aria2），则完全不干预。
    """
    opts = dict(DEFAULTS)
    opts['secret'] = base64.b64encode(read_rpc_secret().encode('utf-8')).decode('ascii')
    return (
        '<script>(function(){try{'
        'var K="AriaNg.Options";'
        'var host=location.hostname,port=location.port||"",'
        'proto=location.protocol.replace(":","");'
        'var d=' + json.dumps(opts, ensure_ascii=False) + ';'
        'd.rpcHost=host;d.rpcPort=port;d.protocol=proto;'
        'var raw=localStorage.getItem(K);'
        'if(!raw){localStorage.setItem(K,JSON.stringify(d));return;}'
        'var o=JSON.parse(raw);'
        'if(o.rpcHost===host){o.rpcHost=host;o.rpcPort=port;o.protocol=proto;o.secret=d.secret;'
        'localStorage.setItem(K,JSON.stringify(o));}'
        '}catch(e){}})();</script>'
    )


def guess_type(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in EXTRA_TYPES:
        return EXTRA_TYPES[ext]
    ctype, _ = mimetypes.guess_type(path)
    return ctype or 'application/octet-stream'


FILES_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#14161a">
<title>文件 - WeDownload</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:#14161a;color:#e6e8eb;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
header{position:sticky;top:0;background:#1c1f24;border-bottom:1px solid #2a2f36;padding:12px 16px;display:flex;gap:12px;align-items:center;z-index:2}
header a{color:#8ab4f8;text-decoration:none;font-size:14px;flex:none}
h1{font-size:15px;margin:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#path{font-size:12px;color:#8b949e;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
main{padding:8px 0 40px}
.row{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid #22262c;text-decoration:none;color:inherit}
.row:active{background:#1f242b}
.ico{width:28px;text-align:center;font-size:17px;flex:none;opacity:.9}
.name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{font-size:12px;color:#8b949e;flex:none}
.empty{padding:60px 16px;text-align:center;color:#8b949e}
#player{position:fixed;inset:0;background:#000;display:none;flex-direction:column;z-index:10}
#player.on{display:flex}
#player .bar{padding:10px 14px;background:#101215;color:#e6e8eb;display:flex;justify-content:space-between;align-items:center;font-size:13px;gap:10px}
#player .bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#player .bar button{background:#2a2f36;color:#e6e8eb;border:0;border-radius:6px;padding:6px 12px;font-size:13px}
#player .body{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto}
#player video,#player img{max-width:100%;max-height:100%}
#player audio{width:90%}
</style>
</head>
<body>
<header>
  <a href="/">← AriaNg</a>
  <div style="min-width:0">
    <h1 id="title">下载目录</h1>
    <div id="path"></div>
  </div>
</header>
<main id="list"><div class="empty">加载中…</div></main>
<div id="player">
  <div class="bar"><span id="pname"></span><button onclick="closePlayer()">关闭</button></div>
  <div class="body" id="pbody"></div>
</div>
<script>
var cur = new URLSearchParams(location.search).get('path') || '';

function fmt(n){
  if(n < 1024) return n + ' B';
  var u = ['KB','MB','GB','TB'], i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n < 10 ? 2 : 1) + ' ' + u[i];
}
function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function joinPath(dir, name){
  return dir ? dir.replace(/\\/$/,'') + '/' + name : name;
}
function rawUrl(p, download){
  return '/files/raw?path=' + encodeURIComponent(p) + (download ? '&download=1' : '');
}

function render(data){
  var list = document.getElementById('list');
  document.getElementById('path').textContent = '/' + (data.path || '');
  document.getElementById('title').textContent = data.path ? data.path.split('/').pop() : '下载目录';
  var rows = [];
  if (data.path) {
    rows.push('<a class="row" href="?path=' + encodeURIComponent(data.parent) + '">' +
      '<span class="ico">↩</span><span class="name">返回上级</span></a>');
  }
  if (!data.entries.length) {
    rows.push('<div class="empty">这里还没有文件</div>');
  }
  data.entries.forEach(function(e){
    var meta = e.type === 'dir' ? '' : fmt(e.size);
    var icon = e.type === 'dir' ? '📁' : (e.media ? '▶' : '📄');
    var href = e.type === 'dir'
      ? '?path=' + encodeURIComponent(joinPath(data.path, e.name))
      : rawUrl(joinPath(data.path, e.name), false);
    rows.push('<a class="row" href="' + href + '" data-kind="' + (e.type === 'dir' ? 'dir' : (e.media ? 'media' : 'file')) +
      '" data-path="' + esc(joinPath(data.path, e.name)) + '">' +
      '<span class="ico">' + icon + '</span>' +
      '<span class="name">' + esc(e.name) + '</span>' +
      '<span class="meta">' + meta + '</span></a>');
  });
  list.innerHTML = rows.join('');

  list.querySelectorAll('a[data-kind="media"]').forEach(function(a){
    a.addEventListener('click', function(ev){
      ev.preventDefault();
      openPlayer(a.dataset.path);
    });
  });
}

function openPlayer(path){
  var name = path.split('/').pop();
  var url = rawUrl(path, false);
  var ext = name.split('.').pop().toLowerCase();
  var body = document.getElementById('pbody');
  var el;
  if (['jpg','jpeg','png','gif','webp','bmp'].indexOf(ext) >= 0) {
    el = document.createElement('img');
  } else if (['mp3','m4a','flac','ogg','wav'].indexOf(ext) >= 0) {
    el = document.createElement('audio');
    el.controls = true;
  } else {
    el = document.createElement('video');
    el.controls = true;
    el.playsInline = true;
  }
  el.src = url;
  body.innerHTML = '';
  body.appendChild(el);
  document.getElementById('pname').textContent = name;
  document.getElementById('player').classList.add('on');
}

function closePlayer(){
  document.getElementById('pbody').innerHTML = '';
  document.getElementById('player').classList.remove('on');
}

fetch('/files/list?path=' + encodeURIComponent(cur))
  .then(function(r){ return r.json(); })
  .then(render)
  .catch(function(){
    document.getElementById('list').innerHTML = '<div class="empty">目录读取失败</div>';
  });
</script>
</body>
</html>
"""


class Proxy(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    # ---------- 路由 ----------

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path in ('/', '/index.html'):
            self.serve_index()
        elif path in ('/files', '/files/'):
            self.serve_files_page()
        elif path == '/files/list':
            self.serve_files_list()
        elif path == '/files/raw':
            self.serve_file_raw(head_only=False)
        else:
            super().do_GET()

    def do_HEAD(self):
        if urllib.parse.urlsplit(self.path).path == '/files/raw':
            self.serve_file_raw(head_only=True)
        else:
            super().do_HEAD()

    # ---------- AriaNg ----------

    def serve_index(self):
        index = os.path.join(WEB_DIR, 'index.html')
        try:
            with open(index, 'r', encoding='utf-8') as f:
                html = f.read()
        except OSError:
            self.send_error(404)
            return
        # 注入点必须在 AriaNg 的 JS 之前执行，才能影响它读取配置
        html = html.replace('</head>', INJECT + '</head>', 1)
        self.send_page(html)

    # ---------- 文件服务 ----------

    def resolve_path(self, rel):
        """把相对路径限定在下载目录内，拒绝 ../ 穿越和符号链接逃逸。"""
        rel = (rel or '').lstrip('/')
        target = os.path.realpath(os.path.join(DOWNLOADS_DIR, rel))
        if target != DOWNLOADS_DIR and not target.startswith(DOWNLOADS_DIR + os.sep):
            return None
        return target

    def serve_files_page(self):
        self.send_page(FILES_HTML)

    def send_page(self, html):
        body = html.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.end_headers()
        self.wfile.write(body)

    def serve_files_list(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        rel = qs.get('path', [''])[0].strip('/')
        target = self.resolve_path(rel)
        if not target or not os.path.isdir(target):
            self.send_json({'error': 'not found'}, 404)
            return
        entries = []
        try:
            for name in os.listdir(target):
                if name.startswith('.'):
                    continue
                full = os.path.join(target, name)
                # 只列出真实位于下载目录内的条目，避免符号链接把外部路径带到列表里
                if self.resolve_path(os.path.relpath(full, DOWNLOADS_DIR)) is None:
                    continue
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                if os.path.isdir(full):
                    entries.append({'name': name, 'type': 'dir', 'size': 0})
                else:
                    entries.append({
                        'name': name,
                        'type': 'file',
                        'size': st.st_size,
                        'media': guess_type(name).startswith(MEDIA_TYPES),
                    })
        except OSError:
            self.send_json({'error': 'cannot read dir'}, 500)
            return
        entries.sort(key=lambda e: (e['type'] != 'dir', e['name'].lower()))
        parent = os.path.dirname(rel) if rel else ''
        self.send_json({'path': rel, 'parent': parent, 'entries': entries})

    def serve_file_raw(self, head_only):
        qs = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        rel = qs.get('path', [''])[0]
        force_download = qs.get('download', ['0'])[0] == '1'
        target = self.resolve_path(rel)
        if not target or not os.path.isfile(target):
            self.send_error(404)
            return

        size = os.path.getsize(target)
        ctype = guess_type(target)
        start, end, partial = 0, size - 1, False

        rng = self.headers.get('Range')
        if rng and rng.startswith('bytes='):
            spec = rng[6:].split(',')[0].strip()
            if '-' in spec:
                a, b = spec.split('-', 1)
                try:
                    if a == '':
                        n = int(b)
                        start = max(0, size - n)
                    else:
                        start = int(a)
                        end = int(b) if b else size - 1
                except ValueError:
                    self.send_error(400)
                    return
                if start >= size or start > end:
                    self.send_response(416)
                    self.send_header('Content-Range', 'bytes */%d' % size)
                    self.end_headers()
                    return
                end = min(end, size - 1)
                partial = True

        length = end - start + 1
        is_media = ctype.startswith(MEDIA_TYPES) and not force_download
        disp = 'inline' if is_media else 'attachment'
        filename = os.path.basename(target)

        self.send_response(206 if partial else 200)
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(length))
        if partial:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Disposition',
                         "%s; filename*=UTF-8''%s" % (disp, urllib.parse.quote(filename)))
        self.end_headers()

        if head_only:
            return
        try:
            with open(target, 'rb') as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(262144, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    # ---------- RPC 转发 ----------

    def do_POST(self):
        if self.path.startswith('/jsonrpc'):
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            req = urllib.request.Request(ARIA2_RPC, data=body,
                headers={'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                    self.send_response(resp.status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                self.send_error(502, str(e))
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


INJECT = build_inject()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 6801
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Proxy)
    print(f'AriaNg proxy + file server on port {port}')
    server.serve_forever()
