/* ===== net.js — 連線層：WebSocket、斷線重連、喚醒冷啟動的伺服器 =====
 * 伺服器位置只從 Config（config.js）拿，這裡不寫死任何網址。
 */
(function (root) {
  'use strict';

  const KEY_STORE = 'richman-key';
  let ws = null;
  let status = 'idle';            /* idle | waking | connecting | open | retrying | offline | unset */
  let retry = 0, retryTimer = 0, wantOpen = false;
  let hello = { name: '', char: 'otter' };
  const handlers = {};
  const statusListeners = [];

  function key() {
    let k = null;
    try { k = localStorage.getItem(KEY_STORE); } catch (e) { k = null; }
    if (!k) {
      k = 'k' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem(KEY_STORE, k); } catch (e) { /* 無痕模式：這次連線有效就好 */ }
    }
    return k;
  }

  function setStatus(s, detail) {
    status = s;
    statusListeners.forEach(fn => fn(s, detail));
  }

  function wsUrl(base) {
    const u = new URL(base);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = u.pathname.replace(/\/+$/, '') + '/ws';
    return u.toString();
  }

  /** 先打 /health：Render 免費方案休眠時要 30～60 秒才醒，這段時間顯示喚醒動畫 */
  async function wake(base) {
    const started = Date.now();
    for (let i = 0; wantOpen; i++) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(base + '/health', { cache: 'no-store', signal: ctl.signal });
        clearTimeout(t);
        if (r.ok) return true;
      } catch (e) { /* 還在睡 */ }
      if (Date.now() - started > 90000) return false;
      setStatus('waking', Math.round((Date.now() - started) / 1000));
      await new Promise(res => setTimeout(res, 2500));
    }
    return false;
  }

  async function open(profile) {
    if (profile) hello = profile;
    wantOpen = true;
    const cfg = root.Config;
    if (!cfg || cfg.status !== 'ok' || !cfg.serverUrl) {
      setStatus('unset', cfg && cfg.error);
      return;
    }
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    setStatus('connecting');
    const ok = await wake(cfg.serverUrl);
    if (!wantOpen) return;
    if (!ok) { setStatus('offline'); scheduleRetry(); return; }
    connect(cfg.serverUrl);
  }

  function connect(base) {
    try { ws = new WebSocket(wsUrl(base)); } catch (e) { setStatus('offline'); scheduleRetry(); return; }
    const me = ws;
    ws.onopen = () => {
      retry = 0;
      me.send(JSON.stringify({ type: 'hello', key: key(), name: hello.name, char: hello.char }));
      setStatus('open');
    };
    ws.onmessage = e => {
      let msg = null;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type === 'welcome' && msg.key) { try { localStorage.setItem(KEY_STORE, msg.key); } catch (err) { /* 忽略 */ } }
      if (msg.type === 'replaced') { wantOpen = false; }
      (handlers[msg.type] || []).forEach(fn => fn(msg));
      (handlers['*'] || []).forEach(fn => fn(msg));
    };
    ws.onclose = () => {
      if (ws !== me) return;
      ws = null;
      if (wantOpen) { setStatus('retrying'); scheduleRetry(); } else setStatus('idle');
    };
    ws.onerror = () => { /* onclose 會接手 */ };
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (!wantOpen) return;
    const wait = Math.min(8000, 600 * Math.pow(1.6, retry++));
    retryTimer = setTimeout(() => { if (wantOpen) open(); }, wait);
  }

  function close() {
    wantOpen = false;
    clearTimeout(retryTimer);
    if (ws) { const w = ws; ws = null; try { w.close(); } catch (e) { /* 忽略 */ } }
    setStatus('idle');
  }

  function send(msg) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
    return false;
  }

  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
  function onStatus(fn) { statusListeners.push(fn); }

  root.Net = {
    open, close, send, on, onStatus, key,
    get status() { return status; },
    get connected() { return !!(ws && ws.readyState === 1); },
    setProfile(p) { hello = p; }
  };
})(typeof self !== 'undefined' ? self : this);
