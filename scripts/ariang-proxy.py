import http.server, urllib.request, json, os, sys, base64

ARIA2_RPC = 'http://localhost:6800/jsonrpc'
WEB_DIR = os.path.expanduser('~/AriaNg')
ARIA2_CONF = os.path.expanduser('~/.aria2/aria2.conf')
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


INJECT = build_inject()


class Proxy(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        if self.path.split('?', 1)[0] in ('/', '/index.html'):
            self.serve_index()
        else:
            super().do_GET()

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
        body = html.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.end_headers()
        self.wfile.write(body)

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

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 6801
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Proxy)
    print(f'AriaNg proxy on port {port}')
    server.serve_forever()
