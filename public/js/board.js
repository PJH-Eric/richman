/* ===== board.js — 棋盤畫面：各種格數的地圖、棋子、骰子、操作按鈕、左欄摘要、我的地產、格子說明 =====
 *
 * 單機與線上共用同一個元件：外面只要把 Rules.publicView() 的結果丟進 render()，
 * 它會照「事件」播動畫（擲骰 → 棋子一格一格走 → 錢飄字 → 抽卡），播完才把最新的局面畫出來，
 * 所以畫面上「棋子還在路上時，錢和地已經變了」這種錯位不會發生。
 * 玩家的操作透過 opt.onAct(action) 交出去（單機直接進 Rules.act，線上送到伺服器）。
 */
(function (root) {
  'use strict';

  const R = root.Rules;
  const Art = root.Art;
  const { esc } = root.UI;
  const T = R.TILES;
  const COLORS = R.PLAYER_COLORS;
  const DIFF_NAME = { kid: '幼幼班', easy: '簡單', normal: '普通', hard: '困難' };
  const SHAPE = ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'cross', 'ring', 'star'];
  const SHAPE_NAME = ['圓形', '方形', '三角', '菱形', '六角', '十字', '圓環', '星形'];

  function shapeSvg(k, color, cls) {
    const p = { circle: '<circle cx="12" cy="12" r="8.5"/>', square: '<rect x="4" y="4" width="16" height="16" rx="2.5"/>',
      triangle: '<path d="M12 3.5L21.5 20H2.5Z" stroke-linejoin="round"/>', diamond: '<path d="M12 2.5L21.5 12L12 21.5L2.5 12Z" stroke-linejoin="round"/>',
      hexagon: '<path d="M12 2.5L20.5 7.25V16.75L12 21.5L3.5 16.75V7.25Z" stroke-linejoin="round"/>',
      cross: '<path d="M9 3H15V9H21V15H15V21H9V15H3V9H9Z" stroke-linejoin="round"/>',
      ring: '<path fill-rule="evenodd" d="M12 3.5A8.5 8.5 0 1 0 12 20.5A8.5 8.5 0 1 0 12 3.5ZM12 8A4 4 0 1 1 12 16A4 4 0 1 1 12 8Z"/>',
      star: '<path d="M12 2.5L14.6 9L21.5 9.4L16.1 13.7L17.9 20.5L12 16.7L6.1 20.5L7.9 13.7L2.5 9.4L9.4 9Z" stroke-linejoin="round"/>' }[SHAPE[k % 8]];
    return '<svg viewBox="0 0 24 24" class="shape ' + (cls || '') + '" aria-hidden="true" fill="' + color + '" stroke="#fff" stroke-width="2">' + p + '</svg>';
  }

  const money = n => n.toLocaleString('en-US');
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function reasonText(r) {
    return { rent: '過路費', tax: '稅金', card: '卡片', buy: '買地', jail: '罰金', go: '起點薪水', buyout: '收購', shop: '商店' }[r] || '';
  }

  /* ---------- 建立 ---------- */

  function create(boardEl, sumEl, opt) {
    R.useMap(opt.map);      /* 先切到這一局的地圖，3D 棋盤才知道要排幾格 */
    const B = {
      opt, myId: opt.myId || null, view: null, shown: null, latest: null, lastN: -1,
      queue: [], pumping: false, busy: false, dead: false, pos: [], first: true,
      lastTurn: -1, lastPhase: '', sent: false, deadlineAt: 0, cardResolve: null, confirmBankrupt: false
    };
    const st = () => (opt.settings ? opt.settings() : {});
    const reduce = () => !!st().reduceMotion;

    boardEl.innerHTML = '<div class="mb"><div class="mc"></div></div>';
    boardEl.classList.add('is3d');
    const mb = boardEl.querySelector('.mb');
    const mc = mb.querySelector('.mc');

    /* --- 3D 場景（three.js 要先載入，載好之前先顯示「準備中」） --- */
    B.v3 = null;
    B.err = null;
    mc.innerHTML = '<p class="mc-prompt dim">3D 棋盤準備中…</p>';
    root.Board3D.create(boardEl, {
      map: opt.map,
      onTile: i => B.tileClick(i),
      reduce: () => reduce()
    }).then(v3 => {
      if (B.dead) { v3.destroy(); return; }
      B.v3 = v3;
      if (B.shown) drawAll();
    }).catch(err => {
      B.err = err;
      mc.innerHTML = '<p class="mc-prompt strong">這台裝置或瀏覽器不支援 3D 畫面（WebGL），玩不了這個遊戲。</p>' +
        '<p class="hint">請換一個新一點的瀏覽器，或到瀏覽器設定打開「硬體加速」。</p>';
    });

    /* --- 棋子位置 --- */
    const OFFS = [[-.24, -.24], [.24, -.24], [-.24, .24], [.24, .24], [0, -.34], [0, .34], [-.36, 0], [.36, 0]];
    function placeTok(i, tile, opts) {
      if (!B.v3) return;
      /* 同一格有多個棋子時錯開 */
      const same = B.pos.map((p, k) => k).filter(k => B.pos[k] === tile && !(B.shown && B.shown.seats[k] && B.shown.seats[k].bankrupt));
      const idx = Math.max(0, same.indexOf(i));
      const o = same.length > 1 ? OFFS[idx % 8] : [0, 0];
      B.v3.setTok(i, tile, o[0] * 1.6, o[1] * 1.6, { jump: !!(opts && opts.jump), dur: (opts && opts.jump) ? 380 : stepMs() * 0.95, instant: !!(opts && opts.instant) });
    }
    function placeAll(instant) {
      if (!B.shown || !B.v3) return;
      B.v3.setSeats(B.shown.seats);
      B.shown.seats.forEach((s, i) => { placeTok(i, B.pos[i] == null ? s.pos : B.pos[i], { instant }); B.v3.hideTok(i, !!s.bankrupt); });
    }
    function setOn(t) { if (B.v3) B.v3.highlight(t == null ? -1 : t); }

    /* ---------- 畫面：格子狀態 ---------- */

    function drawTiles(v) { if (B.v3) B.v3.setTiles(v); }

    /* ---------- 畫面：中央操作區 ---------- */

    function seatTag(s, i, v) {
      const tags = [];
      if (s.ai && !s.afk) tags.push('電腦・' + (DIFF_NAME[s.ai] || ''));
      if (s.afk) tags.push('代打中');
      if (s.jail) tags.push('坐牢');
      if (s.god && R.GODS[s.god.k]) tags.push(R.GODS[s.god.k].name + '×' + s.god.turns);
      if (s.bankrupt) tags.push('破產');
      return tags;
    }

    function tileMini(ti) {
      const t = T[ti];
      const rent = t.type === 'prop' ? t.rent[0] : t.type === 'station' ? '25～200' : '骰子×4／×10';
      return '<div class="mc-tile">' +
        (t.type === 'prop' ? '<i class="mc-band" style="background:' + R.GROUPS[t.group].color + '"></i>' : '') +
        '<span class="mc-gl">' + Art.glyph(t.glyph) + '</span>' +
        '<span class="mc-tn"><b>' + esc(t.name) + '</b><small>地價 ' + t.price + '・空地租金 ' + rent + '</small></span></div>';
    }

    function diceText(d) {
      if (!d[0]) return '';
      if (!d[1]) return '遙控骰：走 ' + d[0] + ' 步';
      return d[0] + '＋' + d[1] + '＝' + (d[0] + d[1]) + (d[0] === d[1] ? '（雙骰）' : '');
    }
    function itemChips(s, canUse, opts) {
      const n = (s.items || []).length;
      let out = '<div class="mc-itemwrap"><button type="button" class="mc-ihead" data-inv="1" aria-label="打開道具庫"><b>\uD83C\uDF92 道具庫</b><small>' + n + '／' + R.MAX_ITEMS + '　查看全部 ›</small></button>';
      if (!n) {
        out += '<p class="mc-inone">還沒有道具：停在休息站、道具商店，或抽到道具卡就能拿到</p></div>';
        return out;
      }
      out += '<div class="mc-items" role="group" aria-label="我的道具">' + s.items.map(id => {
        const it = R.ITEMS[id];
        const active = it.active && canUse && !!opts[id];
        const inner = '<span class="it-ico">' + Art.glyph('i_' + id) + '</span><span class="it-tx"><b>' + it.name + '</b><small>' +
          (it.active ? (active ? '點我使用' : '擲骰前可用') : '自動生效') + '</small></span>';
        return active
          ? '<button type="button" class="it-chip on' + (B.pick === id ? ' sel' : '') + '" data-item="' + id + '" title="' + esc(it.desc) + '">' + inner + '</button>'
          : '<span class="it-chip" title="' + esc(it.desc) + '">' + inner + '</span>';
      }).join('') + '</div>';
      return out + '</div>';
    }

    function centerHtml(v) {
      const me = meIndex(v);
      const cur = v.seats[v.turn];
      const mine = me >= 0 && me === v.turn;
      const opts = me >= 0 ? R.options(v, B.myId) : null;
      const lim = v.opts.roundLimit;
      let out = '<div class="mc-top"><b class="mc-round">第 ' + v.round + (lim ? '／' + lim : '') + ' 回合</b>' +
        (v.turnLeftMs != null ? '<span class="mc-timer" aria-live="off"></span>' : '') +
        (me >= 0 ? '<button type="button" class="mc-props" data-open="props" aria-label="我的地產清單">' + Art.icon('home') + '我的地產</button>' : '') + '</div>';
      out += '<div class="mc-turn' + (mine ? ' mine' : '') + '" style="--seat:' + COLORS[v.turn] + '">' +
        '<span class="mini">' + Art.animalSvg(cur.char) + '</span><b>' + (mine ? '輪到你了！' : '輪到 ' + esc(cur.name)) + '</b>' +
        seatTag(cur, v.turn, v).map(t => '<i class="tag">' + t + '</i>').join('') + '</div>';
      out += '<div class="mc-dice" aria-live="polite">' +
        (v.dice[0] ? '<span class="mc-sum">' + diceText(v.dice) + '</span>' : '') + '</div>';
      const last = v.log[v.log.length - 1];
      out += '<p class="mc-msg">' + esc(last ? last.text : '') + '</p>';
      const canItem = mine && v.phase === 'roll' && !cur.jail && !B.busy && !B.sent && opts;
      if (me >= 0) out += itemChips(v.seats[me], canItem, opts || {});
      if (canItem && B.pick === 'dice') {
        out += '<div class="mc-pick"><p class="mc-prompt strong">遙控骰：想走幾步？</p><div class="pick-n">' +
          [1, 2, 3, 4, 5, 6].map(n => '<button type="button" class="pick-btn" data-n="' + n + '" aria-label="走 ' + n + ' 步">' + Art.dieSvg(n) + '<small>' + tileShort((cur.pos + n) % T.length) + '</small></button>').join('') +
          '</div><button type="button" class="link-btn" data-pickcancel="1">先不用</button></div>';
        return out;
      }
      if (canItem && (B.pick === 'steal' || B.pick === 'swap') && opts) {
        const ids = R.itemTargets(v, me, B.pick);
        out += '<div class="mc-pick"><p class="mc-prompt strong">' + R.ITEMS[B.pick].name + '：選一位對手</p><div class="tgt-list">' +
          ids.map(i => { const o = v.seats[i]; return '<button type="button" class="tgt-btn" data-tgt="' + i + '" style="--seat:' + COLORS[i] + '"><span class="mini">' + Art.animalSvg(o.char) + '</span><b>' + esc(o.name) + '</b><small>' + (B.pick === 'steal' ? money(o.cash) + ' 元' : tileShort(o.pos)) + '</small></button>'; }).join('') +
          '</div><button type="button" class="link-btn" data-pickcancel="1">先不用</button></div>';
        return out;
      }
      if (canItem && B.pick === 'bomb') {
        out += '<div class="mc-pick"><p class="mc-prompt strong">炸彈：點棋盤上對手蓋了房子的地</p><button type="button" class="link-btn" data-pickcancel="1">先不用</button></div>';
        return out;
      }
      if (canItem && B.pick === 'fly') {
        out += '<div class="mc-pick"><p class="mc-prompt strong">機票：點棋盤上要飛去的格子</p><button type="button" class="link-btn" data-pickcancel="1">先不用</button></div>';
        return out;
      }

      if (v.phase === 'over') {
        out += '<p class="mc-prompt strong">遊戲結束</p>';
      } else if (B.busy) {
        out += '<p class="mc-prompt dim">…</p>';
      } else if (me < 0) {
        out += '<p class="mc-prompt dim">觀戰中：' + (cur.ai ? '電腦思考中…' : '等 ' + esc(cur.name) + ' 操作') + '</p>';
      } else if (!mine) {
        out += '<p class="mc-prompt dim">' + (cur.ai && !cur.afk ? esc(cur.name) + ' 思考中…' : '等 ' + esc(cur.name) + ' 操作…') + '</p>';
      } else {
        const dis = B.sent ? ' disabled' : '';
        if (v.phase === 'roll') {
          if (cur.jail) {
            out += '<p class="mc-prompt">你在監獄裡（第 ' + (cur.jailTurns + 1) + '／3 回合）：擲出雙骰就能出獄</p>';
            out += '<div class="mc-actions">' + btn('roll', 'coral', 'dice', '擲骰子', dis) +
              (opts.payJail ? btn('payJail', 'sand small', 'coin', '繳 ' + R.JAIL_FINE + ' 元出獄', dis) : '') +
              (opts.useCard ? btn('useCard', 'sea small', 'cards', '用出獄許可證', dis) : '') + '</div>';
          } else {
            out += '<div class="mc-actions">' + btn('roll', 'coral', 'dice', v.doubles ? '再擲一次！' : '擲骰子', dis) + '</div>';
          }
        } else if (v.phase === 'buy' && v.pending) {
          out += tileMini(v.pending.tile);
          out += '<div class="mc-actions two">' + btn('buy', 'coral', 'coin', '買下 ' + v.pending.price + ' 元', (opts.buy ? '' : ' disabled') + dis) +
            btn('decline', 'sand', '', '不買', dis) + '</div>';
          if (!opts.buy) out += '<p class="mc-prompt dim">現金不夠（' + money(cur.cash) + ' 元）。可以先到「我的地產」抵押換錢</p>';
        } else if (v.phase === 'build' && v.pending) {
          const bt = T[v.pending.tile], bp = v.props[v.pending.tile];
          out += tileMini(v.pending.tile);
          out += '<p class="mc-prompt strong">這是你的地，要加蓋房子嗎？<br><small>' + (bp.houses === 4 ? '升級成旅店' : '第 ' + bp.houses + ' 棟 → 第 ' + (bp.houses + 1) + ' 棟') + '・花 ' + bt.house + ' 元</small></p>';
          out += '<div class="mc-actions two">' + btn('build', 'coral', 'home', '蓋！−' + bt.house, ' data-tile="' + v.pending.tile + '"' + ((opts.build && opts.build.length) ? '' : ' disabled') + dis) +
            btn('decline', 'sand', '', '不蓋', dis) + '</div>';
        } else if (v.phase === 'shop' && v.pending) {
          out += '<p class="mc-prompt strong">道具商店：你有 ' + money(cur.cash) + ' 元，道具欄 ' + cur.items.length + '／' + R.MAX_ITEMS + '</p><div class="shop-list" role="group" aria-label="商品">' +
            (opts.shop || []).map(x => { const it = R.ITEMS[x.item]; return '<button type="button" class="shop-item" data-shop="' + x.item + '" title="' + esc(it.desc) + '"' + (x.can && !B.sent ? '' : ' disabled') + '><span class="it-ico">' + Art.glyph('i_' + x.item) + '</span><span class="it-tx"><b>' + it.name + '</b><small>' + esc(it.desc.replace(/^擲骰前使用：/, '')) + '</small></span><i class="shop-price">' + x.cost + '</i></button>'; }).join('') +
            '</div><div class="mc-actions">' + btn('decline', 'sand', '', '離開商店', dis) + '</div>';
        } else if (v.phase === 'debt' && v.pending) {
          const need = Math.max(0, v.pending.amount - cur.cash);
          out += '<p class="mc-prompt strong">要付 ' + money(v.pending.amount) + ' 元' + (v.pending.creditor >= 0 ? '給 ' + esc(v.seats[v.pending.creditor].name) : '') +
            '，現金 ' + money(cur.cash) + ' 元，還差 ' + money(need) + ' 元</p>';
          out += '<div class="mc-actions">' + btn('settle', 'coral', 'check', '付清', (opts.settle ? '' : ' disabled') + dis) +
            '<button type="button" class="btn3d sea" data-a="manage">' + Art.icon('home') + '賣房子／抵押湊錢</button>' +
            '<button type="button" class="btn3d sand small" data-a="bankrupt"' + dis + '>' + (B.confirmBankrupt ? '確定要破產嗎？再按一次' : '宣告破產') + '</button></div>';
        } else if (v.phase === 'manage') {
          out += '<div class="mc-actions two">' + btn('endTurn', 'coral', 'check', '結束回合', dis) +
            '<button type="button" class="btn3d sea" data-a="manage">' + Art.icon('home') + '我的地產</button></div>';
        } else {
          out += '<div class="mc-actions two"><button type="button" class="btn3d sea" data-a="manage">' + Art.icon('home') + '我的地產</button></div>';
        }
        if (v.phase === 'roll' || v.phase === 'buy') {
          out += '<button type="button" class="link-btn mc-manage" data-a="manage">我的地產（蓋房、抵押、收購）</button>';
        }
      }
      return out;
    }

    function tileShort(i) { const n = T[i].name; return esc(n.length > 4 ? n.slice(0, 4) : n); }

    /** 送出操作：鎖住按鈕防連按；伺服器沒回應或被拒絕時 2.5 秒後自動解鎖，不會卡住 */
    function send(a) {
      B.sent = true;
      opt.onAct(a);
      clearTimeout(B.sentT);
      B.sentT = setTimeout(() => {
        if (B.dead || !B.sent) return;
        B.sent = false;
        if (!B.busy && B.shown) drawCenter(B.shown);
      }, 2500);
    }

    function btn(a, cls, ico, label, extra) {
      return '<button type="button" class="btn3d ' + cls + '" data-a="' + a + '"' + (extra || '') + '>' + (ico ? Art.icon(ico) : '') + label + '</button>';
    }

    function meIndex(v) { return B.myId ? v.seats.findIndex(s => s.id === B.myId) : -1; }

    function drawCenter(v) {
      /* 動畫播到一半不重畫骰子區，免得打斷 */
      mc.innerHTML = centerHtml(v);
      if (B.v3) B.v3.showDice(v.dice[0] ? v.dice : null);
      updateTimer();
    }

    function updateTimer() {
      const el = mc.querySelector('.mc-timer');
      if (!el || !B.deadlineAt) return;
      const left = Math.max(0, Math.ceil((B.deadlineAt - performance.now()) / 1000));
      el.textContent = left + ' 秒';
      el.classList.toggle('hurry', left <= 10);
    }

    /* ---------- 畫面：左欄摘要 ---------- */

    function phaseText(v) {
      const cur = v.seats[v.turn];
      if (v.phase === 'over') return '遊戲結束';
      return { roll: cur.name + ' 擲骰子', buy: cur.name + ' 決定要不要買地', build: cur.name + ' 決定要不要蓋房子', shop: cur.name + ' 逛道具商店', debt: cur.name + ' 湊錢還債中', manage: cur.name + ' 整理財產、準備結束回合' }[v.phase] || '';
    }

    function drawSummary(v) {
      const me = meIndex(v);
      const lim = v.opts.roundLimit;
      let h = '<p class="role">' + (me >= 0 ? '你是玩家' : '你是觀戰者，看得到全部資訊') + '</p>' +
        '<div class="sum-status">第 ' + v.round + (lim ? '／' + lim : '') + ' 回合・' + esc(phaseText(v)) + '</div>' +
        '<ul class="sum-seats">';
      v.seats.forEach((s, i) => {
        const owned = v.props.map((p, k) => p.owner === i ? k : -1).filter(k => k >= 0);
        const houses = owned.reduce((a, k) => a + (v.props[k].houses < 5 ? v.props[k].houses : 0), 0);
        const hotels = owned.filter(k => v.props[k].houses === 5).length;
        const tags = seatTag(s, i, v);
        h += '<li class="' + (i === me ? 'me ' : '') + (i === v.turn && v.phase !== 'over' ? 'turn ' : '') + (s.bankrupt ? 'out' : '') + '" style="--seat:' + COLORS[i] + '">' +
          '<span class="mini">' + Art.animalSvg(s.char) + '</span>' +
          '<span class="who"><b class="nm">' + shapeSvg(i, COLORS[i], 'sh-inline') + esc(s.name) + (i === me ? '（你）' : '') + '</b>' +
          '<small>' + (s.bankrupt ? '已破產' : '地 ' + owned.length + '・房 ' + houses + '・旅店 ' + hotels + (s.getOut ? '・許可證 ' + s.getOut : '')) + '</small>' +
          (s.items && s.items.length ? '<span class="sum-items">' + s.items.map(id => '<span class="it-mini" title="' + esc(R.ITEMS[id].name) + '">' + Art.glyph('i_' + id) + '</span>').join('') + '</span>' : '') +
          (tags.length ? '<span class="tags">' + tags.map(t => '<i class="tag">' + t + '</i>').join('') + '</span>' : '') + '</span>' +
          '<span class="ct"><b>' + (s.bankrupt ? '—' : money(s.cash)) + '</b><small>資產 ' + money(s.worth) + '</small></span></li>';
      });
      h += '</ul><h4>最近發生</h4><ol class="sum-log">' +
        v.log.slice(-9).reverse().map(l => '<li>' + esc(l.text) + '</li>').join('') + '</ol>' +
        '<p class="sum-keys">空白鍵／Enter：擲骰、買地、結束回合。點棋盤上的格子看說明。</p>';
      sumEl.innerHTML = h;
      drawStrip(v, me);
    }

    /* 直向手機／平板：棋盤下面的空地放一排「每個人有多少錢」，不用打開資訊面板 */
    const strip = document.createElement('div');
    strip.className = 'mb-strip';
    strip.setAttribute('aria-hidden', 'true');
    mb.appendChild(strip);
    function drawStrip(v, me) {
      strip.style.setProperty('--cols', Math.min(4, v.seats.length));
      strip.innerHTML = v.seats.map((s, i) =>
        '<div class="ms' + (i === v.turn && v.phase !== 'over' ? ' turn' : '') + (s.bankrupt ? ' out' : '') + '" style="--seat:' + COLORS[i] + '">' +
        '<span class="mini">' + Art.animalSvg(s.char) + '</span>' +
        '<b>' + shapeSvg(i, COLORS[i], 'ms-shape') + (s.bankrupt ? '破產' : money(s.cash)) + '</b><small>' + esc(s.name) + (i === me ? '（你）' : '') + '</small>' +
        (s.items && s.items.length ? '<span class="sum-items">' + s.items.map(id => '<span class="it-mini">' + Art.glyph('i_' + id) + '</span>').join('') + '</span>' : '') + '</div>').join('');
    }

    /* ---------- 「我的地產」視窗與格子說明 ---------- */

    function manageHtml(v) {
      const me = meIndex(v);
      if (me < 0) return '<p class="hint">觀戰者沒有地產可以管理。</p>';
      const s = v.seats[me];
      const o = R.options(v, B.myId);
      const mineTurn = v.turn === me && v.phase !== 'over';
      const owned = R.ownedBy(v, me);
      let h = '<div class="mg-cash"><span>現金 <b>' + money(s.cash) + '</b> 元</span><span>總資產 <b>' + money(s.worth) + '</b> 元</span></div>';
      h += '<p class="hint mg-hint">' + (mineTurn
        ? (v.phase === 'debt' ? '正在還債：只能賣房子或抵押地產。' : '蓋房要「走到自己的地」才能加蓋（面板會問你）；平常可以賣房、贖回抵押的地。')
        : '現在不是你的回合，只能查看；輪到你時才能操作。') + '</p>';
      if (!owned.length) h += '<p class="hint">你還沒有地產。停在空地上就可以買下來。</p>';
      const groups = Object.keys(R.GROUPS).concat(['station', 'utility']);
      for (const g of groups) {
        const ids = owned.filter(i => (T[i].type === 'prop' ? T[i].group : T[i].type) === g);
        if (!ids.length) continue;
        const isP = !!R.GROUPS[g];
        const total = isP ? R.GROUP_TILES[g].length : null;
        const full = isP && ids.length === total;
        h += '<section class="mg-group" style="--gc:' + (isP ? R.GROUPS[g].color : '#8896A8') + '"><h4>' +
          (isP ? R.GROUPS[g].name + '色組' : g === 'station' ? '車站' : '公司') +
          (isP ? '<i class="' + (full ? 'full' : '') + '">' + (full ? '整組到手，可以升到旅店' : '已有 ' + ids.length + '／' + total + ' 塊') + '</i>' : '') + '</h4>';
        for (const i of ids) {
          const t = T[i], p = v.props[i];
          const canB = o.build.includes(i), canS = o.sell.includes(i), canM = o.mortgage.includes(i), canU = o.unmortgage.includes(i);
          const why = isP && !canB && mineTurn && !p.mortgaged && p.houses < 5 && full ? R.canBuildAt(v, me, i) : null;
          h += '<div class="mg-row"><span class="mg-gl">' + Art.glyph(t.glyph) + '</span><span class="mg-name"><b>' + esc(t.name) + '</b>' +
            '<small>' + (p.mortgaged ? '抵押中' : p.houses === 5 ? '旅店' : p.houses ? p.houses + ' 棟房子' : '空地') +
            '・租金 ' + (isP ? R.rentOf(v, i, v.dice) || t.rent[0] : R.rentOf(v, i, v.dice) || '—') + '</small>' +
            (why ? '<small class="why">' + esc(why) + '</small>' : '') + '</span><span class="mg-btns">' +
            (isP ? mgBtn('sell', i, '賣房 +' + Math.floor(t.house / 2), canS) : '') +
            (p.mortgaged ? mgBtn('unmortgage', i, '贖回 −' + R.unmortgageCost(t), canU) : v.phase === 'debt' ? mgBtn('mortgage', i, '抵押 +' + R.mortgageValue(t), canM) : '') +
            '</span></div>';
        }
        h += '</section>';
      }
      return h;
    }
    function mgBtn(a, i, label, enabled) {
      return '<button type="button" class="btn3d small ' + (a === 'build' || a === 'buyout' ? 'coral' : a === 'sell' ? 'sand' : 'sea') + '" data-mg="' + a + '" data-tile="' + i + '"' + (enabled && !B.sent ? '' : ' disabled') + '>' + label + '</button>';
    }

    function tileInfoHtml(v, i) {
      const t = T[i], p = v.props[i];
      const owner = p && p.owner >= 0 ? v.seats[p.owner] : null;
      let h = '<div class="ti-head" style="--gc:' + (t.type === 'prop' ? R.GROUPS[t.group].color : '#8896A8') + '"><span class="ti-gl">' +
        Art.glyph(t.glyph || (t.type === 'go' ? 'go' : t.type)) + '</span><div><h3>' + esc(t.name) + '</h3><small>' +
        ({ prop: R.GROUPS[t.group] ? R.GROUPS[t.group].name + '色組' : '', station: '車站', utility: '公司', go: '每次經過起點領 ' + R.GO_SALARY + ' 元', jail: '路過只是探監；被抓來才要坐牢', park: '什麼都不會發生，安心泡腳', gotojail: '停在這裡會被直接送進監獄', chance: '抽一張機會卡', chest: '抽一張命運卡', tax: '要繳 ' + t.tax + ' 元', shop: '停在這裡可以花錢買道具（道具欄最多 ' + R.MAX_ITEMS + ' 個）' }[t.type] || '') + '</small></div></div>';
      if (t.price) {
        h += '<p class="ti-line">地價 <b>' + t.price + '</b> 元・抵押可拿 ' + R.mortgageValue(t) + ' 元・贖回 ' + R.unmortgageCost(t) + ' 元' + (t.house ? '・蓋一棟房 ' + t.house + ' 元' : '') + '</p>';
        h += '<p class="ti-line">' + (owner ? '<span class="own-chip" style="--c:' + COLORS[p.owner] + '">' + shapeSvg(p.owner, COLORS[p.owner]) + esc(owner.name) + ' 擁有</span>' : '目前沒有主人') +
          (p.mortgaged ? '・抵押中（不收租）' : '') + '</p>';
        if (t.type === 'prop') {
          const lab = ['空地', '1 棟房', '2 棟房', '3 棟房', '4 棟房', '旅店'];
          h += '<table class="ti-rent"><tbody>' + t.rent.map((r, k) =>
            '<tr class="' + (p && p.houses === k ? 'now' : '') + '"><th scope="row">' + lab[k] + '</th><td>' + r + ' 元</td></tr>').join('') + '</tbody></table>' +
            '<p class="hint">整組同色都是同一個人的，空地租金加倍。</p>' +
            '<p class="hint">連棟加乘：同一人相鄰的格子都蓋了房子，踩到租金 2 連×1.5、3 連×2、4 連以上×2.5（目前 ' + (p && p.owner >= 0 ? R.rowLen(v, i) : 1) + ' 連）。</p>';
        } else if (t.type === 'station') h += '<p class="hint">擁有 1／2／3／4 個車站，租金 25／50／100／200 元。</p>';
        else h += '<p class="hint">擁有 1 間：骰子點數 ×4；2 間都有：×10。</p>';
      }
      const here = v.seats.map((s, k) => s.pos === i && !s.bankrupt ? esc(s.name) : '').filter(Boolean);
      if (here.length) h += '<p class="ti-line">現在在這格：' + here.join('、') + '</p>';
      return h;
    }

    function drawModals() {
      if (!B.shown) return;
      if (opt.manage && opt.manage.modal.isOpen) opt.manage.body.innerHTML = manageHtml(B.shown);
      if (opt.tile && opt.tile.modal.isOpen && B.tileOpen != null) opt.tile.body.innerHTML = B.tileOpen === -1 ? invHtml(B.shown) : tileInfoHtml(B.shown, B.tileOpen);
    }

    /* ---------- 全部重畫 ---------- */

    function drawAll() {
      const v = B.shown;
      if (!v) return;
      B.view = v;
      if (B.pick && !(v.phase === 'roll' && meIndex(v) === v.turn)) B.pick = null;   /* 選道具到一半換人／換階段就取消 */
      B.sent = false;      /* 先解鎖再畫，不然按鈕會被畫成灰的、再也沒人重畫 */
      clearTimeout(B.sentT);
      v.seats.forEach((s, i) => { B.pos[i] = s.pos; });
      drawTiles(v);
      placeAll(B.firstDraw !== false);
      B.firstDraw = false;
      drawCenter(v);
      drawSummary(v);
      drawModals();
      const cur = v.seats[v.turn];
      if (B.v3) B.v3.setActive(v.phase === 'over' ? -1 : v.turn);
      setOn(v.phase !== 'over' && cur && !cur.bankrupt ? B.pos[v.turn] != null ? B.pos[v.turn] : cur.pos : -1);
      const me = meIndex(v);
      if (v.turn !== B.lastTurn || v.phase !== B.lastPhase) {
        if (me >= 0 && v.turn === me && v.phase === 'roll' && B.lastTurn !== -1 && v.turn !== B.lastTurn) root.Sound.sfx('turn');
        B.lastTurn = v.turn; B.lastPhase = v.phase;
      }
      if (B.pick) {
        const cur2 = v.seats[v.turn];
        if (!(me >= 0 && v.turn === me && v.phase === 'roll' && !cur2.jail && cur2.items.includes(B.pick))) { B.pick = null; drawCenter(v); }
      }
    }

    /* ---------- 動畫 ---------- */

    function stepMs() { return reduce() ? 0 : st().fastAnim ? 70 : 130; }

    async function animRoll(e) {
      const v = B.shown;
      const box = mc.querySelector('.mc-dice');
      const dur = st().fastAnim ? 650 : 1150;
      if (B.v3 && !reduce()) {
        const hits = B.v3.rollBegin(!e.dice[1], e.dice, dur) || [];
        root.Sound.sfx('dice_throw');
        hits.forEach((ms, i) => setTimeout(() => root.Sound.sfx('dice_hit', Math.max(0.25, 1 - i * 0.16)), ms));
        await wait(dur);
        root.Sound.sfx('dice_settle');
      } else root.Sound.sfx('dice');
      if (B.v3) B.v3.rollEnd(e.dice[0], e.dice[1]);
      if (box) {
        box.innerHTML = '<span class="mc-sum">' + diceText(e.dice) + '</span>';
      }
      const who = v && v.seats[e.seat];
      const msg = mc.querySelector('.mc-msg');
      if (msg && who) msg.textContent = e.single ? who.name + ' 用遙控骰走 ' + e.dice[0] + ' 步' : who.name + ' 擲出 ' + e.dice[0] + '＋' + e.dice[1] + ' ＝ ' + (e.dice[0] + e.dice[1]);
      await wait(reduce() ? 0 : st().fastAnim ? 550 : 1000);
    }

    async function animMove(e) {
      const total = e.teleport ? 0 : ((e.to - e.from + T.length) % T.length || T.length);
      if (e.teleport || reduce()) {
        B.pos[e.seat] = e.to;
        placeTok(e.seat, e.to, { jump: true });
        placeAll();
        root.Sound.sfx('land');
        await wait(reduce() ? 0 : 420);
        return;
      }
      const ms = stepMs();
      if (B.v3) B.v3.setActive(e.seat);
      for (let k = 1; k <= total && !B.dead; k++) {
        const t = (e.from + k) % T.length;
        B.pos[e.seat] = t;
        placeAll();
        setOn(t);
        root.Sound.sfx('step');
        await wait(ms);
      }
      root.Sound.sfx('land');
      await wait(120);
    }

    function floatText(tile, text, good) {
      const el = document.createElement('div');
      el.className = 'float ' + (good ? 'good' : 'bad');
      el.textContent = text;
      const c = B.v3 ? B.v3.project(tile) : { x: mb.clientWidth / 2, y: mb.clientHeight / 2 };
      el.style.left = c.x + 'px';
      el.style.top = c.y + 'px';
      mb.appendChild(el);
      setTimeout(() => el.remove(), 1400);
    }

    async function animCash(e) {
      const v = B.shown;
      if (!v) return;
      if (e.reason === 'go') { floatText(0, '+' + R.GO_SALARY, true); root.Sound.sfx('pass'); return; }
      const pos = B.pos[e.seat] != null ? B.pos[e.seat] : v.seats[e.seat].pos;
      if (e.to === -2) { floatText(pos, '+' + money(e.amount), true); root.Sound.sfx(e.reason === 'god' ? 'god_good' : 'coin'); return; }
      floatText(pos, '−' + money(e.amount), false);
      if (e.to >= 0) {
        const tp = B.pos[e.to] != null ? B.pos[e.to] : v.seats[e.to].pos;
        setTimeout(() => floatText(tp, '+' + money(e.amount), true), 200);
      }
      const meI = meIndex(v);
      if (e.reason === 'buy' || e.reason === 'buyout') { /* 買地的聲音由 buy 事件負責 */ }
      else if (e.reason === 'tax') root.Sound.sfx('tax');
      else if (e.reason === 'godbad') root.Sound.sfx('god_bad');
      else if (e.reason === 'rent') root.Sound.sfx(meI >= 0 && e.to === meI ? 'earn' : 'pay');
      else if (e.reason === 'card') { /* 抽卡的好壞聲已經播過 */ }
      else root.Sound.sfx(e.to >= 0 && e.to === meI ? 'earn' : 'pay');
      if (e.reason === 'rent' || e.reason === 'tax' || e.reason === 'jail') await wait(reduce() ? 0 : 450);
    }

    /** 機會／命運：只在棋盤上方跳出一張小卡，不擋操作、不換畫面；點一下或稍等就消失 */
    async function animCard(e) {
      root.Sound.sfx('card');
      if (e.mood === 'good') setTimeout(() => root.Sound.sfx('good'), 260);
      else if (e.mood === 'bad') setTimeout(() => root.Sound.sfx('bad'), 260);
      const cv = boardEl.querySelector('.b3d');
      const box = document.createElement('div');
      box.className = 'card-toast ' + e.deck;
      box.setAttribute('role', 'status');
      box.innerHTML = '<span class="ct-ico">' + Art.glyph(e.deck) + '</span><span class="ct-tx"><b>' + (e.deck === 'chance' ? '機會' : '命運') + '</b>' + esc(e.text) + '</span>';
      if (cv) { box.style.top = (cv.offsetTop + 10) + 'px'; box.style.left = (cv.offsetLeft + cv.offsetWidth / 2) + 'px'; }
      boardEl.appendChild(box);
      await new Promise(res => {
        const done = () => { box.remove(); B.cardResolve = null; res(); };
        B.cardResolve = done;
        box.onclick = done;
        setTimeout(done, reduce() ? 1100 : 1700);
      });
    }

    async function runEvent(e) {
      switch (e.t) {
        case 'roll': return animRoll(e);
        case 'move': return animMove(e);
        case 'cash': return animCash(e);
        case 'card': return animCard(e);
        case 'buy': case 'buyout': {
          root.Sound.sfx('buy');
          if (B.v3) B.v3.pop(e.tile);
          if (B.shown) { B.shown.props[e.tile].owner = e.seat; drawTiles(B.shown); }
          return wait(reduce() ? 0 : 250);
        }
        case 'build': root.Sound.sfx(e.houses === 5 ? 'hotel' : 'build'); { if (B.v3) B.v3.pop(e.tile); } return wait(reduce() ? 0 : 200);
        case 'mortgage': root.Sound.sfx(e.on === false ? 'unmortgage' : 'mortgage'); return null;
        case 'jail': root.Sound.sfx('jail'); root.UI.vibrate(60); return wait(reduce() ? 0 : 300);
        case 'bankrupt': root.Sound.sfx('bankrupt'); root.UI.vibrate([80, 60, 80]); return wait(reduce() ? 0 : 900);
        case 'item': {
          const v = B.shown, nm = R.ITEMS[e.item] ? R.ITEMS[e.item].name : '';
          const pos = v ? (B.pos[e.seat] != null ? B.pos[e.seat] : v.seats[e.seat].pos) : 0;
          if (e.gain) { root.Sound.sfx('pickup'); floatText(pos, e.cash ? '道具滿了 +50' : '獲得「' + nm + '」', true); }
          else if (e.use) { root.Sound.sfx(e.item === 'fly' ? 'fly' : e.item === 'guard' ? 'block' : e.item === 'free' || e.item === 'taxfree' ? 'free' : e.item === 'cat' ? 'earn' : 'click'); floatText(pos, '「' + nm + '」', true); }
          return wait(reduce() ? 0 : 500);
        }
        case 'attack': {
          const v = B.shown, me = v ? meIndex(v) : -1;
          const pos = v ? (B.pos[e.to] != null ? B.pos[e.to] : v.seats[e.to].pos) : 0;
          const mineHit = me >= 0 && e.to === me;
          if (e.blocked) { root.Sound.sfx('block'); floatText(pos, '擋下了！', true); return wait(reduce() ? 0 : 500); }
          if (e.kind === 'steal') {
            root.Sound.sfx('steal'); floatText(pos, '−' + money(e.amount), false);
            const ap = v ? (B.pos[e.from] != null ? B.pos[e.from] : v.seats[e.from].pos) : 0;
            setTimeout(() => floatText(ap, '+' + money(e.amount), true), 200);
            if (mineHit) { setTimeout(() => root.Sound.sfx('hurt'), 260); root.UI.vibrate(80); }
          } else if (e.kind === 'bomb') {
            root.Sound.sfx('bomb'); if (B.v3 && e.tile >= 0) B.v3.pop(e.tile);
            floatText(e.tile >= 0 ? e.tile : pos, '爆炸！', false);
            if (mineHit) { setTimeout(() => root.Sound.sfx('hurt'), 300); root.UI.vibrate([60, 40, 90]); }
          } else if (e.kind === 'swap') {
            root.Sound.sfx('swap'); floatText(pos, '被換位', false);
            if (mineHit) root.UI.vibrate(50);
          }
          return wait(reduce() ? 0 : 600);
        }
        case 'god': {
          const v = B.shown, g = R.GODS[e.god];
          const pos = v ? (B.pos[e.seat] != null ? B.pos[e.seat] : v.seats[e.seat].pos) : 0;
          if (e.on) { root.Sound.sfx(e.good ? 'god_good' : 'god_bad'); floatText(pos, (g ? g.name : '') + '附身', !!e.good); }
          else floatText(pos, (g ? g.name : '') + '離開了', true);
          return wait(reduce() ? 0 : 600);
        }
        case 'win': return null;
        default: return null;
      }
    }

    async function pump() {
      if (B.pumping) return;
      B.pumping = true;
      try {
        while (B.queue.length && !B.dead) {
          const e = B.queue.shift();
          try { await runEvent(e); } catch (err) { /* 動畫出錯不能卡住遊戲 */ }
        }
      } finally { B.pumping = false; }
      if (B.dead) return;
      B.busy = false;
      B.shown = B.latest;
      drawAll();
    }

    /* ---------- 對外 ---------- */

    B.render = function (view, extra) {
      if (B.dead) return;
      R.useMap(view.map);
      if (view.tiles && R.applyTiles(view.tiles) && B.v3) B.v3.refreshPrices();
      B.latest = view;
      B.deadlineAt = view.turnLeftMs != null ? performance.now() + view.turnLeftMs : 0;
      if (extra && extra.myId !== undefined) B.myId = extra.myId;
      if (B.first) {
        B.first = false;
        B.lastN = view.eventSeq;
        B.shown = view;
        drawAll();
        return;
      }
      const evs = view.events.filter(e => e.n > B.lastN);
      B.lastN = view.eventSeq;
      if (evs.length) {
        /* 動畫期間畫面停在「舊局面」，只有要播的事件之前的樣子；把事件排進佇列 */
        if (!B.busy) { B.busy = true; B.shown = B.shown || view; drawCenter(B.shown); }
        B.queue.push.apply(B.queue, evs);
        pump();
      } else if (!B.busy) {
        B.shown = view;
        drawAll();
      }
    };

    boardEl.addEventListener('click', ev => {
      const inv = ev.target.closest('[data-inv]');
      if (inv) { B.openInv(inv); return; }
      const it = ev.target.closest('[data-item]');
      if (it && !B.sent) {
        const id = it.dataset.item;
        B.pick = B.pick === id ? null : id;
        drawCenter(B.shown);
        return;
      }
      const tg = ev.target.closest('[data-tgt]');
      if (tg && !B.sent && (B.pick === 'steal' || B.pick === 'swap')) {
        const id = B.pick; B.pick = null;
        send({ type: 'useItem', item: id, target: Number(tg.dataset.tgt) });
        return;
      }
      const pn = ev.target.closest('[data-n]');
      if (pn && !B.sent) {
        B.pick = null;
        send({ type: 'useItem', item: 'dice', n: Number(pn.dataset.n) });
        return;
      }
      if (ev.target.closest('[data-pickcancel]')) { B.pick = null; drawCenter(B.shown); return; }
      const sh = ev.target.closest('[data-shop]');
      if (sh && !sh.disabled && !B.sent) { sh.disabled = true; send({ type: 'shopBuy', item: sh.dataset.shop }); return; }
      const op = ev.target.closest('[data-open="props"]');
      if (op) { B.openManage(op); return; }
      const b = ev.target.closest('[data-a]');
      if (b && !b.disabled) {
        const a = b.dataset.a;
        if (a === 'manage') { B.openManage(b); return; }
        if (a === 'bankrupt') {
          if (!B.confirmBankrupt) { B.confirmBankrupt = true; drawCenter(B.shown); setTimeout(() => { B.confirmBankrupt = false; if (!B.dead && !B.busy) drawCenter(B.shown); }, 4000); return; }
          B.confirmBankrupt = false;
        }
        b.disabled = true;
        send(b.dataset.tile != null ? { type: a, tile: Number(b.dataset.tile) } : { type: a });
        return;
      }
    });

    if (opt.manage) opt.manage.body.addEventListener('click', ev => {
      const b = ev.target.closest('[data-mg]');
      if (!b || b.disabled) return;
      send({ type: b.dataset.mg, tile: Number(b.dataset.tile) });
      if (opt.solo) { drawModals(); }
    });

    function invHtml(v) {
      const me = meIndex(v);
      const cur = v.seats[me];
      const opts = R.options(v, B.myId);
      const can = me === v.turn && v.phase === 'roll' && !cur.jail && !B.busy && !B.sent;
      let h = '<p class="inv-cap">最多帶 ' + R.MAX_ITEMS + ' 個，目前 ' + cur.items.length + ' 個。停在溫泉休息站、抽到道具卡可以取得。</p><ul class="inv-list">';
      cur.items.forEach(id => {
        const it = R.ITEMS[id];
        const ok = it.active && can && !!opts[id];
        h += '<li><span class="it-ico big">' + Art.glyph('i_' + id) + '</span><span class="inv-tx"><b>' + it.name + '</b><small>' + esc(it.desc) + '</small></span>' +
          (it.active ? '<button type="button" class="btn3d coral small" data-invuse="' + id + '"' + (ok ? '' : ' disabled') + '>' + (ok ? '使用' : '擲骰前才能用') + '</button>' : '<i class="inv-auto">自動生效</i>') + '</li>';
      });
      if (!cur.items.length) h += '<li class="inv-empty">道具庫是空的</li>';
      return h + '</ul>';
    }
    B.openInv = function (from) {
      if (!opt.tile || !B.shown || meIndex(B.shown) < 0) return;
      B.tileOpen = -1;
      opt.tile.modal.open(from);
      opt.tile.title.textContent = '\uD83C\uDF92 道具庫';
      opt.tile.body.innerHTML = invHtml(B.shown);
    };
    if (opt.tile) opt.tile.body.addEventListener('click', ev => {
      const b = ev.target.closest('[data-invuse]');
      if (!b || b.disabled) return;
      B.pick = b.dataset.invuse;
      opt.tile.modal.close();
      drawCenter(B.shown);
    });

    B.openManage = function (from) {
      if (!opt.manage || !B.shown) return;
      opt.manage.modal.open(from);
      opt.manage.body.innerHTML = manageHtml(B.shown);
    };
    /** 點 3D 棋盤上的格子：機票選目的地時＝飛過去，否則看格子說明 */
    B.tileClick = function (i) {
      const v = B.shown;
      if ((B.pick === 'fly' || B.pick === 'bomb') && v && (B.busy || B.sent)) return;   /* 動畫中點格子：先忽略，不要跳出說明擋住畫面 */
      if ((B.pick === 'fly' || B.pick === 'bomb') && v && !B.busy && !B.sent) {
        const me = meIndex(v), kind = B.pick;
        const err = me >= 0 && me === v.turn ? R.canUseItem(v, me, kind, i) : '現在不能用';
        if (err) {
          const msg = mc.querySelector('.mc-msg');
          if (msg) msg.textContent = err;
          floatText(i, err, false);
          return;
        }
        B.pick = null;
        send({ type: 'useItem', item: kind, tile: i });
        return;
      }
      B.openTile(i, boardEl);
    };
    B.openTile = function (i, from) {
      if (!opt.tile || !B.shown) return;
      B.tileOpen = i;
      opt.tile.modal.open(from);
      opt.tile.body.innerHTML = tileInfoHtml(B.shown, i);
      opt.tile.title.textContent = T[i].name;
    };

    /** 空白鍵／Enter：做「主要動作」（擲骰、買地、結束回合、結清） */
    B.primary = function () {
      const v = B.shown;
      if (!v || B.busy || B.sent || v.phase === 'over') return false;
      const me = meIndex(v);
      if (me < 0 || me !== v.turn) return false;
      const o = R.options(v, B.myId);
      const a = o.roll ? 'roll' : o.buy ? 'buy' : o.settle ? 'settle' : o.endTurn ? 'endTurn' : null;
      if (!a) return false;
      send({ type: a });
      return true;
    };

    /* 保險：輪到我、沒在播動畫、也沒送出操作時，按鈕不該是灰的；若還是灰的就重畫，避免卡死 */
    B.timer = setInterval(() => {
      updateTimer();
      if (B.dead || B.busy || B.sent || !B.shown) return;
      if (mc.querySelector('.mc-actions button[disabled][data-a]:not([data-keep])')) {
        const v = B.shown, me = meIndex(v);
        if (me >= 0 && me === v.turn) {
          const o = R.options(v, B.myId);
          const need = (o.roll && !mc.querySelector('[data-a="roll"]:not([disabled])')) || (o.endTurn && !mc.querySelector('[data-a="endTurn"]:not([disabled])')) || (o.settle && !mc.querySelector('[data-a="settle"]:not([disabled])'));
          if (need) drawCenter(v);
        }
      }
    }, 500);
    B.destroy = function () {
      B.dead = true;
      clearInterval(B.timer);
      if (B.cardResolve) B.cardResolve();
      if (B.v3) B.v3.destroy();
      boardEl.classList.remove('is3d');
      boardEl.innerHTML = '';
      sumEl.innerHTML = '';
    };
    /* 給測試用 */
    B._debug = { get sent() { return B.sent; }, get pick() { return B.pick; }, get pumping() { return B.pumping; }, get busy() { return B.busy; }, get queue() { return B.queue.length; }, get shown() { return B.shown; }, get pos() { return B.pos; } };
    Object.defineProperty(B, 'mySeat', { get() { return B.shown ? meIndex(B.shown) : -1; } });
    return B;
  }

  /** 結算畫面內容（單機與線上共用）；按鈕由外面放進 #result-actions */
  function resultHtml(v, myId, sub) {
    const me = v.seats.findIndex(s => s.id === myId);
    const w = v.seats[v.winner];
    const won = me >= 0 && me === v.winner;
    const title = me < 0 ? w.name + ' 獲勝！' : won ? '你贏了！' : w.name + ' 獲勝';
    let h = '<div class="result-card"><div class="result-hero" style="--seat:' + COLORS[v.winner] + '">' + Art.animalSvg(w.char) + '</div>' +
      '<h2 id="result-title">' + esc(title) + '</h2>' +
      '<p class="result-sub">' + (v.reason === 'roundLimit' ? '回合數到了，比誰的總資產最多' : '其他人都破產了') + '</p>' +
      '<ol class="rank-list">';
    v.ranking.forEach((si, k) => {
      const s = v.seats[si];
      h += '<li class="' + (si === me ? 'me' : '') + '"><span class="no">' + (k + 1) + '</span><span class="mini">' + Art.animalSvg(s.char) + '</span>' +
        '<span class="nm">' + shapeSvg(si, COLORS[si], 'sh-inline') + esc(s.name) + (si === me ? '（你）' : '') + '</span>' +
        '<span class="sc">' + (s.bankrupt ? '破產' : '總資產 ' + money(s.worth)) + '</span></li>';
    });
    h += '</ol><p class="result-stats">' + esc(sub || '') + '</p><div class="result-actions" id="result-actions"></div></div>';
    return h;
  }

  root.Board = { create, resultHtml, DIFF_NAME, shapeSvg, SHAPE_NAME };
})(typeof self !== 'undefined' ? self : this);
