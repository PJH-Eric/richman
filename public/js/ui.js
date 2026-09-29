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

  /** 地圖選擇卡片（單機開局與房主設定共用）。attrs：每張卡片加上的屬性，例如 'data-map' 或 'data-set="map"' */
  function mapCards(selected, attrs, label) {
    return '<div class="map-list" role="radiogroup" aria-label="' + (label || '地圖') + '">' + root.Rules.MAPS.LIST.map(m =>
      '<button type="button" role="radio" class="map-card" aria-checked="' + (m.id === selected) + '" ' + attrs + ' data-val="' + m.id + '" data-map="' + m.id + '">' +
      '<span class="map-sw" style="background:linear-gradient(135deg,' + m.theme.bg + ' 0 45%,' + m.theme.base + ' 45% 100%);color:' + (m.theme.bg === '#20204A' ? '#fff' : '#3B2A1E') + '"><b>' + m.size + '</b><small>格</small></span>' +
      '<span class="map-tx"><b>' + esc(m.name) + '</b><small>' + esc(m.desc) + '</small></span></button>').join('') + '</div>';
  }

  root.UI = { $, $$, esc, show, mapCards, onShow, get current() { return current; }, modal, anyModalOpen, toast, vibrate, randomName, charPicker, setChar, buildSettings, chat };
})(typeof self !== 'undefined' ? self : this);
