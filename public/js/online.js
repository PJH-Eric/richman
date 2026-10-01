/* ===== online.js — 線上大廳、房間、觀戰、邀請連結、線上對局 ===== */
(function (root) {
  'use strict';

  const { $, $$, esc, toast, show } = root.UI;
  const Art = root.Art;
  const limitName = n => n ? n + ' 回合' : '不限回合';
  const DIFF_NAME = root.Board.DIFF_NAME;

  const S = {
    me: null,               /* { personId, name, char } */
    rooms: [],
    room: null,
    invite: null,           /* 網址帶進來的邀請 token */
    inviteInfo: null,
    board: null,
    boardRoomId: null,
    shownResultFor: null,
    chatSeq: -1,
    wasInGame: false,
    active: false
  };

  function init() {
    try { S.invite = new URLSearchParams(location.search).get('invite'); } catch (e) { S.invite = null; }

    root.Net.onStatus(renderConn);
    root.Net.on('welcome', m => {
      S.me = { personId: m.personId, name: m.name, char: m.char };
      if (S.invite && !S.inviteInfo) root.Net.send({ type: 'inviteInfo', invite: S.invite });
    });
    root.Net.on('lobby', m => { S.rooms = m.rooms || []; renderRooms(); });
    root.Net.on('room', m => onRoom(m.room));
    root.Net.on('inviteInfo', m => { S.inviteInfo = m; renderRooms(); });
    root.Net.on('error', m => toast(m.text, 'bad'));
    root.Net.on('notice', m => { toast(m.text); if (root.Sound) root.Sound.sfx('join'); });
    root.Net.on('closed', m => toast(m.text));
    root.Net.on('kicked', m => { toast(m.text, 'bad'); });
    root.Net.on('replaced', () => toast('你在別的分頁開了同一個身分，這個分頁先斷線', 'bad'));

    $('#lobby-quick').onclick = () => { saveProfile(); root.Net.send({ type: 'quick' }); };
    $('#lobby-create').onclick = () => { saveProfile(); root.Net.send({ type: 'create', max: 6, pace: 'normal', roundLimit: 40, mapSize: root.App.store.mapSize }); };
    $('#room-leave').onclick = () => leaveRoom();
    $('#room-list').addEventListener('click', e => {
      const b = e.target.closest('[data-join]');
      if (!b) return;
      saveProfile();
      if (b.dataset.invite) root.Net.send({ type: 'join', invite: b.dataset.invite, as: b.dataset.as });
      else root.Net.send({ type: 'join', roomId: b.dataset.join, as: b.dataset.as });
    });
    $('#screen-room').addEventListener('click', onRoomClick);
    /* 自製下拉選單（不用瀏覽器原生 select）：選單掛在 body 上、用 fixed 定位，不會被捲動容器裁掉 */
    let ddMenu = null, ddBtn = null;
    const ddClose = (focusBack) => {
      if (ddMenu) { ddMenu.remove(); ddMenu = null; }
      if (ddBtn) { ddBtn.setAttribute('aria-expanded', 'false'); if (focusBack && ddBtn.isConnected) ddBtn.focus(); ddBtn = null; }
    };
    const ddOpen = (btn) => {
      ddClose();
      ddBtn = btn; btn.setAttribute('aria-expanded', 'true');
      const keys = Object.keys(DIFF_NAME), cur = btn.dataset.val;
      const m = document.createElement('div');
      m.className = 'dd-menu'; m.setAttribute('role', 'listbox'); m.tabIndex = -1;
      m.innerHTML = keys.map(k => '<button type="button" role="option" class="dd-opt" data-val="' + k + '" aria-selected="' + (k === cur) + '">' + DIFF_NAME[k] + '</button>').join('');
      document.body.appendChild(m); ddMenu = m;
      const r = btn.getBoundingClientRect(), mw = Math.max(r.width, 120), mh = m.offsetHeight;
      const below = window.innerHeight - r.bottom - 8 >= mh || r.top < mh + 8;
      m.style.minWidth = mw + 'px';
      m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
      m.style.top = (below ? r.bottom + 6 : r.top - mh - 6) + 'px';
      const opts = [...m.querySelectorAll('.dd-opt')];
      (opts.find(o => o.dataset.val === cur) || opts[0]).focus();
      m.addEventListener('click', ev => {
        const o = ev.target.closest('.dd-opt'); if (!o) return;
        const id = btn.dataset.dd, v = o.dataset.val;
        ddClose(true);
        if (v !== cur) root.Net.send({ type: 'aiDiff', id, diff: v });
      });
      m.addEventListener('keydown', ev => {
        const i = opts.indexOf(document.activeElement);
        if (ev.key === 'ArrowDown') { ev.preventDefault(); opts[(i + 1) % opts.length].focus(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); opts[(i - 1 + opts.length) % opts.length].focus(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); ddClose(true); }
        else if (ev.key === 'Tab') { ev.preventDefault(); ddClose(true); }
      });
    };
    $('#room-host').addEventListener('ddselect', e => { if (S.room) root.Net.send({ type: 'settings', [e.detail.kind === 'limit' ? 'roundLimit' : 'mapSize']: Number(e.detail.val) }); });
    $('#screen-room').addEventListener('click', e => {
      const b = e.target.closest('[data-dd]');
      if (b) { if (ddBtn === b) ddClose(); else ddOpen(b); }
    });
    document.addEventListener('pointerdown', e => { if (ddMenu && !ddMenu.contains(e.target) && !e.target.closest('[data-dd]')) ddClose(); });
    window.addEventListener('resize', () => ddClose());

    $('#lobby-name').addEventListener('change', saveProfile);
  }

  function profile() {
    const st = root.App.store;
    return { name: st.nickname, char: st.char };
  }

  function saveProfile() {
    const st = root.App.store;
    const nm = $('#lobby-name').value.trim().slice(0, 10);
    st.nickname = nm || st.nickname || root.UI.randomName();
    $('#lobby-name').value = st.nickname;
    root.Store.save(st);
    root.Net.setProfile(profile());
    if (root.Net.connected) root.Net.send({ type: 'profile', name: st.nickname, char: st.char });
  }

  /* ---------- 大廳 ---------- */

  function enterLobby() {
    S.active = true;
    try { sessionStorage.setItem('richman-online', '1'); } catch (e) { /* 忽略 */ }
    const st = root.App.store;
    if (!st.nickname) { st.nickname = root.UI.randomName(); root.Store.save(st); }
    $('#lobby-name').value = st.nickname;
    root.UI.setChar($('#lobby-chars'), st.char);
    show('lobby');
    renderRooms();
    root.Net.open(profile());
    renderConn(root.Net.status);
  }

  function renderConn(s, detail) {
    const el = $('#lobby-conn');
    if (!el) return;
    const map = {
      idle: ['', '尚未連線'],
      connecting: ['wait', '連線中…'],
      waking: ['wait', '喚醒伺服器中…（免費伺服器睡著了，第一次要等 30～60 秒）' + (detail ? ' 已等 ' + detail + ' 秒' : '')],
      open: ['ok', '已連線'],
      retrying: ['wait', '連線中斷，重新連線中…'],
      offline: ['bad', '連不上伺服器，稍後會自動再試'],
      unset: ['bad', '這個版本沒有設定遊戲伺服器，只能玩「一個人玩」' + (detail ? '（' + detail + '）' : '')]
    };
    const m = map[s] || map.idle;
    el.className = 'conn-line ' + m[0];
    el.innerHTML = '<i class="dot"></i><span>' + esc(m[1]) + '</span>';
    const dis = s !== 'open';
    $('#lobby-quick').disabled = dis;
    $('#lobby-create').disabled = dis;

    const banner = $('#net-banner');
    if (banner) {
      const inGame = root.UI.current === 'game' && !root.Solo.active;
      banner.hidden = !(inGame && s !== 'open');
      banner.textContent = s === 'waking' ? '喚醒伺服器中…' : '連線中斷，重新連線中…（操作暫時送不出去）';
    }
  }

  function renderRooms() {
    const ul = $('#room-list');
    if (!ul) return;
    let h = '';
    const inv = S.inviteInfo;
    if (S.invite) {
      if (!inv) h += '<li class="invite-card">正在確認邀請連結…</li>';
      else if (!inv.ok) h += '<li class="invite-card bad">' + esc(inv.error) + '</li>';
      else {
        const full = inv.playing || inv.seats >= inv.max;
        h += '<li class="invite-card"><div><b>你收到邀請</b><span>' + esc(inv.name) + '（' + inv.seats + '/' + inv.max + '，' +
          (inv.playing ? '對局中' : '等待中') + '）</span>' +
          (full ? '<small>現在只能觀戰，下一局可以換上桌</small>' : '') + '</div>' +
          '<div class="room-btns">' +
          '<button type="button" class="btn3d coral small" data-join="' + inv.id + '" data-invite="' + esc(S.invite) + '" data-as="player"' + (full ? ' disabled' : '') + '>加入遊戲</button>' +
          '<button type="button" class="btn3d sea small" data-join="' + inv.id + '" data-invite="' + esc(S.invite) + '" data-as="spectator">觀戰</button>' +
          '</div></li>';
      }
    }
    if (!S.rooms.length) {
      h += '<li class="empty"><span class="empty-ico" aria-hidden="true">🏝️</span><b>現在沒有房間</b><small>按「快速加入」會自動幫你開一間，或自己「建立房間」找朋友來玩！</small></li>';
    } else {
      h += S.rooms.map(r => {
        const full = r.players >= r.max;
        let dots = '';
        for (let k = 0; k < r.max; k++) dots += '<i class="sdot' + (k < r.players ? ' on' : '') + '"></i>';
        return '<li class="room-row' + (r.playing ? ' playing' : '') + '"><div class="room-meta"><b class="room-name">' + esc(r.name) + '</b>' +
          '<span class="pill ' + (r.playing ? 'playing' : 'waiting') + '">' + (r.playing ? '對局中' : '等待中') + '</span>' +
          '<div class="room-info"><span class="seat-dots" role="img" aria-label="玩家 ' + r.players + '/' + r.max + '">' + dots + '<em>' + r.players + '/' + r.max + '</em></span>' +
          '<span class="chip">' + r.mapSize + ' 格</span><span class="chip">' + limitName(r.roundLimit) + '</span>' +
          (r.specs ? '<span class="chip">觀戰 ' + r.specs + '</span>' : '') + '<span class="code">' + r.id + '</span></div></div>' +
          '<div class="room-btns">' +
          '<button type="button" class="btn3d coral small" data-join="' + r.id + '" data-as="player"' + (r.playing || full ? ' disabled' : '') + '>' + (full ? '已滿' : '加入遊戲') + '</button>' +
          '<button type="button" class="btn3d sea small" data-join="' + r.id + '" data-as="spectator">觀戰</button></div></li>';
      }).join('');
    }
    ul.innerHTML = h;
    const rc = $('#room-count'); if (rc) rc.textContent = S.rooms.length ? S.rooms.length + ' 間' : '';
  }

  /* ---------- 房間 ---------- */

  function onRoom(room) {
    const prev = S.room;
    S.room = room;
    if (!S.active) return;
    if (!room) {
      endTable();
      if (['room', 'game'].includes(root.UI.current)) {
        if (prev && root.UI.current === 'game' && $('#result').hidden === false) return;
        show('lobby');
      }
      root.UI.chat.clear();
      S.chatSeq = -1;
      renderRooms();
      return;
    }
    /* 拿到房間就把網址上的邀請清掉，免得重新整理又跳邀請 */
    if (S.invite) {
      S.invite = null; S.inviteInfo = null;
      try { const u = new URL(location.href); u.searchParams.delete('invite'); history.replaceState(null, '', u); } catch (e) { /* 忽略 */ }
    }
    if (room.chatSeq !== S.chatSeq) {
      const grew = S.chatSeq >= 0 && room.chatSeq > S.chatSeq;
      S.chatSeq = room.chatSeq;
      root.UI.chat.set(room.chat);
      if (grew) root.App.chatArrived(room.chat[room.chat.length - 1]);
    }
    root.UI.chat.canSend = true;

    if (room.game) {
      /* 新的一局開始：還停在上一局結算畫面的人也要自動回到牌桌 */
      $('#result').hidden = true;
      if (root.UI.current !== 'game') { show('game'); root.App.gameLayout(true); }
      renderGame(room);
      S.wasInGame = true;
    } else {
      if (S.wasInGame && room.lastGame && S.board) {
        /* 這局剛結束：留在棋盤上秀結算 */
        S.board.render(room.lastGame);
        showResult(room);
        S.wasInGame = false;
      } else if (root.UI.current === 'game' && !$('#result').hidden) {
        /* 結算畫面開著，等使用者按按鈕 */
      } else {
        endTable();
        if (root.UI.current !== 'room') show('room');
      }
      renderRoom(room);
    }
  }

  function renderRoom(room) {
    $('#room-title').textContent = room.name + '・' + room.id;
    const me = room.you;
    const iPlayer = me.role === 'player';
    const seatsFree = room.max - room.seats.length;
    $('#room-summary').innerHTML = '<div class="rs-title"><b>' + esc(room.name) + '</b><span class="code">' + room.id + '</span></div>' +
      '<div class="rs-chips"><span class="chip">玩家 ' + room.seats.length + '/' + room.max + '</span><span class="chip">' + room.mapSize + ' 格</span><span class="chip">' + limitName(room.roundLimit) + '</span>' +
      (room.specs.length ? '<span class="chip">觀戰 ' + room.specs.length + '</span>' : '') + '</div>';
    $('#room-role').innerHTML =
      '<span class="pill ' + (iPlayer ? 'waiting' : 'spec') + '">' + (iPlayer ? '你是玩家' : '你是觀戰者') + '</span>' +
      (me.host ? '<span class="pill host">' + Art.icon('crown') + '房主</span>' : '') +
      (iPlayer ? '<button type="button" class="link-btn" data-act="to-spec">改成觀戰</button>'
        : (seatsFree > 0 ? '<button type="button" class="link-btn" data-act="to-player">上桌玩</button>' : '<small>座位已滿</small>'));

    let h = '';
    room.seats.forEach((s, si) => {
      const isMe = s.id === me.id;
      const tags = [];
      if (s.id === room.hostId) tags.push('<i class="tag host">房主</i>');
      if (s.kind === 'ai' && me.host) {
        /* 房主可以替每個電腦各自選難度 */
        tags.push('<button type="button" class="ai-dd" data-dd="' + s.id + '" data-val="' + s.diff + '" aria-haspopup="listbox" aria-expanded="false" aria-label="' + esc(s.name) + ' 的難度：' + DIFF_NAME[s.diff] + '"><span>' + DIFF_NAME[s.diff] + '</span><i class="ai-dd-caret" aria-hidden="true"></i></button>');
      } else if (s.kind === 'ai') tags.push('<i class="tag ai">電腦・' + DIFF_NAME[s.diff] + '</i>');
      else if (!s.online) tags.push('<i class="tag off">離線</i>');
      else if (s.id === room.hostId) tags.push('<i class="tag ready">開局者</i>');
      else tags.push(s.ready ? '<i class="tag ready">準備好了</i>' : '<i class="tag wait">還沒準備</i>');
      let act = '';
      if (me.host && s.kind === 'ai') act = '<button type="button" class="icon-btn small" data-act="rm-ai" data-id="' + s.id + '" aria-label="移除' + esc(s.name) + '">' + Art.icon('close') + '</button>';
      else if (me.host && !isMe) act = '<button type="button" class="icon-btn small" data-act="kick" data-id="' + s.id + '" aria-label="請' + esc(s.name) + '離開">' + Art.icon('kick') + '</button>';
      h += '<li class="seat-row' + (isMe ? ' me' : '') + '"><i class="seat-no">' + (si + 1) + '</i><span class="mini">' + Art.animalSvg(s.char || 'otter') + '</span>' +
        '<b class="nm">' + esc(s.name) + (isMe ? '（你）' : '') + '</b>' + tags.join('') + act + '</li>';
    });
    for (let i = 0; i < seatsFree; i++) {
      h += '<li class="seat-row empty"><i class="seat-no">' + (room.seats.length + i + 1) + '</i><span class="mini ghost"></span><b class="nm">空位</b>' +
        (me.host ? '<button type="button" class="btn3d sand small" data-act="add-ai">' + Art.icon('robot') + '加電腦</button>' : '') + '</li>';
    }
    $('#room-seats').innerHTML = h;

    /* 主要按鈕 */
    let a = '';
    const mySeat = room.seats.find(s => s.id === me.id);
    if (me.host && iPlayer) {
      const waiting = room.seats.filter(s => s.kind === 'human' && s.id !== me.id && !s.ready).length;
      const can = room.seats.length >= 2 && waiting === 0;
      a += '<button type="button" class="btn3d coral btn-wide" data-act="start"' + (can ? '' : ' disabled') + '>開始對局</button>' +
        '<small class="hint">' + (room.seats.length < 2 ? '至少 2 個人才能開局，可以按「加電腦」補位' : waiting ? '等其他玩家按準備好' : '大家都準備好了！') + '</small>';
    } else if (iPlayer && mySeat) {
      a += '<button type="button" class="btn3d ' + (mySeat.ready ? 'sand' : 'coral') + ' btn-wide" data-act="ready">' + (mySeat.ready ? '取消準備' : '準備好了') + '</button>' +
        '<small class="hint">房主會在大家準備好後開局</small>';
    } else if (me.host) {
      a += '<small class="hint">你是房主但在觀戰席，要上桌才能開局</small>';
    } else {
      a += '<small class="hint">觀戰中，對局開始後會自動看到牌桌</small>';
    }
    if (room.lastGame) {
      const w = room.lastGame.seats[room.lastGame.winner];
      a += '<p class="last-game">上一局：' + esc(w ? w.name : '') + ' 獲勝' + (room.lastGame.reason === 'roundLimit' ? '（回合數到，比總資產）' : '') + '</p>';
    }
    $('#room-actions').innerHTML = a;

    /* 房主設定 */
    const seg = (k, opts, cur) => '<div class="seg small" role="radiogroup">' + opts.map(o =>
      '<button type="button" role="radio" aria-checked="' + (String(o[0]) === String(cur)) + '" data-set="' + k + '" data-val="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>';
    $('#room-host').innerHTML = me.host
      ? '<h4>' + Art.icon('crown') + '房間設定（房主）</h4>' +
        '<div class="dd-pair"><div class="field"><span>地圖大小</span>' + root.UI.mapCards(room.mapSize, '') + '</div>' +
        '<div class="field"><span>回合上限</span>' + root.UI.limitSelect(room.roundLimit, '') + '</div></div>' +
        '<small class="hint">每一局的主題、地名和格子位置都是隨機生成的</small>'
      : '<p class="host-info">地圖 ' + room.mapSize + ' 格（每局隨機生成）・' + limitName(room.roundLimit) + '（房主決定）</p>';

    /* 邀請連結 */
    const link = room.invite.active ? inviteLink(room.invite.token) : '';
    $('#room-invite').innerHTML = '<h4>' + Art.icon('link') + '邀請連結</h4>' +
      (room.invite.active
        ? '<div class="invite-row"><input readonly value="' + esc(link) + '" aria-label="邀請連結" id="invite-url">' +
          '<button type="button" class="btn3d sea small" data-act="copy">複製</button>' +
          (navigator.share ? '<button type="button" class="btn3d sea small" data-act="share">分享</button>' : '') + '</div>' +
          '<small class="hint">朋友打開連結可以選「加入遊戲」或「觀戰」；房間關閉後連結自動失效</small>'
        : '<p class="hint">邀請連結已撤銷' + (me.host ? '' : '，請房主重發') + '</p>') +
      (me.host ? '<div class="invite-row"><button type="button" class="link-btn" data-act="regen">重發新連結</button>' +
        (room.invite.active ? '<button type="button" class="link-btn danger" data-act="revoke">撤銷連結</button>' : '') + '</div>' : '');

    $('#room-specs').innerHTML = '<h4>' + Art.icon('eye') + '觀戰席（' + room.specs.length + '/20）</h4>' +
      (room.specs.length ? '<ul class="spec-list">' + room.specs.map(s =>
        '<li><span class="mini">' + Art.animalSvg(s.char || 'otter') + '</span>' + esc(s.name) + (s.id === me.id ? '（你）' : '') +
        (me.host && s.id !== me.id ? '<button type="button" class="icon-btn small" data-act="kick" data-id="' + s.id + '" aria-label="請' + esc(s.name) + '離開">' + Art.icon('kick') + '</button>' : '') +
        '</li>').join('') + '</ul>' : '<p class="hint">目前沒有人觀戰</p>');
  }

  function inviteLink(tok) {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('invite', tok);
    if (root.Config.source === 'query' && root.Config.serverUrl) u.searchParams.set('server', root.Config.serverUrl);
    return u.toString();
  }

  function onRoomClick(e) {
    const b = e.target.closest('[data-act],[data-set]');
    if (!b || !S.room) return;
    const act = b.dataset.act;
    if (b.dataset.set) {
      const v = (b.dataset.set === 'max' || b.dataset.set === 'roundLimit' || b.dataset.set === 'mapSize') ? Number(b.dataset.val) : b.dataset.val;
      root.Net.send({ type: 'settings', [b.dataset.set]: v });
      return;
    }
    const mySeat = S.room.seats.find(s => s.id === S.room.you.id);
    switch (act) {
      case 'ready': root.Net.send({ type: 'ready', ready: !(mySeat && mySeat.ready) }); break;
      case 'start': root.Net.send({ type: 'start' }); break;
      case 'add-ai': root.Net.send({ type: 'addAI' }); break;
      case 'rm-ai': root.Net.send({ type: 'removeAI', id: b.dataset.id }); break;
      case 'kick': root.Net.send({ type: 'kick', personId: b.dataset.id }); break;
      case 'to-spec': root.Net.send({ type: 'switch', to: 'spectator' }); break;
      case 'to-player': root.Net.send({ type: 'switch', to: 'player' }); break;
      case 'regen': root.Net.send({ type: 'invite' }); break;
      case 'revoke': root.Net.send({ type: 'invite', revoke: true }); break;
      case 'copy': copyInvite(); break;
      case 'share': {
        const url = $('#invite-url').value;
        navigator.share({ title: '寶島大富翁', text: '一起來玩寶島大富翁！', url }).catch(() => {});
        break;
      }
    }
  }

  function copyInvite() {
    const input = $('#invite-url');
    if (!input) return;
    const done = () => toast('邀請連結已複製');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(done, () => { input.select(); document.execCommand('copy'); done(); });
    else { input.select(); document.execCommand('copy'); done(); }
  }

  function leaveRoom() {
    root.Net.send({ type: 'leave' });
    endTable();
    show('lobby');
  }

  /* ---------- 線上對局 ---------- */

  function renderGame(room) {
    if (!S.board || S.boardRoomId !== room.id) {
      endTable();
      const ui = root.App.modals;
      S.board = root.Board.create($('#board'), $('#summary'), {
        myId: room.you.role === 'player' ? room.you.id : null,
        online: true, map: room.game.map,
        settings: () => root.App.store,
        onAct: a => {
          const ok = root.Net.send({ type: 'act', action: a });
          if (!ok) toast('連線中斷，這個動作沒有送出去', 'bad');
        },
        manage: ui.manage, tile: ui.tile
      });
      S.boardRoomId = room.id;
    }
    S.board.render(room.game);
  }
  function showResult(room) {
    const v = room.lastGame;
    const myId = room.you.id;
    const mine = v.seats.findIndex(s => s.id === myId);
    if (mine >= 0) {
      root.Store.record(root.App.store, 'online', mine === v.winner);
      root.Sound.sfx(mine === v.winner ? 'win' : 'lose');
    } else root.Sound.sfx('win');
    const box = $('#result');
    box.innerHTML = root.Board.resultHtml(v, myId, '一共玩了 ' + v.round + ' 回合');
    $('#result-actions').innerHTML =
      '<button type="button" class="btn3d coral" id="res-room">回到房間</button>' +
      '<button type="button" class="btn3d sand" id="res-leave">離開房間</button>';
    box.hidden = false;
    $('#res-room').onclick = () => { box.hidden = true; endTable(); if (S.room) { show('room'); renderRoom(S.room); } else show('lobby'); };
    $('#res-leave').onclick = () => { box.hidden = true; leaveRoom(); };
    $('#res-room').focus({ preventScroll: true });
  }

  function endTable() {
    if (S.board) { S.board.destroy(); S.board = null; S.boardRoomId = null; }
  }

  function exit() {
    S.active = false;
    try { sessionStorage.removeItem('richman-online'); } catch (e) { /* 忽略 */ }
    if (S.room) root.Net.send({ type: 'leave' });
    endTable();
    root.Net.close();
    S.room = null;
    root.UI.chat.clear();
    S.chatSeq = -1;
  }

  root.Online = {
    wasOnline() { try { return sessionStorage.getItem('richman-online') === '1'; } catch (e) { return false; } },
    init, enterLobby, leaveRoom, exit, copyInvite,
    get room() { return S.room; },
    get active() { return S.active; },
    get board() { return S.board; },
    get hasInvite() { return !!S.invite; }
  };
})(typeof self !== 'undefined' ? self : this);
