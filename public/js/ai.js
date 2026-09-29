/* ===== ai.js — 電腦玩家（瀏覽器與伺服器共用） =====
 *
 * 電腦跟真人一樣只看公開資訊，動作也全部走 Rules.act 這個合法入口。
 * 四段難度的差別是「會不會做決定」，不只是名字不同：
 *
 *   幼幼班：沒什麼策略——看到地有六成機率買、不蓋房、不贖回抵押；想很久，方便小朋友跟上
 *   簡單　：現金夠會買，偶爾才蓋房；不太會規劃湊整組，也不會贖回抵押
 *   普通　：留一筆預備金再買；買齊整組就蓋房、有錢就贖回；有出獄許可證就用
 *   困難　：搶湊同色整組、會擋對手的整組；車站優先；依對手最貴的過路費決定預備金；
 *          蓋房挑投資報酬率最高的組，必要時抵押閒置地產換錢買關鍵地；後期寧可待在監獄
 *
 * 驅動器 createDriver() 只負責「什麼時候做什麼」：等 Rules 的 readyAt（讓人看完動畫）再加一小段思考時間。
 */
(function (root, factory) {
  'use strict';
  const api = factory(typeof require === 'function' && typeof module === 'object'
    ? { RNG: require('./rng.js'), Rules: require('./rules.js') } : { RNG: root.RNG, Rules: root.Rules });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AI = api;
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  const RNG = deps.RNG;
  const R = deps.Rules;
  let T = R.TILES;   /* 每次決策開頭換成這一局的地價表 */

  const THINK = { kid: [900, 1600], easy: [600, 1100], normal: [450, 800], hard: [300, 550] };

  /* ---------- 局面判斷 ---------- */

  function owner(state, ti) { return state.props[ti].owner; }
  function ownsAllOthers(state, si, ti) {
    const t = T[ti];
    return t.type === 'prop' && R.GROUP_TILES[t.group].every(i => i === ti || owner(state, i) === si);
  }
  /** 買了這塊就湊齊整組 */
  function completesSet(state, si, ti) { return ownsAllOthers(state, si, ti); }
  /** 買了這塊可以擋住某個對手（他已經有同組其他所有格） */
  function blocksOpponent(state, si, ti) {
    const t = T[ti];
    if (t.type !== 'prop') return false;
    const ids = R.GROUP_TILES[t.group].filter(i => i !== ti);
    const o = owner(state, ids[0]);
    return o >= 0 && o !== si && ids.every(i => owner(state, i) === o);
  }
  function unownedCount(state) { return R.OWNABLE.filter(i => owner(state, i) < 0).length; }
  function stationsOwned(state, si) { return R.OWNABLE.filter(i => T[i].type === 'station' && owner(state, i) === si).length; }

  /** 對手最兇的一格過路費（預備金要能扛得住） */
  function worstRent(state, si) {
    let worst = 0;
    for (const i of R.OWNABLE) {
      const o = owner(state, i);
      if (o < 0 || o === si || state.props[i].mortgaged) continue;
      worst = Math.max(worst, R.rentOf(state, i, [3, 4]));
    }
    return worst;
  }

  function reserveFor(level, state, si) {
    if (level === 'kid') return 0;
    if (level === 'easy') return 100;
    if (level === 'normal') return 320;
    return Math.min(450, 50 + Math.round(worstRent(state, si) * 0.3));
  }

  /* ---------- 買地 ---------- */

  function decideBuy(state, si, level, rng, opt) {
    const s = state.seats[si];
    const ti = state.pending.tile, t = T[ti], price = t.price;
    const sets = completesSet(state, si, ti);
    const blocks = blocksOpponent(state, si, ti);
    const after = s.cash - price;

    if (!opt.buy) return { type: 'decline' };
    if (level === 'kid') return rng.chance(0.6) ? { type: 'buy' } : { type: 'decline' };
    if (level === 'easy') return after >= 100 || rng.chance(0.25) ? { type: 'buy' } : { type: 'decline' };
    if (level === 'normal') {
      if (sets) return { type: 'buy' };
      if (t.type === 'utility') return after >= 500 ? { type: 'buy' } : { type: 'decline' };
      return after >= 250 || (t.type === 'station' && after >= 150) ? { type: 'buy' } : { type: 'decline' };
    }
    /* 困難 */
    if (sets || blocks) return { type: 'buy' };
    if (t.type === 'station') return after >= 40 ? { type: 'buy' } : { type: 'decline' };
    if (t.type === 'utility') return after >= 300 ? { type: 'buy' } : { type: 'decline' };
    /* 同組已經有自己的地：更值得買 */
    const mine = t.type === 'prop' ? R.GROUP_TILES[t.group].filter(i => owner(state, i) === si).length : 0;
    const need = mine > 0 ? 0 : 60;
    return after >= need ? { type: 'buy' } : { type: 'decline' };
  }

  /** 沒在湊整組、沒有房子的地，可以先抵押換現金 */
  function idleMortgageList(state, si, exceptTile) {
    const list = [];
    for (const i of R.ownedBy(state, si)) {
      if (i === exceptTile) continue;
      const t = T[i], p = state.props[i];
      if (p.mortgaged || p.houses > 0) continue;
      if (R.canMortgageAt(state, si, i)) continue;
      if (t.type === 'prop') {
        const mine = R.GROUP_TILES[t.group].filter(k => owner(state, k) === si).length;
        if (mine * 2 > R.GROUP_TILES[t.group].length) continue;   /* 已經湊到一半以上的組不抵押 */
      }
      if (t.type === 'station') continue;
      list.push(i);
    }
    return list;
  }
  function idleMortgageGain(state, si) { return idleMortgageList(state, si, -1).reduce((a, i) => a + R.mortgageValue(T[i]), 0); }
  function pickIdleMortgage(state, si, exceptTile) {
    const list = idleMortgageList(state, si, exceptTile).sort((a, b) => T[b].price - T[a].price);
    return list.length ? list[0] : null;
  }

  /* ---------- 蓋房、贖回 ---------- */

  function decideManage(state, si, level, rng, opt) {
    const s = state.seats[si];
    if (level === 'kid') return null;
    const reserve = reserveFor(level, state, si);
    /* 收購與蓋房都在這裡決定 */

    /* 贖回抵押：普通看預備金，困難更積極（先贖回整組的） */
    if (level !== 'easy' && opt.unmortgage.length) {
      const list = opt.unmortgage.slice().sort((a, b) => {
        const sa = ownsAllOthers(state, si, a) ? 0 : 1, sb = ownsAllOthers(state, si, b) ? 0 : 1;
        return sa - sb || T[b].price - T[a].price;
      });
      for (const i of list) {
        if (s.cash - R.unmortgageCost(T[i]) >= reserve + (level === 'hard' ? 60 : 150)) return { type: 'unmortgage', tile: i };
      }
    }

    return null;
  }

  /** 走到自己的地：要不要加蓋房子（面板詢問的那一步） */
  function decideBuild(state, si, level, rng, opt) {
    const s = state.seats[si];
    const ti = state.pending.tile;
    if (!opt.build.length || level === 'kid') return { type: 'decline' };
    const t = T[ti], p = state.props[ti], cost = t.house;
    const reserve = reserveFor(level, state, si);
    if (level === 'easy') return s.cash - cost >= 150 && rng.chance(0.5) ? { type: 'build', tile: ti } : { type: 'decline' };
    if (s.cash - cost < reserve) return { type: 'decline' };
    if (level === 'hard') {
      if (p.houses === 4 && s.cash < reserve + cost + 300) return { type: 'decline' };
      return { type: 'build', tile: ti };
    }
    return { type: 'build', tile: ti };
  }

  /* ---------- 還債 ---------- */

  function decideDebt(state, si, level, rng, opt) {
    const s = state.seats[si];
    const need = state.pending.amount;
    if (s.cash >= need) return { type: 'settle' };
    const cands = [];
    for (const i of opt.mortgage) {
      const t = T[i];
      let score = R.mortgageValue(t) * -1;                 /* 換到越多錢越好 */
      score += ownsAllOthers(state, si, i) || (t.type === 'prop' && R.groupOwned(state, si, t.group)) ? 800 : 0;   /* 整組先留著 */
      score += t.type === 'station' ? 250 : 0;
      cands.push({ a: { type: 'mortgage', tile: i }, score });
    }
    for (const i of opt.sell) {
      const t = T[i], p = state.props[i];
      /* 賣房：租金高的組留到最後 */
      cands.push({ a: { type: 'sell', tile: i }, score: 300 + t.rent[p.houses] - Math.floor(t.house / 2) });
    }
    if (!cands.length) return { type: 'bankrupt' };
    cands.sort((x, y) => x.score - y.score);
    return cands[0].a;
  }

  /* ---------- 監獄 ---------- */

  function decideJail(state, si, level, rng, opt) {
    const s = state.seats[si];
    if (opt.useCard) return { type: 'useCard' };
    if (level === 'kid' || level === 'easy') return { type: 'roll' };
    const early = unownedCount(state) >= 6;
    if (level === 'normal') return opt.payJail && early && s.cash >= 400 ? { type: 'payJail' } : { type: 'roll' };
    /* 困難：前期趕快出去買地，後期別亂跑，在監獄裡最安全 */
    if (early) return opt.payJail && s.cash >= 150 ? { type: 'payJail' } : { type: 'roll' };
    const danger = worstRent(state, si) >= s.cash * 0.5;
    return danger ? { type: 'roll' } : (opt.payJail && s.cash >= 600 ? { type: 'payJail' } : { type: 'roll' });
  }


  /* ---------- 道具 ---------- */

  /** 站上這一格對我大概值多少分（正＝好事、負＝損失） */
  function tileScore(state, si, ti, level) {
    const s = state.seats[si], t = T[ti];
    const p = state.props[ti];
    if (t.type === 'gotojail') return -300;
    if (t.type === 'tax') return -t.tax;
    if (t.type === 'park') return 120;
    if (t.type === 'go') return 100;
    if (!R.OWNABLE.includes(ti)) return 0;
    if (p.owner === si) return 0;
    if (p.owner < 0) {
      if (s.cash < t.price + 60) return 0;
      let v = 100;
      if (completesSet(state, si, ti)) v += 300;
      else if (blocksOpponent(state, si, ti)) v += 150;
      if (t.type === 'station') v += 40;
      return v;
    }
    if (p.mortgaged) return 0;
    let rent = R.rentOf(state, ti, [3, 4]);
    if (s.items.includes('free')) rent = Math.round(rent * 0.3);
    return -rent;
  }

  function decideItem(state, si, level, rng, opt) {
    const s = state.seats[si];
    if (level === 'kid' || !s.items.length) return null;
    const BOARD = 40;
    /* 攻擊型道具：偷錢、炸房、換位（簡單難度偶爾才用，困難更精打細算） */
    if (opt.steal && s.items.includes('steal')) {
      const c = R.itemTargets(state, si, 'steal').filter(i => state.seats[i].cash >= (level === 'hard' ? 250 : 350)).sort((a, b) => state.seats[b].cash - state.seats[a].cash)[0];
      if (c != null && (level !== 'easy' || rng.chance(0.4))) return { type: 'useItem', item: 'steal', target: c };
    }
    if (opt.bomb && s.items.includes('bomb') && level !== 'easy') {
      const c = R.itemTargets(state, si, 'bomb').sort((a, b) => state.props[b].houses * T[b].house - state.props[a].houses * T[a].house)[0];
      if (c != null && state.props[c].houses >= (level === 'hard' ? 2 : 3)) return { type: 'useItem', item: 'bomb', tile: c };
    }
    if (opt.swap && s.items.includes('swap') && level !== 'easy') {
      let f = null;
      R.itemTargets(state, si, 'swap').forEach(i => { const v = tileScore(state, si, state.seats[i].pos, level) - 40; if (!f || v > f.v) f = { v, a: { type: 'useItem', item: 'swap', target: i } }; });
      if (f && f.v >= (level === 'hard' ? 200 : 300)) return f.a;
    }
    let best = null;
    if (opt.dice && s.items.includes('dice')) {
      for (let n = 1; n <= 6; n++) {
        const v = tileScore(state, si, (s.pos + n) % BOARD, level) + ((s.pos + n >= BOARD) ? 60 : 0);
        if (!best || v > best.v) best = { v, a: { type: 'useItem', item: 'dice', n } };
      }
    }
    if (opt.fly && s.items.includes('fly') && level !== 'easy') {
      let f = null;
      for (let i = 0; i < BOARD; i++) {
        if (i === s.pos || T[i].type === 'gotojail') continue;
        const v = tileScore(state, si, i, level) - 40;
        if (!f || v > f.v) f = { v, a: { type: 'useItem', item: 'fly', tile: i } };
      }
      /* 機票很珍貴：只在真的划算時才用 */
      if (f && f.v >= (level === 'hard' ? 220 : 300) && (!best || f.v > best.v + 60)) best = f;
    }
    if (!best) return null;
    if (level === 'easy') return best.v >= 100 && rng.chance(0.5) ? best.a : null;
    if (best.a.item === 'dice') return best.v >= (level === 'hard' ? 100 : 150) ? best.a : null;
    return best.a;
  }

  /* ---------- 總入口 ---------- */

  /** 這個座位現在要做什麼；回傳 Rules.act 的 action */
  function decide(state, si, level, rng) {
    level = R.DIFFICULTY_LIST.includes(level) ? level : 'normal';
    T = state.tiles || R.TILES;
    const s = state.seats[si];
    const opt = R.options(state, s.id);
    switch (state.phase) {
      case 'buy': return decideBuy(state, si, level, rng, opt);
      case 'build': return decideBuild(state, si, level, rng, opt);
      case 'debt': return decideDebt(state, si, level, rng, opt);
      case 'manage': return decideManage(state, si, level, rng, opt) || { type: 'endTurn' };
      case 'roll': {
        if (s.jail) return decideJail(state, si, level, rng, opt);
        const it = decideItem(state, si, level, rng, opt);
        if (it) return it;
        const m = decideManage(state, si, level, rng, opt);
        return m || { type: 'roll' };
      }
      default: return null;
    }
  }

  function createDriver(seed) {
    const rng = RNG.create(String(seed) + '-drv');
    let lastKey = null, dueAt = 0, issuedKey = null;
    const SAFE = { roll: { type: 'roll' }, buy: { type: 'decline' }, manage: { type: 'endTurn' }, debt: { type: 'bankrupt' } };
    return {
      /** @returns {{id, action}[]}（一次最多一個動作） */
      actions(state, now) {
        if (state.phase === 'over') return [];
        const si = state.turn;
        const s = state.seats[si];
        if (!s || !(s.ai || s.auto)) { lastKey = null; return []; }
        const level = s.ai || 'normal';
        const key = state.version + ':' + state.turn + ':' + state.phase;
        if (key !== lastKey) {
          lastKey = key;
          const th = THINK[level] || THINK.normal;
          dueAt = Math.max(state.readyAt || 0, now) + Math.round(rng.range(th[0], th[1]) * (R.PACES[state.opts.pace] || 1));
        }
        if (now < dueAt) return [];
        /* 同一個局面上一個動作被拒絕（版本沒變）：改走一定合法的保底動作，避免卡住 */
        let a = issuedKey === key ? SAFE[state.phase] : decide(state, si, level, rng);
        if (!a) return [];
        issuedKey = key;
        return [{ id: s.id, action: a }];
      }
    };
  }

  return { decide, createDriver, THINK, reserveFor, completesSet, blocksOpponent };
});
