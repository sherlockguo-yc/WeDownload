'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  view: 'tasks',
  tab: 'active',
  path: '',
  entries: [],
  taskSig: '',
  archivePath: '',
};

/* ---------------- 工具 ---------------- */

function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return n.toFixed(n < 10 ? 2 : 1) + ' ' + units[i];
}

function fmtEta(bytes, speed) {
  if (!speed) return '—';
  const sec = Math.round(bytes / speed);
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return sec + ' 秒';
  if (sec < 3600) return Math.floor(sec / 60) + ' 分';
  return Math.floor(sec / 3600) + ' 时 ' + Math.floor((sec % 3600) / 60) + ' 分';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function friendlyError(msg) {
  const m = String(msg || '');
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(m)) return '无法连接下载引擎，请确认 aria2 正在运行';
  if (/timed? ?out/i.test(m)) return '请求超时，请稍后重试';
  return m || '操作失败';
}

let toastTimer = 0;
function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

async function api(url, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  let data = {};
  try { data = await res.json(); } catch (_) { /* 非 JSON 响应 */ }
  if (!res.ok) throw new Error(data.error || ('请求失败 ' + res.status));
  return data;
}

function fileUrl(p, download) {
  return '/api/file?path=' + encodeURIComponent(p) + (download ? '&download=1' : '');
}

/* ---------------- 视图切换 ---------------- */

function switchView(view) {
  state.view = view;
  $('#view-tasks').hidden = view !== 'tasks';
  $('#view-files').hidden = view !== 'files';
  $$('.tabbar button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'files' && !state.entries.length) loadFiles(state.path);
}

/* ---------------- 任务 ---------------- */

function taskCard(t) {
  const pct = t.total ? Math.min(100, (t.done / t.total) * 100) : 0;
  const failed = t.status === 'error';
  const complete = t.status === 'complete' || t.status === 'removed';
  const barCls = failed ? 'fail' : complete ? 'done' : '';
  let sub = '';
  if (t.status === 'active') sub = `${fmtSize(t.done)} / ${fmtSize(t.total)} · ${fmtSpeed(t.speed)} · 剩 ${fmtEta(t.total - t.done, t.speed)}`;
  else if (failed) sub = t.error || '下载失败';
  else if (complete) sub = fmtSize(t.total);
  else sub = t.status === 'paused' ? '已暂停 · ' + fmtSize(t.done) : fmtSize(t.done);

  const buttons = [];
  if (t.status === 'active') buttons.push(`<button class="icon-btn" data-act="pause" title="暂停">⏸</button>`);
  if (t.status === 'paused' || t.status === 'waiting') buttons.push(`<button class="icon-btn" data-act="resume" title="继续">▶</button>`);
  if (t.status === 'active' || t.status === 'paused' || t.status === 'waiting') buttons.push(`<button class="icon-btn danger" data-act="remove" title="删除">✕</button>`);
  if (t.status === 'complete' || t.status === 'error' || t.status === 'removed') buttons.push(`<button class="icon-btn danger" data-act="forget" title="移除记录">✕</button>`);

  return `<div class="card" data-gid="${esc(t.gid)}">
    <div class="task-head">
      <span class="task-name">${esc(t.name || t.gid)}</span>
      <span class="task-meta">${pct.toFixed(0)}%</span>
    </div>
    <div class="bar ${barCls}"><i style="width:${pct}%"></i></div>
    <div class="task-foot">
      <span class="task-sub">${esc(sub)}</span>
      ${buttons.join('')}
    </div>
  </div>`;
}

function fmtSpeed(n) {
  return fmtSize(n) + '/s';
}

async function loadTasks() {
  const box = $('#taskList');
  let tasks = [];
  try {
    tasks = (await api('/api/tasks?type=' + state.tab)).tasks;
  } catch (e) {
    box.innerHTML = `<div class="empty">${esc(friendlyError(e.message))}</div>`;
    return;
  }
  if (!tasks.length) {
    state.taskSig = 'empty:' + state.tab;
    box.innerHTML = '<div class="empty">暂无任务</div>';
    return;
  }
  const sig = state.tab + '|' + tasks.map((t) => t.gid + ':' + t.status).join(',');
  if (sig !== state.taskSig) {
    state.taskSig = sig;
    box.innerHTML = tasks.map(taskCard).join('');
  } else {
    tasks.forEach((t) => {
      const el = box.querySelector(`[data-gid="${t.gid}"]`);
      if (!el) return;
      const pct = t.total ? Math.min(100, (t.done / t.total) * 100) : 0;
      el.querySelector('.bar > i').style.width = pct + '%';
      el.querySelector('.task-meta').textContent = pct.toFixed(0) + '%';
      const sub = el.querySelector('.task-sub');
      if (t.status === 'active') {
        sub.textContent = `${fmtSize(t.done)} / ${fmtSize(t.total)} · ${fmtSpeed(t.speed)} · 剩 ${fmtEta(t.total - t.done, t.speed)}`;
      }
    });
  }
}

async function loadStat() {
  try {
    const s = await api('/api/stat');
    const parts = [];
    if (s.downloadSpeed) parts.push('↓ ' + fmtSpeed(s.downloadSpeed));
    if (s.uploadSpeed) parts.push('↑ ' + fmtSpeed(s.uploadSpeed));
    if (s.numActive) parts.push(s.numActive + ' 个任务');
    $('#stat').textContent = parts.length ? parts.join(' · ') : '空闲';
  } catch (_) {
    $('#stat').textContent = '未连接';
  }
}

$('#taskList').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('[data-gid]');
  const gid = card.dataset.gid;
  const act = btn.dataset.act;
  if (act === 'remove' && !confirm('删除任务（已下载的文件会保留）？')) return;
  btn.disabled = true;
  try {
    await api('/api/task/action', { method: 'POST', body: { gid, action: act } });
    state.taskSig = '';
    loadTasks();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
  }
});

$$('.segment button').forEach((b) => {
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    state.taskSig = '';
    $$('.segment button').forEach((x) => x.classList.toggle('on', x === b));
    loadTasks();
  });
});

/* ---------------- 文件 ---------------- */

const ICONS = { dir: '📁', image: '🖼', audio: '🎵', video: '▶', archive: '🗜', pdf: '📕', text: '📄', file: '📄' };

function renderCrumbs(data) {
  const parts = data.path ? data.path.split('/') : [];
  const items = [`<a href="#" data-path="">下载目录</a>`];
  let acc = '';
  parts.forEach((p) => {
    acc = acc ? acc + '/' + p : p;
    items.push(`<span class="sep">/</span><a href="#" data-path="${esc(acc)}">${esc(p)}</a>`);
  });
  $('#crumbs').innerHTML = items.join(' ');
}

async function loadFiles(path) {
  const box = $('#fileList');
  let data;
  try {
    data = await api('/api/files?path=' + encodeURIComponent(path || ''));
  } catch (e) {
    box.innerHTML = `<div class="empty">${esc(friendlyError(e.message))}</div>`;
    return;
  }
  state.path = data.path;
  state.entries = data.entries;
  renderCrumbs(data);

  const rows = [];
  if (data.imageCount >= 2) {
    rows.push(`<div class="banner"><span>这个目录有 ${data.imageCount} 张图片</span><button id="readAll">开始阅读</button></div>`);
  }
  if (!data.entries.length) {
    rows.push('<div class="empty">这里还没有文件</div>');
  }
  data.entries.forEach((e) => {
    const full = data.path ? data.path + '/' + e.name : e.name;
    const size = e.type === 'dir' ? '' : fmtSize(e.size);
    rows.push(`<div class="row" data-kind="${e.kind}" data-path="${esc(full)}" data-name="${esc(e.name)}">
      <span class="ico">${ICONS[e.kind] || '📄'}</span>
      <span class="name">${esc(e.name)}</span>
      <span class="size">${size}</span>
      <button class="icon-btn danger" data-del="${esc(full)}" title="删除">✕</button>
    </div>`);
  });
  box.innerHTML = rows.join('');
}

$('#crumbs').addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-path]');
  if (!a) return;
  ev.preventDefault();
  loadFiles(a.dataset.path);
});

$('#fileList').addEventListener('click', async (ev) => {
  const del = ev.target.closest('button[data-del]');
  if (del) {
    ev.stopPropagation();
    const p = del.dataset.del;
    if (!confirm('确定删除「' + p.split('/').pop() + '」？此操作不可恢复。')) return;
    try {
      await api('/api/file/delete', { method: 'POST', body: { path: p } });
      toast('已删除');
      loadFiles(state.path);
    } catch (e) { toast(e.message); }
    return;
  }
  if (ev.target.id === 'readAll') {
    openReader();
    return;
  }
  const row = ev.target.closest('.row');
  if (!row) return;
  const kind = row.dataset.kind;
  const p = row.dataset.path;
  if (kind === 'dir') return loadFiles(p);
  if (kind === 'video' || kind === 'audio' || kind === 'image') return openPlayer(p, kind);
  if (kind === 'pdf') return openPlayer(p, 'pdf');
  if (kind === 'text') return openPlayer(p, 'text');
  if (kind === 'archive') return askExtract(p, row.dataset.name);
  window.location.href = fileUrl(p, true);
});

/* ---------------- 播放器 ---------------- */

function closeOverlays() {
  $('#player').hidden = true;
  $('#playerBody').innerHTML = '';
  $('#reader').hidden = true;
  $('#readerTrack').innerHTML = '';
}

function openPlayer(path, kind) {
  const name = path.split('/').pop();
  $('#playerName').textContent = name;
  const body = $('#playerBody');
  body.innerHTML = '';
  const url = fileUrl(path);

  if (kind === 'pdf') {
    window.open(url, '_blank');
    return;
  }
  if (kind === 'text') {
    fetch(url).then((r) => r.text()).then((txt) => {
      const pre = document.createElement('pre');
      pre.textContent = txt;
      body.appendChild(pre);
    }).catch((e) => toast(e.message));
  } else if (kind === 'image') {
    const img = document.createElement('img');
    img.src = url;
    body.appendChild(img);
  } else if (kind === 'audio') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = url;
    body.appendChild(audio);
    audio.play().catch(() => {});
  } else {
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.src = url;
    body.appendChild(video);
    video.play().catch(() => {});
  }
  $('#player').hidden = false;
}

/* ---------------- 漫画阅读器 ---------------- */

function openReader() {
  const images = state.entries.filter((e) => e.kind === 'image');
  if (!images.length) return;
  const track = $('#readerTrack');
  track.innerHTML = images.map((e) => {
    const full = state.path ? state.path + '/' + e.name : e.name;
    return `<div class="reader-slide"><img loading="lazy" src="${fileUrl(full)}" alt=""></div>`;
  }).join('');
  $('#readerPos').textContent = `1 / ${images.length}`;
  $('#reader').hidden = false;

  track.onscroll = () => {
    const idx = Math.round(track.scrollLeft / track.clientWidth);
    $('#readerPos').textContent = `${Math.min(images.length, idx + 1)} / ${images.length}`;
  };
}

/* ---------------- 解压 ---------------- */

function askExtract(path, name) {
  state.archivePath = path;
  $('#passTitle').textContent = '解压 ' + name;
  $('#passHint').textContent = '解压到同名目录。加密压缩包需要输入密码。';
  $('#passInput').value = sessionStorage.getItem('wd-pass:' + path) || '';
  $('#passSheet').hidden = false;
  setTimeout(() => $('#passInput').focus(), 100);
}

$('#submitPass').addEventListener('click', async () => {
  const btn = $('#submitPass');
  const pass = $('#passInput').value;
  btn.disabled = true;
  btn.textContent = '解压中…';
  try {
    const r = await api('/api/archive/extract', {
      method: 'POST',
      body: { path: state.archivePath, password: pass },
    });
    sessionStorage.setItem('wd-pass:' + state.archivePath, pass);
    $('#passSheet').hidden = true;
    toast('解压完成');
    switchView('files');
    loadFiles(r.path);
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    btn.disabled = false;
    btn.textContent = '解压';
  }
});

/* ---------------- 新建下载 ---------------- */

$('#addBtn').addEventListener('click', () => {
  $('#urlInput').value = '';
  $('#addSheet').hidden = false;
  setTimeout(() => $('#urlInput').focus(), 100);
});

$('#submitAdd').addEventListener('click', async () => {
  const text = $('#urlInput').value.trim();
  if (!text) return toast('请输入下载链接');
  const urls = text.split(/[\n\s]+/).map((s) => s.trim()).filter(Boolean);
  const btn = $('#submitAdd');
  btn.disabled = true;
  try {
    await api('/api/task/add', { method: 'POST', body: { urls } });
    $('#addSheet').hidden = true;
    switchView('tasks');
    state.tab = 'active';
    $$('.segment button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'active'));
    state.taskSig = '';
    loadTasks();
    toast('已加入下载队列');
  } catch (e) {
    toast(e.message, 3500);
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- 主题 ---------------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('wd-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f4f5f7' : '#0f1115';
}

$('#themeBtn').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

/* ---------------- 通用关闭 ---------------- */

$$('[data-close]').forEach((b) => b.addEventListener('click', () => {
  b.closest('.sheet, .overlay').hidden = true;
  closeOverlays();
}));

$$('.sheet').forEach((s) => s.addEventListener('click', (ev) => {
  if (ev.target === s) s.hidden = true;
}));

$$('.tabbar button[data-view]').forEach((b) => {
  b.addEventListener('click', () => switchView(b.dataset.view));
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    closeOverlays();
    $$('.sheet').forEach((s) => { s.hidden = true; });
  }
});

/* ---------------- 启动 ---------------- */

applyTheme(localStorage.getItem('wd-theme') || 'dark');
loadStat();
loadTasks();
setInterval(loadStat, 1000);
setInterval(() => {
  if (state.view === 'tasks') loadTasks();
}, 1200);
