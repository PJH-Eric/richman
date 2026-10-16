/* ===== app.js — 進入點：首頁、單機設定、說明頁、設定彈窗、選單、鍵盤、版面切換 ===== */
(function (root) {
  'use strict';
  const { $, $$, esc, show, toast } = root.UI;
  const Art = root.Art;
  const store = root.Store.load();
  let settingsModal = null, menuModal = null, manageModal = null, tileModal = null, itemsModal = null;
  let chatPopOpen = false, unread = 0, sideUnread = 0, chatMinState = () => false;
  const modals = {};

  const t = (k, p) => root.I18N.t(k, p);
  const DIFF_HINT = k => t('diff.' + k + '.hint');
  const LIMIT_HINT = n => ({ 25: 1, 40: 1, 50: 1, 0: 1 })[n] ? t('limit.hint.' + n) : '';

  function boot() {
    /* 圖示 */
    $('#btn-settings').innerHTML = Art.icon('gear');
    $$('.back-btn').forEach(b => { b.innerHTML = Art.icon('back'); });
    $('#btn-menu').innerHTML = Art.icon('pause');
    $('#btn-menu-fab').innerHTML = Art.icon('pause');
    $('#side-open').innerHTML = Art.icon('info');
    $('#side-close').innerHTML = Art.icon('close');
    $('#chat-fab').insertAdjacentHTML('afterbegin', Art.icon('chat'));
    $('#chat-pop-close').innerHTML = Art.icon('close');
    $$('.modal [data-close].icon-btn').forEach(b => { b.innerHTML = Art.icon('close'); });
    $('#hero').innerHTML = Art.heroSvg();
    $('#solo-ai [data-step="-1"]').innerHTML = Art.icon('minus');
    $('#solo-ai [data-step="1"]').innerHTML = Art.icon('plus');
    root.Sound.apply(store);
    applyVisual();
    /* 語言切換鈕：放在設定鈕旁邊；「回遊戲大廳」連結帶上 ?lang= */
    root.I18N.mountToggle({ after: $('#btn-settings') });
    const syncLobbyLink = () => { const a = $('#lobby-home-link'); if (a) a.href = root.I18N.withLang('https://pjh-eric.github.io/game-lobby/'); };
    syncLobbyLink();
    /* 第一次點擊才能出聲（瀏覽器規定） */
    const unlock = () => { root.Sound.unlock(); document.removeEventListener('pointerdown', unlock, true); document.removeEventListener('keydown', unlock, true); };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    document.addEventListener('click', e => { if (e.target.closest('.btn3d, .icon-btn, .char-opt, .seg button')) root.Sound.sfx('click'); });

    /* 設定彈窗 */
    settingsModal = root.UI.modal($('#settings-modal'), {
      onOpen: () => { if (root.Solo.active && !root.Solo.paused) root.Solo.pause(true, true); },
      onClose: () => { if (root.Solo.active && root.Solo.paused && !menuModal.isOpen && $('#result').hidden) root.Solo.resume(); }
    });
    root.UI.buildSettings(store, s => { root.Store.save(s); root.Sound.apply(s); applyVisual(); });
    $('#btn-settings').onclick = e => settingsModal.open(e.currentTarget);

    /* 我的地產、格子說明（單機開著時也暫停時鐘） */
    manageModal = root.UI.modal($('#manage-modal'), { onOpen: () => soloHold(true), onClose: () => soloHold(false) });
    tileModal = root.UI.modal($('#tile-modal'), { onOpen: () => soloHold(true), onClose: () => soloHold(false) });
    itemsModal = root.UI.modal($('#items-modal'), { onOpen: () => soloHold(true), onClose: () => soloHold(false) });
    document.querySelectorAll('[data-items-guide]').forEach(b => { b.onclick = e => { $('#items-body').innerHTML = itemsGuideHtml(); itemsModal.open(e.currentTarget); }; });
    modals.manage = { modal: manageModal, body: $('#manage-body') };
    modals.tile = { modal: tileModal, body: $('#tile-body'), title: $('#tile-title') };

    /* 選單（單機＝暫停；線上＝不會暫停整房） */
    menuModal = root.UI.modal($('#menu-modal'), {
      onClose: () => { if (root.Solo.active && root.Solo.paused && !settingsModal.isOpen) root.Solo.resume(); }
    });
    const menuClick = e => {
      setSide(false);
      if (root.Solo.active) root.Solo.pause(false, false, e.currentTarget);
      else openMenu(false, e.currentTarget);
    };
    $('#btn-menu').onclick = menuClick;
    $('#btn-menu-fab').onclick = menuClick;

    /* 首頁 */
    $('#go-solo').onclick = () => openSolo();
    $('#go-online').onclick = () => root.Online.enterLobby();
    $('#go-help').onclick = () => { renderHelp(); show('help'); };
    $$('[data-back]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.back === 'home' && root.UI.current === 'lobby') root.Online.exit();
      show(b.dataset.back);
      if (b.dataset.back === 'home') renderStats();
    }));

    /* 單機設定 */
    root.UI.charPicker($('#solo-chars'), store.char, charPicked);
    root.UI.charPicker($('#lobby-chars'), store.char, lobbyCharPicked);
    $('#solo-ai').addEventListener('click', e => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      store.aiCount = Math.min(5, Math.max(1, store.aiCount + Number(b.dataset.step)));
      root.Store.save(store);
      renderSoloSetup();
    });
    $('#solo-ai-list').addEventListener('ddselect', e => {
      const b = e.target.closest('[data-ai]');
      if (!b) return;
      const d = aiDiffs();
      d[Number(b.dataset.ai)] = DIFF_ORDER[Number(e.detail.val)];
      store.aiDiffs = d;
      root.Store.save(store);
      renderSoloSetup();
    });
    $('#solo-limit').addEventListener('ddselect', e => {
      store.roundLimit = Number(e.detail.val);
      root.Store.save(store);
      renderSoloSetup();
    });
    $('#solo-map').addEventListener('ddselect', e => {
      store.mapSize = Number(e.detail.val);
      root.Store.save(store);
      renderSoloSetup();
    });
    $('#solo-start').onclick = startSolo;

    /* 對局畫面：左欄抽屜、聊天彈層 */
    $('#side-open').onclick = () => setSide(true);
    $('#side-close').onclick = () => setSide(false);
    $('#chat-fab').onclick = () => setChatPop(true);
    /* 左欄聊天室可以縮成一條，摘要就能完整顯示 */
    let chatMin = false;
    try { chatMin = localStorage.getItem('richman-chat-min') === '1'; } catch (e) { /* 沒有儲存空間也沒關係 */ }
    const applyChatMin = () => {
      const box = $('#side-chatbox'), t = $('#chat-toggle');
      box.classList.toggle('min', chatMin);
      t.setAttribute('aria-expanded', String(!chatMin));
      t.setAttribute('aria-label', chatMin ? root.I18N.t('chat.expand') : root.I18N.t('chat.collapse'));
      if (!chatMin) { sideUnread = 0; renderSideUnread(); root.UI.chat.render(); }
    };
    $('#chat-toggle').onclick = () => {
      chatMin = !chatMin;
      try { localStorage.setItem('richman-chat-min', chatMin ? '1' : '0'); } catch (e) { /* ignore */ }
      applyChatMin();
    };
    chatMinState = () => chatMin;
    /* 聊天室浮在左下角：把它的高度告訴摘要，摘要底部留白，才捲得到最後一行 */
    if (window.ResizeObserver) new ResizeObserver(() => {
      const bx = $('#side-chatbox'); $('#side').style.setProperty('--chat-h', (bx.hidden ? 0 : bx.offsetHeight) + 'px');
    }).observe($('#side-chatbox'));
    applyChatMin();
    $('#chat-pop-close').onclick = () => setChatPop(false);
    root.UI.chat.mount();
    root.UI.chat.onSend = text => root.Net.send({ type: 'chat', text });
    root.Online.init();

    /* 鍵盤：空白鍵／Enter 做主要動作、Esc 選單 */
    document.addEventListener('keydown', onKey);
    root.UI.onShow(name => {
      document.body.classList.toggle('in-game', name === 'game');
      if (name !== 'game') { setSide(false); setChatPop(false); }
    });
    window.addEventListener('resize', () => gameLayout());
    renderStats();
    /* 切換語言：重畫目前看得到的所有動態內容（靜態 HTML 由 I18N 自己更新） */
    root.I18N.onChange(() => {
      syncLobbyLink();
      applyChatMin();
      root.UI.relang();
      root.UI.buildSettings(store, s => { root.Store.save(s); root.Sound.apply(s); applyVisual(); });
      renderStats();
      if (root.UI.current === 'solo') { root.UI.charPicker($('#solo-chars'), store.char, charPicked); renderSoloSetup(); }
      if (root.UI.current === 'lobby') root.UI.charPicker($('#lobby-chars'), store.char, lobbyCharPicked);
      if (root.UI.current === 'help') renderHelp();
      if (itemsModal && itemsModal.isOpen) $('#items-body').innerHTML = itemsGuideHtml();
      if (menuModal && menuModal.isOpen) openMenu(false);
      root.Online.relang();
      root.Solo.relang();
    });
    if (root.Online.hasInvite || root.Online.wasOnline()) root.Online.enterLobby();
    else show('home');
  }

  function charPicked(id) { store.char = id; root.Store.save(store); root.UI.setChar($('#lobby-chars'), id); }
  function lobbyCharPicked(id) {
    store.char = id; root.Store.save(store); root.UI.setChar($('#solo-chars'), id);
    root.Net.setProfile({ name: store.nickname, char: id });
    if (root.Net.connected) root.Net.send({ type: 'profile', char: id });
  }

  function soloHold(on) {
    if (!root.Solo.active) return;
    if (on) root.Solo.pause(true, true);
    else if (!settingsModal.isOpen && !menuModal.isOpen && $('#result').hidden) root.Solo.resume();
  }

  function applyVisual() {
    document.body.classList.toggle('reduce-motion', !!store.reduceMotion);
    document.body.classList.toggle('big-text', !!store.bigText);
  }

  /** 空白鍵／Enter：目前這個人「最該按」的那顆鍵（擲骰、買地、結清、結束回合） */
  function primary() {
    if (root.Solo.active) return root.Solo.primary();
    const b = root.Online.board;
    return b ? b.primary() : false;
  }
  function onKey(e) {
    if (root.UI.current !== 'game' || root.UI.anyModalOpen()) return;
    if (document.querySelector('.shop-ov:not([hidden])')) return;   /* 商店疊層自己處理鍵盤 */
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') {
      if (e.target && e.target.closest && e.target.closest('button, [role="button"]')) return;   /* 焦點在按鈕上就讓按鈕自己處理 */
      e.preventDefault();
      if (e.repeat) return;
      primary();
    } else if (e.key === 'Escape') {
      if (!$('#result').hidden) return;
      e.preventDefault();
      if (root.Solo.active) root.Solo.pause(false); else openMenu(false);
    }
  }

  /* ---------- 首頁 ---------- */
  function renderStats() {
    let play = 0, win = 0;
    for (const k in store.stats) { play += store.stats[k].play; win += store.stats[k].win; }
    $('#home-stats').textContent = play ? t('home.stats', { play, win }) : '';
  }

  /* ---------- 單機 ---------- */
  function openSolo() {
    $('#solo-name').value = store.nickname || '';
    root.UI.setChar($('#solo-chars'), store.char);
    renderSoloSetup();
    show('solo');
  }
  const DIFF_ORDER = ['kid', 'easy', 'normal', 'hard'];
  function aiDiffs() {
    const base = store.difficulty || 'normal';
    const d = Array.isArray(store.aiDiffs) ? store.aiDiffs.slice(0, 7) : [];
    while (d.length < 7) d.push(base);
    return d.map(x => DIFF_ORDER.includes(x) ? x : base);
  }
  function renderSoloSetup() {
    const diffs = aiDiffs().slice(0, store.aiCount);
    const same = diffs.every(x => x === diffs[0]);
    $('#solo-ai-list').style.setProperty('--n', diffs.length);
    $('#solo-ai-list').innerHTML = diffs.map((d, i) =>
      '<li><span class="ai-no">' + t('solo.botN', { n: i + 1 }) + '</span>' + root.UI.diffSelect(i, DIFF_ORDER.indexOf(d)) + '</li>').join('');
    if (!root.Rules.MAPS.validSize(store.mapSize)) store.mapSize = root.Rules.MAPS.DEFAULT_SIZE;
    $('#solo-map').innerHTML = root.UI.mapCards(store.mapSize, '');
    $('#solo-ai-n').textContent = store.aiCount;
    $('#solo-ai [data-step="-1"]').disabled = store.aiCount <= 1;
    $('#solo-ai [data-step="1"]').disabled = store.aiCount >= 5;
    $('#solo-limit').innerHTML = root.UI.limitSelect(store.roundLimit, '');
    $('#solo-limit-hint').textContent = LIMIT_HINT(store.roundLimit);
    const easiest = DIFF_ORDER.find(k => diffs.includes(k));
    $('#solo-diff-hint').textContent = same ? DIFF_HINT(diffs[0]) : t('diff.mixed', { d: t('diff.' + easiest) });
  }
  function startSolo() {
    const nm = $('#solo-name').value.trim().slice(0, 10) || store.nickname || root.UI.randomName();
    store.nickname = nm;
    root.Store.save(store);
    $('#result').hidden = true;
    show('game');
    gameLayout(false);
    root.Solo.start({ name: nm, char: store.char, aiCount: store.aiCount, aiDiffs: aiDiffs().slice(0, store.aiCount), roundLimit: store.roundLimit, mapSize: store.mapSize, map: store.testMap });   /* testMap：只給自動化測試固定版面用 */
    if (!store.seenHelp) {
      store.seenHelp = true;
      root.Store.save(store);
      toast(t('solo.firstTip'));
    }
  }

  /* ---------- 對局版面 ---------- */
  function isWide() { return window.matchMedia('(min-width: 900px) and (min-height: 560px)').matches; }
  /** online：這局有沒有聊天室 */
  function gameLayout(online) {
    if (online != null) document.body.classList.toggle('online-game', !!online);
    const on = document.body.classList.contains('online-game');
    const side = $('#side-chatbox');
    side.hidden = !on;
    $('#chat-fab').hidden = !on || isWide();
    if (isWide()) { setChatPop(false); setSide(false); }
  }
  function setSide(open) {
    document.body.classList.toggle('side-open', !!open);
    const btn = $('#side-open');
    if (btn) btn.setAttribute('aria-expanded', String(!!open));
  }
  function setChatPop(open) {
    chatPopOpen = !!open;
    $('#chat-pop').hidden = !chatPopOpen;
    if (chatPopOpen) {
      unread = 0; renderUnread();
      const input = $('#chat-pop input'); if (input) input.focus();
      root.UI.chat.render();
    }
  }
  function renderSideUnread() {
    const b = $('#side-unread');
    b.hidden = sideUnread === 0;
    b.textContent = sideUnread > 9 ? '9+' : sideUnread;
  }
  function chatArrived(m) {
    if (!m || m.system) return;
    root.Sound.sfx('chat');
    if (root.UI.current === 'game' && chatMinState()) { sideUnread++; renderSideUnread(); }
    if (root.UI.current === 'game' && !isWide() && !chatPopOpen) { unread++; renderUnread(); }
  }
  function renderUnread() {
    const b = $('#chat-unread');
    b.hidden = unread === 0;
    b.textContent = unread > 9 ? '9+' : unread;
  }

  /* ---------- 選單 ---------- */
  function openMenu(auto, from) {
    if (!from) from = isWide() ? $('#btn-menu') : $('#btn-menu-fab');
    const body = $('#menu-body');
    if (root.Solo.active) {
      $('#menu-title').textContent = auto ? t('menu.autoTitle') : t('menu.pause');
      body.innerHTML = (auto ? '<p class="hint">' + t('menu.auto') + '</p>' : '') +
        '<button type="button" class="btn3d coral btn-wide" id="m-resume">' + t('menu.resume') + '</button>' +
        '<button type="button" class="btn3d sand btn-wide" id="m-restart">' + t('menu.restart') + '</button>' +
        '<button type="button" class="btn3d sea btn-wide" id="m-home">' + t('menu.home') + '</button>';
      $('#m-resume').onclick = () => menuModal.close();
      $('#m-restart').onclick = () => { menuModal.close(); $('#result').hidden = true; root.Solo.restart(); };
      $('#m-home').onclick = () => { root.Solo.stop(); menuModal.close(); show('home'); renderStats(); };
    } else {
      const room = root.Online.room;
      const isPlayer = room && room.you.role === 'player';
      $('#menu-title').textContent = t('menu.title');
      body.innerHTML = '<p class="hint">' + t('menu.onlineNote') + '</p>' +
        '<button type="button" class="btn3d coral btn-wide" id="m-resume">' + t('menu.back') + '</button>' +
        (room && room.invite.active ? '<button type="button" class="btn3d sea btn-wide" id="m-copy">' + t('menu.copyInvite') + '</button>' : '') +
        '<button type="button" class="btn3d sand btn-wide" id="m-leave">' + t('menu.leave') + '</button>' +
        (isPlayer ? '<small class="hint">' + t('menu.leaveNote') + '</small>' : '');
      $('#m-resume').onclick = () => menuModal.close();
      const cp = $('#m-copy');
      if (cp) cp.onclick = () => {
        const tmp = document.createElement('input');
        tmp.id = 'invite-url'; tmp.style.position = 'fixed'; tmp.style.opacity = '0';
        const u = new URL(location.href); u.search = ''; u.searchParams.set('invite', room.invite.token);
        tmp.value = u.toString(); document.body.appendChild(tmp);
        root.Online.copyInvite(); tmp.remove();
      };
      $('#m-leave').onclick = () => { menuModal.close(); root.Online.leaveRoom(); };
    }
    menuModal.open(from);
  }

  /** 道具說明：全部道具的圖示、點數、庫存、效果與取得方式 */
  function itemsGuideHtml() {
    const R = root.Rules;
    let h = '<p class="ig-rule">' + t('items.rule', { max: R.MAX_ITEMS }) + '</p><ul class="ig-list">';
    R.ITEM_LIST.forEach(id => {
      const it = R.ITEMS[id];
      h += '<li><span class="it-ico">' + root.Art.glyph('i_' + id) + '</span><span class="ig-tx"><b>' + esc(root.GT.item(id)) + '</b><small>' + esc(root.GT.itemDesc(id)) + '</small></span>' +
        '<span class="ig-meta"><b>' + t('u.pts', { n: it.pts }) + '</b><br>' + t('items.stock', { stock: R.stockFor(id, 4), sell: R.sellPrice(id) }) + '</span></li>';
    });
    return h + '</ul>';
  }

  /* ---------- 怎麼玩（靜態圖文） ---------- */
  function renderHelp() {
    const G = Art.glyph;
    const step = (pic, n) => '<li><div class="help-pic">' + pic + '</div><div><h3>' + t('help.s' + n + '.h') + '</h3><p>' + t('help.s' + n + '.p') + '</p></div></li>';
    $('#help-body').innerHTML =
      '<ol class="help-steps">' +
      step(Art.dieSvg(4) + Art.dieSvg(3), 1) + step(G('gem'), 2) + step(Art.houseSvg() + Art.hotelSvg(), 3) + step(G('chance'), 4) +
      step(G('jail'), 5) + step(G('coin'), 6) + step(G('god_fortune'), 7) + step(G('i_dice'), 8) +
      '</ol>' +
      '<div class="help-tips"><h3>' + t('help.tipsTitle') + '</h3><ul>' +
      [1, 2, 3, 4, 5].map(n => '<li>' + t('help.tip' + n) + '</li>').join('') +
      '</ul></div>' +
      '<button type="button" class="btn3d coral btn-wide" id="help-go">' + t('help.go') + '</button>';
    $('#help-go').onclick = () => openSolo();
  }

  root.App = { store, openMenu, gameLayout, chatArrived, modals, get settingsModal() { return settingsModal; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : this);
