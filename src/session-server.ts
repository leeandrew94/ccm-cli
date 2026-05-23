import { exec } from 'node:child_process';
import http from 'node:http';
import {
  deleteSession,
  getModelForSession,
  getSessionMessages,
  getSessionsList,
  getSessionTitle,
  resolveProfileName
} from './session-data.js';

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

function jsonResponse(res: http.ServerResponse, data: any, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function startSessionServer(port = 13501): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);

      if (req.method === 'GET' && (url.pathname === '/' || /^\/session\/[0-9a-f-]+$/.test(url.pathname))) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getHTML());
        return;
      }

      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        const sessions = getSessionsList();
        jsonResponse(res, sessions);
        return;
      }

      const sessionMatch = url.pathname.match(/^\/api\/session\/([0-9a-f-]+)$/);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];

        if (req.method === 'GET') {
          const messages = getSessionMessages(sessionId);
          const model = getModelForSession(sessionId);
          const profile = model ? resolveProfileName(model) : null;
          const restoreCmd = profile
            ? `ccm ${profile} --resume ${sessionId}`
            : `ccm <model> --resume ${sessionId}`;
          const title = getSessionTitle(sessionId);
          jsonResponse(res, { messages, model, profile, restoreCmd, title });
          return;
        }

        if (req.method === 'DELETE') {
          deleteSession(sessionId);
          jsonResponse(res, { ok: true });
          return;
        }
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`\n  ccm sessions web: ${url}\n`);
      openBrowser(url);
      resolve(server);
    });
  });
}

function getHTML(): string {
  const BT = String.fromCharCode(96); // backtick
  const jsCode = `
let sessions = [];
let currentSession = null;

async function loadSessions() {
  const res = await fetch('/api/sessions');
  sessions = await res.json();
  renderSessionList(sessions);
  const match = location.pathname.match(/\\/session\\/([0-9a-f-]+)/);
  if (match) selectSession(match[1], false);
}

window.addEventListener('popstate', function(e) {
  if (e.state && e.state.sessionId) selectSession(e.state.sessionId, false);
});

function renderSessionList(list) {
  const el = document.getElementById('sessionList');
  el.innerHTML = list.map((s, i) => {
    const date = new Date(s.timestamp);
    const time = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const active = currentSession === s.sessionId ? ' active' : '';
    return '<div class="session-item' + active + '" data-id="' + s.sessionId + '" onclick="selectSession(\\'' + s.sessionId + '\\')">' +
      '<div class="time">' + time + '</div>' +
      '<div class="question">' + escHtml(s.firstQuestion) + '</div>' +
      '</div>';
  }).join('');
}

async function selectSession(sessionId, pushState) {
  currentSession = sessionId;
  if (pushState !== false) history.pushState({ sessionId }, '', '/session/' + sessionId);
  renderSessionList(getFilteredList());
  const res = await fetch('/api/session/' + sessionId);
  const data = await res.json();
  const session = sessions.find(s => s.sessionId === sessionId);
  const date = session ? new Date(session.timestamp) : new Date();
  const dateStr = date.toLocaleString('zh-CN');
  const mainEl = document.getElementById('main');
  const questions = data.messages.filter(m => m.role === 'user');
  let html = '<div class="main-header">' +
    '<h1>' + escHtml(session?.firstQuestion || data.title || '无标题') + '</h1>' +
    '<div class="meta">' +
    '<span class="meta-date"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="3" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 1.5V3M9 1.5V3M1 6h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' + dateStr + '</span>' +
    (data.model ? '<span><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 3.5V6.5L8.5 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' + escHtml(data.model) + '</span>' : '') +
    '</div>' +
    '<div class="restore-bar">' +
    '<code>' + escHtml(data.restoreCmd) + '</code>' +
    '<button class="copy-btn" onclick="copyCmd()">复制</button>' +
    '</div></div>' +
    '<div class="messages" id="messages">';
  data.messages.forEach((m, i) => {
    const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
    if (m.role === 'user') {
      html += '<div class="message user" id="msg-' + i + '"><div class="avatar">U</div><div><div class="bubble">' + renderMarkdown(m.content) + '</div><div class="time">' + time + '</div></div></div>';
    } else {
      html += '<div class="message ai" id="msg-' + i + '"><div class="avatar">AI</div><div>' + (m.model ? '<div class="model-tag">' + escHtml(m.model) + '</div>' : '') + '<div class="bubble">' + renderMarkdown(m.content) + '</div><div class="time">' + time + '</div></div></div>';
    }
  });
  html += '<div class="message-count">共 ' + data.messages.length + ' 条消息</div></div>';
  mainEl.innerHTML = html;
  document.getElementById('indexPanel').style.display = '';
  const indexEl = document.getElementById('indexList');
  let idx = 0;
  indexEl.innerHTML = questions.map((q, i) => {
    const msgIdx = data.messages.indexOf(q);
    const text = q.content.length > 30 ? q.content.slice(0, 30) + '...' : q.content;
    return '<div class="index-item" data-msg="' + msgIdx + '" onclick="scrollToMsg(' + msgIdx + ')"><span class="num">' + (++idx) + '</span><span>' + escHtml(text) + '</span></div>';
  }).join('');
  window._restoreCmd = data.restoreCmd;
  setTimeout(() => {
    const msgsEl = document.getElementById('messages');
    if (!msgsEl) return;
    msgsEl.addEventListener('scroll', function() {
      var bar = document.getElementById('progressBar');
      if (!bar) return;
      var pct = msgsEl.scrollHeight > msgsEl.clientHeight ? (msgsEl.scrollTop / (msgsEl.scrollHeight - msgsEl.clientHeight)) * 100 : 0;
      bar.style.width = pct + '%';
    });
    var observer = new IntersectionObserver(function(entries) {
      for (var j = 0; j < entries.length; j++) {
        if (entries[j].isIntersecting) {
          var id = entries[j].target.id;
          var msgIdx = parseInt(id.replace('msg-', ''));
          document.querySelectorAll('.index-item').forEach(function(el) { el.classList.toggle('active', parseInt(el.dataset.msg) === msgIdx); });
        }
      }
    }, { root: msgsEl, threshold: 0.5 });
    document.querySelectorAll('.message').forEach(function(el) { observer.observe(el); });
  }, 100);
}

function scrollToMsg(idx) {
  var el = document.getElementById('msg-' + idx);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function copyCmd() {
  if (window._restoreCmd) { navigator.clipboard.writeText(window._restoreCmd); showToast('已复制: ' + window._restoreCmd); }
}

function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function() { el.classList.remove('show'); }, 2000);
}

function getFilteredList() {
  var q = document.getElementById('search').value.toLowerCase();
  if (!q) return sessions;
  return sessions.filter(function(s) { return s.firstQuestion.toLowerCase().includes(q) || s.projectName.toLowerCase().includes(q); });
}

document.getElementById('search').addEventListener('input', function() { renderSessionList(getFilteredList()); });

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  if (!text) return '';
  var h = escHtml(text);
  var BT = String.fromCharCode(96);
  h = h.replace(new RegExp(BT + BT + BT + '(\\\\w*)\\\\n([\\\\s\\\\S]*?)' + BT + BT + BT, 'g'), function(m, lang, code) { return '<pre><code>' + highlightCode(code) + '</code></pre>'; });
  h = h.replace(new RegExp(BT + '([^\\\\n]+?)' + BT, 'g'), '<code>$1</code>');
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
  h = h.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
  h = h.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  h = h.replace(/^---$/gm, '<hr>');
  h = h.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\\/li>)/s, '<ul>$1</ul>');
  h = h.replace(/^\\|(.+)\\|$/gm, function(m, content) {
    var cells = content.split('|').map(function(c) { return c.trim(); });
    if (cells.every(function(c) { return /^[-:]+$/.test(c); })) return '';
    return '<tr>' + cells.map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
  });
  h = h.replace(/(<tr>.*<\\/tr>)/gs, '<table>$1</table>');
  h = h.replace(/\\n\\n/g, '</p><p>');
  h = '<p>' + h + '</p>';
  h = h.replace(/<p><\\/p>/g, '');
  h = h.replace(/<p>(<h[123]>)/g, '$1');
  h = h.replace(/(<\\/h[123]>)<\\/p>/g, '$1');
  h = h.replace(/<p>(<pre>)/g, '$1');
  h = h.replace(/(<\\/pre>)<\\/p>/g, '$1');
  h = h.replace(/<p>(<table>)/g, '$1');
  h = h.replace(/(<\\/table>)<\\/p>/g, '$1');
  h = h.replace(/<p>(<ul>)/g, '$1');
  h = h.replace(/(<\\/ul>)<\\/p>/g, '$1');
  h = h.replace(/<p>(<blockquote>)/g, '$1');
  h = h.replace(/(<\\/blockquote>)<\\/p>/g, '$1');
  h = h.replace(/<p>(<hr>)/g, '$1');
  h = h.replace(/(<hr>)<\\/p>/g, '$1');
  return h;
}

function highlightCode(code) {
  var h = code;
  h = h.replace(/(\\/\\/.*$)/gm, '<span class="cm">$1</span>');
  h = h.replace(/(#.*$)/gm, '<span class="cm">$1</span>');
  h = h.replace(/("(?:[^"\\\\\\\\]|\\\\\\\\.)*"|'(?:[^'\\\\\\\\]|\\\\\\\\.)*')/g, '<span class="str">$1</span>');
  h = h.replace(/\\b(import|export|from|const|let|var|function|return|if|else|for|while|class|extends|new|async|await|try|catch|throw|switch|case|break|default|typeof|instanceof|void|null|undefined|true|false|def|self|print|raise|with|as|in|not|and|or|is|lambda|yield|assert|del|global|nonlocal|pass|elif|except|finally)\\b/g, '<span class="kw">$1</span>');
  h = h.replace(/\\b(\\d+\\.?\\d*)\\b/g, '<span class="num">$1</span>');
  return h;
}

loadSessions();`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ccm sessions</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
:root {
  --td-brand-color: #0052D9;
  --td-brand-color-hover: #266FE8;
  --td-brand-color-light: #ECF2FE;
  --td-success-color: #00A870;
  --td-warning-color: #ED7B2F;
  --td-error-color: #E34D59;
  --td-gray-1: #F3F3F3;
  --td-gray-2: #EEEEEE;
  --td-gray-3: #E7E7E7;
  --td-gray-4: #DCDCDC;
  --td-gray-6: #A6A6A6;
  --td-gray-8: #616161;
  --td-gray-10: #1A1A1A;
  --td-text-primary: #1A1A1A;
  --td-text-secondary: #4A4A4A;
  --td-text-placeholder: #A6A6A6;
  --td-bg-page: #F3F3F3;
  --td-bg-card: #FFFFFF;
  --td-border-level-1: #E7E7E7;
  --td-radius-small: 3px;
  --td-radius-default: 6px;
  --td-radius-large: 9px;
  --td-shadow-1: 0 1px 4px rgba(0,0,0,.08);
  --td-shadow-2: 0 4px 16px rgba(0,0,0,.10);
}
body {
  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
  font-size: 14px; line-height: 1.6;
  color: var(--td-text-primary); background: var(--td-bg-page);
  height: 100vh; overflow: hidden;
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--td-gray-4); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--td-gray-6); }

.app { display: grid; grid-template-columns: 280px 1fr 220px; height: 100vh; }

/* ─── Sidebar ─── */
.sidebar {
  background: var(--td-bg-card);
  border-right: 1px solid var(--td-border-level-1);
  display: flex; flex-direction: column; overflow: hidden;
}
.sidebar-header {
  padding: 16px; border-bottom: 1px solid var(--td-border-level-1);
}
.sidebar-header h2 {
  font-size: 15px; font-weight: 600; margin-bottom: 10px;
  color: var(--td-text-primary);
}
.sidebar-header input {
  width: 100%; padding: 8px 12px;
  border: 1px solid var(--td-border-level-1);
  border-radius: var(--td-radius-default);
  font-size: 13px; outline: none; color: var(--td-text-primary);
  transition: border-color .15s, box-shadow .15s;
}
.sidebar-header input::placeholder { color: var(--td-text-placeholder); }
.sidebar-header input:focus {
  border-color: var(--td-brand-color);
  box-shadow: 0 0 0 2px rgba(0,82,217,.12);
}
.session-list { flex: 1; overflow-y: auto; padding: 8px 0; }
.session-item {
  padding: 10px 16px; cursor: pointer;
  transition: background .15s;
  border-radius: 0;
  border-left: 3px solid transparent;
}
.session-item:hover { background: var(--td-brand-color-light); }
.session-item.active {
  background: var(--td-brand-color-light);
  border-left-color: var(--td-brand-color);
}
.session-item .time {
  font-size: 12px; font-weight: 700; color: var(--td-brand-color);
  text-transform: uppercase; letter-spacing: .06em;
  font-variant-numeric: tabular-nums;
}
.session-item .question {
  font-size: 13px;
  margin-top: 4px;
  color: var(--td-text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  line-height: 1.5;
}

/* ─── Progress bar ─── */
.progress-bar {
  position: fixed; top: 0; left: 0; height: 3px; width: 0;
  background: linear-gradient(90deg, var(--td-brand-color), #66B2FF);
  z-index: 100; transition: width .1s;
}

/* ─── Main ─── */
.main { display: flex; flex-direction: column; overflow: hidden; }
.main-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--td-border-level-1);
  background: var(--td-bg-card);
}
.main-header h1 {
  font-size: 16px; font-weight: 600; margin-bottom: 10px;
  line-height: 1.5; color: var(--td-text-primary);
}
.main-header .meta {
  display: flex; gap: 18px; font-size: 12px;
  color: var(--td-text-placeholder); flex-wrap: wrap;
}
.main-header .meta span {
  display: flex; align-items: center; gap: 5px;
}
.main-header .meta .meta-date {
  text-transform: uppercase; letter-spacing: .06em;
}
.main-header .meta svg { opacity: .7; }
.restore-bar {
  margin-top: 14px; display: flex; align-items: center; gap: 10px;
  background: var(--td-gray-1); padding: 10px 14px;
  border-radius: var(--td-radius-default);
  border: 1px solid var(--td-border-level-1);
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", Monaco, Consolas, monospace;
  font-size: 13px;
}
.restore-bar code { flex: 1; color: var(--td-text-secondary); }
.copy-btn {
  padding: 5px 14px; background: var(--td-brand-color); color: #fff;
  border: none; border-radius: var(--td-radius-small);
  cursor: pointer; font-size: 12px; font-weight: 500; white-space: nowrap;
  transition: background .15s;
}
.copy-btn:hover { background: var(--td-brand-color-hover); }

/* ─── Messages ─── */
.messages {
  flex: 1; overflow-y: auto; padding: 24px 16px;
  background: var(--td-bg-card);box-shadow: var(--td-shadow-1);
}
.message { margin-bottom: 20px; display: flex; gap: 10px; width: 100%; }
.message.user { flex-direction: row-reverse; justify-content: flex-start; }
.message.user > div:not(.avatar) { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-end; }
.message.user .bubble { max-width: 85%; }
.message .avatar {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; flex-shrink: 0;
}
.message.user .avatar {
  background: var(--td-brand-color); color: #fff;
}
.message.ai .avatar {
  background: #F6FFF9; color: var(--td-success-color);
  border: 1px solid #A3DFC5;
}
.message .bubble {
  max-width: 85%; padding: 12px 16px;
  border-radius: var(--td-radius-large);
  line-height: 1.7; font-size: 14px;
}
.message.user .bubble { background: var(--td-brand-color-light); color: var(--td-text-primary); }
.message.ai .bubble { background-color: var(--ai-bubble, #f5f7fa);}
.message .time {
  font-size: 11px; color: var(--td-text-placeholder); margin-top: 6px;
  font-variant-numeric: tabular-nums;
}
.message.user .time { text-align: right; }
.message .model-tag {
  font-size: 11px; color: var(--td-brand-color); margin-bottom: 6px;
  font-weight: 500;
}
.message-count {
  text-align: center; color: var(--td-text-placeholder);
  font-size: 12px; padding: 20px;
}

/* ─── Bubble content ─── */
.bubble h1, .bubble h2, .bubble h3 { margin: 16px 0 8px; font-weight: 600; color: var(--td-text-primary); }
.bubble h1 { font-size: 17px; }
.bubble h2 { font-size: 15px; }
.bubble h3 { font-size: 14px; }
.bubble p { margin-bottom: 10px; }
.bubble p:last-child { margin-bottom: 0; }
.bubble ul, .bubble ol { margin: 10px 0; padding-left: 22px; }
.bubble li { margin-bottom: 5px; line-height: 1.6; }
.bubble code {
  background: rgba(175,184,193,.25); color: #C7254E;
  padding: 2px 5px; border-radius: 3px;
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace; font-size: .86em;
}
.bubble pre {
  background: #F6F8FA; border: 1px solid #E1E4E8;
  padding: 16px 18px; border-radius: var(--td-radius-default);
  overflow-x: auto; margin: 12px 0;
  font-size: 13px; line-height: 1.7;
}
.bubble pre code {
  background: none; padding: 0; color: #24292E; font-size: 12.5px;
  border-radius: 0;
}
.bubble blockquote {
  border-left: 4px solid var(--td-brand-color);
  background: var(--td-brand-color-light);
  padding: 12px 16px; margin: 12px 0;
  border-radius: 0 var(--td-radius-default) var(--td-radius-default) 0;
  color: var(--td-text-secondary); font-size: 13.5px;
}
.bubble table { border-collapse: collapse; margin: 12px 0; width: 100%; font-size: 13px; }
.bubble th, .bubble td { border: 1px solid var(--td-border-level-1); padding: 8px 12px; text-align: left; }
.bubble th { background: var(--td-gray-1); font-weight: 600; color: var(--td-text-primary); }
.bubble td { color: var(--td-text-secondary); }
.bubble a { color: var(--td-brand-color); text-decoration: none; }
.bubble a:hover { text-decoration: underline; }
.bubble strong { font-weight: 600; color: var(--td-text-primary); }
.bubble em { font-style: italic; color: var(--td-brand-color); }
.bubble hr { border: none; border-top: 1px solid var(--td-border-level-1); margin: 16px 0; }

/* GitHub Light syntax colors */
.bubble pre .kw { color: #D73A49; font-weight: 600; }
.bubble pre .str { color: #032F62; }
.bubble pre .cm { color: #6A737D; font-style: italic; }
.bubble pre .fn { color: #6F42C1; }
.bubble pre .num { color: #005CC5; }
.bubble pre .keyword { color: #D73A49; font-weight: 600; }
.bubble pre .string { color: #032F62; }
.bubble pre .comment { color: #6A737D; font-style: italic; }
.bubble pre .number { color: #005CC5; }

/* ─── Index panel ─── */
.index {
  background: var(--td-bg-card);
  border-left: 1px solid var(--td-border-level-1);
  display: flex; flex-direction: column; overflow: hidden;
}
.index-header {
  padding: 14px 16px; border-bottom: 1px solid var(--td-border-level-1);
  font-size: 16px; font-weight: 700; color: var(--td-text-primary);
}
.index-list { flex: 1; overflow-y: auto; padding: 8px; }
.index-item {
  padding: 8px 10px; font-size: 12px; cursor: pointer;
  border-radius: var(--td-radius-small);
  color: var(--td-text-secondary); line-height: 1.5;
  transition: background .15s, color .15s;
  display: flex; gap: 8px;
}
.index-item:hover { background: var(--td-brand-color-light); color: var(--td-text-primary); }
.index-item.active {
  background: var(--td-brand-color-light);
  color: var(--td-brand-color); font-weight: 500;
}
.index-item .num {
  color: var(--td-text-placeholder); flex-shrink: 0; min-width: 18px;
  font-variant-numeric: tabular-nums;
}

/* ─── Empty state ─── */
.empty {
  display: flex; align-items: center; justify-content: center;
  height: 100%; color: var(--td-text-placeholder); font-size: 15px;
}
.welcome { text-align: center; }
.welcome h2 {
  font-size: 20px; margin-bottom: 8px; color: var(--td-text-primary);
  font-weight: 600;
}
.welcome p { font-size: 14px; color: var(--td-text-placeholder); }

/* ─── Toast ─── */
.toast {
  position: fixed; bottom: 40px; left: 50%;
  transform: translateX(-50%) translateY(8px);
  background: var(--td-gray-10); color: #fff;
  padding: 10px 24px; border-radius: var(--td-radius-large);
  font-size: 13px; opacity: 0;
  transition: opacity .25s, transform .25s;
  pointer-events: none; z-index: 100;
  box-shadow: var(--td-shadow-2);
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
</style>
</head>
<body>
<div class="progress-bar" id="progressBar"></div>
<div class="app">
  <div class="sidebar">
    <div class="sidebar-header">
      <h2>ccm sessions</h2>
      <input type="text" id="search" placeholder="搜索会话...">
    </div>
    <div class="session-list" id="sessionList"></div>
  </div>
  <div class="main" id="main">
    <div class="empty" id="emptyState">
      <div class="welcome">
        <h2>ccm sessions</h2>
        <p>选择左侧会话查看对话记录</p>
      </div>
    </div>
  </div>
  <div class="index" id="indexPanel" style="display:none">
    <div class="index-header">问题索引</div>
    <div class="index-list" id="indexList"></div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>${jsCode}</script>
</body>
</html>`;
}
