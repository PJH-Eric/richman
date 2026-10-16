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
  const GT = root.GT;
  const T = R.TILES;
  const COLORS = R.PLAYER_COLORS;
  const DIFF_NAME = { get kid() { return root.I18N.t("board.0"); }, get easy() { return root.I18N.t("board.1"); }, get normal() { return root.I18N.t("board.2"); }, get hard() { return root.I18N.t("board.3"); } };
  const SHAPE = ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'cross', 'ring', 'star'];
  const SHAPE_NAME = [root.I18N.t("board.4"), root.I18N.t("board.5"), root.I18N.t("board.6"), root.I18N.t("board.7"), root.I18N.t("board.8"), root.I18N.t("board.9"), root.I18N.t("board.10"), root.I18N.t("board.11")];

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
    return { get rent() { return root.I18N.t("board.12"); }, get tax() { return root.I18N.t("board.13"); }, get card() { return root.I18N.t("board.14"); }, get buy() { return root.I18N.t("board.15"); }, get jail() { return root.I18N.t("board.16"); }, get go() { return root.I18N.t("board.17"); }, get buyout() { return root.I18N.t("board.18"); }, get shop() { return root.I18N.t("board.19"); } }[r] || '';
  }

  /* ---------- 建立 ---------- */

  function create(boardEl, sumEl, opt) {
    /* 同一個棋盤元素上若還有沒收掉的舊局（單機↔線上切換、再來一局），先整個拆掉，舊局的按鍵才不會搶著送出 */
    if (boardEl._rmBoard && !boardEl._rmBoard.dead) boardEl._rmBoard.destroy();
    R.useMap(opt.map);      /* 先切到這一局的地圖，3D 棋盤才知道要排幾格 */
    const B = {
      opt, myId: opt.myId || null, view: null, shown: null, latest: null, lastN: -1,
      queue: [], pumping: false, busy: false, dead: false, pos: [], first: true,
      lastTurn: -1, lastPhase: '', sent: false, deadlineAt: 0, cardResolve: null, confirmBankrupt: false
    };
    boardEl._rmBoard = B;
    /* 這一局掛上的所有事件監聽，銷毀時一次拔掉 */
    const AC = new AbortController();
    const LS = { signal: AC.signal };
    const st = () => (opt.settings ? opt.settings() : {});
    const reduce = () => !!st().reduceMotion;

    boardEl.innerHTML = '<div class="mb"><div class="mc"></div></div>';
    boardEl.classList.add('is3d');
    const mb = boardEl.querySelector('.mb');
    const mc = mb.querySelector('.mc');

    /* --- 3D 場景（three.js 要先載入，載好之前先顯示「準備中」） --- */
    B.v3 = null;
    B.err = null;
    mc.innerHTML = root.I18N.t("board.20");
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
      mc.innerHTML = root.I18N.t("board.21") +
        root.I18N.t("board.22");
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
      if (s.ai && !s.afk) tags.push(root.I18N.t("board.23") + (DIFF_NAME[s.ai] || ''));
      if (s.afk) tags.push(root.I18N.t("board.24"));
      if (s.jail) tags.push(root.I18N.t("board.25"));
      if (s.god && R.GODS[s.god.k]) tags.push(R.GODS[s.god.k].name + '×' + s.god.turns);
      if (s.bankrupt) tags.push(root.I18N.t("board.26"));
      return tags;
    }

    function tileMini(ti) {
      const t = T[ti];
      const rent = t.type === 'prop' ? t.rent[0] : t.type === 'station' ? '40～320' : root.I18N.t("board.27");
      return '<div class="mc-tile">' +
        (t.type === 'prop' ? '<i class="mc-band" style="background:' + R.GROUPS[t.group].color + '"></i>' : '') +
        '<span class="mc-gl">' + Art.glyph(t.glyph) + '</span>' +
        '<span class="mc-tn"><b>' + esc(GT.place(t.name)) + root.I18N.t("board.28") + t.price + root.I18N.t("board.29") + rent + '</small></span></div>';
    }

    /** 走到（或飛到）某格會發生什麼事：給選步數／選目的地時預覽用；回傳 [文字, 好壞 good|bad|''] */
    function landHint(v, me, ti, dice) {
      const t = T[ti], p = v.props[ti];
      if (t.type === 'gotojail') return [root.I18N.t("board.30"), 'bad'];
      if (t.type === 'tax') return [root.I18N.t("board.31") + t.tax, 'bad'];
      if (t.type === 'chance' || t.type === 'chest') return [root.I18N.t("board.32"), ''];
      if (t.type === 'park') return [root.I18N.t("board.33"), 'good'];
      if (t.type === 'shop') return [root.I18N.t("board.34"), 'good'];
      if (t.type === 'jail') return [root.I18N.t("board.35"), ''];
      if (t.type === 'go') return [root.I18N.t("board.36"), ''];
      if (t.type === 'prop' || t.type === 'station' || t.type === 'utility') {
        if (p.owner < 0) return [root.I18N.t("board.37") + t.price + '）', 'good'];
        if (p.owner === me) return [t.type === 'prop' && p.houses < R.MAX_HOUSES ? root.I18N.t("board.38") : root.I18N.t("board.39"), 'good'];
        const seat = v.seats[me];
        if (seat && seat.items.includes('free')) return [root.I18N.t("board.40"), 'good'];
        return [root.I18N.t("board.41") + R.rentOf(v, ti, dice || v.dice) + (R.rowLen(v, ti) >= 2 ? '（' + R.rowLen(v, ti) + root.I18N.t("board.42") : ''), 'bad'];
      }
      return ['', ''];
    }

    function diceText(d, kind) {
      if (!d[0]) return '';
      if (kind === 'remote') return root.I18N.t("board.43") + (d[0] + d[1]) + root.I18N.t("board.44");
      if (!d[1]) return root.I18N.t("board.45") + d[0] + root.I18N.t("board.44");
      return d[0] + '＋' + d[1] + '＝' + (d[0] + d[1]);
    }
    /** 擲骰前選 1 顆還是 2 顆 */
    function diceChooser(dis) {
      const n = B.diceN === 1 ? 1 : 2;
      return root.I18N.t("board.46") + [1, 2].map(k =>
        '<button type="button" role="radio" class="dc-btn' + (n === k ? ' sel' : '') + '" data-dn="' + k + '" aria-checked="' + (n === k) + '"' + dis + '>' +
        '<span class="dc-dice">' + Art.dieSvg(k === 1 ? 5 : 3) + (k === 2 ? Art.dieSvg(4) : '') + '</span><b>' + k + root.I18N.t("board.47") + (k === 1 ? root.I18N.t("board.48") : root.I18N.t("board.49")) + '</small></button>').join('') + '</div>';
    }
    /* 右下角面板只放「道具庫」入口與數量；有哪些道具、怎麼用，打開道具庫就看得到 */
    function itemChips(s) {
      const n = (s.items || []).length;
      return root.I18N.t("board.50") + n + root.I18N.t("board.51") + n + '／' + R.MAX_ITEMS + root.I18N.t("board.52");
    }

    function centerHtml(v) {
      const me = meIndex(v);
      const cur = v.seats[v.turn];
      const mine = me >= 0 && me === v.turn;
      const opts = me >= 0 ? R.options(v, B.myId) : null;
      const lim = v.opts.roundLimit;
      let out = root.I18N.t("board.53") + v.round + (lim ? '／' + lim : '') + root.I18N.t("board.54") +
        (v.turnLeftMs != null ? '<span class="mc-timer" aria-live="off"></span>' : '') +
        (me >= 0 ? root.I18N.t("board.55") + Art.icon('home') + root.I18N.t("board.56") : '') + '</div>';
      out += '<div class="mc-turn' + (mine ? ' mine' : '') + '" style="--seat:' + COLORS[v.turn] + '">' +
        '<span class="mini">' + Art.animalSvg(cur.char) + '</span><b>' + (mine ? root.I18N.t("board.57") : root.I18N.t("board.58") + esc(cur.name)) + '</b>' +
        seatTag(cur, v.turn, v).map(t => '<i class="tag">' + t + '</i>').join('') + '</div>';
      out += '<div class="mc-dice" aria-live="polite">' +
        (v.dice[0] ? '<span class="mc-sum">' + diceText(v.dice, v.diceKind) + '</span>' : '') + '</div>';
      const last = v.log[v.log.length - 1];
      out += '<p class="mc-msg">' + esc(last ? GT.tr(last.text) : '') + '</p>';
      const canItem = mine && v.phase === 'roll' && !cur.jail && !B.busy && !B.sent && opts;
      const chipsHtml = me >= 0 ? itemChips(v.seats[me], canItem, opts || {}) : '';
      if (canItem && B.pick === 'dice') {
        const dn = B.sel;
        out += root.I18N.t("board.59") +
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => '<button type="button" class="pick-btn' + (dn === n ? ' sel' : '') + '" data-n="' + n + '" aria-pressed="' + (dn === n) + root.I18N.t("board.60") + n + root.I18N.t("board.61") + esc(GT.place(T[(cur.pos + n) % T.length].name)) + '"><b class="pk-n">' + n + '</b><small>' + tileShort((cur.pos + n) % T.length) + '</small></button>').join('') +
          '</div>';
        if (dn != null) {
          const dt = (cur.pos + dn) % T.length, h = landHint(v, me, dt, [dn, 0]);
          out += tileMini(dt) + '<p class="mc-hint ' + h[1] + '">' + esc(h[0]) + '</p><button type="button" class="btn3d coral" data-confirm="1"' + (B.sent ? ' disabled' : '') + root.I18N.t("board.62") + dn + root.I18N.t("board.63");
        } else out += root.I18N.t("board.64");
        out += root.I18N.t("board.65");
        return out;
      }
      if (!B.pick) B.sel = null;
      const cancel = root.I18N.t("board.66");
      const confirmBtn = label => '<button type="button" class="btn3d coral" data-confirm="1"' + (B.sent ? ' disabled' : '') + '>' + label + '</button>';
      if (canItem && (B.pick === 'steal' || B.pick === 'swap' || B.pick === 'freeze' || B.pick === 'grab' || B.pick === 'frame' || B.pick === 'equal')) {
        const steal = B.pick === 'steal';
        const others = v.seats.map((o, i) => i).filter(i => i !== me && !v.seats[i].bankrupt);
        const sel = B.sel != null ? v.seats[B.sel] : null;
        const stealAmt = o => Math.min(R.stealCap(v), Math.max(1, Math.floor(o.cash * 0.1)));
        const PROMPT = { steal: root.I18N.t("board.67") + R.stealCap(v) + '）', get freeze() { return root.I18N.t("board.68"); }, get swap() { return root.I18N.t("board.69"); }, get grab() { return root.I18N.t("board.70"); }, get frame() { return root.I18N.t("board.71"); }, get equal() { return root.I18N.t("board.72"); } };
        const EFF = { steal: o => root.I18N.t("board.73") + money(stealAmt(o)) + root.I18N.t("board.74"), freeze: () => root.I18N.t("board.75"), swap: o => root.I18N.t("board.76") + tileShort(o.pos) + '」', grab: o => root.I18N.t("board.77") + ((o.items || []).length) + root.I18N.t("board.78"), frame: () => root.I18N.t("board.79"), equal: o => root.I18N.t("board.80") + money(Math.floor((o.cash + v.seats[me].cash) / 2)) + root.I18N.t("board.74") };
        const BTN = { steal: n => root.I18N.t("board.81") + n + root.I18N.t("board.82"), freeze: n => root.I18N.t("board.83") + n + '！', swap: n => root.I18N.t("board.84") + n + root.I18N.t("board.85"), grab: n => root.I18N.t("board.86") + n + root.I18N.t("board.87"), frame: n => root.I18N.t("board.88") + n + '！', equal: n => root.I18N.t("board.84") + n + root.I18N.t("board.89") };
        out += '<div class="mc-pick"><p class="mc-prompt strong">' + R.ITEMS[B.pick].name + root.I18N.t("board.90") + PROMPT[B.pick] + root.I18N.t("board.91") +
          others.map(i => {
            const o = v.seats[i], why = R.canUseItem(v, me, B.pick, i), n = R.ownedBy(v, i).length;
            const tags = (o.jail ? root.I18N.t("board.92") : '') + (o.items && o.items.includes('guard') ? root.I18N.t("board.93") : '') + (o.auto || o.afk ? root.I18N.t("board.94") : '');
            return '<button type="button" class="tgt-btn pcard' + (B.sel === i ? ' sel' : '') + '" data-tgt="' + i + '" style="--seat:' + COLORS[i] + '"' + (why ? ' disabled' : '') + ' aria-pressed="' + (B.sel === i) + '" aria-label="' + esc(o.name) + (why ? root.I18N.t("board.95") + esc(why) : '') + '">' +
              '<span class="pc-head"><span class="mini">' + Art.animalSvg(o.char) + '</span><b>' + esc(o.name) + '</b></span>' +
              root.I18N.t("board.96") + money(o.cash) + root.I18N.t("board.97") + tileShort(o.pos) + '</b></span><span><b>' + n + root.I18N.t("board.98") +
              (tags ? '<span class="pc-tags">' + tags + '</span>' : '') +
              '<span class="pc-eff' + (why ? ' why' : '') + '">' + (why ? esc(why) : EFF[B.pick](o)) + '</span></button>';
          }).join('') + '</div>' +
          (sel ? confirmBtn(BTN[B.pick](esc(sel.name))) : root.I18N.t("board.99")) + cancel + '</div>';
        return out;
      }
      if (canItem && B.pick === 'bomb') {
        const list = R.itemTargets(v, me, 'bomb');
        out += root.I18N.t("board.100") +
          list.map(i => {
            const ow = v.props[i].owner, o = v.seats[ow], h = v.props[i].houses, t = T[i];
            const rent = R.rentOf(v, i, v.dice), rentAfter = (() => { v.props[i].houses = h - 1; const r = R.rentOf(v, i, v.dice); v.props[i].houses = h; return r; })();
            return '<button type="button" class="tgt-btn pcard' + (B.sel === i ? ' sel' : '') + '" data-tsel="' + i + '" style="--seat:' + COLORS[ow] + '" aria-pressed="' + (B.sel === i) + '">' +
              '<span class="pc-head"><span class="mini">' + Art.animalSvg(o.char) + '</span><b>' + esc(GT.place(t.name)) + '</b></span>' +
              '<span class="pc-stats"><span>' + esc(o.name) + '</span><span><b>' + (h === 5 ? root.I18N.t("board.101") : h + root.I18N.t("board.102")) + '</b></span></span>' +
              root.I18N.t("board.103") + rent + ' → ' + rentAfter + '</span></button>';
          }).join('') + '</div>' +
          (B.sel != null ? confirmBtn(root.I18N.t("board.104") + esc(GT.place(T[B.sel].name)) + '」！') : root.I18N.t("board.105")) + cancel + '</div>';
        return out;
      }
      if (canItem && (B.pick === 'upgrade' || B.pick === 'surge')) {
        const surge = B.pick === 'surge';
        const list = R.itemTargets(v, me, B.pick);
        out += '<div class="mc-pick"><p class="mc-prompt strong">' + (surge ? root.I18N.t("board.106") : root.I18N.t("board.107")) + root.I18N.t("board.108") +
          list.map(i => {
            const t = T[i], h = v.props[i].houses, col = R.GROUPS[t.group] ? R.GROUPS[t.group].color : '#D9B25C';
            return '<button type="button" class="tgt-btn tchip' + (B.sel === i ? ' sel' : '') + '" data-tsel="' + i + '" aria-pressed="' + (B.sel === i) + '" style="--band:' + col + '"><i class="tc-band"></i><span class="tc-gl">' + Art.glyph(t.glyph) + '</span><span class="tc-tx"><b>' + esc(GT.place(t.name)) + '</b><small>' + (surge ? root.I18N.t("board.109") + money(R.rentOf(v, i, v.dice)) + ' → ' + money(Math.round(R.rentOf(v, i, v.dice) * 1.5)) : h === 4 ? root.I18N.t("board.110") : h + root.I18N.t("board.111") + (h + 1) + root.I18N.t("board.112")) + '</small></span></button>';
          }).join('') + '</div>' +
          (B.sel != null ? confirmBtn((surge ? root.I18N.t("board.113") : root.I18N.t("board.114")) + esc(GT.place(T[B.sel].name)) + '」！') : root.I18N.t("board.115")) + cancel + '</div>';
        return out;
      }
      if (v.phase === 'over') {
        out += root.I18N.t("board.116");
      } else if (B.busy) {
        out += '<p class="mc-prompt dim">…</p>';
      } else if (me < 0) {
        out += root.I18N.t("board.117") + (cur.ai ? root.I18N.t("board.118") : root.I18N.t("board.119") + esc(cur.name) + root.I18N.t("board.120")) + '</p>';
      } else if (!mine) {
        out += '<p class="mc-prompt dim">' + (cur.ai && !cur.afk ? esc(cur.name) + root.I18N.t("board.121") : root.I18N.t("board.119") + esc(cur.name) + root.I18N.t("board.122")) + '</p>';
      } else {
        const dis = B.sent ? ' disabled' : '';
        if (v.phase === 'roll') {
          if (cur.jail) {
            out += root.I18N.t("board.123") + (cur.jailTurns + 1) + root.I18N.t("board.124") + (cur.jailTurns >= 2 ? root.I18N.t("board.125") : root.I18N.t("board.126") + opts.jailFine + root.I18N.t("board.127")) + '</p>';
            out += '<div class="mc-actions">' + btn('roll', 'coral', 'jail', cur.jailTurns >= 2 ? root.I18N.t("board.128") : root.I18N.t("board.129"), dis) +
              (opts.payJail ? btn('payJail', 'sand small', 'coin', root.I18N.t("board.130") + opts.jailFine + root.I18N.t("board.131"), dis) : '') +
              (opts.useCard ? btn('useCard', 'sea small', 'cards', root.I18N.t("board.132"), dis) : '') + '</div>';
          } else {
            out += diceChooser(dis) + '<div class="mc-actions">' + btn('roll', 'coral', 'dice', root.I18N.t("board.133") + (B.diceN === 1 ? 1 : 2) + root.I18N.t("board.134"), dis) + '</div>';
          }
        } else if (v.phase === 'buy' && v.pending) {
          out += tileMini(v.pending.tile);
          out += '<div class="mc-actions two">' + btn('buy', 'coral', 'coin', root.I18N.t("board.135") + v.pending.price + root.I18N.t("board.74"), (opts.buy ? '' : ' disabled') + dis) +
            btn('decline', 'sand', '', root.I18N.t("board.136"), dis) + '</div>';
          if (!opts.buy) out += root.I18N.t("board.137") + money(cur.cash) + root.I18N.t("board.138");
        } else if (v.phase === 'build' && v.pending) {
          const bt = T[v.pending.tile], bp = v.props[v.pending.tile];
          out += tileMini(v.pending.tile);
          out += root.I18N.t("board.139") + (bp.houses === 4 ? root.I18N.t("board.110") : root.I18N.t("board.140") + bp.houses + root.I18N.t("board.141") + (bp.houses + 1) + root.I18N.t("board.112")) + root.I18N.t("board.142") + bt.house + root.I18N.t("board.143");
          out += '<div class="mc-actions two">' + btn('build', 'coral', 'home', root.I18N.t("board.144") + bt.house, ' data-tile="' + v.pending.tile + '"' + ((opts.build && opts.build.length) ? '' : ' disabled') + dis) +
            btn('decline', 'sand', '', root.I18N.t("board.145"), dis) + '</div>';
        } else if (v.phase === 'shop' && v.pending) {
          out += root.I18N.t("board.146");
        } else if (v.phase === 'debt' && v.pending) {
          const need = Math.max(0, v.pending.amount - cur.cash);
          out += root.I18N.t("board.147") + money(v.pending.amount) + root.I18N.t("board.74") + (v.pending.creditor >= 0 ? root.I18N.t("board.148") + esc(v.seats[v.pending.creditor].name) : '') +
            root.I18N.t("board.149") + money(cur.cash) + root.I18N.t("board.150") + money(need) + root.I18N.t("board.151");
          out += '<div class="mc-actions">' + btn('settle', 'coral', 'check', root.I18N.t("board.152"), (opts.settle ? '' : ' disabled') + dis) +
            '<button type="button" class="btn3d sea" data-a="manage">' + Art.icon('home') + root.I18N.t("board.153") +
            '<button type="button" class="btn3d sand small" data-a="bankrupt"' + dis + '>' + (B.confirmBankrupt ? root.I18N.t("board.154") : root.I18N.t("board.155")) + '</button></div>';
        } else if (v.phase === 'manage') {
          out += '<div class="mc-actions">' + btn('endTurn', 'coral', 'check', root.I18N.t("board.156"), dis) + '</div>';
        }
      }
      if (!B.pick) out += chipsHtml;   /* 主要操作（擲骰、買地…）在上面，道具庫放下面 */
      return out;
    }

    function tileShort(i) { const n = GT.place(T[i].name); return esc(n.length > 4 ? n.slice(0, 4) : n); }

    /** 送出操作：鎖住按鈕防連按；伺服器沒回應或被拒絕時 2.5 秒後自動解鎖，不會卡住 */
    function send(a) {
      if (B.dead) return;
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

    /* ---------- 道具商店：踩到當下自動打開的滿版疊層；關掉就不能再開，所以離開前要再確認一次 ---------- */
    const shopEl = document.createElement('div');
    shopEl.className = 'shop-ov'; shopEl.hidden = true;
    shopEl.setAttribute('role', 'dialog'); shopEl.setAttribute('aria-modal', 'true'); shopEl.setAttribute('aria-label', root.I18N.t("board.157"));
    boardEl.appendChild(shopEl);
    const TIER = { 10: 'sky', 20: 'mint', 30: 'grape', 40: 'amber', 50: 'rose' };
    function shopHtml(v, me) {
      const cur = v.seats[me], opts = R.options(v, B.myId), pd = v.pending;
      const tname = (T[pd.tile] && T[pd.tile].name) || root.I18N.t("board.157");
      const tab = B.shopTab === 'sell' ? 'sell' : 'buy';
      const full = cur.items.length >= R.MAX_ITEMS;
      let h = '<div class="so-card">' +
        '<header class="so-head"><div class="so-awning" aria-hidden="true"></div>' +
        '<div class="so-title"><span class="so-logo">' + Art.glyph('shop') + '</span><div><h2>' + esc(tname) + root.I18N.t("board.158") +
        root.I18N.t("board.159") + cur.points + root.I18N.t("board.160") +
        '<span class="so-bag' + (full ? ' full' : '') + '"><i>\uD83C\uDF92</i><b>' + cur.items.length + '／' + R.MAX_ITEMS + '</b></span></div></header>' +
        '<div class="so-tabs" role="tablist"><button type="button" role="tab" class="so-tab' + (tab === 'buy' ? ' on' : '') + '" data-stab="buy" aria-selected="' + (tab === 'buy') + root.I18N.t("board.161") + (opts.shop || []).length + '</em></button>' +
        '<button type="button" role="tab" class="so-tab' + (tab === 'sell' ? ' on' : '') + '" data-stab="sell" aria-selected="' + (tab === 'sell') + root.I18N.t("board.162") + (opts.sellItems || []).length + '</em></button></div>' +
        '<div class="so-body">';
      if (tab === 'buy') {
        h += root.I18N.t("board.163") + (opts.shop || []).length + root.I18N.t("board.164") +
          (opts.shop || []).map(x => {
            const it = R.ITEMS[x.item], max = R.stockFor(x.item, v.seats.length), pct = Math.max(0, Math.min(100, Math.round(x.stock / max * 100)));
            const why = x.bought ? root.I18N.t("board.165") : x.stock < 1 ? root.I18N.t("board.166") : full ? root.I18N.t("board.167") : cur.points < x.pts ? root.I18N.t("board.168") : '';
            return '<button type="button" class="so-item t-' + TIER[x.pts] + (x.bought ? ' done' : '') + '" data-shop="' + x.item + '"' + (x.can && !B.sent ? '' : ' disabled') + '>' +
              '<span class="si-ico">' + Art.glyph('i_' + x.item) + '</span><span class="si-name">' + it.name + '</span>' +
              '<span class="si-desc">' + esc(it.desc.replace(/^擲骰前使用：/, '')) + '</span>' +
              '<span class="si-stock"><i style="width:' + pct + root.I18N.t("board.169") + x.stock + '</small><b class="si-price">' + x.pts + root.I18N.t("board.170") +
              (why ? '<span class="si-tag">' + why + '</span>' : '') + '</button>';
          }).join('') + '</div>';
      } else {
        const list = opts.sellItems || [];
        h += root.I18N.t("board.171") +
          (list.length ? '<div class="so-grid">' + list.map(x => {
            const it = R.ITEMS[x.item];
            return '<button type="button" class="so-item sell t-' + TIER[it.pts] + '" data-sell="' + x.item + '"' + (B.sent ? ' disabled' : '') + '>' +
              '<span class="si-ico">' + Art.glyph('i_' + x.item) + '</span><span class="si-name">' + it.name + '</span><span class="si-desc">' + esc(it.desc.replace(/^擲骰前使用：/, '')) + '</span>' +
              root.I18N.t("board.172") + it.pts + root.I18N.t("board.173") + x.back + root.I18N.t("board.174");
          }).join('') + '</div>' : root.I18N.t("board.175"));
      }
      h += root.I18N.t("board.176") +
        Array.from({ length: R.MAX_ITEMS }, (_, k) => cur.items[k] ? '<span class="so-slot on" title="' + esc(R.ITEMS[cur.items[k]].name) + '">' + Art.glyph('i_' + cur.items[k]) + '</span>' : '<span class="so-slot"></span>').join('') + '</div>' +
        '<button type="button" class="btn3d sand" data-shopleave="ask"' + (B.sent ? ' disabled' : '') + root.I18N.t("board.177");
      if (B.shopLeave) h += root.I18N.t("board.178") +
        root.I18N.t("board.179") + (B.sent ? ' disabled' : '') + root.I18N.t("board.180");
      return h + '</div>';
    }
    function drawShop(v) {
      const me = meIndex(v);
      const on = v.phase === 'shop' && v.pending && me >= 0 && me === v.turn && (!B.busy || !shopEl.hidden);
      if (!on) { if (!shopEl.hidden) { shopEl.hidden = true; shopEl.innerHTML = ''; } B.shopLeave = false; B.shopTab = 'buy'; return; }
      const wasHidden = shopEl.hidden;
      const sc = shopEl.querySelector('.so-body'), top = sc ? sc.scrollTop : 0;
      shopEl.innerHTML = shopHtml(v, me);
      shopEl.hidden = false;
      const nb = shopEl.querySelector('.so-body'); if (nb) nb.scrollTop = top;
      if (wasHidden) { root.Sound.sfx('pickup'); const f = shopEl.querySelector('.so-item:not([disabled]), .so-tab'); if (f) f.focus({ preventScroll: true }); }
    }
    shopEl.addEventListener('click', ev => { if (B.dead) return;
      const t = ev.target.closest('[data-stab]');
      if (t) { B.shopTab = t.dataset.stab; drawShop(B.shown); return; }
      const lv = ev.target.closest('[data-shopleave]');
      if (lv) { B.shopLeave = lv.dataset.shopleave === 'ask'; drawShop(B.shown); return; }
      const b = ev.target.closest('[data-a="decline"]');
      if (b && !b.disabled && !B.sent) { b.disabled = true; B.shopLeave = false; send({ type: 'decline' }); }
    }, LS);
    const shopKey = ev => {
      if (B.dead || !shopEl.isConnected) { document.removeEventListener('keydown', shopKey, true); return; }
      if (ev.key === 'Escape' && !shopEl.hidden) { ev.stopPropagation(); ev.preventDefault(); B.shopLeave = !B.shopLeave; drawShop(B.shown); }
    };
    document.addEventListener('keydown', shopKey, { capture: true, signal: AC.signal });

    function drawCenter(v) {
      /* 動畫播到一半不重畫骰子區，免得打斷 */
      mc.innerHTML = centerHtml(v);
      drawShop(v);
      if (B.v3) {
        B.v3.showDice(v.dice[0] ? v.dice : null);
        /* 選道具目標：可選的格子在棋盤上發亮，選中的用黃色標出來 */
        const me2 = meIndex(v);
        let tg = [];
        if (me2 >= 0 && me2 === v.turn && v.phase === 'roll') {
          if (B.pick === 'bomb' || B.pick === 'upgrade' || B.pick === 'surge') tg = R.itemTargets(v, me2, B.pick);
        }
        B.v3.setTargets(tg);
        if (B.pick && B.sel != null) B.v3.highlight(('steal,swap,freeze,grab,frame,equal'.split(',').includes(B.pick)) ? v.seats[B.sel].pos : B.pick === 'dice' ? (v.seats[me2].pos + B.sel) % T.length : B.sel);
        else if (!B.busy && B.hiPick) B.v3.highlight(-1);
        B.hiPick = !!(B.pick && B.sel != null);
      }
      updateTimer();
    }

    function updateTimer() {
      const el = mc.querySelector('.mc-timer');
      if (!el || !B.deadlineAt) return;
      const left = Math.max(0, Math.ceil((B.deadlineAt - performance.now()) / 1000));
      el.textContent = left + root.I18N.t("board.181");
      el.classList.toggle('hurry', left <= 10);
    }

    /* ---------- 畫面：左欄摘要 ---------- */

    function phaseText(v) {
      const cur = v.seats[v.turn];
      if (v.phase === 'over') return root.I18N.t("board.182");
      return { roll: cur.name + root.I18N.t("board.183"), buy: cur.name + root.I18N.t("board.184"), build: cur.name + root.I18N.t("board.185"), shop: cur.name + root.I18N.t("board.186"), debt: cur.name + root.I18N.t("board.187"), manage: cur.name + root.I18N.t("board.188") }[v.phase] || '';
    }

    /* 地／房／旅店（／許可證）：每一項是不會被拆開的小標籤，空間不夠就整項換行 */
    function statChips(st, permit) {
      return root.I18N.t("board.189") + st.owned.length + root.I18N.t("board.190") + st.houses + root.I18N.t("board.191") + st.hotels + '</b></span>' + (permit ? root.I18N.t("board.192") + permit + '</b></span>' : '') + '</span>';
    }

    function drawSummary(v) {
      const me = meIndex(v);
      const lim = v.opts.roundLimit;
      const tab = B.sumTab === 'players' ? 'players' : 'info';
      const stat = i => {
        const owned = v.props.map((p, k) => p.owner === i ? k : -1).filter(k => k >= 0);
        return { owned, houses: owned.reduce((a, k) => a + (v.props[k].houses < 5 ? v.props[k].houses : 0), 0), hotels: owned.filter(k => v.props[k].houses === 5).length };
      };
      const alive = v.seats.filter(s => !s.bankrupt).length;
      let h = '';
      if (tab === 'info') {
        h += '<p class="role">' + (me >= 0 ? root.I18N.t("board.193") : root.I18N.t("board.194")) + '</p>' +
          root.I18N.t("board.195") + v.round + (lim ? '／' + lim : '') + root.I18N.t("board.196") + esc(phaseText(v)) + '</b></div>';
        if (me >= 0) {
          const s = v.seats[me], st = stat(me);
          h += '<div class="sum-me" style="--seat:' + COLORS[me] + '"><span class="mini">' + Art.animalSvg(s.char) + '</span><span class="who"><b>' + (s.bankrupt ? root.I18N.t("board.197") : root.I18N.t("board.198")) + '</b>' +
            statChips(st) + '</span><span class="ct"><b>' + (s.bankrupt ? '—' : money(s.cash)) + root.I18N.t("board.199") + money(s.worth) + root.I18N.t("board.200") + s.points + '</small></span></div>';
        }
        h += root.I18N.t("board.201") + v.log.slice(-9).reverse().map(l => '<li>' + esc(GT.tr(l.text)) + '</li>').join('') + '</ol>' +
          root.I18N.t("board.202");
      } else {
        h += '<ul class="sum-seats' + (v.seats.length > 5 ? ' dense' : '') + '">';
        v.seats.forEach((s, i) => {
          const st = stat(i), tags = seatTag(s, i, v);
          h += '<li class="' + (i === me ? 'me ' : '') + (i === v.turn && v.phase !== 'over' ? 'turn ' : '') + (s.bankrupt ? 'out' : '') + '" style="--seat:' + COLORS[i] + '">' +
            '<span class="mini">' + Art.animalSvg(s.char) + '</span>' +
            '<span class="who"><b class="nm">' + shapeSvg(i, COLORS[i], 'sh-inline') + esc(s.name) + (i === me ? root.I18N.t("board.203") : '') + '</b>' +
            (s.bankrupt ? root.I18N.t("board.204") : statChips(st, s.getOut)) +
            (s.items && s.items.length ? '<span class="sum-items">' + s.items.map(id => '<span class="it-mini" title="' + esc(R.ITEMS[id].name) + '">' + Art.glyph('i_' + id) + '</span>').join('') + '</span>' : '') +
            (tags.length ? '<span class="tags">' + tags.map(t => '<i class="tag">' + t + '</i>').join('') + '</span>' : '') + '</span>' +
            '<span class="ct"><b>' + (s.bankrupt ? '—' : money(s.cash)) + root.I18N.t("board.199") + money(s.worth) + root.I18N.t("board.200") + s.points + '</small></span></li>';
        });
        h += '</ul>';
      }
      /* 分頁列與內容區的元素固定不換（自製卷軸才不會一直重建），每次只更新裡面的內容 */
      if (!sumEl.querySelector('.sum-tabs')) {
        sumEl.innerHTML = root.I18N.t("board.205") +
          root.I18N.t("board.206") +
          root.I18N.t("board.207") +
          '<div class="sum-pane" id="sumpane" role="tabpanel"></div>';
      }
      sumEl.querySelector('#sumtab-info').setAttribute('aria-selected', String(tab === 'info'));
      sumEl.querySelector('#sumtab-players').setAttribute('aria-selected', String(tab === 'players'));
      sumEl.querySelector('#sumtab-players i').textContent = alive + '／' + v.seats.length;
      const pane = sumEl.querySelector('#sumpane');
      const tabChanged = pane.getAttribute('aria-labelledby') !== 'sumtab-' + tab;
      const top = pane.scrollTop;
      pane.setAttribute('aria-labelledby', 'sumtab-' + tab);
      pane.innerHTML = h;
      pane.scrollTop = tabChanged ? 0 : top;
      drawStrip(v, me);
    }
    sumEl.addEventListener('click', ev => { if (B.dead) return;
      const t = ev.target.closest('[data-sumtab]');
      if (!t || !B.shown) return;
      B.sumTab = t.dataset.sumtab;
      drawSummary(B.shown);
      const nb = sumEl.querySelector('[data-sumtab="' + B.sumTab + '"]'); if (nb) nb.focus();
    }, LS);
    sumEl.addEventListener('keydown', ev => { if (B.dead) return;
      if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && ev.target.closest('[data-sumtab]') && B.shown) {
        B.sumTab = B.sumTab === 'players' ? 'info' : 'players';
        drawSummary(B.shown);
        const nb = sumEl.querySelector('[data-sumtab="' + B.sumTab + '"]'); if (nb) nb.focus();
      }
    }, LS);

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
        '<b>' + shapeSvg(i, COLORS[i], 'ms-shape') + (s.bankrupt ? root.I18N.t("board.26") : money(s.cash)) + '</b><small>' + esc(s.name) + (i === me ? root.I18N.t("board.203") : '') + '</small>' +
        (s.items && s.items.length ? '<span class="sum-items">' + s.items.map(id => '<span class="it-mini">' + Art.glyph('i_' + id) + '</span>').join('') + '</span>' : '') + '</div>').join('');
    }

    /* ---------- 「我的地產」視窗與格子說明 ---------- */

    function manageHtml(v) {
      const me = meIndex(v);
      if (me < 0) return root.I18N.t("board.208");
      const s = v.seats[me];
      const o = R.options(v, B.myId);
      const mineTurn = v.turn === me && v.phase !== 'over';
      const owned = R.ownedBy(v, me);
      let h = root.I18N.t("board.209") + money(s.cash) + root.I18N.t("board.210") + money(s.worth) + root.I18N.t("board.211");
      h += '<p class="hint mg-hint">' + (mineTurn
        ? (v.phase === 'debt' ? root.I18N.t("board.212") : root.I18N.t("board.213"))
        : root.I18N.t("board.214")) + '</p>';
      if (!owned.length) h += root.I18N.t("board.215");
      const groups = Object.keys(R.GROUPS).concat(['station', 'utility']);
      for (const g of groups) {
        const ids = owned.filter(i => (T[i].type === 'prop' ? T[i].group : T[i].type) === g);
        if (!ids.length) continue;
        const isP = !!R.GROUPS[g];
        const total = isP ? R.GROUP_TILES[g].length : null;
        const full = isP && ids.length === total;
        h += '<section class="mg-group" style="--gc:' + (isP ? R.GROUPS[g].color : '#8896A8') + '"><h4>' +
          (isP ? R.GROUPS[g].name + root.I18N.t("board.216") : g === 'station' ? root.I18N.t("board.217") : root.I18N.t("board.218")) +
          (isP ? '<i class="' + (full ? 'full' : '') + '">' + (full ? root.I18N.t("board.219") : root.I18N.t("board.220") + ids.length + '／' + total + root.I18N.t("board.221")) + '</i>' : '') + '</h4>';
        for (const i of ids) {
          const t = T[i], p = v.props[i];
          const canB = o.build.includes(i), canS = o.sell.includes(i);
          const why = isP && !canB && mineTurn && p.houses < 5 && full ? R.canBuildAt(v, me, i) : null;
          h += '<div class="mg-row"><span class="mg-gl">' + Art.glyph(t.glyph) + '</span><span class="mg-name"><b>' + esc(GT.place(t.name)) + '</b>' +
            '<small>' + (p.houses === 5 ? root.I18N.t("board.101") : p.houses ? p.houses + root.I18N.t("board.102") : root.I18N.t("board.222")) +
            root.I18N.t("board.223") + (isP ? R.rentOf(v, i, v.dice) || t.rent[0] : R.rentOf(v, i, v.dice) || '—') + '</small>' +
            (why ? '<small class="why">' + esc(why) + '</small>' : '') + '</span><span class="mg-btns">' +
            (isP ? mgBtn('sell', i, root.I18N.t("board.224") + Math.floor(t.house / 2), canS) : '') +
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
        Art.glyph(t.glyph || (t.type === 'go' ? 'go' : t.type)) + '</span><div><h3>' + esc(GT.place(t.name)) + '</h3><small>' +
        ({ prop: R.GROUPS[t.group] ? R.GROUPS[t.group].name + root.I18N.t("board.216") : '', get station() { return root.I18N.t("board.217"); }, get utility() { return root.I18N.t("board.218"); }, go: root.I18N.t("board.225") + R.salaryOf(v) + root.I18N.t("board.74"), get jail() { return root.I18N.t("board.226"); }, get park() { return root.I18N.t("board.227"); }, get gotojail() { return root.I18N.t("board.228"); }, get chance() { return root.I18N.t("board.229"); }, get chest() { return root.I18N.t("board.230"); }, tax: root.I18N.t("board.231") + t.tax + root.I18N.t("board.74"), shop: root.I18N.t("board.232") + R.MAX_ITEMS + root.I18N.t("board.233") }[t.type] || '') + '</small></div></div>';
      if (t.price) {
        h += root.I18N.t("board.234") + t.price + root.I18N.t("board.235") + (t.house ? root.I18N.t("board.236") + t.house + root.I18N.t("board.74") : '') + '</p>';
        h += '<p class="ti-line">' + (owner ? '<span class="own-chip" style="--c:' + COLORS[p.owner] + '">' + shapeSvg(p.owner, COLORS[p.owner]) + esc(owner.name) + root.I18N.t("board.237") : root.I18N.t("board.238")) +
          '</p>';
        if (t.type === 'prop') {
          const lab = [root.I18N.t("board.222"), root.I18N.t("board.239"), root.I18N.t("board.240"), root.I18N.t("board.241"), root.I18N.t("board.242"), root.I18N.t("board.101")];
          h += '<table class="ti-rent"><tbody>' + t.rent.map((r, k) =>
            '<tr class="' + (p && p.houses === k ? 'now' : '') + '"><th scope="row">' + lab[k] + '</th><td>' + r + root.I18N.t("board.243")).join('') + '</tbody></table>' +
            root.I18N.t("board.244") +
            root.I18N.t("board.245") + (p && p.owner >= 0 ? R.rowLen(v, i) : 1) + root.I18N.t("board.246");
        } else if (t.type === 'station') h += root.I18N.t("board.247");
        else h += root.I18N.t("board.248");
      }
      const here = v.seats.map((s, k) => s.pos === i && !s.bankrupt ? esc(s.name) : '').filter(Boolean);
      if (here.length) h += root.I18N.t("board.249") + here.join('、') + '</p>';
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

    function stepMs() { return reduce() ? 0 : st().fastAnim ? 104 : 195; }

    async function animRoll(e) {
      const v = B.shown;
      const box = mc.querySelector('.mc-dice');
      const dur = st().fastAnim ? 700 : 1300;
      if (B.v3 && !reduce()) {
        /* 鏡頭還沒滑到這位玩家身上就先別擲骰 */
        B.v3.setActive(e.seat);
        const t0 = performance.now(), cap = st().fastAnim ? 900 : 1800;
        while (!B.dead && !B.v3.camReady() && performance.now() - t0 < cap) await wait(50);
        if (performance.now() - t0 > 80) await wait(st().fastAnim ? 80 : 220);   /* 到位後停一下，看清楚是誰要擲 */
        const hits = B.v3.rollBegin(!e.dice[1], e.dice, dur) || [];
        root.Sound.sfx('dice_throw');
        hits.forEach((ms, i) => setTimeout(() => root.Sound.sfx('dice_hit', Math.max(0.25, 1 - i * 0.16)), ms));
        await wait(dur);
        root.Sound.sfx('dice_settle');
      } else root.Sound.sfx('dice');
      if (B.v3) B.v3.rollEnd(e.dice[0], e.dice[1]);
      if (box) {
        box.innerHTML = '<span class="mc-sum">' + diceText(e.dice, e.remote ? 'remote' : e.single ? 'one' : 'two') + '</span>';
      }
      const who = v && v.seats[e.seat];
      const msg = mc.querySelector('.mc-msg');
      if (msg && who) msg.textContent = e.remote ? who.name + root.I18N.t("board.250") + (e.dice[0] + e.dice[1]) + root.I18N.t("board.44") : e.single ? who.name + root.I18N.t("board.251") + e.dice[0] + root.I18N.t("board.252") : who.name + root.I18N.t("board.253") + e.dice[0] + '＋' + e.dice[1] + ' ＝ ' + (e.dice[0] + e.dice[1]);
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
      if (e.reason === 'go') { floatText(0, '+' + e.amount, true); root.Sound.sfx('pass'); return; }
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
      box.innerHTML = '<span class="ct-ico">' + Art.glyph(e.deck) + '</span><span class="ct-tx"><b>' + (e.deck === 'chance' ? root.I18N.t("board.254") : root.I18N.t("board.255")) + '</b>' + esc(GT.tr(e.text)) + '</span>';
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
        case 'jail': root.Sound.sfx('jail'); root.UI.vibrate(60); return wait(reduce() ? 0 : 300);
        case 'bankrupt': root.Sound.sfx('bankrupt'); root.UI.vibrate([80, 60, 80]); return wait(reduce() ? 0 : 900);
        case 'item': {
          const v = B.shown, nm = R.ITEMS[e.item] ? R.ITEMS[e.item].name : '';
          const pos = v ? (B.pos[e.seat] != null ? B.pos[e.seat] : v.seats[e.seat].pos) : 0;
          if (e.gain) { root.Sound.sfx('pickup'); floatText(pos, e.cash ? root.I18N.t("board.256") : root.I18N.t("board.257") + nm + '」', true); }
          else if (e.use) { root.Sound.sfx(e.item === 'guard' ? 'block' : e.item === 'free' || e.item === 'coupon' ? 'free' : e.item === 'cat' ? 'earn' : 'click'); floatText(pos, '「' + nm + '」', true); }
          return wait(reduce() ? 0 : 500);
        }
        case 'attack': {
          const v = B.shown, me = v ? meIndex(v) : -1;
          const pos = v ? (B.pos[e.to] != null ? B.pos[e.to] : v.seats[e.to].pos) : 0;
          const mineHit = me >= 0 && e.to === me;
          if (e.blocked) { root.Sound.sfx('block'); floatText(pos, root.I18N.t("board.258"), true); return wait(reduce() ? 0 : 500); }
          if (e.kind === 'steal') {
            root.Sound.sfx('steal'); floatText(pos, '−' + money(e.amount), false);
            const ap = v ? (B.pos[e.from] != null ? B.pos[e.from] : v.seats[e.from].pos) : 0;
            setTimeout(() => floatText(ap, '+' + money(e.amount), true), 200);
            if (mineHit) { setTimeout(() => root.Sound.sfx('hurt'), 260); root.UI.vibrate(80); }
          } else if (e.kind === 'bomb') {
            root.Sound.sfx('bomb'); if (B.v3 && e.tile >= 0) B.v3.pop(e.tile);
            floatText(e.tile >= 0 ? e.tile : pos, root.I18N.t("board.259"), false);
            if (mineHit) { setTimeout(() => root.Sound.sfx('hurt'), 300); root.UI.vibrate([60, 40, 90]); }
          } else if (e.kind === 'freeze') {
            root.Sound.sfx('block'); floatText(pos, root.I18N.t("board.260"), false);
            if (mineHit) root.UI.vibrate(50);
          } else if (e.kind === 'freezeSkip') {
            floatText(pos, root.I18N.t("board.261"), false);
          } else if (e.kind === 'swap') {
            root.Sound.sfx('swap'); floatText(pos, root.I18N.t("board.262"), false);
            if (mineHit) root.UI.vibrate(50);
          } else if (e.kind === 'grab') {
            root.Sound.sfx('steal'); floatText(pos, root.I18N.t("board.263"), false);
            if (mineHit) root.UI.vibrate(60);
          } else if (e.kind === 'frame') {
            root.Sound.sfx('hurt'); floatText(pos, root.I18N.t("board.264"), false);
            if (mineHit) root.UI.vibrate([60, 40, 60]);
          } else if (e.kind === 'equal') {
            root.Sound.sfx('swap'); floatText(pos, root.I18N.t("board.265"), false);
          }
          return wait(reduce() ? 0 : 600);
        }
        case 'points': {
          const v = B.shown, pos = v ? (B.pos[e.seat] != null ? B.pos[e.seat] : v.seats[e.seat].pos) : 0;
          root.Sound.sfx('pickup'); floatText(pos, '+' + e.amount + root.I18N.t("board.252"), true);
          return wait(reduce() ? 0 : 500);
        }
        case 'god': {
          const v = B.shown, g = R.GODS[e.god];
          const pos = v ? (B.pos[e.seat] != null ? B.pos[e.seat] : v.seats[e.seat].pos) : 0;
          if (e.on) { root.Sound.sfx(e.good ? 'god_good' : 'god_bad'); floatText(pos, (g ? g.name : '') + root.I18N.t("board.266"), !!e.good); }
          else floatText(pos, (g ? g.name : '') + root.I18N.t("board.267"), true);
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

    /** 給自動化測試用：下一次 render 直接跳到最新局面，不播中間累積的動畫 */
    B.relang = function () {
      if (B.v3) B.v3.refreshPrices();
      if (B.shown) drawAll();
    };
    B.skipAnim = function () { B.queue.length = 0; B.first = true; B.busy = false; B.sent = false; };
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

    /* 選 1／2 顆：按下去就立刻記住並就地改樣式（不重畫），避免剛好遇到面板重畫、click 被吃掉而沒選到 */
    function chooseDice(ev) {
      const dnb = ev.target.closest && ev.target.closest('[data-dn]');
      if (!dnb || dnb.disabled || B.sent) return false;
      B.diceN = Number(dnb.dataset.dn) === 1 ? 1 : 2;
      mc.querySelectorAll('[data-dn]').forEach(x => { const on = Number(x.dataset.dn) === B.diceN; x.classList.toggle('sel', on); x.setAttribute('aria-checked', on); });
      const rb = mc.querySelector('[data-a="roll"]');
      if (rb && !cur_isJail()) rb.lastChild.nodeType === 3 && (rb.lastChild.nodeValue = root.I18N.t("board.133") + B.diceN + root.I18N.t("board.134"));
      return true;
    }
    /** 要擲幾顆：以畫面上目前亮著的選項為準（跟玩家看到的一致），沒有選項時才用記住的值 */
    function rollCount() {
      const sel = mc.querySelector('.dice-choose [data-dn].sel');
      if (sel) B.diceN = Number(sel.dataset.dn) === 1 ? 1 : 2;
      return B.diceN === 1 ? 1 : 2;
    }
    function cur_isJail() { const v = B.shown; return !v || !!(v.seats[v.turn] && v.seats[v.turn].jail); }
    boardEl.addEventListener('pointerdown', ev => { if (!B.dead) chooseDice(ev); }, LS);
    boardEl.addEventListener('click', ev => { if (B.dead) return;
      const inv = ev.target.closest('[data-inv]');
      if (inv) { B.openInv(inv); return; }
      const tg = ev.target.closest('[data-tgt]');
      if (tg && !tg.disabled && !B.sent && 'steal,swap,freeze,grab,frame,equal'.split(',').includes(B.pick)) { B.sel = Number(tg.dataset.tgt); drawCenter(B.shown); return; }
      const ts = ev.target.closest('[data-tsel]');
      if (ts && !B.sent && (B.pick === 'bomb' || B.pick === 'upgrade' || B.pick === 'surge')) { B.sel = Number(ts.dataset.tsel); drawCenter(B.shown); return; }
      if (ev.target.closest('[data-confirm]') && !B.sent && B.pick && B.sel != null) {
        const id = B.pick, sel = B.sel; B.pick = null; B.sel = null;
        if (id === 'dice') send({ type: 'useItem', item: 'dice', n: sel });
        else if (R.ITEMS[id] && R.ITEMS[id].target === 'seat') send({ type: 'useItem', item: id, target: sel });
        else send({ type: 'useItem', item: id, tile: sel });
        return;
      }
      const dnb = ev.target.closest('[data-dn]');
      if (dnb && !B.sent) { B.diceN = Number(dnb.dataset.dn) === 1 ? 1 : 2; drawCenter(B.shown); return; }
      const pn = ev.target.closest('[data-n]');
      if (pn && !B.sent && B.pick === 'dice') { B.sel = Number(pn.dataset.n); drawCenter(B.shown); return; }
      if (ev.target.closest('[data-pickcancel]')) { B.pick = null; B.sel = null; drawCenter(B.shown); return; }
      const sl = ev.target.closest('[data-sell]');
      if (sl && !sl.disabled && !B.sent) { sl.disabled = true; send({ type: 'shopSell', item: sl.dataset.sell }); return; }
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
        send(a === 'roll' ? { type: 'roll', dice: rollCount() } : b.dataset.tile != null ? { type: a, tile: Number(b.dataset.tile) } : { type: a });
        return;
      }
    }, LS);

    if (opt.manage) opt.manage.body.addEventListener('click', ev => { if (B.dead) return;
      const b = ev.target.closest('[data-mg]');
      if (!b || b.disabled) return;
      send({ type: b.dataset.mg, tile: Number(b.dataset.tile) });
      if (opt.solo) { drawModals(); }
    }, LS);

    function invHtml(v) {
      const me = meIndex(v);
      const cur = v.seats[me];
      const opts = R.options(v, B.myId);
      const can = me === v.turn && v.phase === 'roll' && !cur.jail && !B.busy && !B.sent;
      let h = root.I18N.t("board.268") + R.MAX_ITEMS + root.I18N.t("board.269") + cur.items.length + root.I18N.t("board.270") + cur.points + root.I18N.t("board.271");
      cur.items.forEach(id => {
        const it = R.ITEMS[id];
        const ok = it.active && can && !!opts[id];
        h += '<li><span class="it-ico big">' + Art.glyph('i_' + id) + '</span><span class="inv-tx"><b>' + it.name + '</b><small>' + esc(it.desc) + '</small></span>' +
          (it.active ? '<button type="button" class="btn3d coral small" data-invuse="' + id + '"' + (ok ? '' : ' disabled') + '>' + (ok ? root.I18N.t("board.272") : root.I18N.t("board.273")) + '</button>' : root.I18N.t("board.274")) + '</li>';
      });
      if (!cur.items.length) h += root.I18N.t("board.275");
      return h + '</ul>';
    }
    B.openInv = function (from) {
      if (!opt.tile || !B.shown || meIndex(B.shown) < 0) return;
      B.tileOpen = -1;
      { const mc = opt.tile.body.closest('.modal-card'); if (mc) { mc.classList.remove('narrow'); mc.classList.add('inv-wide'); } }
      opt.tile.modal.open(from);
      opt.tile.title.textContent = root.I18N.t("board.276");
      opt.tile.body.innerHTML = invHtml(B.shown);
    };
    if (opt.tile) opt.tile.body.addEventListener('click', ev => { if (B.dead) return;
      const b = ev.target.closest('[data-invuse]');
      if (!b || b.disabled) return;
      opt.tile.modal.close();
      if ((R.ITEMS[b.dataset.invuse] && R.ITEMS[b.dataset.invuse].direct)) { B.pick = null; send({ type: 'useItem', item: b.dataset.invuse }); return; }
      B.pick = b.dataset.invuse; B.sel = null;
      drawCenter(B.shown);
    }, LS);

    B.openManage = function (from) {
      if (!opt.manage || !B.shown) return;
      opt.manage.modal.open(from);
      opt.manage.body.innerHTML = manageHtml(B.shown);
    };
    /** 點 3D 棋盤上的格子：選炸彈／加蓋／漲價目標時＝選那一格，否則看格子說明 */
    B.tileClick = function (i) {
      const v = B.shown;
      if ((B.pick === 'bomb' || B.pick === 'upgrade' || B.pick === 'surge') && v && (B.busy || B.sent)) return;   /* 動畫中點格子：先忽略，不要跳出說明擋住畫面 */
      if ((B.pick === 'bomb' || B.pick === 'upgrade' || B.pick === 'surge') && v && !B.busy && !B.sent) {
        const me = meIndex(v), kind = B.pick;
        const err = me >= 0 && me === v.turn ? R.canUseItem(v, me, kind, i) : root.I18N.t("board.277");
        if (err) {
          const msg = mc.querySelector('.mc-msg');
          if (msg) msg.textContent = err;
          floatText(i, err, false);
          return;
        }
        B.sel = i;
        drawCenter(v);
        return;
      }
      B.openTile(i, boardEl);
    };
    B.openTile = function (i, from) {
      if (!opt.tile || !B.shown) return;
      { const mc = opt.tile.body.closest('.modal-card'); if (mc) { mc.classList.add('narrow'); mc.classList.remove('inv-wide'); } }
      B.tileOpen = i;
      opt.tile.modal.open(from);
      opt.tile.body.innerHTML = tileInfoHtml(B.shown, i);
      opt.tile.title.textContent = GT.place(T[i].name);
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
      send(a === 'roll' ? { type: 'roll', dice: rollCount() } : { type: a });
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
      AC.abort();
      clearTimeout(B.sentT);
      clearInterval(B.timer);
      if (boardEl._rmBoard === B) boardEl._rmBoard = null;
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
    const title = me < 0 ? w.name + root.I18N.t("board.278") : won ? root.I18N.t("board.279") : w.name + root.I18N.t("board.280");
    const stat = i => {
      const owned = v.props.filter(p => p.owner === i);
      return { lands: owned.length, houses: owned.reduce((a, p) => a + (p.houses > 0 && p.houses < 5 ? p.houses : 0), 0), hotels: owned.filter(p => p.houses === 5).length };
    };
    const st = v.seats.map((s, i) => stat(i));
    const maxWorth = Math.max(1, ...v.seats.map(s => s.bankrupt ? 0 : s.worth));
    const alive = v.seats.filter(s => !s.bankrupt).length;
    /* 小獎項：只頒給真的有東西的人，並列時取排名較前的 */
    const best = (score) => {
      let bi = -1, bv = 0;
      v.ranking.forEach(i => { if (v.seats[i].bankrupt) return; const x = score(i); if (x > bv) { bv = x; bi = i; } });
      return bi < 0 ? null : { i: bi, v: bv };
    };
    const awards = [
      [root.I18N.t("board.281"), best(i => st[i].lands), n => n + root.I18N.t("board.282")],
      [root.I18N.t("board.283"), best(i => st[i].houses + st[i].hotels * 5), n => n + root.I18N.t("board.284")],
      [root.I18N.t("board.285"), best(i => v.seats[i].cash), n => money(n)]
    ].filter(a => a[1]);
    const confetti = [];
    for (let k = 0; k < 24; k++) {
      confetti.push('<i style="--x:' + ((k * 37) % 100) + '%;--d:' + ((k * 0.23) % 2.6).toFixed(2) + 's;--t:' + (3.2 + (k % 5) * 0.5).toFixed(1) + 's;--c:' + COLORS[k % COLORS.length] + ';--r:' + ((k * 47) % 360) + 'deg"></i>');
    }
    let h = '<div class="confetti' + (won || me < 0 ? '' : ' soft') + '" aria-hidden="true">' + confetti.join('') + '</div>' +
      '<div class="result-card" style="--seat:' + COLORS[v.winner] + '">' +
      '<div class="result-top"><span class="result-badge">' + (v.reason === 'roundLimit' ? root.I18N.t("board.286") : root.I18N.t("board.287")) + '</span>' +
      '<div class="hero-wrap"><svg class="crown" viewBox="0 0 48 28" aria-hidden="true"><path d="M4 24 L8 6 L18 16 L24 3 L30 16 L40 6 L44 24 Z" fill="#FFD447" stroke="#E0A800" stroke-width="3" stroke-linejoin="round"/><circle cx="8" cy="6" r="3" fill="#FF8FA3"/><circle cx="24" cy="3" r="3" fill="#7FD8E0"/><circle cx="40" cy="6" r="3" fill="#FF8FA3"/></svg><div class="result-hero">' + Art.animalSvg(w.char) + '</div></div></div>' +
      '<h2 id="result-title">' + esc(title) + '</h2>' +
      '<p class="result-sub">' + (v.reason === 'roundLimit' ? root.I18N.t("board.288") : root.I18N.t("board.289")) + '</p>' +
      '<div class="result-tiles"><div><b>' + v.round + root.I18N.t("board.290") + alive + '/' + v.seats.length + root.I18N.t("board.291") + money(w.worth) + root.I18N.t("board.292") +
      (awards.length ? '<div class="result-awards">' + awards.map(a => '<span class="award" style="--seat:' + COLORS[a[1].i] + '"><em>' + a[0] + '</em>' + esc(v.seats[a[1].i].name) + '<small>' + a[2](a[1].v) + '</small></span>').join('') + '</div>' : '') +
      '<ol class="rank-list">';
    v.ranking.forEach((si, k) => {
      const s = v.seats[si], t = st[si];
      const tot = s.bankrupt ? 0 : Math.max(0, s.worth);
      const pct = Math.round(tot / maxWorth * 100), cashPct = tot ? Math.round(Math.max(0, Math.min(tot, s.cash)) / tot * 100) : 0;
      h += '<li class="' + (si === me ? 'me ' : '') + (s.bankrupt ? 'out ' : '') + (k === 0 ? 'first' : '') + '" style="--seat:' + COLORS[si] + '"><span class="no">' + (k + 1) + '</span><span class="mini">' + Art.animalSvg(s.char) + '</span>' +
        '<span class="nm">' + shapeSvg(si, COLORS[si], 'sh-inline') + '<span class="nt">' + esc(s.name) + (si === me ? root.I18N.t("board.203") : '') + '</span></span>' +
        '<span class="sc">' + (s.bankrupt ? root.I18N.t("board.26") : money(s.worth)) + '</span>' +
        (s.bankrupt ? '' : root.I18N.t("board.293") + pct + '%"><span class="cash" style="width:' + cashPct + '%"></span></span></span>' +
          root.I18N.t("board.294") + money(s.cash) + root.I18N.t("board.295") + t.lands + root.I18N.t("board.190") + t.houses + root.I18N.t("board.191") + t.hotels + '</b></span></span>') +
        '</li>';
    });
    h += '</ol><p class="result-stats">' + esc(sub || '') + '</p><div class="result-actions" id="result-actions"></div></div>';
    return h;
  }

  root.Board = { create, resultHtml, DIFF_NAME, shapeSvg, SHAPE_NAME };
})(typeof self !== 'undefined' ? self : this);
