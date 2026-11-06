'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8080);
const HOME = os.homedir();
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const ARIANG_DIR = path.join(HOME, 'AriaNg');
const ARIA2_RPC = process.env.ARIA2_RPC || 'http://127.0.0.1:6800/jsonrpc';
const ARIA2_CONF = path.join(HOME, '.aria2', 'aria2.conf');
const DOWNLOADS_DIR = path.resolve(process.env.DOWNLOADS_DIR || path.join(HOME, 'downloads'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ts': 'video/mp2t',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.ass': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
};

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const AUDIO_EXT = ['.mp3', '.m4a', '.flac', '.ogg', '.wav'];
const VIDEO_EXT = ['.mp4', '.webm', '.mkv', '.mov', '.m4v'];
const ARCHIVE_EXT = ['.zip', '.rar', '.7z'];
const TEXT_EXT = ['.txt', '.md', '.srt', '.vtt', '.ass', '.json', '.log'];

function readSecret() {
  try {
    const lines = fs.readFileSync(ARIA2_CONF, 'utf8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('rpc-secret')) return t.split('=').slice(1).join('=').trim();
    }
  } catch (_) { /* 配置缺失时用兜底值 */ }
  return 'WeDownload2026!';
}
const RPC_SECRET = readSecret();

function mimeOf(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

function kindOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (ARCHIVE_EXT.includes(ext)) return 'archive';
  if (ext === '.pdf') return 'pdf';
  if (TEXT_EXT.includes(ext)) return 'text';
  return 'file';
}

/** 把相对路径限制在下载目录内，拒绝 ../ 与指向外部的符号链接 */
function safePath(rel) {
  const cleaned = String(rel || '').replace(/^\/+/, '');
  const target = path.resolve(DOWNLOADS_DIR, cleaned);
  if (target !== DOWNLOADS_DIR && !target.startsWith(DOWNLOADS_DIR + path.sep)) return null;
  try {
    const real = fs.realpathSync(target);
    if (real !== DOWNLOADS_DIR && !real.startsWith(DOWNLOADS_DIR + path.sep)) return null;
    return real;
  } catch (_) {
    return target;
  }
}

async function rpc(method, params = []) {
  const res = await fetch(ARIA2_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'wedownload',
      method,
      params: [`token:${RPC_SECRET}`, ...params],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'aria2 rpc error');
  return data.result;
}

const TASK_KEYS = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed',
  'uploadSpeed', 'connections', 'numSeeders', 'seeder', 'errorMessage', 'files', 'dir'];

function shapeTask(t) {
  const f = (t.files && t.files[0]) || {};
  const name = f.path ? path.basename(f.path) : (t.gid || '');
  return {
    gid: t.gid,
    status: t.status,
    name,
    path: f.path || '',
    total: Number(t.totalLength || 0),
    done: Number(t.completedLength || 0),
    speed: Number(t.downloadSpeed || 0),
    connections: Number(t.connections || 0),
    error: t.errorMessage || '',
  };
}

/* ---------------- 正文读取 ---------------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 1024 * 100) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/* ---------------- 静态与文件 ---------------- */

function serveStatic(res, filePath, req) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    res.writeHead(200, {
      'Content-Type': mimeOf(filePath),
      'Content-Length': st.size,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

/** 带 Range 的文件输出，视频拖动依赖它 */
function serveFile(req, res, filePath, { download = false, inlineOk = true } = {}) {
  let st;
  try { st = fs.statSync(filePath); } catch (_) {
    res.writeHead(404); return res.end('Not Found');
  }
  if (!st.isFile()) { res.writeHead(404); return res.end('Not Found'); }

  const size = st.size;
  const type = mimeOf(filePath);
  let start = 0;
  let end = size - 1;
  let partial = false;

  const range = req.headers.range;
  if (range && range.startsWith('bytes=')) {
    const spec = range.slice(6).split(',')[0].trim();
    const [a, b] = spec.split('-');
    if (a === '') {
      const n = Number(b);
      if (Number.isFinite(n)) { start = Math.max(0, size - n); }
    } else {
      start = Number(a);
      end = b ? Number(b) : size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    end = Math.min(end, size - 1);
    partial = true;
  }

  const length = end - start + 1;
  const name = path.basename(filePath);
  const disp = (download || !inlineOk) ? 'attachment' : 'inline';

  const headers = {
    'Content-Type': type,
    'Content-Length': length,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `${disp}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-cache',
  };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;

  res.writeHead(partial ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();

  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

/* ---------------- 压缩包 ---------------- */

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || stdout || err.message || '').toString().trim().slice(0, 400)));
        resolve((stdout || '').toString());
      });
  });
}

function hasCmd(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  return dirs.some((d) => {
    try { return fs.existsSync(path.join(d, cmd)); } catch (_) { return false; }
  });
}

async function extractArchive(filePath, password, outDir) {
  const ext = path.extname(filePath).toLowerCase();
  const pass = password || '';
  const has7z = hasCmd('7z') || hasCmd('7za');

  if (ext === '.7z' || (has7z && ext === '.rar')) {
    const bin = hasCmd('7z') ? '7z' : '7za';
    const args = ['x', '-y', `-o${outDir}`];
    if (pass) args.push(`-p${pass}`);
    args.push(filePath);
    return run(bin, args);
  }
  if (ext === '.zip') {
    // 不加 -q，否则 unzip 在密码错误时不输出原因
    const args = ['-o'];
    if (pass) args.push('-P', pass);
    args.push(filePath, '-d', outDir);
    return run('unzip', args);
  }
  if (ext === '.rar') {
    const args = ['x', '-o+', '-idq'];
    if (pass) args.push(`-p${pass}`);
    else args.push('-p-');
    // unrar 的最后一个参数是目标目录（必须以 / 结尾）
    args.push(filePath, outDir.endsWith(path.sep) ? outDir : outDir + path.sep);
    return run('unrar', args);
  }
  throw new Error('不支持的压缩格式');
}

/* ---------------- 路由 ---------------- */

async function handleApi(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  try {
    if (p === '/api/stat') {
      const stat = await rpc('aria2.getGlobalStat');
      return sendJson(res, 200, {
        downloadSpeed: Number(stat.downloadSpeed || 0),
        uploadSpeed: Number(stat.uploadSpeed || 0),
        numActive: Number(stat.numActive || 0),
        numWaiting: Number(stat.numWaiting || 0),
        numStopped: Number(stat.numStopped || 0),
      });
    }

    if (p === '/api/tasks') {
      const type = q.get('type') || 'active';
      let tasks = [];
      if (type === 'active') tasks = await rpc('aria2.tellActive', [TASK_KEYS]);
      else if (type === 'waiting') tasks = await rpc('aria2.tellWaiting', [0, 100, TASK_KEYS]);
      else tasks = await rpc('aria2.tellStopped', [0, 100, TASK_KEYS]);
      return sendJson(res, 200, { tasks: tasks.map(shapeTask) });
    }

    if (p === '/api/task/add' && req.method === 'POST') {
      const body = await readBody(req);
      const urls = (body.urls || []).map((u) => String(u).trim()).filter(Boolean);
      if (!urls.length) return sendJson(res, 400, { error: '没有有效链接' });
      const gids = [];
      for (const u of urls) gids.push(await rpc('aria2.addUri', [[u]]));
      return sendJson(res, 200, { gids });
    }

    if (p === '/api/task/action' && req.method === 'POST') {
      const body = await readBody(req);
      const { gid, action } = body;
      if (!gid || !action) return sendJson(res, 400, { error: 'missing gid/action' });
      const map = {
        pause: 'aria2.pause',
        resume: 'aria2.unpause',
        remove: 'aria2.remove',
        forget: 'aria2.removeDownloadResult',
      };
      if (!map[action]) return sendJson(res, 400, { error: 'unknown action' });
      try {
        await rpc(map[action], [gid]);
      } catch (e) {
        if (action === 'resume') await rpc('aria2.unpause', [gid]);
        else throw e;
      }
      await rpc('aria2.saveSession').catch(() => {});
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/task/clear' && req.method === 'POST') {
      await rpc('aria2.purgeDownloadResult');
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/files') {
      const rel = q.get('path') || '';
      const dir = safePath(rel);
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return sendJson(res, 404, { error: '目录不存在' });
      }
      const entries = [];
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('.')) continue;
        const full = path.join(dir, name);
        const checked = safePath(path.relative(DOWNLOADS_DIR, full));
        if (!checked) continue;
        let st;
        try { st = fs.statSync(full); } catch (_) { continue; }
        const isDir = st.isDirectory();
        entries.push({
          name,
          type: isDir ? 'dir' : 'file',
          size: isDir ? 0 : st.size,
          mtime: st.mtimeMs,
          kind: isDir ? 'dir' : kindOf(name),
        });
      }
      entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh') : a.type === 'dir' ? -1 : 1));
      const relOut = path.relative(DOWNLOADS_DIR, dir);
      const parentRel = relOut ? path.dirname(relOut) : '';
      // 图片序列自动识别（漫画阅读）
      const imgs = entries.filter((e) => e.kind === 'image').length;
      return sendJson(res, 200, {
        path: relOut,
        parent: parentRel === '.' ? '' : parentRel,
        entries,
        imageCount: imgs,
      });
    }

    if (p === '/api/file') {
      const file = safePath(q.get('path') || '');
      if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not Found'); }
      const download = q.get('download') === '1';
      const kind = kindOf(file);
      const inlineOk = ['image', 'audio', 'video', 'pdf', 'text'].includes(kind);
      return serveFile(req, res, file, { download, inlineOk });
    }

    if (p === '/api/file/delete' && req.method === 'POST') {
      const body = await readBody(req);
      const target = safePath(body.path || '');
      if (!target || target === DOWNLOADS_DIR) return sendJson(res, 400, { error: '非法路径' });
      if (!fs.existsSync(target)) return sendJson(res, 404, { error: '不存在' });
      await fsp.rm(target, { recursive: true, force: true });
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/archive/extract' && req.method === 'POST') {
      const body = await readBody(req);
      const file = safePath(body.path || '');
      if (!file || !fs.existsSync(file)) return sendJson(res, 404, { error: '文件不存在' });
      if (!ARCHIVE_EXT.includes(path.extname(file).toLowerCase())) {
        return sendJson(res, 400, { error: '不是压缩包' });
      }
      const ext = path.extname(file);
      const outDir = path.join(path.dirname(file), path.basename(file, ext));
      if (!safePath(path.relative(DOWNLOADS_DIR, outDir))) {
        return sendJson(res, 400, { error: '非法目标路径' });
      }
      await fsp.mkdir(outDir, { recursive: true });
      try {
        await extractArchive(file, body.password || '', outDir);
      } catch (e) {
        const raw = String(e.message || '');
        let msg = '解压失败，可能是密码错误或文件已损坏';
        if (/password|encrypted/i.test(raw)) msg = '密码错误，请重试';
        else if (/not supported|不支持/.test(raw)) msg = raw;
        else if (/No space|ENOSPC/i.test(raw)) msg = '磁盘空间不足';
        return sendJson(res, 400, { error: msg });
      }
      // 解压后若只有一个子目录，自动下沉一层，免得用户多点一次
      let rel = path.relative(DOWNLOADS_DIR, outDir);
      try {
        const kids = fs.readdirSync(outDir).filter((n) => !n.startsWith('.'));
        if (kids.length === 1) {
          const only = path.join(outDir, kids[0]);
          if (fs.statSync(only).isDirectory()) rel = path.relative(DOWNLOADS_DIR, only);
        }
      } catch (_) { /* ignore */ }
      return sendJson(res, 200, { ok: true, path: rel });
    }

    return sendJson(res, 404, { error: 'unknown api' });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'internal error' });
  }
}

async function handleRpc(req, res) {
  let buf = '';
  req.on('data', (c) => { buf += c; });
  req.on('end', async () => {
    try {
      const r = await fetch(ARIA2_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buf,
      });
      const data = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': data.length,
      });
      res.end(data);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (p.startsWith('/api/')) return handleApi(req, res, url);
  if (p === '/jsonrpc') return handleRpc(req, res);

  // AriaNg 保留为备用入口，方便对照原界面
  if (p === '/ariang' || p === '/ariang/') {
    return serveStatic(res, path.join(ARIANG_DIR, 'index.html'), req);
  }
  if (p.startsWith('/ariang/')) {
    return serveStatic(res, path.join(ARIANG_DIR, p.slice('/ariang/'.length)), req);
  }

  if (p === '/' || p === '/index.html') {
    return serveStatic(res, path.join(PUBLIC_DIR, 'index.html'), req);
  }
  return serveStatic(res, path.join(PUBLIC_DIR, p.replace(/^\/+/, '')), req);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`WeDownload web on 127.0.0.1:${PORT}, downloads=${DOWNLOADS_DIR}`);
});
