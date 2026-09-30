/* ===== app.js — 進入點：首頁、單機設定、說明頁、設定彈窗、選單、鍵盤、版面切換 ===== */
(function (root) {
  'use strict';
  const { $, $$, esc, show, toast } = root.UI;
  const Art = root.Art;
  const store = root.Store.load();
  let settingsModal = null, menuModal = null, manageModal = null, tileModal = null, itemsModal = null;
  let chatPopOpen = false, unread = 0, sideUnread = 0, chatMinState = () => false;
  const modals = {};

  const DIFF_HINT = {
    kid: '電腦會亂買、不蓋房、不收購，適合 3～5 歲小朋友一起玩',
    easy: '電腦會買地，但比較大方、不太會蓋房',
    normal: '電腦會算現金、湊整組、蓋房，跟一般玩家差不多',
    hard: '電腦會留現金防身、搶整組，很會理財'
  };
  const LIMIT_HINT = {
    25: '25 回合到了還沒分出勝負，就比總資產（現金＋地產＋房子），最多的人獲勝',
    40: '40 回合到了還沒分出勝負，就比總資產，最多的人獲勝',
    50: '50 回合到了還沒分出勝負，就比總資產，最多的人獲勝',
    0: '不限回合，打到只剩一個人沒破產。可能會打很久，中途可以隨時離開'
  };

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
    root.UI.charPicker($('#solo-chars'), store.char, id => { store.char = id; root.Store.save(store); root.UI.setChar($('#lobby-chars'), id); });
    root.UI.charPicker($('#lobby-chars'), store.char, id => {
      store.char = id; root.Store.save(store); root.UI.setChar($('#solo-chars'), id);
      root.Net.setProfile({ name: store.nickname, char: id });
      if (root.Net.connected) root.Net.send({ type: 'profile', char: id });
    });
    $('#solo-ai').addEventListener('click', e => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      store.aiCount = Math.min(7, Math.max(1, store.aiCount + Number(b.dataset.step)));
      root.Store.save(store);
      renderSoloSetup();
    });
    $('#solo-diff').innerHTML = root.Rules.DIFFICULTY_LIST.map(k =>
      '<button type="button" role="radio" data-diff="' + k + '">' + root.Rules.DIFFICULTIES[k].name + '</button>').join('');
    $('#solo-diff').addEventListener('click', e => {
      const b = e.target.closest('[data-diff]');
      if (!b) return;
      store.difficulty = b.dataset.diff;
      store.aiDiffs = new Array(7).fill(b.dataset.diff);     /* 全部一起設 */
      root.Store.save(store);
      renderSoloSetup();
    });
    $('#solo-ai-list').addEventListener('click', e => {
      const b = e.target.closest('[data-ai][data-diff]');
      if (!b) return;
      const d = aiDiffs();
      d[Number(b.dataset.ai)] = b.dataset.diff;
      store.aiDiffs = d;
      root.Store.save(store);
      renderSoloSetup();
    });
    $('#solo-limit').addEventListener('click', e => {
      const b = e.target.closest('[data-limit]');
      if (!b) return;
      store.roundLimit = Number(b.dataset.limit);
      root.Store.save(store);
      renderSoloSetup();
    });
    $('#solo-map').addEventListener('click', e => {
      const b = e.target.closest('[data-size]');
      if (!b) return;
      store.mapSize = Number(b.dataset.size);
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
      t.setAttribute('aria-label', chatMin ? '展開聊天室' : '縮小聊天室');
      if (!chatMin) { sideUnread = 0; renderSideUnread(); root.UI.chat.render(); }
    };
    $('#chat-toggle').onclick = () => {
      chatMin = !chatMin;
      try { localStorage.setItem('richman-chat-min', chatMin ? '1' : '0'); } catch (e) { /* ignore */ }
      applyChatMin();
    };
    chatMinState = () => chatMin;
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
    if (root.Online.hasInvite || root.Online.wasOnline()) root.Online.enterLobby();
    else show('home');
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
    $('#home-stats').textContent = play ? '這台裝置上玩過 ' + play + ' 局，贏了 ' + win + ' 局' : '';
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
    const names = root.Rules.DIFFICULTIES;
    $('#solo-ai-list').innerHTML = diffs.map((d, i) =>
      '<li><span class="ai-no">電腦 ' + (i + 1) + '</span><div class="seg small" role="radiogroup" aria-label="電腦 ' + (i + 1) + ' 的難度">' +
      DIFF_ORDER.map(k => '<button type="button" role="radio" data-ai="' + i + '" data-diff="' + k + '" aria-checked="' + (k === d) + '">' + names[k].name + '</button>').join('') +
      '</div></li>').join('');
    if (!root.Rules.MAPS.validSize(store.mapSize)) store.mapSize = root.Rules.MAPS.DEFAULT_SIZE;
    $('#solo-map').innerHTML = root.UI.mapCards(store.mapSize, '');
    $('#solo-ai-n').textContent = store.aiCount;
    $('#solo-ai [data-step="-1"]').disabled = store.aiCount <= 1;
    $('#solo-ai [data-step="1"]').disabled = store.aiCount >= 7;
    $$('#solo-diff [data-diff]').forEach(b => b.setAttribute('aria-checked', String(same && b.dataset.diff === diffs[0])));
    $$('#solo-limit [data-limit]').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.limit) === Number(store.roundLimit))));
    $('#solo-limit-hint').textContent = LIMIT_HINT[store.roundLimit] || '';
    const easiest = DIFF_ORDER.find(k => diffs.includes(k));
    $('#solo-diff-hint').textContent = same ? DIFF_HINT[diffs[0]] : '混合難度：動作節奏跟著最簡單的電腦（' + names[easiest].name + '）';
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
      toast('輪到你就按「擲骰子」（空白鍵也可以）！點棋盤上的格子可以看說明。');
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
      $('#menu-title').textContent = auto ? '遊戲暫停了' : '暫停';
      body.innerHTML = (auto ? '<p class="hint">剛剛離開畫面，先幫你暫停</p>' : '') +
        '<button type="button" class="btn3d coral btn-wide" id="m-resume">繼續</button>' +
        '<button type="button" class="btn3d sand btn-wide" id="m-restart">重新開始</button>' +
        '<button type="button" class="btn3d sea btn-wide" id="m-home">回首頁</button>';
      $('#m-resume').onclick = () => menuModal.close();
      $('#m-restart').onclick = () => { menuModal.close(); $('#result').hidden = true; root.Solo.restart(); };
      $('#m-home').onclick = () => { root.Solo.stop(); menuModal.close(); show('home'); renderStats(); };
    } else {
      const room = root.Online.room;
      const isPlayer = room && room.you.role === 'player';
      $('#menu-title').textContent = '選單';
      body.innerHTML = '<p class="hint">線上對局不會暫停，其他人會繼續玩。</p>' +
        '<button type="button" class="btn3d coral btn-wide" id="m-resume">回到棋盤</button>' +
        (room && room.invite.active ? '<button type="button" class="btn3d sea btn-wide" id="m-copy">複製邀請連結</button>' : '') +
        '<button type="button" class="btn3d sand btn-wide" id="m-leave">離開房間</button>' +
        (isPlayer ? '<small class="hint">對局中離開，你的角色會交給電腦代打</small>' : '');
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
    const src = it => it.pts ? '' : '';
    let h = '<p class="ig-rule"><b>道具點數</b>：開局有「回合上限 × 10」點（不限回合 500 點），只能在道具商店花。' +
      '每次停到商店會隨機上架 3～6 樣，同一次只能各買 1 件；庫存整場全房共用，越貴越少。道具也能在商店半價賣回去。' +
      '機會／命運卡有時會送點數。每人最多帶 ' + R.MAX_ITEMS + ' 個道具。停在溫泉休息站、抽到道具箱會拿到隨機道具。</p><ul class="ig-list">';
    R.ITEM_LIST.forEach(id => {
      const it = R.ITEMS[id];
      h += '<li><span class="it-ico">' + root.Art.glyph('i_' + id) + '</span><span class="ig-tx"><b>' + esc(it.name) + '</b><small>' + esc(it.desc) + '</small></span>' +
        '<span class="ig-meta"><b>' + it.pts + ' 點</b><br>庫存 ' + R.stockFor(id, 4) + '／賣 ' + R.sellPrice(id) + ' 點' + src(it) + '</span></li>';
    });
    return h + '</ul>';
  }

  /* ---------- 怎麼玩（靜態圖文） ---------- */
  function renderHelp() {
    const G = Art.glyph;
    const step = (pic, h, p) => '<li><div class="help-pic">' + pic + '</div><div><h3>' + h + '</h3><p>' + p + '</p></div></li>';
    $('#help-body').innerHTML =
      '<ol class="help-steps">' +
      step(Art.dieSvg(4) + Art.dieSvg(3), '1. 擲骰子走路', '輪到你，先選「1 顆」還是「2 顆」骰子再按擲骰（1 顆走 1～6 步、2 顆走 2～12 步），棋子在棋盤上順時針走。每局地圖都是隨機產生的，開局前可以選地圖大小：48／64／80／96／120 格。起始現金＝回合數（不限回合算 100）×200×地圖倍率（48／64／80／96／120 格＝1.2／1.4／1.6／1.8／2 倍），經過起點的薪水＝500×同樣倍率。沒有雙骰再擲的規則。') +
      step(G('gem'), '2. 買地', '停在沒有主人的地上，可以花錢買下來。買不起或不想買就按「不買」。別人停在你的地上，要付你過路費。') +
      step(Art.houseSvg() + Art.hotelSvg(), '3. 走到自己的地才能蓋房', '走到自己的地時，面板會問你要不要加蓋房子（花的錢是那塊地的房價）。每塊地單獨最多升到 2 級；同色整組都是你的，才能繼續升到 4 棟、旅店，租金最高。整組都是你的，空地租金也加倍。')+
      step(G('chance'), '4. 機會與命運', '停在「機會」或「命運」會抽一張卡，可能領獎金、被罰錢、被送去別的地方。') +
      step(G('jail'), '5. 監獄', '被抓進監獄後，可以繳罰款、用出獄許可證離開，或待在牢裡等；想提早出去要繳罰款，罰款依你的總資產決定（10%，最少 50、最多 500 元）；在牢裡不能擲骰子；待滿整整 3 個回合免罰金出獄，第 4 回合起才能擲骰。路過監獄只是探監，不會被關。') +
      step(G('coin'), '6. 錢不夠就賣房', '要付錢卻不夠時，可以到「我的地產」賣房子換現金。實在湊不出來就破產，淘汰出局。') +
      step(G('god_fortune'), '7. 命運之神', '抽到好的機會／命運可能被福神（別人付你的過路費加倍）或財神（每回合領 120 元）附身；壞運氣會遇到窮神（你付雙倍過路費）或衰神（每回合被扣 80 元）。神明會陪你 4 個自己的回合。') +
      step(G('i_dice'), '8. 道具與攻擊', '停在休息站、抽到道具卡會獲得道具；停在「道具商店」用道具點數買道具（每次上架 3～6 樣、庫存全房共用），也能把道具半價賣回去；機會／命運卡有時會送點數。每人最多帶 10 個，大廳和面板上的「道具說明」／「道具庫」可以看全部道具。擲骰前可以主動用：遙控骰（選走 1～12 步）、機票、偷錢卡、換位卡、冰凍卡、炸彈、加蓋券、提款卡；免租券、減租券、免稅券、招財貓、起點加碼券、保釋券、購地折價券、護身符會在對的時候自動生效。') +
      '</ol>' +
      '<div class="help-tips"><h3>怎麼贏</h3><ul>' +
      '<li>其他人都破產，剩下的最後一個人獲勝。</li>' +
      '<li>如果設了回合上限，時間到就比總資產（現金＋地價＋房子），最多的人獲勝。</li>' +
      '<li>電腦有四種難度：幼幼班、簡單、普通、困難。</li>' +
      '<li>棋盤上每個玩家有不同顏色和形狀（圓、方、三角、菱形），看形狀就知道地是誰的。</li>' +
      '<li>空白鍵或 Enter 可以快速做「擲骰／買地／結束回合」。右上角齒輪可以調音樂、音效、動畫。</li>' +
      '</ul></div>' +
      '<button type="button" class="btn3d coral btn-wide" id="help-go">我懂了，開始玩！</button>';
    $('#help-go').onclick = () => openSolo();
  }

  root.App = { store, openMenu, gameLayout, chatArrived, modals, get settingsModal() { return settingsModal; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : this);
