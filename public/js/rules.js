/* ===== rules.js — 寶島大富翁規則核心（瀏覽器與伺服器共用） =====
 *
 * 純邏輯、沒有畫面也沒有計時器：所有時間都由呼叫端用 now（毫秒）帶進來，
 * 單機用可暫停的遊戲時鐘，伺服器用 Date.now()，測試用假時鐘，
 * 三邊跑的是同一套判定，不會各寫一份互相漂移。
 *
 * 亂數（骰子、機會命運牌序）一律來自 seed 決定的 RNG，同一個 seed＋同一串行動＝同一局。
 *
 * 回合流程（phase）：
 *   roll    —— 等目前玩家擲骰（在監獄裡可改成繳罰金／用出獄許可證）
 *   buy     —— 停在沒人的地產上，等玩家決定買或不買
 *   debt    —— 付不出錢，等玩家賣房子湊錢，或宣告破產
 *   manage  —— 這回合的事都做完了，可以結束回合
 *   over    —— 只剩一人（或到回合上限）
 *
 * 已確認的規則（簡易版；不做交易與拍賣）：
 *   - 40 格；起點領 200；起始現金＝回合上限×100（不限回合 10000）；2～8 人；系統隨機決定座位順序。
 *   - 沒人買的地不拍賣，留在原地，下次有人停到還能買。
 *   - 同色整組都是自己的才能蓋房；每格最多 4 棟房，再升級成 1 間旅店；蓋房要平均。
 *   - 強制收購（簡易版取代交易）：自己的回合可以用 2 倍地價，向對手買下「一塊」能讓你湊齊整組的地
 *     （沒有房子才行，每回合一次）。
 *   - 擲出雙骰可再擲一次，連三次雙骰進監獄。
 *   - 監獄：繳 50、用出獄許可證、或擲出雙骰出獄；第三回合還沒出就強制繳 50 並照骰子前進。
 *   - 付不出錢：先賣房子還債；所有資產加起來都不夠就破產，資產全給債主（給銀行就回收）。
 *   - 最後一個沒破產的人獲勝；房主／單機可設回合上限，到了就比總資產。
 */
(function (root, factory) {
  'use strict';
  const isNode = typeof require === 'function' && typeof module === 'object';
  const api = factory(isNode ? require('./rng.js') : root.RNG, isNode ? require('./maps.js') : root.Maps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Rules = api;
})(typeof self !== 'undefined' ? self : this, function (RNG, Maps) {
  'use strict';

  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 8;
  const SOLO_MAX_LEVEL = 2;       /* 沒湊齊同色整組時，單格最高能升到幾級 */
  const START_CASH = 10000;        /* 不限回合的起始現金 */
  /** 起始現金：回合上限 × 100（20／30／40 回合＝2000／3000／4000），不限回合＝10000 */
  function startCashFor(limit) { return Number(limit) > 0 ? Number(limit) * 100 : START_CASH; }
  const GO_SALARY = 200;
  const JAIL_FINE = 50;
  let JAIL_POS = 10;
  const MAX_HOUSES = 5;            /* 5＝旅店 */
  let BOARD = 40;

  const DIFFICULTY_LIST = ['kid', 'easy', 'normal', 'hard'];
  const DIFFICULTIES = {
    kid: { name: '幼幼班' }, easy: { name: '簡單' }, normal: { name: '普通' }, hard: { name: '困難' }
  };
  const PACES = { slow: 1.5, normal: 1, fast: 0.6 };
  const ROUND_LIMITS = [0, 20, 30, 40];   /* 0＝沒有上限 */
  const PLAYER_COLORS = ['#EF5B5B', '#3F8CFF', '#3DAE6B', '#FFA53D', '#A56BE8', '#1FB8C4', '#F06AB2', '#7A8594'];

  /* ---------- 棋盤 ---------- */

  /* 目前生效的地圖（GROUPS／TILES／GROUP_TILES／OWNABLE 都是「原地更新」的同一份物件，
   * 畫面那邊抓一次參考就永遠有效）。伺服器會同時跑不同地圖的房間，所以每個入口函式一進來
   * 都會先 useMap(state.map) 切到那一局的地圖；切換只是換內容，不會重新建立。 */
  const GROUPS = {};
  const TILES = [];
  let BASE_TILES = [];
  const CTX = {};
  let CUR_MAP = null;
  function ctxOf(id) {
    if (CTX[id]) return CTX[id];
    const m = Maps.get(id);
    const groupTiles = {};
    m.tiles.forEach(t => { if (t.type === 'prop') (groupTiles[t.group] = groupTiles[t.group] || []).push(t.i); });
    const clone = t => Object.assign({}, t, t.rent ? { rent: t.rent.slice() } : {});
    const ownable = m.tiles.filter(t => t.type === 'prop' || t.type === 'station' || t.type === 'utility').map(t => t.i);
    const chance = CHANCE_BASE.map(c => Object.assign({}, c)), chest = CHEST_BASE.map(c => Object.assign({}, c));
    [['top', 1], ['beach', 2], ['station', 3]].forEach(([k, idx]) => {
      chance[idx] = Object.assign({}, chance[idx], { t: 'moveTo', to: m.landmarks[k], text: m.texts[idx] || m.texts[k] });
    });
    return (CTX[id] = {
      id: m.id, def: m, base: m.tiles.map(clone), live: m.tiles.map(clone), groups: m.groups, groupTiles, ownable, size: m.tiles.length,
      jail: m.tiles.findIndex(t => t.type === 'jail'), chance, chest
    });
  }
  function useMap(id) {
    id = Maps.has(id) ? id : Maps.DEFAULT;
    if (CUR_MAP === id) return id;
    const c = ctxOf(id);
    TILES.length = 0; c.live.forEach(t => TILES.push(t));
    Object.keys(GROUPS).forEach(k => delete GROUPS[k]); Object.assign(GROUPS, c.groups);
    Object.keys(GROUP_TILES).forEach(k => delete GROUP_TILES[k]); Object.assign(GROUP_TILES, c.groupTiles);
    OWNABLE.length = 0; c.ownable.forEach(i => OWNABLE.push(i));
    CHANCE.length = 0; c.chance.forEach(x => CHANCE.push(x));
    CHEST.length = 0; c.chest.forEach(x => CHEST.push(x));
    BASE_TILES = c.base; BOARD = c.size; JAIL_POS = c.jail;
    CUR_MAP = id;
    return id;
  }
  const GROUP_TILES = {};
  const OWNABLE = [];

  /* ---------- 每場隨機地價：在原價 ±30% 內，價格、房價、租金一起縮放，全部整數 ---------- */
  const PRICE_SWING = 0.3;
  const r10 = (n, min) => Math.max(min || 10, Math.round(n / 10) * 10);
  function tl(state) { return state && state.tiles && state.tiles[0] && state.tiles[0].type ? state.tiles : TILES; }
  /** 依亂數產生這一場的地價表。同色組內維持「原本低的還是低」，車站／公司／稅金各自縮放。 */
  function genTiles(rng) {
    const out = BASE_TILES.map(t => Object.assign({}, t, t.rent ? { rent: t.rent.slice() } : {}));
    const f = () => 1 - PRICE_SWING + rng.next() * PRICE_SWING * 2;
    Object.keys(GROUP_TILES).forEach(g => {
      const ids = GROUP_TILES[g].slice().sort((a, b) => BASE_TILES[a].price - BASE_TILES[b].price || a - b);
      const fs = ids.map(f).sort((a, b) => a - b);
      ids.forEach((i, k) => {
        const t = BASE_TILES[i], o = out[i], m = fs[k];
        o.price = r10(t.price * m); o.house = r10(t.house * m);
        o.rent = t.rent.map(x => Math.max(1, Math.round(x * m)));
        for (let j = 1; j < o.rent.length; j++) if (o.rent[j] <= o.rent[j - 1]) o.rent[j] = o.rent[j - 1] + 1;
      });
    });
    BASE_TILES.forEach((t, i) => {
      if (t.type === 'station' || t.type === 'utility') out[i].price = r10(t.price * f());
      if (t.type === 'tax') out[i].tax = r10(t.tax * f());
    });
    return out;
  }
  /** 給畫面用：把公開的地價表套進全域 TILES（伺服器不呼叫，只有瀏覽器單局用） */
  function applyTiles(list) {
    if (!list || list.length !== TILES.length) return false;
    let changed = false;
    list.forEach((x, i) => {
      if (!x) return;
      const t = TILES[i];
      if (x.price != null && t.price !== x.price) { t.price = x.price; changed = true; }
      if (x.tax != null && t.tax !== x.tax) { t.tax = x.tax; changed = true; }
      if (x.house != null && t.house !== x.house) { t.house = x.house; changed = true; }
      if (x.rent && t.rent && x.rent.join() !== t.rent.join()) { t.rent = x.rent.slice(); changed = true; }
    });
    return changed;
  }
  const STATION_RENT = [40, 80, 160, 320];

  /* ---------- 機會／命運 ---------- */

  const CHANCE = [];
  const CHANCE_BASE = [
    { t: 'moveTo', to: 0, text: '前進到起點，領 200 元' },
    { t: 'moveTo', to: 39, text: '前往台北101，看看跨年煙火' },
    { t: 'moveTo', to: 6, text: '週末衝墾丁！前進到墾丁' },
    { t: 'moveTo', to: 5, text: '搭高鐵到台北車站' },
    { t: 'nearest', kind: 'station', text: '前進到最近的車站；如果有主人，租金加倍' },
    { t: 'nearest', kind: 'station', text: '前進到最近的車站；如果有主人，租金加倍' },
    { t: 'nearest', kind: 'utility', text: '前進到最近的公司；如果有主人，付骰子點數的 15 倍' },
    { t: 'collect', n: 50, text: '銀行發放股息，領 50 元' },
    { t: 'collect', n: 150, text: '定存到期，領 150 元' },
    { t: 'collect', n: 100, text: '統一發票中獎，領 100 元' },
    { t: 'getOut', text: '獲得一張「出獄許可證」，可以留著以後用' },
    { t: 'moveBack', n: 3, text: '走錯路，後退 3 格' },
    { t: 'jail', text: '違規停車被拖吊，直接進監獄！' },
    { t: 'repairs', house: 25, hotel: 100, text: '房屋整修：每棟房子付 25 元、每間旅店付 100 元' },
    { t: 'pay', n: 15, text: '超速罰單，付 15 元' },
    { t: 'eachPay', n: 50, text: '你被選為社區主委，付給每位玩家 50 元' },
    { t: 'item', text: '撿到一個道具箱，獲得一個隨機道具' },
    { t: 'god', good: true, text: '福神或財神降臨！接下來 4 回合好運連連' },
    { t: 'god', good: false, text: '窮神或衰神纏身……接下來 4 回合要小心荷包' }
  ];
  const CHEST = [];
  const CHEST_BASE = [
    { t: 'moveTo', to: 0, text: '前進到起點，領 200 元' },
    { t: 'collect', n: 200, text: '銀行算錯帳，剛好對你有利，領 200 元' },
    { t: 'pay', n: 50, text: '看醫生，付 50 元' },
    { t: 'collect', n: 50, text: '賣掉股票，賺 50 元' },
    { t: 'getOut', text: '獲得一張「出獄許可證」，可以留著以後用' },
    { t: 'jail', text: '闖紅燈被開單，直接進監獄！' },
    { t: 'eachCollect', n: 50, text: '過年紅包！每位玩家給你 50 元' },
    { t: 'collect', n: 20, text: '所得稅退稅，領 20 元' },
    { t: 'eachCollect', n: 10, text: '今天是你的生日！每位玩家給你 10 元' },
    { t: 'collect', n: 100, text: '保險到期，領 100 元' },
    { t: 'pay', n: 100, text: '住院費，付 100 元' },
    { t: 'pay', n: 50, text: '繳學費，付 50 元' },
    { t: 'collect', n: 25, text: '顧問費，領 25 元' },
    { t: 'repairs', house: 40, hotel: 115, text: '道路修繕：每棟房子付 40 元、每間旅店付 115 元' },
    { t: 'collect', n: 10, text: '選美比賽得到第二名，領 10 元' },
    { t: 'collect', n: 100, text: '收到遺產，領 100 元' },
    { t: 'item', text: '抽中摸彩獎品，獲得一個隨機道具' },
    { t: 'god', good: true, text: '廟裡擲筊三個聖筊，福神或財神跟著你！' },
    { t: 'god', good: false, text: '踩到黑貓的尾巴，窮神或衰神跟上你……' }
  ];
  const CHANCE_GETOUT = 10, CHEST_GETOUT = 4;

  /* ---------- 道具 ----------
   * 來源：停在「溫泉休息站」、抽到「道具箱」卡。最多帶 3 個；帶滿了就改領 50 元。
   * active：自己挑時機用（擲骰前）；passive：條件到了自動用掉。 */
  const MAX_ITEMS = 3;
  const ITEMS = {
    dice:   { name: '遙控骰', cost: 80, active: true,  desc: '擲骰前使用：自己決定這回合走 1～6 步（不算雙骰）' },
    fly:    { name: '機票', cost: 120,   active: true,  desc: '擲骰前使用：直接飛到棋盤上任何一格（不會領起點薪水，落點照常處理）' },
    free:   { name: '免租券', cost: 80, active: false, desc: '下一次要付過路費時自動用掉，這次不用付' },
    cat:    { name: '招財貓', cost: 100, active: false, desc: '下一次有人付你過路費時，租金加倍（用掉）' },
    taxfree:{ name: '免稅券', cost: 60, active: false, desc: '下一次要繳稅時自動用掉，這次不用繳' },
    guard:  { name: '護身符', cost: 100, active: false, desc: '別人對你使用偷錢卡、換位卡或炸彈時自動擋下（用掉）' },
    steal:  { name: '偷錢卡', cost: 150, active: true, target: 'seat', desc: '擲骰前使用：指定一位對手，偷走他 20% 的現金（最多 300 元）' },
    swap:   { name: '換位卡', cost: 130, active: true, target: 'seat', desc: '擲骰前使用：和指定對手交換位置，換到的落點照常處理（不領薪水）' },
    bomb:   { name: '炸彈', cost: 150,   active: true, target: 'tile', desc: '擲骰前使用：炸掉指定對手的一間房子（旅店降回 4 間房）' }
  };
  /* ---------- 命運之神：附身 4 個自己的回合 ---------- */
  const GODS = {
    fortune: { name: '福神', good: true,  desc: '別人付你的過路費加倍' },
    wealth:  { name: '財神', good: true,  desc: '每個自己的回合開始領 120 元' },
    poor:    { name: '窮神', good: false, desc: '你付出去的過路費加倍' },
    unlucky: { name: '衰神', good: false, desc: '每個自己的回合開始被扣 80 元' }
  };
  const GOD_TURNS = 4;
  const ITEM_LIST = Object.keys(ITEMS);

  /* ---------- 建立 ---------- */

  function hide(state, key, val) { Object.defineProperty(state, key, { value: val, enumerable: false, writable: true }); }

  /**
   * @param {{id,name,char,ai?}[]} players
   * @param {{seed,pace,now,roundLimit,startCash,turnMs}} o
   */
  function create(players, o) {
    o = o || {};
    const mapId = useMap(o.map);
    const rng = RNG.create(String(o.seed || 'seed') + '-rules');
    const order = rng.shuffle(players.slice());
    const seats = order.map(p => ({
      id: p.id, name: p.name, char: p.char, ai: p.ai || null,
      cash: o.startCash || startCashFor(ROUND_LIMITS.includes(Number(o.roundLimit)) ? Number(o.roundLimit) : 0), pos: 0, jail: false, jailTurns: 0, getOut: 0, items: [], god: null,
      bankrupt: false, auto: false, timeouts: 0, afk: false
    }));
    const props = TILES.map(() => ({ owner: -1, houses: 0 }));
    const tiles = o.fixedPrices ? TILES : genTiles(rng);
    const now = o.now || 0;
    const state = {
      version: 0,
      opts: {
        pace: PACES[o.pace] ? o.pace : 'normal',
        roundLimit: ROUND_LIMITS.includes(Number(o.roundLimit)) ? Number(o.roundLimit) : 0,
        turnMs: Number(o.turnMs) || 0
      },
      map: mapId, seats, props, tiles, turn: 0, round: 1, phase: 'roll', dice: [0, 0], doubles: 0, again: false,
      pending: null, boughtOut: false, card: null, cardSeq: 0, events: [], eventSeq: 0, log: [], logSeq: 0,
      winner: null, reason: null, ranking: null, bankruptOrder: [],
      readyAt: now + 800, deadline: 0, startedAt: now
    };
    hide(state, '_rng', rng);
    hide(state, '_decks', { chance: rng.shuffle(CHANCE.map((c, i) => i)), chest: rng.shuffle(CHEST.map((c, i) => i)) });
    say(state, '開局！由 ' + seats[0].name + ' 先擲骰子');
    if (state.opts.turnMs) state.deadline = now + state.opts.turnMs;
    return state;
  }

  /* ---------- 小工具 ---------- */

  function say(state, text) { state.log.push({ n: ++state.logSeq, text }); if (state.log.length > 60) state.log.shift(); }
  function ev(state, e) { e.n = ++state.eventSeq; state.events.push(e); if (state.events.length > 40) state.events.shift(); }
  function cur(state) { return state.seats[state.turn]; }
  function indexOfId(state, id) { return state.seats.findIndex(s => s.id === id); }
  function alive(state) { return state.seats.filter(s => !s.bankrupt); }
  function money(n) { return n + ' 元'; }

  function ownedBy(state, si) { return OWNABLE.filter(i => state.props[i].owner === si); }
  function groupOwned(state, si, group) { return GROUP_TILES[group].every(i => state.props[i].owner === si); }
  function groupHouses(state, group) { return GROUP_TILES[group].map(i => state.props[i].houses); }
  function countKind(state, si, type) { return OWNABLE.filter(i => tl(state)[i].type === type && state.props[i].owner === si).length; }

  /** 租金；opt.double 車站加倍、opt.tenX 公司固定 15 倍（機會卡） */
  /* 連棟加乘：同一個人在「相鄰」的連續格子上都蓋了房子，踩到其中任何一格租金加成：2 連 ×1.5、3 連 ×2、4 連以上 ×2.5 */
  const ROW_BONUS = [1, 1, 1.5, 2, 2.5];
  function rowLen(state, ti) {
    const T = tl(state), n = T.length, o = state.props[ti].owner;
    const ok = i => { const q = state.props[i]; return T[i].type === 'prop' && q.owner === o && q.houses > 0; };
    if (o < 0 || !ok(ti)) return 1;
    let len = 1;
    for (let k = 1; k < n && ok((ti + k) % n); k++) len++;
    for (let k = 1; len < n && k < n && ok((ti - k + n) % n); k++) len++;
    return len;
  }
  function rowBonus(state, ti) { return ROW_BONUS[Math.min(rowLen(state, ti), ROW_BONUS.length - 1)]; }

  function rentOf(state, ti, dice, opt) {
    opt = opt || {};
    const t = tl(state)[ti], p = state.props[ti];
    if (p.owner < 0) return 0;
    if (t.type === 'prop') {
      if (p.houses > 0) return Math.round(t.rent[p.houses] * rowBonus(state, ti));
      return t.rent[0] * (groupOwned(state, p.owner, t.group) ? 2 : 1);
    }
    if (t.type === 'station') return STATION_RENT[Math.max(0, countKind(state, p.owner, 'station') - 1)] * (opt.double ? 2 : 1);
    const d = dice ? dice[0] + dice[1] : 7;
    return (opt.tenX || countKind(state, p.owner, 'utility') >= 2 ? 15 : 6) * d;
  }

  /** 一個人手上能換成現金的最大金額（現金＋賣房） */
  function liquidity(state, si) {
    const s = state.seats[si];
    let v = s.cash;
    for (const i of ownedBy(state, si)) {
      const t = tl(state)[i], p = state.props[i];
      v += p.houses * Math.floor((t.house || 0) / 2);
    }
    return v;
  }

  function netWorth(state, si) {
    const s = state.seats[si];
    let v = s.cash;
    for (const i of ownedBy(state, si)) {
      const t = tl(state)[i], p = state.props[i];
      v += t.price;
      v += p.houses * (t.house || 0);
    }
    return v;
  }

  /* ---------- 道具 ---------- */

  function hasItem(state, si, id) { return state.seats[si].items.includes(id); }
  function useUp(state, si, id) {
    const s = state.seats[si];
    const k = s.items.indexOf(id);
    if (k >= 0) s.items.splice(k, 1);
    ev(state, { t: 'item', seat: si, item: id, use: true });
  }
  function gainItem(state, si) {
    const s = state.seats[si];
    if (s.items.length >= MAX_ITEMS) {
      s.cash += 50;
      ev(state, { t: 'cash', seat: si, to: -2, amount: 50, reason: 'card' });
      say(state, s.name + ' 的道具已經帶滿了，改領 50 元');
      return;
    }
    const id = ITEM_LIST[state._rng.int(0, ITEM_LIST.length - 1)];
    s.items.push(id);
    ev(state, { t: 'item', seat: si, item: id, gain: true });
    say(state, s.name + ' 獲得道具「' + ITEMS[id].name + '」');
  }
  /** 遙控骰／機票 現在能不能用（回傳 null 代表可以） */
  function canUseItem(state, si, id, arg) {
    const s = state.seats[si];
    if (state.phase !== 'roll') return '擲骰前才能使用';
    if (s.jail) return '在監獄裡不能用';
    if (!ITEMS[id] || !ITEMS[id].active) return '這個道具不能主動使用';
    if (!s.items.includes(id)) return '你沒有這個道具';
    if (id === 'dice' && !(Number.isInteger(arg) && arg >= 1 && arg <= 6)) return '請選 1～6 步';
    if (id === 'steal' || id === 'swap') {
      const o = Number.isInteger(arg) ? state.seats[arg] : null;
      if (!o || arg === si || o.bankrupt) return '請選一位對手';
      if (id === 'steal' && o.cash < 5) return '對方身上沒什麼錢可以偷';
      if (id === 'swap' && (o.jail || o.pos === s.pos)) return o.jail ? '對方在監獄裡，換不了' : '你們在同一格';
    }
    if (id === 'bomb') {
      const p = Number.isInteger(arg) && arg >= 0 && arg < BOARD ? state.props[arg] : null;
      if (!p || p.owner < 0 || p.owner === si || p.houses < 1) return '請選一塊對手蓋了房子的地';
    }
    if (id === 'fly') {
      if (!(Number.isInteger(arg) && arg >= 0 && arg < BOARD)) return '請選要飛去的格子';
      if (arg === s.pos) return '你已經在這一格了';
      if (tl(state)[arg].type === 'gotojail') return '不能飛去「去坐牢」';
    }
    return null;
  }

  /** 攻擊型道具現在有哪些可選目標（座位或格子），空陣列＝沒有目標 */
  function itemTargets(state, si, id) {
    const out = [];
    if (id === 'steal' || id === 'swap') state.seats.forEach((o, i) => { if (!canUseItem(state, si, id, i)) out.push(i); });
    else if (id === 'bomb') for (let i = 0; i < BOARD; i++) if (!canUseItem(state, si, 'bomb', i)) out.push(i);
    return out;
  }
  function godOf(state, si) { return state.seats[si].god ? state.seats[si].god.k : null; }
  function giveGod(state, si, good) {
    const s = state.seats[si];
    const ks = Object.keys(GODS).filter(k => GODS[k].good === good);
    const k = ks[state._rng.int(0, ks.length - 1)];
    s.god = { k, turns: GOD_TURNS };
    ev(state, { t: 'god', seat: si, god: k, on: true, good });
    say(state, s.name + ' 被' + GODS[k].name + '附身了：' + GODS[k].desc);
  }
  /** 被攻擊：有護身符就擋下。回傳 true＝被擋下 */
  function guarded(state, from, to, kind, tile) {
    if (!hasItem(state, to, 'guard')) return false;
    useUp(state, to, 'guard');
    ev(state, { t: 'attack', kind, from, to, tile: tile == null ? -1 : tile, blocked: true });
    say(state, state.seats[to].name + ' 的「護身符」擋下了 ' + state.seats[from].name + ' 的攻擊！');
    return true;
  }

  /* ---------- 錢、破產 ---------- */

  /**
   * 付錢。to：-1 銀行、其他＝債主座位。
   * 付得起就直接付、回傳 true；資產變賣後付得起就進入 debt；連變賣都不夠就直接破產。
   */
  function charge(state, si, to, amount, reason, cont) {
    const s = state.seats[si];
    if (amount <= 0) return true;
    if (s.cash >= amount) {
      pay(state, si, to, amount, reason);
      return true;
    }
    if (liquidity(state, si) >= amount) {
      state.pending = { kind: 'debt', amount, creditor: to, reason, cont: cont || null };
      state.phase = 'debt';
      say(state, s.name + ' 現金不夠付 ' + money(amount) + '，要先賣房子');
      return false;
    }
    say(state, s.name + ' 要付 ' + money(amount) + '，但全部資產都不夠');
    goBankrupt(state, si, to);
    return false;
  }

  function pay(state, si, to, amount, reason) {
    const s = state.seats[si];
    s.cash -= amount;
    if (to >= 0) state.seats[to].cash += amount;
    ev(state, { t: 'cash', seat: si, to, amount, reason });
  }

  function goBankrupt(state, si, to) {
    const s = state.seats[si];
    if (s.bankrupt) return;
    /* 房子先賣回銀行（半價），換到的錢跟現金一起給債主 */
    let cash = s.cash;
    for (const i of ownedBy(state, si)) {
      const t = tl(state)[i], p = state.props[i];
      cash += p.houses * Math.floor((t.house || 0) / 2);
      p.houses = 0;
    }
    const heir = to >= 0 && !state.seats[to].bankrupt ? to : -1;
    for (const i of ownedBy(state, si)) {
      const p = state.props[i];
      if (heir >= 0) p.owner = heir;
      else p.owner = -1;
    }
    if (heir >= 0) {
      state.seats[heir].cash += cash;
      state.seats[heir].getOut += s.getOut;
    } else for (let k = 0; k < s.getOut; k++) returnGetOut(state);
    s.cash = 0; s.getOut = 0; s.items = []; s.bankrupt = true; s.jail = false;
    state.bankruptOrder.push(si);
    state.pending = null;
    ev(state, { t: 'bankrupt', seat: si, to: heir });
    say(state, s.name + ' 破產出局了！' + (heir >= 0 ? '所有財產都給了 ' + state.seats[heir].name : '財產回到銀行'));
    if (alive(state).length <= 1) { finish(state, 'lastStanding'); return; }
    nextTurn(state);
  }

  function returnGetOut(state) {
    if (!state._decks.chance.includes(CHANCE_GETOUT)) state._decks.chance.push(CHANCE_GETOUT);
    else if (!state._decks.chest.includes(CHEST_GETOUT)) state._decks.chest.push(CHEST_GETOUT);
  }

  function finish(state, reason) {
    state.phase = 'over';
    state.reason = reason;
    state.pending = null;
    const live = state.seats.map((s, i) => i).filter(i => !state.seats[i].bankrupt)
      .sort((a, b) => netWorth(state, b) - netWorth(state, a));
    state.ranking = live.concat(state.bankruptOrder.slice().reverse());
    state.winner = state.ranking[0];
    say(state, state.seats[state.winner].name + ' 獲勝！' + (reason === 'roundLimit' ? '（回合到了，比總資產）' : '（其他人都破產了）'));
    ev(state, { t: 'win', seat: state.winner });
  }

  /* ---------- 移動與落點 ---------- */

  function sendToJail(state, si) {
    const s = state.seats[si];
    const from = s.pos;
    s.pos = JAIL_POS; s.jail = true; s.jailTurns = 0;
    state.again = false; state.doubles = 0;
    ev(state, { t: 'move', seat: si, from, to: JAIL_POS, teleport: true });
    ev(state, { t: 'jail', seat: si });
    say(state, s.name + ' 被關進監獄了');
  }

  /** forward：往前走（經過起點領薪水）；否則直接跳過去（後退） */
  function moveBy(state, si, to, forward, ctx) {
    const s = state.seats[si];
    const from = s.pos;
    const passGo = forward && to <= from;
    s.pos = to;
    ev(state, { t: 'move', seat: si, from, to, teleport: !forward, forward: !!forward });
    if (passGo) {
      s.cash += GO_SALARY;
      ev(state, { t: 'cash', seat: si, to: -2, amount: GO_SALARY, reason: 'go' });
      say(state, s.name + ' 經過起點，領 ' + money(GO_SALARY));
    }
    land(state, si, ctx || {});
  }

  function land(state, si, ctx) {
    const s = state.seats[si], t = tl(state)[s.pos], p = state.props[s.pos];
    if (t.type === 'prop' || t.type === 'station' || t.type === 'utility') {
      if (p.owner < 0) {
        state.pending = { kind: 'buy', tile: t.i, price: t.price };
        state.phase = 'buy';
        return;
      }
      if (p.owner === si) {
        if (t.type === 'prop' && !canBuildAt(state, si, t.i)) {
          state.pending = { kind: 'build', tile: t.i };
          state.phase = 'build';
          say(state, s.name + ' 來到自己的 ' + t.name + '，可以加蓋房子');
        } else say(state, s.name + ' 來到自己的 ' + t.name);
        return;
      }
      let rent = rentOf(state, t.i, state.dice, ctx);
      if (hasItem(state, si, 'free')) {
        useUp(state, si, 'free');
        say(state, s.name + ' 停在 ' + state.seats[p.owner].name + ' 的 ' + t.name + '，用掉「免租券」，這次不用付！');
        return;
      }
      if (hasItem(state, p.owner, 'cat')) {
        useUp(state, p.owner, 'cat');
        rent *= 2;
        say(state, state.seats[p.owner].name + ' 的「招財貓」發威，租金加倍！');
      }
      if (godOf(state, p.owner) === 'fortune') { rent *= 2; say(state, state.seats[p.owner].name + ' 有福神保佑，租金加倍！'); }
      if (godOf(state, si) === 'poor') { rent *= 2; say(state, s.name + ' 被窮神纏身，要付雙倍過路費！'); }
      say(state, s.name + ' 停在 ' + state.seats[p.owner].name + ' 的 ' + t.name + '，付過路費 ' + money(rent));
      charge(state, si, p.owner, rent, 'rent');
      return;
    }
    if (t.type === 'tax') {
      if (hasItem(state, si, 'taxfree')) { useUp(state, si, 'taxfree'); say(state, s.name + ' 用掉「免稅券」，這次不用繳' + t.name + '！'); return; }
      say(state, s.name + ' 繳' + t.name + ' ' + money(t.tax));
      charge(state, si, -1, t.tax, 'tax');
      return;
    }
    if (t.type === 'gotojail') { say(state, s.name + ' 被抓去坐牢'); sendToJail(state, si); return; }
    if (t.type === 'chance' || t.type === 'chest') { drawCard(state, si, t.type); return; }
    if (t.type === 'shop') { shopArrive(state, si, t); return; }
    if (t.type === 'jail') say(state, s.name + ' 來監獄探監（只是路過）');
    else if (t.type === 'park') { say(state, s.name + ' 在溫泉休息站泡腳，撿到一個道具'); gainItem(state, si); }
  }

  /* ---------- 道具商店：停在「道具商店」格，可以花錢買道具（最多帶 MAX_ITEMS 個） ---------- */
  function cheapestItem() { return Math.min.apply(null, ITEM_LIST.map(k => ITEMS[k].cost)); }
  function canBuyItem(state, si, id) {
    const s = state.seats[si];
    if (!ITEMS[id]) return '沒有這個商品';
    if (s.items.length >= MAX_ITEMS) return '道具欄滿了（最多 ' + MAX_ITEMS + ' 個）';
    if (s.cash < ITEMS[id].cost) return '現金不夠（要 ' + money(ITEMS[id].cost) + '）';
    return null;
  }
  function shopArrive(state, si, t) {
    const s = state.seats[si];
    if (s.items.length >= MAX_ITEMS) { say(state, s.name + ' 逛了' + t.name + '，但道具欄已經滿了'); return; }
    if (s.cash < cheapestItem()) { say(state, s.name + ' 逛了' + t.name + '，但錢不夠買任何東西'); return; }
    state.pending = { kind: 'shop', tile: t.i };
    state.phase = 'shop';
    say(state, s.name + ' 來到' + t.name + '，可以買道具');
  }

  function drawCard(state, si, deck) {
    const s = state.seats[si];
    const list = deck === 'chance' ? CHANCE : CHEST;
    const order = state._decks[deck];
    const idx = order.shift();
    const card = list[idx];
    if (card.t !== 'getOut') order.push(idx);
    state.card = { n: ++state.cardSeq, deck, text: card.text, seat: si };
    const MOOD = { collect: 'good', getOut: 'good', item: 'good', eachCollect: 'good', pay: 'bad', jail: 'bad', moveBack: 'bad', repairs: 'bad', eachPay: 'bad' };
    const mood = card.t === 'god' ? (card.good ? 'good' : 'bad') : (MOOD[card.t] || 'neutral');
    ev(state, { t: 'card', seat: si, deck, text: card.text, mood });
    say(state, s.name + ' 抽到' + (deck === 'chance' ? '機會' : '命運') + '：' + card.text);
    switch (card.t) {
      case 'collect': s.cash += card.n; ev(state, { t: 'cash', seat: si, to: -2, amount: card.n, reason: 'card' }); break;
      case 'pay': charge(state, si, -1, card.n, 'card'); break;
      case 'getOut': s.getOut++; break;
      case 'item': gainItem(state, si); break;
      case 'god': giveGod(state, si, !!card.good); break;
      case 'jail': sendToJail(state, si); break;
      case 'moveTo': moveBy(state, si, card.to, true, {}); break;
      case 'moveBack': moveBy(state, si, (s.pos - card.n + BOARD) % BOARD, false, {}); break;
      case 'nearest': {
        let to = s.pos;
        for (let k = 1; k <= BOARD; k++) {
          const c = (s.pos + k) % BOARD;
          if (tl(state)[c].type === card.kind) { to = c; break; }
        }
        moveBy(state, si, to, true, card.kind === 'station' ? { double: true } : { tenX: true });
        break;
      }
      case 'repairs': {
        let h = 0, ho = 0;
        for (const i of ownedBy(state, si)) { const x = state.props[i].houses; if (x === MAX_HOUSES) ho++; else h += x; }
        charge(state, si, -1, h * card.house + ho * card.hotel, 'card');
        break;
      }
      case 'eachPay': {
        const others = state.seats.map((x, i) => i).filter(i => i !== si && !state.seats[i].bankrupt);
        const total = card.n * others.length;
        if (s.cash >= total) others.forEach(i => pay(state, si, i, card.n, 'card'));
        else charge(state, si, -1, total, 'card');     /* 簡化：錢不夠時視為付給銀行 */
        break;
      }
      case 'eachCollect': {
        state.seats.forEach((x, i) => {
          if (i === si || x.bankrupt) return;
          const n = Math.min(card.n, x.cash);          /* 簡化：對方現金不夠就付他有的 */
          if (n > 0) pay(state, i, si, n, 'card');
        });
        break;
      }
      default: break;
    }
  }

  /* ---------- 回合推進 ---------- */

  function nextTurn(state) {
    if (state.phase === 'over') return;
    const n = state.seats.length;
    let t = state.turn;
    for (let k = 0; k < n; k++) {
      t = (t + 1) % n;
      if (!state.seats[t].bankrupt) break;
    }
    if (t <= state.turn) {
      state.round++;
      if (state.opts.roundLimit && state.round > state.opts.roundLimit) { state.round = state.opts.roundLimit; finish(state, 'roundLimit'); return; }
    }
    state.turn = t;
    state.doubles = 0; state.again = false; state.pending = null; state.boughtOut = false;
    state.phase = 'roll';
    state.seats[t].auto = false;
    say(state, '輪到 ' + state.seats[t].name);
    godTurnStart(state, t);
  }
  function godTurnStart(state, si) {
    const s = state.seats[si];
    if (!s.god) return;
    const k = s.god.k;
    if (k === 'wealth') { s.cash += 120; ev(state, { t: 'cash', seat: si, to: -2, amount: 120, reason: 'god' }); say(state, '財神送錢：' + s.name + ' 領到 120 元'); }
    else if (k === 'unlucky') {
      const n = Math.min(80, s.cash);
      if (n > 0) { s.cash -= n; ev(state, { t: 'cash', seat: si, to: -1, amount: n, reason: 'godbad' }); say(state, '衰神作祟：' + s.name + ' 破財 ' + n + ' 元'); }
    }
    if (--s.god.turns <= 0) { s.god = null; ev(state, { t: 'god', seat: si, god: k, on: false }); say(state, s.name + ' 身上的' + GODS[k].name + '離開了'); }
  }

  /** 這一步的事都處理完了：該再擲一次、進入整理階段，還是換人（換人後不能再動） */
  function afterResolve(state, si) {
    if (state.phase === 'buy' || state.phase === 'build' || state.phase === 'shop' || state.phase === 'debt' || state.phase === 'over') return;
    if (state.turn !== si || state.seats[si].bankrupt) return;
    const s = state.seats[si];
    if (state.again && !s.jail) { state.phase = 'roll'; say(state, s.name + ' 擲出雙骰，再擲一次！'); return; }
    state.phase = 'manage';
  }

  function runCont(state, si, cont) {
    if (!cont) return;
    if (cont.kind === 'move') moveBy(state, si, (state.seats[si].pos + cont.sum) % BOARD, true, {});
  }

  /* ---------- 行動 ---------- */

  function holdFor(state, kind, extra) {
    const f = PACES[state.opts.pace] || 1;
    const base = { roll: 900, buy: 600, decline: 450, build: 550, shop: 500, sell: 450, buyout: 800, end: 350, pay: 500, settle: 450, bankrupt: 1200 }[kind] || 400;
    return Math.round((base + (extra || 0)) * f);
  }

  function doRoll(state, si, now) {
    const s = state.seats[si];
    const n0 = state.eventSeq;
    const rng = state._rng;
    const a = rng.int(1, 6), b = rng.int(1, 6);
    state.dice = [a, b];
    ev(state, { t: 'roll', seat: si, dice: [a, b] });
    const dbl = a === b;
    let steps = 0;
    let moved = true;
    if (s.jail) {
      if (dbl) {
        s.jail = false; s.jailTurns = 0; state.again = false;
        say(state, s.name + ' 擲出雙骰 ' + a + '+' + b + '，出獄了！');
        steps = a + b;
        moveBy(state, si, (s.pos + steps) % BOARD, true, {});
      } else {
        s.jailTurns++;
        say(state, s.name + ' 擲出 ' + a + '+' + b + '，沒有雙骰，繼續關著');
        if (s.jailTurns >= 3) {
          s.jail = false; s.jailTurns = 0; state.again = false;
          say(state, s.name + ' 關滿 3 回合，繳 ' + money(JAIL_FINE) + ' 出獄');
          steps = a + b;
          if (charge(state, si, -1, JAIL_FINE, 'jail', { kind: 'move', sum: a + b })) moveBy(state, si, (s.pos + steps) % BOARD, true, {});
        } else {
          state.phase = 'manage';
          moved = false;
        }
      }
    } else {
      state.doubles = dbl ? state.doubles + 1 : 0;
      state.again = dbl;
      if (dbl && state.doubles >= 3) {
        say(state, s.name + ' 連續三次雙骰，被抓去坐牢！');
        sendToJail(state, si);
      } else {
        say(state, s.name + ' 擲出 ' + a + '+' + b + ' = ' + (a + b));
        steps = a + b;
        moveBy(state, si, (s.pos + steps) % BOARD, true, {});
      }
    }
    if (moved) afterResolve(state, si);
    const drew = state.events.some(e => e.n > n0 && e.t === 'card');
    state.readyAt = now + holdFor(state, 'roll', steps * 140 + (drew ? 1300 : 0) + (moved ? 0 : 500));
  }

  function checkTileOwn(state, si, ti) {
    if (!OWNABLE.includes(ti)) return '這格不能這樣做';
    if (state.props[ti].owner !== si) return '這塊地不是你的';
    return null;
  }

  function canBuildAt(state, si, ti) {
    const t = tl(state)[ti];
    if (!t || t.type !== 'prop') return '只有地產可以蓋房子';
    const p = state.props[ti];
    if (p.owner !== si) return '這塊地不是你的';
    if (p.houses >= MAX_HOUSES) return '已經是旅店了';
    if (state.seats[si].cash < t.house) return '現金不夠（要 ' + money(t.house) + '）';
    if (!groupOwned(state, si, t.group)) {
      /* 沒湊齊整組：每一格可以各自升級到 2 級；想更高要先買齊同色整組 */
      if (p.houses >= SOLO_MAX_LEVEL) return '這格已升到 ' + SOLO_MAX_LEVEL + ' 級；買齊同色整組才能繼續升級';
      return null;
    }
    const min = Math.min.apply(null, groupHouses(state, t.group));
    if (p.houses > min) return '要平均升級：先把同組其他格升到一樣高';
    return null;
  }

  function canSellAt(state, si, ti) {
    const t = tl(state)[ti];
    if (!t || t.type !== 'prop') return '這格沒有房子';
    const p = state.props[ti];
    if (p.owner !== si) return '這塊地不是你的';
    if (p.houses <= 0) return '這格沒有房子';
    if (groupOwned(state, si, t.group)) {
      const max = Math.max.apply(null, groupHouses(state, t.group));
      if (p.houses < max) return '要平均賣：先賣同組蓋比較多的那格';
    }
    return null;
  }

  /** 買了這塊，同組其他格都是自己的 → 湊齊整組 */
  function completesGroup(state, si, ti) {
    const t = tl(state)[ti];
    return t.type === 'prop' && GROUP_TILES[t.group].every(i => i === ti || state.props[i].owner === si);
  }

  function buyoutCost(state, ti) { return tl(state)[ti].price * 2; }

  function canBuyoutAt(state, si, ti) {
    const t = tl(state)[ti];
    if (!t || t.type !== 'prop') return '只有地產可以收購';
    const p = state.props[ti];
    if (p.owner < 0) return '這塊地還沒有主人，直接停上去買就好';
    if (p.owner === si) return '這塊地已經是你的了';
    if (state.boughtOut) return '這回合已經收購過一次了';
    if (p.houses > 0) return '有房子的地不能收購';
    if (!completesGroup(state, si, ti)) return '收購後要能湊齊同色整組才行';
    if (state.seats[si].cash < buyoutCost(state, ti)) return '現金不夠（要 ' + money(buyoutCost(state, ti)) + '）';
    return null;
  }

  /**
   * 執行一個行動。
   * action：{ type: 'useItem'|'roll'|'payJail'|'useCard'|'buy'|'decline'|'build'|'sell'|'buyout'|'settle'|'bankrupt'|'endTurn', tile? }
   * meta.ai：電腦或系統代打（不會清掉「掛機」狀態）
   */
  function act(state, id, action, now, meta) {
    meta = meta || {};
    if (state.phase === 'over') return { ok: false, reason: 'over' };
    const si = indexOfId(state, id);
    if (si < 0) return { ok: false, reason: 'no-seat' };
    if (si !== state.turn) return { ok: false, reason: 'not-your-turn' };
    const s = state.seats[si];
    const type = action && action.type;
    const ph = state.phase;
    const fail = reason => ({ ok: false, reason });
    let hold = 'end';

    switch (type) {
      case 'roll':
        if (ph !== 'roll') return fail('bad-phase');
        doRoll(state, si, now);
        hold = null;
        break;
      case 'payJail':
        if (ph !== 'roll' || !s.jail) return fail('bad-phase');
        if (s.cash < JAIL_FINE) return fail('no-cash');
        pay(state, si, -1, JAIL_FINE, 'jail');
        s.jail = false; s.jailTurns = 0;
        say(state, s.name + ' 繳 ' + money(JAIL_FINE) + ' 出獄');
        hold = 'pay';
        break;
      case 'useCard':
        if (ph !== 'roll' || !s.jail || s.getOut < 1) return fail('bad-phase');
        s.getOut--; s.jail = false; s.jailTurns = 0;
        returnGetOut(state);
        say(state, s.name + ' 用出獄許可證出獄了');
        hold = 'pay';
        break;
      case 'useItem': {
        const id = action.item;
        const arg = id === 'dice' ? Number(action.n) : (id === 'steal' || id === 'swap') ? Number(action.target) : Number(action.tile);
        const err = canUseItem(state, si, id, arg);
        if (err) return { ok: false, reason: 'illegal', text: err };
        const n0 = state.eventSeq;
        useUp(state, si, id);
        if (id === 'steal' || id === 'swap' || id === 'bomb') {
          const to = id === 'bomb' ? state.props[arg].owner : arg;
          say(state, s.name + ' 對 ' + state.seats[to].name + ' 使用了「' + ITEMS[id].name + '」');
          if (guarded(state, si, to, id, id === 'bomb' ? arg : -1)) { state.readyAt = now + holdFor(state, 'roll', 900); hold = null; break; }
          if (id === 'steal') {
            const o = state.seats[to], amt = Math.min(300, Math.max(1, Math.floor(o.cash * 0.2)));
            o.cash -= amt; s.cash += amt;
            ev(state, { t: 'attack', kind: 'steal', from: si, to, amount: amt });
            say(state, s.name + ' 從 ' + o.name + ' 身上偷走 ' + money(amt));
            state.readyAt = now + holdFor(state, 'roll', 900); hold = null; break;
          }
          if (id === 'bomb') {
            state.props[arg].houses--;
            ev(state, { t: 'attack', kind: 'bomb', from: si, to, tile: arg });
            say(state, tl(state)[arg].name + ' 被炸掉一間房子！');
            state.readyAt = now + holdFor(state, 'roll', 900); hold = null; break;
          }
          /* swap */
          const o = state.seats[to], a = s.pos, b = o.pos;
          s.pos = b; o.pos = a;
          ev(state, { t: 'attack', kind: 'swap', from: si, to });
          ev(state, { t: 'move', seat: si, from: a, to: b, teleport: true });
          ev(state, { t: 'move', seat: to, from: b, to: a, teleport: true });
          say(state, s.name + ' 和 ' + o.name + ' 交換了位置');
          land(state, si, {});
          afterResolve(state, si);
          const drew2 = state.events.some(e => e.n > n0 && e.t === 'card');
          state.readyAt = now + holdFor(state, 'roll', 900 + (drew2 ? 1300 : 0));
          hold = null;
          break;
        }
        if (id === 'dice') {
          state.dice = [arg, 0];
          state.doubles = 0; state.again = false;
          ev(state, { t: 'roll', seat: si, dice: [arg, 0], single: true });
          say(state, s.name + ' 用「遙控骰」，走 ' + arg + ' 步');
          moveBy(state, si, (s.pos + arg) % BOARD, true, {});
        } else {
          say(state, s.name + ' 用「機票」飛到 ' + tl(state)[arg].name);
          moveBy(state, si, arg, false, {});
        }
        afterResolve(state, si);
        const drew = state.events.some(e => e.n > n0 && e.t === 'card');
        state.readyAt = now + holdFor(state, 'roll', (id === 'dice' ? arg * 140 : 700) + (drew ? 1300 : 0));
        hold = null;
        break;
      }
      case 'buy': {
        if (ph !== 'buy' || !state.pending) return fail('bad-phase');
        const t = tl(state)[state.pending.tile];
        if (s.cash < t.price) return fail('no-cash');
        s.cash -= t.price;
        state.props[t.i].owner = si;
        ev(state, { t: 'buy', seat: si, tile: t.i, price: t.price });
        ev(state, { t: 'cash', seat: si, to: -1, amount: t.price, reason: 'buy' });
        say(state, s.name + ' 用 ' + money(t.price) + ' 買下 ' + t.name);
        state.pending = null; state.phase = 'roll';
        afterResolve(state, si);
        hold = 'buy';
        break;
      }
      case 'shopBuy': {
        if (ph !== 'shop' || !state.pending) return fail('bad-phase');
        const item = String(action.item || '');
        const err = canBuyItem(state, si, item);
        if (err) return { ok: false, reason: 'illegal', text: err };
        const cost = ITEMS[item].cost;
        s.cash -= cost; s.items.push(item);
        ev(state, { t: 'cash', seat: si, to: -1, amount: cost, reason: 'shop' });
        ev(state, { t: 'item', seat: si, item, gain: true });
        say(state, s.name + ' 花 ' + money(cost) + ' 買了「' + ITEMS[item].name + '」');
        if (s.items.length >= MAX_ITEMS || s.cash < cheapestItem()) {      /* 買不下去了就自動離開 */
          state.pending = null; state.phase = 'roll';
          afterResolve(state, si);
        }
        hold = 'shop';
        break;
      }
      case 'decline':
        if ((ph !== 'buy' && ph !== 'build' && ph !== 'shop') || !state.pending) return fail('bad-phase');
        say(state, s.name + (ph === 'build' ? ' 這次不加蓋 ' : ph === 'shop' ? ' 離開了 ' : ' 決定不買 ') + tl(state)[state.pending.tile].name);
        state.pending = null; state.phase = 'roll';
        afterResolve(state, si);
        hold = 'decline';
        break;
      case 'mortgage': case 'unmortgage': return { ok: false, reason: 'illegal', text: '沒有抵押功能' };
      case 'build': case 'sell': {
        const okPhase = type === 'build' ? ph === 'build'
          : (ph === 'roll' || ph === 'manage' || ph === 'buy' || ph === 'debt');
        if (!okPhase) return fail('bad-phase');
        const ti = Number(action.tile);
        if (type === 'build' && (!state.pending || state.pending.tile !== ti)) return { ok: false, reason: 'illegal', text: '只能在你剛走到的這塊地加蓋' };
        const err = type === 'build' ? canBuildAt(state, si, ti) : canSellAt(state, si, ti);
        if (err) return { ok: false, reason: 'illegal', text: err };
        const t = tl(state)[ti], p = state.props[ti];
        if (type === 'build') {
          s.cash -= t.house; p.houses++;
          ev(state, { t: 'build', seat: si, tile: ti, houses: p.houses });
          say(state, s.name + ' 在 ' + t.name + (p.houses === MAX_HOUSES ? ' 蓋了旅店' : ' 蓋了第 ' + p.houses + ' 棟房子'));
          state.pending = null; state.phase = 'roll';
          afterResolve(state, si);
        } else if (type === 'sell') {
          const back = Math.floor(t.house / 2);
          s.cash += back; p.houses--;
          ev(state, { t: 'build', seat: si, tile: ti, houses: p.houses });
          say(state, s.name + ' 賣掉 ' + t.name + ' 的一棟房子，拿回 ' + money(back));
        }
        hold = type;
        break;
      }
      case 'buyout': return { ok: false, reason: 'illegal', text: '已經沒有強制收購了' };
      case 'settle': {
        if (ph !== 'debt' || !state.pending) return fail('bad-phase');
        const d = state.pending;
        if (s.cash < d.amount) return fail('no-cash');
        state.pending = null;
        pay(state, si, d.creditor, d.amount, d.reason);
        say(state, s.name + ' 湊到錢了，付清 ' + money(d.amount));
        state.phase = 'roll';
        runCont(state, si, d.cont);
        afterResolve(state, si);
        hold = 'settle';
        break;
      }
      case 'bankrupt': {
        if (ph !== 'debt' || !state.pending) return fail('bad-phase');
        goBankrupt(state, si, state.pending.creditor);
        hold = 'bankrupt';
        break;
      }
      case 'endTurn':
        if (ph !== 'manage') return fail('bad-phase');
        nextTurn(state);
        hold = 'end';
        break;
      default:
        return fail('bad-action');
    }
    state.version++;
    if (hold) state.readyAt = now + holdFor(state, hold);
    if (state.opts.turnMs) state.deadline = now + state.opts.turnMs;
    if (!meta.ai) {
      s.timeouts = 0;
      if (s.afk) { s.afk = false; s.ai = null; }
    }
    return { ok: true };
  }

  /** 推進時間：人類玩家想太久就由電腦代打這一步。回傳有沒有變動。 */
  function tick(state, now) {
    if (state.phase === 'over' || !state.opts.turnMs || !state.deadline) return false;
    const s = cur(state);
    if (s.ai || s.auto || s.bankrupt || now < state.deadline) return false;
    s.auto = true;
    s.timeouts++;
    if (s.timeouts >= 3) { s.afk = true; s.ai = 'normal'; say(state, s.name + ' 好像不在，先由電腦代打（回來操作就會還給你）'); }
    else say(state, s.name + ' 想太久了，這一步先由電腦代打');
    state.deadline = now + state.opts.turnMs;
    state.version++;
    return true;
  }

  /* ---------- 給畫面與電腦用的查詢 ---------- */

  /** 目前玩家可以做的事（畫面按鈕與電腦都看這個，跟 act 用同一套判斷） */
  function options(state, id) {
    const si = indexOfId(state, id);
    const out = { roll: false, payJail: false, useCard: false, buy: false, decline: false, settle: false, bankrupt: false, endTurn: false,
      build: [], sell: [], buyout: [], shop: [], liquidity: 0, dice: false, fly: false, steal: false, swap: false, bomb: false };
    if (si < 0 || state.phase === 'over' || si !== state.turn) return out;
    const s = state.seats[si], ph = state.phase;
    out.liquidity = liquidity(state, si);
    if (ph === 'roll') {
      out.roll = true;
      out.dice = !canUseItem(state, si, 'dice', 1);
      out.fly = !canUseItem(state, si, 'fly', (s.pos + 1) % BOARD);
      ['steal', 'swap', 'bomb'].forEach(k => { out[k] = s.items.includes(k) && !s.jail && itemTargets(state, si, k).length > 0; });
      if (s.jail) { out.payJail = s.cash >= JAIL_FINE; out.useCard = s.getOut > 0; }
    }
    if (ph === 'shop' && state.pending) {
      out.decline = true;
      out.shop = ITEM_LIST.map(k => ({ item: k, cost: ITEMS[k].cost, can: !canBuyItem(state, si, k) }));
    }
    if (ph === 'build' && state.pending) { out.decline = true; out.build = canBuildAt(state, si, state.pending.tile) ? [] : [state.pending.tile]; }
    if (ph === 'buy' && state.pending) {
      out.buy = s.cash >= tl(state)[state.pending.tile].price;
      out.decline = true;
    }
    if (ph === 'debt' && state.pending) {
      out.settle = s.cash >= state.pending.amount;
      out.bankrupt = true;
    }
    if (ph === 'manage') out.endTurn = true;
    const manageable = ph === 'roll' || ph === 'manage';
    for (const i of ownedBy(state, si)) {
      if ((manageable || ph === 'debt' || ph === 'buy') && !canSellAt(state, si, i)) out.sell.push(i);
    }
    return out;
  }

  /** 送給所有人（含觀戰者）的畫面資料；牌堆順序與 seed 不會出去。大富翁沒有隱藏資訊。 */
  function publicView(state, now) {
    return {
      version: state.version,
      map: state.map,
      boughtOut: state.boughtOut,
      opts: state.opts,
      seats: state.seats.map((s, i) => ({
        id: s.id, name: s.name, char: s.char, ai: s.ai, cash: s.cash, pos: s.pos, jail: s.jail, jailTurns: s.jailTurns,
        getOut: s.getOut, items: s.items.slice(), god: s.god ? { k: s.god.k, turns: s.god.turns } : null, bankrupt: s.bankrupt, auto: s.auto, afk: s.afk, worth: netWorth(state, i)
      })),
      props: state.props.map(p => ({ owner: p.owner, houses: p.houses })),
      tiles: state.tiles.map(t => t.type === 'prop' ? { price: t.price, house: t.house, rent: t.rent } : t.price ? { price: t.price } : t.tax ? { tax: t.tax } : null),
      turn: state.turn, round: state.round, phase: state.phase, dice: state.dice, doubles: state.doubles,
      pending: state.pending ? { kind: state.pending.kind, tile: state.pending.tile, price: state.pending.price,
        amount: state.pending.amount, creditor: state.pending.creditor, reason: state.pending.reason } : null,
      card: state.card, events: state.events.slice(-24), eventSeq: state.eventSeq, log: state.log.slice(-30),
      winner: state.winner, reason: state.reason, ranking: state.ranking,
      turnLeftMs: state.opts.turnMs && state.deadline && state.phase !== 'over' ? Math.max(0, state.deadline - (now == null ? 0 : now)) : null
    };
  }

  /* 所有「拿 state 當第一個參數」的入口，一進來先切到這一局的地圖 */
  const inMap = fn => function (state) { if (state && state.map) useMap(state.map); return fn.apply(null, arguments); };
  useMap(Maps.DEFAULT);
  const api = {
    MIN_PLAYERS, MAX_PLAYERS, START_CASH, startCashFor, GO_SALARY, JAIL_FINE, MAX_HOUSES, SOLO_MAX_LEVEL,
    DIFFICULTY_LIST, DIFFICULTIES, PACES, ROUND_LIMITS, PLAYER_COLORS,
    GODS, TILES, GROUPS, GROUP_TILES, OWNABLE, CHANCE, CHEST, ITEMS, ITEM_LIST, MAX_ITEMS,
    MAPS: Maps, useMap, tl, genTiles, applyTiles, create,
    itemTargets: inMap(itemTargets), canUseItem: inMap(canUseItem), act: inMap(act), tick: inMap(tick), options: inMap(options), publicView: inMap(publicView),
    rentOf: inMap(rentOf), rowLen: inMap(rowLen), netWorth: inMap(netWorth), liquidity: inMap(liquidity), ownedBy: inMap(ownedBy), groupOwned: inMap(groupOwned),
    buyoutCost: inMap(buyoutCost), canBuyoutAt: inMap(canBuyoutAt), completesGroup: inMap(completesGroup),
    canBuildAt: inMap(canBuildAt), canSellAt: inMap(canSellAt),
    indexOfId, cur, alive
  };
  Object.defineProperty(api, 'BOARD', { get: () => BOARD, enumerable: true });
  Object.defineProperty(api, 'JAIL_POS', { get: () => JAIL_POS, enumerable: true });
  return api;
});
