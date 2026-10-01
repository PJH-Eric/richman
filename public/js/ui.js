/* ===== ui.js — 共用介面零件：畫面切換、Modal、提示、設定彈窗、聊天室、暱稱 ===== */
(function (root) {
  'use strict';

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 畫面切換 ---------- */

  let current = 'home';
  const listeners = [];
  function show(name) {
    $$('.screen').forEach(s => { s.hidden = s.dataset.screen !== name; });
    current = name;
    document.body.dataset.screen = name;
    const lobbyLink = $('#lobby-home-link');
    if (lobbyLink) lobbyLink.hidden = name !== 'home';
    listeners.forEach(fn => fn(name));
    const h = $('.screen:not([hidden]) h2, .screen:not([hidden]) h1');
    if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { /* 舊瀏覽器 */ } }
  }
  function onShow(fn) { listeners.push(fn); }

  /* ---------- Modal：遮罩、焦點鎖定、Esc／返回鍵關閉、關閉後焦點回原處 ---------- */

  const stack = [];
  function modal(el, opt) {
    opt = opt || {};
    let lastFocus = null;
    const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
    const items = () => $$(FOCUSABLE, el).filter(n => n.offsetParent !== null);

    function onKey(e) {
      if (stack[stack.length - 1] !== api) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function open(from) {
      if (!el.hidden) return;
      lastFocus = from || document.activeElement;
      el.hidden = false;
      stack.push(api);
      document.addEventListener('keydown', onKey, true);
      const list = items();
      if (list.length) list[0].focus();
      if (opt.onOpen) opt.onOpen();
    }
    function close() {
      if (el.hidden) return;
      el.hidden = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      document.removeEventListener('keydown', onKey, true);
      if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
      if (opt.onClose) opt.onClose();
    }
    el.addEventListener('click', e => {
      if (e.target === el || e.target.closest('[data-close]')) close();
    });
    const api = { open, close, get isOpen() { return !el.hidden; } };
    return api;
  }
  function anyModalOpen() { return stack.length > 0; }

  /* ---------- 提示 ---------- */

  function toast(text, kind) {
    if (kind === 'bad' && root.Sound) root.Sound.sfx('error');
    const box = $('#toasts');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = text;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  function vibrate(ms) {
    if (!root.App || !root.App.store.vibrate) return;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 隨機可愛暱稱（形容詞＋小動物） ---------- */

  const ADJ = ['開心', '快手', '小小', '圓滾滾', '愛笑', '勇敢', '軟綿綿', '機靈', '陽光', '悠哉', '閃亮', '好奇'];
  const NOUN = ['水獺', '兔兔', '水豚', '企鵝', '柴柴', '海龜', '無尾熊', '貓咪', '海豹', '螃蟹', '椰子', '小魚'];
  function randomName() {
    return ADJ[Math.floor(Math.random() * ADJ.length)] + NOUN[Math.floor(Math.random() * NOUN.length)];
  }

  /* ---------- 角色選擇 ---------- */

  function charPicker(el, selected, onPick) {
    el.innerHTML = root.Art.ANIMALS.map(a =>
      '<button type="button" class="char-opt" role="radio" data-char="' + a.id + '" aria-checked="' + (a.id === selected) +
      '" aria-label="' + a.name + '">' + root.Art.animalSvg(a.id) + '<span>' + a.name + '</span></button>').join('');
    el.addEventListener('click', e => {
      const b = e.target.closest('.char-opt');
      if (!b) return;
      $$('.char-opt', el).forEach(x => x.setAttribute('aria-checked', String(x === b)));
      onPick(b.dataset.char);
    });
  }
  function setChar(el, id) {
    $$('.char-opt', el).forEach(x => x.setAttribute('aria-checked', String(x.dataset.char === id)));
  }

  /* ---------- 設定彈窗 ---------- */

  function buildSettings(store, onChange) {
    const body = $('#settings-body');
    const sw = (key, label, iconName, desc) =>
      '<label class="set-row"><span class="set-ico">' + root.Art.icon(iconName) + '</span>' +
      '<span class="set-text"><b>' + label + '</b>' + (desc ? '<small>' + desc + '</small>' : '') + '</span>' +
      '<input type="checkbox" class="switch" data-key="' + key + '"' + (store[key] ? ' checked' : '') + '></label>';
    const vol = (key, label) =>
      '<label class="set-row vol"><span class="set-text"><b>' + label + '</b></span>' +
      '<input type="range" min="0" max="1" step="0.05" data-key="' + key + '" value="' + store[key] + '" aria-label="' + label + '"></label>';
    body.innerHTML =
      '<h3 class="set-group">聲音</h3>' +
      sw('bgm', '背景音樂', 'music') + vol('bgmVol', '音樂音量') +
      sw('sfx', '音效', 'sound') + vol('sfxVol', '音效音量') +
      '<h3 class="set-group">手感與畫面</h3>' +
      sw('vibrate', '震動', 'feel', '被關進監獄、破產時震一下（支援的手機／平板）') +
      sw('reduceMotion', '減少動態', 'see', '關掉骰子、棋子移動與飄字動畫') +
      sw('fastAnim', '動畫加快', 'feel', '棋子走快一點，骰子少轉一下') +
      sw('bigText', '中央文字放大', 'see', '棋盤中央的提示與按鈕字更大') +
      '<div class="set-actions"><button type="button" class="btn3d sand" id="set-reset">恢復預設</button>' +
      '<button type="button" class="btn3d sea" data-close>完成</button></div>';

    body.oninput = e => {
      const k = e.target.dataset.key;
      if (!k) return;
      store[k] = e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value);
      onChange(store);
    };
    $('#set-reset').onclick = () => {
      root.Store.resetSettings(store);
      buildSettings(store, onChange);
      onChange(store);
      toast('設定已恢復預設');
      const first = $('#settings-body .switch');
      if (first) first.focus();
    };
  }

  /* ---------- 聊天室（房間、對局左欄、窄版彈層共用同一份訊息） ---------- */

  const QUICK = ['加油！', '好緊張～', '手好快！', '再來一局', '哈哈哈', '等我一下'];
  const chat = {
    messages: [],
    enabled: false,
    canSend: true,
    onSend: null,
    unread: 0,
    set(list) { this.messages = list.slice(-80); this.render(); },
    add(m) { this.messages.push(m); if (this.messages.length > 80) this.messages.shift(); this.render(); },
    clear() { this.messages = []; this.unread = 0; this.render(); },
    mount() {
      $$('.chat').forEach(box => {
        box.innerHTML =
          '<ol class="chat-log" aria-live="polite"></ol>' +
          '<div class="chat-quick">' + QUICK.map(q => '<button type="button" class="chip" data-q="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' +
          '<form class="chat-form"><input maxlength="60" placeholder="輸入訊息…" aria-label="聊天訊息" autocomplete="off">' +
          '<button class="icon-btn send" type="submit" aria-label="送出">' + root.Art.icon('send') + '</button></form>';
        box.addEventListener('click', e => {
          const q = e.target.closest('[data-q]');
          if (q && this.onSend) this.onSend(q.dataset.q);
        });
        $('.chat-form', box).addEventListener('submit', e => {
          e.preventDefault();
          const input = $('input', box);
          const text = input.value.trim();
          if (text && this.onSend) this.onSend(text);
          input.value = '';
        });
      });
    },
    render() {
      const html = this.messages.map(m => m.system
        ? '<li class="sys">' + esc(m.text) + '</li>'
        : '<li><span class="who">' + (m.char ? root.Art.animalSvg(m.char) : '') + '<b>' + esc(m.name) +
          (m.spec ? '<i>觀戰</i>' : '') + '</b></span><span class="msg">' + esc(m.text) + '</span></li>').join('');
      $$('.chat-log').forEach(ol => {
        const nearBottom = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 40;
        ol.innerHTML = html || '<li class="sys">還沒有訊息，打聲招呼吧！</li>';
        if (nearBottom || true) ol.scrollTop = ol.scrollHeight;
      });
      $$('.chat-form input, .chat-form button, .chat-quick button').forEach(n => { n.disabled = !this.canSend; });
    }
  };

  /** 地圖大小選擇卡片（單機開局與房主設定共用）。地圖每局隨機生成，只選格數。attrs：每張卡片加上的屬性，例如 'data-size' 或 'data-set="mapSize"' */
  const SIZE_INFO = { 48: ['小巧', '節奏快，約 10～15 分鐘'], 64: ['標準', '地產多一點，剛剛好'], 80: ['寬廣', '色組多、要走比較久'], 96: ['超大', '長線經營，適合久玩'], 120: ['巨大', '超大棋盤，玩很久也很豐富'] };
  /* 自製下拉選單（不用原生 <select>）：地圖大小、回合上限共用。按鈕顯示目前選的，點開跳出選項；
   * 選了會在按鈕上送出 'ddselect' 事件（detail＝{ kind, val }，val 是數字） */
  const LIMIT_INFO = { 25: ['短局', '25 回合到了比總資產'], 40: ['標準', '40 回合到了比總資產'], 50: ['長局', '50 回合到了比總資產'], 0: ['不限', '打到只剩一人沒破產'] };
  const DD = {
    map: { label: '地圖大小', values: () => root.Rules.MAPS.SIZES, norm: n => root.Rules.MAPS.SIZES.includes(Number(n)) ? Number(n) : root.Rules.MAPS.DEFAULT_SIZE,
      sw: n => '<span class="map-sw"><b>' + n + '</b><small>格</small></span>', name: n => SIZE_INFO[n][0], sub: n => SIZE_INFO[n][1], aria: n => n + ' 格' + SIZE_INFO[n][0] },
    limit: { label: '回合上限', values: () => root.Rules.ROUND_LIMITS.filter(n => n).concat([0]), norm: n => root.Rules.ROUND_LIMITS.includes(Number(n)) ? Number(n) : 40,
      sw: n => '<span class="map-sw lim"><b>' + (n || '∞') + '</b><small>回合</small></span>', name: n => LIMIT_INFO[n][0], sub: n => LIMIT_INFO[n][1], aria: n => n ? n + ' 回合' : '不限回合' }
  };
  /* 電腦難度：一格一個的精簡下拉，值是 0～3（幼幼班／簡單／普通／困難） */
  DD.diff = { label: '電腦難度', compact: true, values: () => [0, 1, 2, 3], norm: n => [0, 1, 2, 3].includes(Number(n)) ? Number(n) : 2,
    name: n => root.Rules.DIFFICULTIES[['kid', 'easy', 'normal', 'hard'][n]].name, aria: n => root.Rules.DIFFICULTIES[['kid', 'easy', 'normal', 'hard'][n]].name };
  function dropdown(kind, selected, attrs) {
    const d = DD[kind], n = d.norm(selected);
    if (d.compact) return '<button type="button" class="map-dd cell-dd" data-ddk="' + kind + '" data-val="' + n + '" aria-haspopup="listbox" aria-expanded="false" aria-label="' + (attrs && attrs.label ? attrs.label : d.label) + '：' + d.aria(n) + '" ' + ((attrs && attrs.attrs) || '') + '><b>' + d.name(n) + '</b><i class="dd-caret" aria-hidden="true"></i></button>';
    return '<button type="button" class="map-dd" data-ddk="' + kind + '" data-val="' + n + '" aria-haspopup="listbox" aria-expanded="false" aria-label="' + d.label + '：' + d.aria(n) + '" ' + (attrs || '') + '>' +
      d.sw(n) + '<span class="map-tx"><b>' + d.name(n) + '</b><small>' + d.sub(n) + '</small></span><i class="dd-caret" aria-hidden="true"></i></button>';
  }
  const mapCards = (selected, attrs) => dropdown('map', selected, attrs);
  const limitSelect = (selected, attrs) => dropdown('limit', selected, attrs);
  const diffSelect = (idx, selected) => dropdown('diff', selected, { label: '電腦 ' + (idx + 1) + ' 的難度', attrs: 'data-ai="' + idx + '"' });
  let mdMenu = null, mdBtn = null;
  function mapMenuClose(focus) {
    if (!mdMenu) return;
    mdMenu.remove(); mdMenu = null;
    if (mdBtn) { mdBtn.setAttribute('aria-expanded', 'false'); if (focus) mdBtn.focus(); }
    mdBtn = null;
  }
  function mapMenuOpen(btn) {
    mapMenuClose();
    const kind = btn.dataset.ddk, d = DD[kind];
    mdBtn = btn; btn.setAttribute('aria-expanded', 'true');
    const cur = Number(btn.dataset.val);
    const m = document.createElement('div');
    m.className = 'dd-menu map-menu'; m.setAttribute('role', 'listbox'); m.tabIndex = -1; m.setAttribute('aria-label', d.label);
    if (d.compact) m.classList.add('cell-menu');
    m.innerHTML = d.compact ? d.values().map(n => '<button type="button" role="option" class="dd-opt" data-val="' + n + '" aria-selected="' + (n === cur) + '">' + d.name(n) + (n === cur ? '<i class="dd-check" aria-hidden="true"></i>' : '') + '</button>').join('') : d.values().map(n => '<button type="button" role="option" class="dd-opt map-opt" data-val="' + n + '" aria-selected="' + (n === cur) + '">' + d.sw(n) +
      '<span class="map-tx"><b>' + d.name(n) + '</b><small>' + d.sub(n) + '</small></span>' + (n === cur ? '<i class="dd-check" aria-hidden="true"></i>' : '') + '</button>').join('');
    document.body.appendChild(m); mdMenu = m;
    const r = btn.getBoundingClientRect(), mh = m.offsetHeight;
    m.style.width = Math.min(window.innerWidth - 16, Math.max(r.width, d.compact ? 132 : 260)) + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left)) + 'px';
    const below = window.innerHeight - r.bottom - 8 >= mh || r.top < mh + 8;
    m.style.top = Math.max(8, below ? r.bottom + 6 : r.top - mh - 6) + 'px';
    const opts = [...m.querySelectorAll('.dd-opt')];
    (opts.find(o => Number(o.dataset.val) === cur) || opts[0]).focus();
    m.addEventListener('click', ev => {
      const o = ev.target.closest('.dd-opt'); if (!o) return;
      const b = mdBtn, v = Number(o.dataset.val);
      mapMenuClose(true);
      if (b && v !== cur) b.dispatchEvent(new CustomEvent('ddselect', { bubbles: true, detail: { kind, val: v } }));
    });
    m.addEventListener('keydown', ev => {
      const i = opts.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown') { ev.preventDefault(); opts[(i + 1) % opts.length].focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); opts[(i - 1 + opts.length) % opts.length].focus(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); mapMenuClose(true); }
      else if (ev.key === 'Tab') { ev.preventDefault(); mapMenuClose(true); }
    });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ddk]');
    if (b) { if (mdBtn === b) mapMenuClose(); else mapMenuOpen(b); }
  });
  document.addEventListener('pointerdown', e => { if (mdMenu && !mdMenu.contains(e.target) && !e.target.closest('[data-ddk]')) mapMenuClose(); });
  window.addEventListener('resize', () => mapMenuClose());

  root.UI = { $, $$, esc, show, mapCards, limitSelect, diffSelect, onShow, get current() { return current; }, modal, anyModalOpen, toast, vibrate, randomName, charPicker, setChar, buildSettings, chat };
})(typeof self !== 'undefined' ? self : this);
