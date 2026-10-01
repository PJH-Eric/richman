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
 * 已確認的規則（簡易版）：
 *   - 經典 40 格起點領 200，其餘 48～120 格依地圖大小；起始現金＝回合上限×200×地圖倍率（不限回合當 100）；2～6 人；系統隨機決定座位順序。
 *   - 沒人買的地留在原地，下次有人停到還能買。
 *   - 每塊自己的地都能單獨升級：最多 4 棟房，再升級成 1 間旅店（不必湊齊同色整組、也不必平均）；湊齊整組仍有空地租金加倍與連棟加成。
 *   - 每次擲骰前先選「1 顆」或「2 顆」骰子。
 *   - 監獄：提早出獄要繳罰金（依個人總資產 10%，50～500）或用出獄許可證；也可以留在牢裡，第三回合免罰金自動出獄並照骰子前進。
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
  const MAX_PLAYERS = 6;
  const START_CASH = 10000;        /* 不限回合的起始現金 */
  /* 起始現金＝回合上限（不限回合當 100）× 200 × 地圖大小倍率；起點薪水＝500 × 同一倍率。
   * 倍率：48／64／80／96／120 格＝1.2／1.4／1.6／1.8／2。其他格數（測試用經典 40 格）沿用舊制：回合×100（不限 10000）、薪水 200 */
  const CASH_MULT = { 48: 1.2, 64: 1.4, 80: 1.6, 96: 1.8, 120: 2 };
  function startCashFor(limit, size) {
    const m = CASH_MULT[Number(size)], n = Number(limit) > 0 ? Number(limit) : 0;
    if (m == null) return n > 0 ? n * 100 : START_CASH;
    return Math.round((n > 0 ? n : 100) * 200 * m);
  }
  /* 金額隨初始資產調整：倍率＝√(初始現金÷10000)，限制在 0.6～2.2（初始越多，地價、房價、過路費、稅、卡片金額都稍微調高；越少則調低）。
   * 只套用在有地圖倍率的格數（48～120 格）；經典 40 格維持原價 */
  function econOf(startCash, size) {
    if (CASH_MULT[Number(size)] == null) return 1;
    return Math.round(Math.min(4, Math.max(1, Number(startCash) / 6000)) * 100) / 100;
  }
  /** 小額（卡片、神明、罰金…）依倍率換算：100 以上取 10 的倍數，其餘取 5 的倍數，至少 5 */
  function scaleMoney(x, e) {
    const v = x * (e || 1);
    return v >= 100 ? Math.round(v / 10) * 10 : Math.max(5, Math.round(v / 5) * 5);
  }
  const econ = state => (state && state.econ) || 1;
  function goSalaryFor(size) { const m = CASH_MULT[Number(size)]; return m == null ? GO_SALARY : Math.round(500 * m); }
  /** 收入（起點薪水、收錢卡、財神）額外再乘 GAIN，讓賺錢的感覺跟得上花費 */
  const GAIN = 1.5;
  /** 起點薪水只看地圖大小，不乘資產倍率 */
  function salaryOf(state) { return goSalaryFor(tl(state).length); }
  /** 偷錢卡上限：起點薪水的 2 倍（1200／1400／1600／1800／2000）；經典 40 格＝300 */
  function stealCap(state) { return CASH_MULT[tl(state).length] == null ? 300 : salaryOf(state) * 2; }
  const GO_SALARY = 200;
  const JAIL_FINE = 50;            /* 最低罰金；實際罰金依個人資產：總資產 10%（取 10 的倍數），最少 50、最多 500 */
  const JAIL_FINE_MAX = 500;
  let JAIL_POS = 10;
  const MAX_HOUSES = 5;            /* 5＝旅店 */
  let BOARD = 40;

  const DIFFICULTY_LIST = ['kid', 'easy', 'normal', 'hard'];
  const DIFFICULTIES = {
    kid: { name: '幼幼班' }, easy: { name: '簡單' }, normal: { name: '普通' }, hard: { name: '困難' }
  };
  const PACES = { slow: 1.5, normal: 1, fast: 0.6 };
  const ROUND_LIMITS = [0, 25, 40, 50];   /* 0＝沒有上限 */
  const PLAYER_COLORS = ['#EF5B5B', '#3F8CFF', '#3DAE6B', '#FFA53D', '#A56BE8', '#1FB8C4', '#F06AB2', '#7A8594'];

  /* ---------- 棋盤 ---------- */

  /* 目前生效的地圖（GROUPS／TILES／GROUP_TILES／OWNABLE 都是「原地更新」的同一份物件，
   * 畫面那邊抓一次參考就永遠有效）。伺服器會同時跑不同地圖的房間，所以每個入口函式一進來
   * 都會先 useMap(state.map) 切到那一局的地圖；切換只是換內容，不會重新建立。 */
  const GROUPS = {};
  const TILES = [];
  let BASE_TILES = [];
  const CTX = {};
  const CTX_ORDER = [];
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
    CTX_ORDER.push(id);
    while (CTX_ORDER.length > 24) { const old = CTX_ORDER.shift(); if (old !== CUR_MAP) delete CTX[old]; else CTX_ORDER.push(old); }
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
  /** 依初始資產倍率調整地價、房價、過路費、稅金 */
  function scaleTiles(list, E) {
    list.forEach(t => {
      if (t.price) t.price = r10(t.price * E);
      if (t.house) t.house = r10(t.house * E);
      if (t.tax) t.tax = r10(t.tax * E);
      if (t.rent) {
        t.rent = t.rent.map(x => Math.max(1, Math.round(x * E)));
        for (let j = 1; j < t.rent.length; j++) if (t.rent[j] <= t.rent[j - 1]) t.rent[j] = t.rent[j - 1] + 1;
      }
    });
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
    { t: 'moveTo', to: 0, text: '前進到起點，領起點薪水' },
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
    { t: 'god', good: false, text: '窮神或衰神纏身……接下來 4 回合要小心荷包' },
    { t: 'points', n: 30, text: '集點活動兌換成功，獲得 30 點道具點數' },
    { t: 'points', n: 50, text: '抽中道具商店贈點，獲得 50 點道具點數' }
  ];
  const CHEST = [];
  const CHEST_BASE = [
    { t: 'moveTo', to: 0, text: '前進到起點，領起點薪水' },
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
    { t: 'god', good: false, text: '踩到黑貓的尾巴，窮神或衰神跟上你……' },
    { t: 'points', n: 20, text: '參加問答比賽，獲得 20 點道具點數' },
    { t: 'points', n: 40, text: '會員紅利點數到帳，獲得 40 點道具點數' }
  ];
  const CHANCE_GETOUT = 10, CHEST_GETOUT = 4;

  /* ---------- 道具 ----------
   * 來源：溫泉休息站、道具箱卡、道具商店（用道具點數買，可半價賣回）。最多帶 MAX_ITEMS 個；帶滿了就改領一筆小錢。
   * active：自己挑時機用（擲骰前）；passive：條件到了自動用掉。 */
  const MAX_ITEMS = 10;
  /* pts：商店要用「道具點數」買，10～50 點，依實用度定價；stock：單場遊戲全房共用的庫存基數（越貴越少） */
  const ITEMS = {
    bail:   { name: '保釋券', pts: 20, active: false, desc: '下一次被抓去坐牢時自動用掉，直接免關' },
    dice:   { name: '遙控骰', pts: 20, active: true,  desc: '擲骰前使用：自己決定這回合走 1～12 步' },
    swap:   { name: '換位卡', pts: 20, active: true, target: 'seat', desc: '擲骰前使用：和指定對手交換位置，換到的落點照常處理（不領薪水）' },
    collect:{ name: '收租券', pts: 30, active: true, direct: true, desc: '擲骰前使用：向每位對手各收一筆錢（約起點薪水的 1/10，對方現金不夠就收他有的）' },
    chest:  { name: '福袋', pts: 20, active: true, direct: true, desc: '擲骰前使用：打開福袋，立刻隨機獲得 1 個其他道具' },
    gobonus:{ name: '起點加碼券', pts: 20, active: false, desc: '下一次經過起點時自動用掉，薪水加倍' },
    cure:   { name: '驅神符', pts: 10, active: true, direct: true, desc: '擲骰前使用：送走身上的窮神或衰神（需要有窮神或衰神附身）' },
    free:   { name: '免租券', pts: 30, active: false, desc: '下一次要付過路費時自動用掉，這次免付' },
    cat:    { name: '招財貓', pts: 30, active: false, desc: '下一次有人付你過路費時，租金加倍（用掉）' },
    steal:  { name: '偷錢卡', pts: 30, active: true, target: 'seat', desc: '擲骰前使用：指定一位對手，偷走他 10% 的現金（有上限，依地圖大小與初始資產）' },
    coupon: { name: '購地免費券', pts: 40, active: false, desc: '下一次買無主的地時自動用掉，這塊地免費' },
    god:    { name: '求神符', pts: 30, active: true, direct: true, desc: '擲骰前使用：隨機請來福神或財神附身 4 個回合（身上已有神就用不了）' },
    salary: { name: '領薪券', pts: 30, active: true, direct: true, desc: '擲骰前使用：立刻領一次起點薪水（依地圖大小），人在哪裡都能領' },
    surge:  { name: '漲價卡', pts: 30, active: true, target: 'tile', desc: '擲骰前使用：指定自己的一塊地，過路費 ×1.5，持續 3 個回合' },
    guard:  { name: '護身符', pts: 40, active: false, desc: '別人對你使用偷錢卡、搶奪卡、換位卡、冰凍卡、陷害卡或炸彈時自動擋下（用掉）' },
    bomb:   { name: '炸彈', pts: 40, active: true, target: 'tile', desc: '擲骰前使用：炸掉指定對手的一間房子（旅店降回 4 間房）' },
    freeze: { name: '冰凍卡', pts: 40, active: true, target: 'seat', desc: '擲骰前使用：指定一位對手，他的下一個回合直接跳過' },
    grab:   { name: '搶奪卡', pts: 40, active: true, target: 'seat', desc: '擲骰前使用：指定一位對手，隨機搶走他的 1 個道具（對方需要有道具）' },
    equal:  { name: '均富卡', pts: 100, active: true, target: 'seat', desc: '擲骰前使用：指定一位對手，你和他的現金加起來平分（護身符可以擋下）' },
    frame:  { name: '陷害卡', pts: 40, active: true, target: 'seat', desc: '擲骰前使用：指定一位對手，讓他直接去坐牢（保釋券、護身符可以擋下）' },
    again:  { name: '加骰券', pts: 40, active: true, direct: true, desc: '擲骰前使用：這回合走完後，可以再擲一次骰子' },
    reflect:{ name: '反彈卡', pts: 50, active: false, desc: '下一次要付過路費時自動用掉：你免付，屋主反而要付你一半的過路費' },
    seize:  { name: '強制購地券', pts: 50, active: false, desc: '踩到別人的地、付完過路費後自動用掉：這塊地直接變成你的（房子一起過戶）' },
    upgrade:{ name: '加蓋券', pts: 50, active: true, target: 'tile', desc: '擲骰前使用：免費幫自己的一塊地加蓋一間房子（照一般升級規則，人在哪裡都能指定）' }
  };
  const STOCK_BASE = { 10: 10, 20: 8, 30: 6, 40: 4, 50: 3 };
  /** 單場遊戲某商品的庫存：越貴越少；人多時加倍（每 4 人一份） */
  function stockFor(id, nPlayers) { return (STOCK_BASE[ITEMS[id].pts] || 3) * Math.max(1, Math.ceil((nPlayers || 4) / 4)); }
  const SHOP_OFFER_MIN = 3, SHOP_OFFER_MAX = 6;
  /** 道具點數：起始 = 回合上限 × 10；不限回合 500 */
  const START_POINTS = 500;
  function startPointsFor(limit) { return Number(limit) > 0 ? Number(limit) * 10 : START_POINTS; }
  /* ---------- 命運之神：附身 4 個自己的回合 ---------- */
  const GODS = {
    fortune: { name: '福神', good: true,  desc: '別人付你的過路費加倍' },
    wealth:  { name: '財神', good: true,  desc: '每個自己的回合開始領一筆錢' },
    poor:    { name: '窮神', good: false, desc: '你付出去的過路費加倍' },
    unlucky: { name: '衰神', good: false, desc: '每個自己的回合開始被扣一筆錢' }
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
    const mapId = useMap(o.map && Maps.has(o.map) ? o.map : Maps.genId(o.mapSize, o.seed == null ? 'seed' : o.seed));   /* 沒指定地圖：依格數＋這局種子隨機生成 */
    const rng = RNG.create(String(o.seed || 'seed') + '-rules');
    const order = rng.shuffle(players.slice());
    const startCash = o.startCash || startCashFor(ROUND_LIMITS.includes(Number(o.roundLimit)) ? Number(o.roundLimit) : 0, TILES.length);
    const E = econOf(startCash, TILES.length);
    const seats = order.map(p => ({
      id: p.id, name: p.name, char: p.char, ai: p.ai || null,
      cash: startCash, points: startPointsFor(ROUND_LIMITS.includes(Number(o.roundLimit)) ? Number(o.roundLimit) : 0), frozen: false, pos: 0, jail: false, jailTurns: 0, getOut: 0, items: [], god: null,
      bankrupt: false, auto: false, timeouts: 0, afk: false, again: false
    }));
    const props = TILES.map(() => ({ owner: -1, houses: 0 }));
    let tiles = o.fixedPrices ? TILES : genTiles(rng);
    if (E !== 1) {
      if (o.fixedPrices) tiles = TILES.map(t => Object.assign({}, t, t.rent ? { rent: t.rent.slice() } : {}));
      scaleTiles(tiles, E);
    }
    const now = o.now || 0;
    const state = {
      version: 0,
      opts: {
        pace: PACES[o.pace] ? o.pace : 'normal',
        roundLimit: ROUND_LIMITS.includes(Number(o.roundLimit)) ? Number(o.roundLimit) : 0,
        turnMs: Number(o.turnMs) || 0
      },
      map: mapId, econ: E, seats, props, tiles, turn: 0, round: 1, phase: 'roll', dice: [0, 0], diceKind: 'two', stock: null,
      pending: null, boughtOut: false, card: null, cardSeq: 0, events: [], eventSeq: 0, log: [], logSeq: 0,
      winner: null, reason: null, ranking: null, bankruptOrder: [],
      readyAt: now + 800, deadline: 0, startedAt: now
    };
    state.stock = {};
    ITEM_LIST.forEach(k => { state.stock[k] = stockFor(k, seats.length); });
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
  /* 連棟：同一個人在「相鄰」的連續格子上都蓋了房子，踩到其中任何一格，要付的是整串每一格過路費的「總和」 */
  function rowTiles(state, ti) {
    const T = tl(state), n = T.length, o = state.props[ti].owner;
    const ok = i => { const q = state.props[i]; return T[i].type === 'prop' && q.owner === o && q.houses > 0; };
    if (o < 0 || !ok(ti)) return [ti];
    const list = [ti];
    for (let k = 1; k < n && ok((ti + k) % n); k++) list.push((ti + k) % n);
    for (let k = 1; list.length < n && k < n && ok((ti - k + n) % n); k++) list.unshift((ti - k + n) % n);
    return list;
  }
  /** 這一格在 h 棟房子時的過路費（含漲價卡 ×1.5） */
  function tileRent(state, i, h) {
    const base = tl(state)[i].rent[h];
    return state.props[i].surge >= state.round ? Math.round(base * 1.5) : base;
  }
  function rowLen(state, ti) { return rowTiles(state, ti).length; }
  const ROW_DISCOUNT = 0.8;
  /** 這一串連棟每一格各自的過路費加總（未打折、不含道具、神明等加成） */
  function rowSum(state, ti) {
    const T = tl(state);
    return rowTiles(state, ti).reduce((a, i) => a + tileRent(state, i, state.props[i].houses), 0);
  }
  /** 連棟過路費：2 格以上整串加總後打 8 折；單獨一格照原價 */
  function rowRent(state, ti) {
    const sum = rowSum(state, ti);
    return rowLen(state, ti) >= 2 ? Math.round(sum * ROW_DISCOUNT) : sum;
  }

  function rentOf(state, ti, dice, opt) {
    opt = opt || {};
    const t = tl(state)[ti], p = state.props[ti];
    if (p.owner < 0) return 0;
    if (t.type === 'prop') {
      if (p.houses > 0) return rowRent(state, ti);
      return tileRent(state, ti, 0) * (groupOwned(state, p.owner, t.group) ? 2 : 1);
    }
    if (t.type === 'station') return Math.round(STATION_RENT[Math.max(0, countKind(state, p.owner, 'station') - 1)] * econ(state)) * (opt.double ? 2 : 1);
    const d = dice ? dice[0] + dice[1] : 7;
    return Math.round((opt.tenX || countKind(state, p.owner, 'utility') >= 2 ? 15 : 6) * d * econ(state));
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

  /** 出獄罰金：依這位玩家的總資產（現金＋地價＋房子）決定：10%（取 10 的倍數），最少 50、最多 500 */
  function jailFine(state, si) {
    const w = netWorth(state, si);
    return Math.max(scaleMoney(JAIL_FINE, econ(state)), Math.min(scaleMoney(JAIL_FINE_MAX, econ(state)), Math.round(w * 0.1 / 10) * 10));
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
      const c = scaleMoney(50, econ(state));
      s.cash += c;
      ev(state, { t: 'cash', seat: si, to: -2, amount: c, reason: 'card' });
      say(state, s.name + ' 的道具已經帶滿了，改領 ' + c + ' 元');
      return;
    }
    const id = ITEM_LIST[state._rng.int(0, ITEM_LIST.length - 1)];
    s.items.push(id);
    ev(state, { t: 'item', seat: si, item: id, gain: true });
    say(state, s.name + ' 獲得道具「' + ITEMS[id].name + '」');
  }
  /** 主動道具現在能不能用（回傳 null 代表可以） */
  function canUseItem(state, si, id, arg) {
    const s = state.seats[si];
    if (state.phase !== 'roll') return '擲骰前才能使用';
    if (s.jail) return '在監獄裡不能用';
    if (!ITEMS[id] || !ITEMS[id].active) return '這個道具不能主動使用';
    if (!s.items.includes(id)) return '你沒有這個道具';
    if (id === 'dice' && !(Number.isInteger(arg) && arg >= 1 && arg <= 12)) return '請選 1～12 步';
    if (id === 'cure' && !(s.god && !GODS[s.god.k].good)) return '身上沒有窮神或衰神';
    if (id === 'god' && s.god) return '身上已經有神了';
    if (id === 'steal' || id === 'swap' || id === 'freeze' || id === 'grab' || id === 'frame' || id === 'equal') {
      const o = Number.isInteger(arg) ? state.seats[arg] : null;
      if (!o || arg === si || o.bankrupt) return '請選一位對手';
      if (id === 'freeze' && o.frozen) return '他已經被冰凍了';
      if (id === 'steal' && o.cash < 5) return '對方身上沒什麼錢可以偷';
      if (id === 'grab' && !o.items.length) return '對方身上沒有道具可以搶';
      if (id === 'frame' && o.jail) return '對方已經在監獄裡了';
      if (id === 'equal' && Math.abs(o.cash - s.cash) < 10) return '你們的現金差不多，不用平分';
      if (id === 'swap' && (o.jail || o.pos === s.pos)) return o.jail ? '對方在監獄裡，換不了' : '你們在同一格';
    }
    if (id === 'bomb') {
      const p = Number.isInteger(arg) && arg >= 0 && arg < BOARD ? state.props[arg] : null;
      if (!p || p.owner < 0 || p.owner === si || p.houses < 1) return '請選一塊對手蓋了房子的地';
    }
    if (id === 'upgrade') {
      if (!Number.isInteger(arg) || arg < 0 || arg >= BOARD) return '請選一塊自己的地';
      const err = canBuildAt(state, si, arg, true);
      if (err) return err;
    }
    if (id === 'surge') {
      const p = Number.isInteger(arg) && arg >= 0 && arg < BOARD ? state.props[arg] : null;
      if (!p || p.owner !== si || tl(state)[arg].type !== 'prop') return '請選一塊自己的地';
      if (p.surge >= state.round) return '這塊地已經在漲價中了';
    }
    if (id === 'again' && s.again) return '這回合已經用過加骰券了';
    if (id === 'collect' && !state.seats.some((o, i) => i !== si && !o.bankrupt && o.cash > 0)) return '沒有對手身上有錢可以收';
    return null;
  }

  /** 攻擊型道具現在有哪些可選目標（座位或格子），空陣列＝沒有目標 */
  function itemTargets(state, si, id) {
    const out = [];
    if (id === 'steal' || id === 'swap' || id === 'freeze' || id === 'grab' || id === 'frame' || id === 'equal') state.seats.forEach((o, i) => { if (!canUseItem(state, si, id, i)) out.push(i); });
    else if (id === 'bomb' || id === 'upgrade' || id === 'surge') for (let i = 0; i < BOARD; i++) if (!canUseItem(state, si, id, i)) out.push(i);
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
    if (hasItem(state, si, 'bail')) {
      useUp(state, si, 'bail');
      say(state, s.name + ' 用掉「保釋券」，免關！');
      return;
    }
    const from = s.pos;
    s.pos = JAIL_POS; s.jail = true; s.jailTurns = 0;
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
      let sal = salaryOf(state);
      if (hasItem(state, si, 'gobonus')) { useUp(state, si, 'gobonus'); sal *= 2; say(state, s.name + ' 用掉「起點加碼券」，薪水加倍！'); }
      s.cash += sal;
      ev(state, { t: 'cash', seat: si, to: -2, amount: sal, reason: 'go' });
      say(state, s.name + ' 經過起點，領 ' + money(sal));
    }
    land(state, si, ctx || {});
  }

  /** 強制購地券：付完過路費後，這塊地改成自己的（房子一起過戶） */
  function trySeize(state, si, ti, owner) {
    const s = state.seats[si];
    if (s.bankrupt || !hasItem(state, si, 'seize') || state.props[ti].owner !== owner || owner === si) return;
    useUp(state, si, 'seize');
    state.props[ti].owner = si;
    ev(state, { t: 'buy', seat: si, tile: ti, price: 0 });
    say(state, s.name + ' 用掉「強制購地券」，' + tl(state)[ti].name + ' 變成他的了！');
  }

  function land(state, si, ctx) {
    const s = state.seats[si], t = tl(state)[s.pos], p = state.props[s.pos];
    if (t.type === 'prop' || t.type === 'station' || t.type === 'utility') {
      if (p.owner < 0) {
        const coupon = hasItem(state, si, 'coupon');
        state.pending = { kind: 'buy', tile: t.i, price: coupon ? 0 : t.price, coupon };
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
      if (t.type === 'prop' && p.houses > 0 && rowLen(state, t.i) >= 2) say(state, t.name + ' 是 ' + rowLen(state, t.i) + ' 連棟，整串過路費加總後打 8 折：' + money(rent) + '！');
      if (hasItem(state, si, 'reflect')) {
        useUp(state, si, 'reflect');
        const owner = state.seats[p.owner], back = Math.min(Math.ceil(rent / 2), owner.cash);
        say(state, s.name + ' 停在 ' + owner.name + ' 的 ' + t.name + '，用掉「反彈卡」：不用付過路費，' + owner.name + ' 反而要付 ' + money(back) + '！');
        if (back > 0) pay(state, p.owner, si, back, 'reflect');
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
      if (charge(state, si, p.owner, rent, 'rent', { kind: 'seize', tile: t.i, owner: p.owner })) trySeize(state, si, t.i, p.owner);
      return;
    }
    if (t.type === 'tax') {
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
  /** 這間商店這次能不能買這樣東西（回傳 null＝可以）。庫存是整場遊戲全房共用；同一次逛商店同一樣商品只能買一件 */
  function canBuyItem(state, si, id) {
    const s = state.seats[si], pd = state.pending;
    if (!ITEMS[id]) return '沒有這個商品';
    if (!pd || pd.kind !== 'shop' || !Array.isArray(pd.offer) || !pd.offer.includes(id)) return '這次商店沒有賣這個';
    if (pd.bought.includes(id)) return '這次已經買過了（同一樣一次只能買 1 件）';
    if ((state.stock[id] || 0) < 1) return '賣完了（全房共用庫存）';
    if (s.items.length >= MAX_ITEMS) return '道具欄滿了（最多 ' + MAX_ITEMS + ' 個）';
    if (s.points < ITEMS[id].pts) return '道具點數不夠（要 ' + ITEMS[id].pts + ' 點）';
    return null;
  }
  /** 賣回商店的價格＝半價（進位到整數） */
  function sellPrice(id) { return Math.ceil(ITEMS[id].pts / 2); }
  function shopArrive(state, si, t) {
    const s = state.seats[si];
    const pool = ITEM_LIST.filter(k => (state.stock[k] || 0) > 0);
    if (!pool.length && !s.items.length) { say(state, s.name + ' 逛了' + t.name + '，但商品全都賣完了'); return; }
    const want = state._rng.int(SHOP_OFFER_MIN, SHOP_OFFER_MAX);
    const offer = state._rng.shuffle(pool.slice()).slice(0, Math.min(want, pool.length));
    if (!s.items.length && !offer.some(k => s.points >= ITEMS[k].pts)) { say(state, s.name + ' 逛了' + t.name + '，但道具點數不夠買任何東西（' + s.points + ' 點）'); return; }
    state.pending = { kind: 'shop', tile: t.i, offer, bought: [] };
    state.phase = 'shop';
    say(state, s.name + ' 來到' + t.name + '，今天上架 ' + offer.length + ' 樣商品');
  }

  /** 卡片上的金額也跟著初始資產倍率調整（文字一起改） */
  function scaleCard(card, E, scaled) {
    if ((E === 1 && !scaled) || !/^(collect|pay|eachPay|eachCollect|repairs)$/.test(card.t)) return card;
    const c = Object.assign({}, card), toks = [];
    let text = card.text;
    const sub = (v, g) => {
      const nv = scaleMoney(v, E * (g || 1)), k = toks.push(nv) - 1;
      text = text.replace(new RegExp('(^|[^0-9])' + v + ' 元'), (m, a) => a + '{' + k + '} 元');
      return nv;
    };
    if (card.t === 'repairs') { c.house = sub(card.house); c.hotel = sub(card.hotel); } else c.n = sub(card.n, scaled && /^(collect|eachCollect)$/.test(card.t) ? GAIN : 1);
    c.text = text.replace(/\{(\d)\} 元/g, (m, k) => toks[k] + ' 元');
    return c;
  }
  function drawCard(state, si, deck) {
    const s = state.seats[si];
    const list = deck === 'chance' ? CHANCE : CHEST;
    const order = state._decks[deck];
    const idx = order.shift();
    const card = scaleCard(list[idx], econ(state), CASH_MULT[tl(state).length] != null);
    if (card.t !== 'getOut') order.push(idx);
    state.card = { n: ++state.cardSeq, deck, text: card.text, seat: si };
    const MOOD = { collect: 'good', points: 'good', getOut: 'good', item: 'good', eachCollect: 'good', pay: 'bad', jail: 'bad', moveBack: 'bad', repairs: 'bad', eachPay: 'bad' };
    const mood = card.t === 'god' ? (card.good ? 'good' : 'bad') : (MOOD[card.t] || 'neutral');
    ev(state, { t: 'card', seat: si, deck, text: card.text, mood });
    say(state, s.name + ' 抽到' + (deck === 'chance' ? '機會' : '命運') + '：' + card.text);
    switch (card.t) {
      case 'collect': s.cash += card.n; ev(state, { t: 'cash', seat: si, to: -2, amount: card.n, reason: 'card' }); break;
      case 'pay': charge(state, si, -1, card.n, 'card'); break;
      case 'getOut': s.getOut++; break;
      case 'points': s.points += card.n; ev(state, { t: 'points', seat: si, amount: card.n }); break;
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
    for (let k = 0; k < n * 2; k++) {
      t = (t + 1) % n;
      if (state.seats[t].bankrupt) continue;
      if (state.seats[t].frozen && t !== state.turn) {
        state.seats[t].frozen = false;
        ev(state, { t: 'attack', kind: 'freezeSkip', from: t, to: t });
        say(state, state.seats[t].name + ' 被冰凍了，這回合直接跳過');
        continue;
      }
      break;
    }
    if (t <= state.turn) {
      state.round++;
      if (state.opts.roundLimit && state.round > state.opts.roundLimit) { state.round = state.opts.roundLimit; finish(state, 'roundLimit'); return; }
    }
    state.turn = t;
    state.pending = null; state.boughtOut = false;
    state.phase = 'roll';
    state.seats[t].auto = false;
    say(state, '輪到 ' + state.seats[t].name);
    godTurnStart(state, t);
  }
  function godTurnStart(state, si) {
    const s = state.seats[si];
    if (!s.god) return;
    const k = s.god.k;
    if (k === 'wealth') { const w = scaleMoney(120, econ(state) * (CASH_MULT[tl(state).length] == null ? 1 : GAIN)); s.cash += w; ev(state, { t: 'cash', seat: si, to: -2, amount: w, reason: 'god' }); say(state, '財神送錢：' + s.name + ' 領到 ' + w + ' 元'); }
    else if (k === 'unlucky') {
      const n = Math.min(scaleMoney(80, econ(state)), s.cash);
      if (n > 0) { s.cash -= n; ev(state, { t: 'cash', seat: si, to: -1, amount: n, reason: 'godbad' }); say(state, '衰神作祟：' + s.name + ' 破財 ' + n + ' 元'); }
    }
    if (--s.god.turns <= 0) { s.god = null; ev(state, { t: 'god', seat: si, god: k, on: false }); say(state, s.name + ' 身上的' + GODS[k].name + '離開了'); }
  }

  /** 這一步的事都處理完了：該再擲一次、進入整理階段，還是換人（換人後不能再動） */
  function afterResolve(state, si) {
    if (state.phase === 'buy' || state.phase === 'build' || state.phase === 'shop' || state.phase === 'debt' || state.phase === 'over') return;
    if (state.turn !== si || state.seats[si].bankrupt) return;
    const s = state.seats[si];
    state.phase = 'manage';
  }

  function runCont(state, si, cont) {
    if (!cont) return;
    if (cont.kind === 'move') moveBy(state, si, (state.seats[si].pos + cont.sum) % BOARD, true, {});
    else if (cont.kind === 'seize') trySeize(state, si, cont.tile, cont.owner);
  }

  /* ---------- 行動 ---------- */

  function holdFor(state, kind, extra) {
    const f = PACES[state.opts.pace] || 1;
    const base = { roll: 900, buy: 600, decline: 450, build: 550, shop: 500, sell: 450, buyout: 800, end: 350, pay: 500, settle: 450, bankrupt: 1200 }[kind] || 400;
    return Math.round((base + (extra || 0)) * f);
  }

  function doRoll(state, si, now, count) {
    const s = state.seats[si];
    /* 在牢裡不能擲骰子：這個動作只是「待在牢裡」；待滿 3 回合就免罰金出獄，下一回合才能擲骰 */
    if (s.jail) {
      s.jailTurns++;
      if (s.jailTurns >= 3) {
        s.jail = false; s.jailTurns = 0;
        say(state, s.name + ' 待滿 3 回合，免罰金出獄！下一回合起可以擲骰子');
      } else say(state, s.name + ' 留在牢裡（第 ' + s.jailTurns + '／3 回合），不能擲骰子');
      state.phase = 'manage';
      state.readyAt = now + holdFor(state, 'roll', 500);
      return;
    }
    const n0 = state.eventSeq;
    const rng = state._rng;
    const cnt = Number(count) === 1 ? 1 : 2;
    const a = rng.int(1, 6), b = cnt === 2 ? rng.int(1, 6) : 0;
    state.dice = [a, b]; state.diceKind = cnt === 1 ? 'one' : 'two';
    ev(state, { t: 'roll', seat: si, dice: [a, b], single: cnt === 1 });
    const total = a + b;
    say(state, s.name + (cnt === 1 ? ' 擲 1 顆骰子：' + a : ' 擲出 ' + a + '+' + b + ' = ' + total));
    const steps = total;
    moveBy(state, si, (s.pos + steps) % BOARD, true, {});
    afterResolve(state, si);
    const drew = state.events.some(e => e.n > n0 && e.t === 'card');
    state.readyAt = now + holdFor(state, 'roll', steps * 182 + (drew ? 1300 : 0));
  }

  function checkTileOwn(state, si, ti) {
    if (!OWNABLE.includes(ti)) return '這格不能這樣做';
    if (state.props[ti].owner !== si) return '這塊地不是你的';
    return null;
  }

  function canBuildAt(state, si, ti, free) {
    const t = tl(state)[ti];
    if (!t || t.type !== 'prop') return '只有地產可以蓋房子';
    const p = state.props[ti];
    if (p.owner !== si) return '這塊地不是你的';
    if (p.houses >= MAX_HOUSES) return '已經是旅店了';
    if (!free && state.seats[si].cash < t.house) return '現金不夠（要 ' + money(t.house) + '）';
    return null;
  }

  function canSellAt(state, si, ti) {
    const t = tl(state)[ti];
    if (!t || t.type !== 'prop') return '這格沒有房子';
    const p = state.props[ti];
    if (p.owner !== si) return '這塊地不是你的';
    if (p.houses <= 0) return '這格沒有房子';
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
        doRoll(state, si, now, action.dice);
        hold = null;
        break;
      case 'payJail':
        if (ph !== 'roll' || !s.jail) return fail('bad-phase');
        const fine = jailFine(state, si);
        if (s.cash < fine) return fail('no-cash');
        pay(state, si, -1, fine, 'jail');
        s.jail = false; s.jailTurns = 0;
        say(state, s.name + ' 繳 ' + money(fine) + ' 出獄（依總資產計算）');
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
        const arg = id === 'dice' ? Number(action.n) : (ITEMS[id] && ITEMS[id].target === 'seat') ? Number(action.target) : (ITEMS[id] && ITEMS[id].direct) ? 0 : Number(action.tile);
        const err = canUseItem(state, si, id, arg);
        if (err) return { ok: false, reason: 'illegal', text: err };
        const n0 = state.eventSeq;
        useUp(state, si, id);
        if (id === 'again') {
          s.again = true;
          say(state, s.name + ' 用「加骰券」：這回合走完後可以再擲一次！');
          state.readyAt = now + holdFor(state, 'roll', 600); hold = null; break;
        }
        if (id === 'collect') {
          const each = Math.max(10, Math.round(salaryOf(state) / 100) * 10);
          let total = 0;
          state.seats.forEach((o, i) => { if (i === si || o.bankrupt) return; const n = Math.min(each, o.cash); if (n > 0) { pay(state, i, si, n, 'item'); total += n; } });
          say(state, s.name + ' 用「收租券」向每位對手各收 ' + money(each) + '，共收到 ' + money(total));
          state.readyAt = now + holdFor(state, 'roll', 800); hold = null; break;
        }
        if (id === 'surge') {
          state.props[arg].surge = state.round + 2;
          say(state, s.name + ' 用「漲價卡」：' + tl(state)[arg].name + ' 過路費 ×1.5，持續 3 個回合');
          state.readyAt = now + holdFor(state, 'roll', 700); hold = null; break;
        }
        if (id === 'chest') {
          const pool = ITEM_LIST.filter(k => k !== 'chest'), got = pool[state._rng.int(0, pool.length - 1)];
          s.items.push(got);
          ev(state, { t: 'item', seat: si, item: got, gain: true });
          say(state, s.name + ' 打開「福袋」，獲得「' + ITEMS[got].name + '」');
          state.readyAt = now + holdFor(state, 'roll', 700); hold = null; break;
        }
        if (id === 'salary') {
          const sal = salaryOf(state);
          s.cash += sal;
          ev(state, { t: 'cash', seat: si, to: -2, amount: sal, reason: 'go' });
          say(state, s.name + ' 用「領薪券」領了 ' + money(sal) + ' 薪水');
          state.readyAt = now + holdFor(state, 'roll', 600); hold = null; break;
        }
        if (id === 'god') { giveGod(state, si, true); state.readyAt = now + holdFor(state, 'roll', 900); hold = null; break; }
        if (id === 'cure') {
          const k = s.god.k; s.god = null;
          ev(state, { t: 'god', seat: si, god: k, on: false });
          say(state, s.name + ' 用「驅神符」送走了' + GODS[k].name);
          state.readyAt = now + holdFor(state, 'roll', 800); hold = null; break;
        }
        if (id === 'upgrade') {
          state.props[arg].houses++;
          ev(state, { t: 'build', seat: si, tile: arg, houses: state.props[arg].houses, free: true });
          say(state, s.name + ' 用「加蓋券」免費幫 ' + tl(state)[arg].name + ' 加蓋，現在是 ' + (state.props[arg].houses >= MAX_HOUSES ? '旅店' : state.props[arg].houses + ' 間房'));
          state.readyAt = now + holdFor(state, 'roll', 700); hold = null; break;
        }
        if (id === 'steal' || id === 'swap' || id === 'bomb' || id === 'freeze' || id === 'grab' || id === 'frame' || id === 'equal') {
          const to = id === 'bomb' ? state.props[arg].owner : arg;
          say(state, s.name + ' 對 ' + state.seats[to].name + ' 使用了「' + ITEMS[id].name + '」');
          if (guarded(state, si, to, id, id === 'bomb' ? arg : -1)) { state.readyAt = now + holdFor(state, 'roll', 900); hold = null; break; }
          if (id === 'steal') {
            const o = state.seats[to], amt = Math.min(stealCap(state), Math.max(1, Math.floor(o.cash * 0.1)));
            o.cash -= amt; s.cash += amt;
            ev(state, { t: 'attack', kind: 'steal', from: si, to, amount: amt });
            say(state, s.name + ' 從 ' + o.name + ' 身上偷走 ' + money(amt));
            state.readyAt = now + holdFor(state, 'roll', 900); hold = null; break;
          }
          if (id === 'freeze') {
            state.seats[to].frozen = true;
            ev(state, { t: 'attack', kind: 'freeze', from: si, to });
            say(state, state.seats[to].name + ' 被冰凍了，下一個回合會被跳過');
            state.readyAt = now + holdFor(state, 'roll', 900); hold = null; break;
          }
          if (id === 'grab') {
            const o = state.seats[to], k = state._rng.int(0, o.items.length - 1), got = o.items.splice(k, 1)[0];
            s.items.push(got);
            ev(state, { t: 'attack', kind: 'grab', from: si, to });
            ev(state, { t: 'item', seat: si, item: got, gain: true });
            say(state, s.name + ' 搶走了 ' + o.name + ' 的「' + ITEMS[got].name + '」！');
            state.readyAt = now + holdFor(state, 'roll', 900); hold = null; break;
          }
          if (id === 'frame') {
            ev(state, { t: 'attack', kind: 'frame', from: si, to });
            say(state, state.seats[to].name + ' 被陷害了！');
            sendToJail(state, to);
            state.readyAt = now + holdFor(state, 'roll', 900); hold = null; break;
          }
          if (id === 'equal') {
            const o = state.seats[to], total = s.cash + o.cash;
            s.cash = Math.floor(total / 2); o.cash = total - s.cash;
            ev(state, { t: 'attack', kind: 'equal', from: si, to });
            say(state, s.name + ' 和 ' + o.name + ' 的現金平分，各剩約 ' + money(s.cash));
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
          const da = arg === 1 ? 1 : Math.ceil(arg / 2), db = arg === 1 ? 0 : arg - da;
          state.dice = [da, db]; state.diceKind = 'remote';
          ev(state, { t: 'roll', seat: si, dice: [da, db], single: arg === 1, remote: true });
          say(state, s.name + ' 用「遙控骰」，走 ' + arg + ' 步');
          moveBy(state, si, (s.pos + arg) % BOARD, true, {});
        }
        afterResolve(state, si);
        const drew = state.events.some(e => e.n > n0 && e.t === 'card');
        state.readyAt = now + holdFor(state, 'roll', (id === 'dice' ? arg * 182 : 700) + (drew ? 1300 : 0));
        hold = null;
        break;
      }
      case 'buy': {
        if (ph !== 'buy' || !state.pending) return fail('bad-phase');
        const t = tl(state)[state.pending.tile];
        const cost = state.pending.price != null ? state.pending.price : t.price;
        if (s.cash < cost) return fail('no-cash');
        if (state.pending.coupon && hasItem(state, si, 'coupon')) { useUp(state, si, 'coupon'); say(state, s.name + ' 用掉「購地免費券」，' + t.name + ' 免費拿下！'); }
        s.cash -= cost;
        state.props[t.i].owner = si;
        ev(state, { t: 'buy', seat: si, tile: t.i, price: cost });
        ev(state, { t: 'cash', seat: si, to: -1, amount: cost, reason: 'buy' });
        say(state, s.name + ' 用 ' + money(cost) + ' 買下 ' + t.name);
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
        const pts = ITEMS[item].pts;
        s.points -= pts; s.items.push(item); state.stock[item]--; state.pending.bought.push(item);
        ev(state, { t: 'item', seat: si, item, gain: true, shop: true });
        say(state, s.name + ' 用 ' + pts + ' 點買了「' + ITEMS[item].name + '」（剩 ' + s.points + ' 點）');
        hold = 'shop';
        break;
      }
      case 'shopSell': {                                   /* 在商店把道具賣回去：拿回半價點數，庫存 +1 */
        if (ph !== 'shop' || !state.pending) return fail('bad-phase');
        const item = String(action.item || ''), k = s.items.indexOf(item);
        if (k < 0 || !ITEMS[item]) return { ok: false, reason: 'illegal', text: '你身上沒有這個道具' };
        const back = sellPrice(item);
        s.items.splice(k, 1); s.points += back; state.stock[item] = (state.stock[item] || 0) + 1;
        ev(state, { t: 'item', seat: si, item, gain: false, shop: true });
        say(state, s.name + ' 把「' + ITEMS[item].name + '」賣回商店，換回 ' + back + ' 點（剩 ' + s.points + ' 點）');
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
          const cost = t.house;
          s.cash -= cost; p.houses++;
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
        if (s.again && !s.jail && !s.bankrupt) {
          s.again = false; state.phase = 'roll'; state.pending = null;
          say(state, s.name + ' 用「加骰券」，再擲一次！');
          hold = 'end';
          break;
        }
        s.again = false;
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
      build: [], sell: [], buyout: [], shop: [], liquidity: 0, dice: false, steal: false, swap: false, bomb: false, freeze: false, upgrade: false, grab: false, frame: false, equal: false, surge: false, chest: false, cure: false, god: false, salary: false, again: false, collect: false };
    if (si < 0 || state.phase === 'over' || si !== state.turn) return out;
    const s = state.seats[si], ph = state.phase;
    out.liquidity = liquidity(state, si);
    if (ph === 'roll') {
      out.roll = true;
      out.dice = !canUseItem(state, si, 'dice', 1);
      ['chest', 'cure', 'god', 'salary', 'again', 'collect'].forEach(k => { out[k] = s.items.includes(k) && !canUseItem(state, si, k, 0); });
      ['steal', 'swap', 'bomb', 'freeze', 'upgrade', 'grab', 'frame', 'equal', 'surge'].forEach(k => { out[k] = s.items.includes(k) && !s.jail && itemTargets(state, si, k).length > 0; });
      if (s.jail) { out.jailFine = jailFine(state, si); out.payJail = s.cash >= out.jailFine; out.useCard = s.getOut > 0; }
    }
    if (ph === 'shop' && state.pending) {
      out.decline = true;
      out.sellItems = s.items.map((k, idx) => ({ item: k, idx, back: sellPrice(k) }));
      out.shop = state.pending.offer.map(k => ({ item: k, pts: ITEMS[k].pts, stock: state.stock[k], bought: state.pending.bought.includes(k), can: !canBuyItem(state, si, k) }));
    }
    if (ph === 'build' && state.pending) { out.decline = true; out.build = canBuildAt(state, si, state.pending.tile) ? [] : [state.pending.tile]; }
    if (ph === 'buy' && state.pending) {
      out.buy = s.cash >= (state.pending.price != null ? state.pending.price : tl(state)[state.pending.tile].price);
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
      econ: state.econ || 1,
      boughtOut: state.boughtOut,
      opts: state.opts,
      seats: state.seats.map((s, i) => ({
        id: s.id, name: s.name, char: s.char, ai: s.ai, cash: s.cash, pos: s.pos, jail: s.jail, jailTurns: s.jailTurns,
        getOut: s.getOut, points: s.points, frozen: s.frozen, items: s.items.slice(), again: !!s.again, god: s.god ? { k: s.god.k, turns: s.god.turns } : null, bankrupt: s.bankrupt, auto: s.auto, afk: s.afk, worth: netWorth(state, i)
      })),
      props: state.props.map(p => ({ owner: p.owner, houses: p.houses, surge: p.surge || 0 })),
      tiles: state.tiles.map(t => t.type === 'prop' ? { price: t.price, house: t.house, rent: t.rent } : t.price ? { price: t.price } : t.tax ? { tax: t.tax } : null),
      turn: state.turn, round: state.round, phase: state.phase, dice: state.dice, diceKind: state.diceKind, stock: Object.assign({}, state.stock),
      pending: state.pending ? { kind: state.pending.kind, tile: state.pending.tile, price: state.pending.price,
        amount: state.pending.amount, creditor: state.pending.creditor, reason: state.pending.reason, coupon: state.pending.coupon,
        offer: state.pending.offer ? state.pending.offer.slice() : undefined, bought: state.pending.bought ? state.pending.bought.slice() : undefined } : null,
      card: state.card, events: state.events.slice(-24), eventSeq: state.eventSeq, log: state.log.slice(-30),
      winner: state.winner, reason: state.reason, ranking: state.ranking,
      turnLeftMs: state.opts.turnMs && state.deadline && state.phase !== 'over' ? Math.max(0, state.deadline - (now == null ? 0 : now)) : null
    };
  }

  /* 所有「拿 state 當第一個參數」的入口，一進來先切到這一局的地圖 */
  const inMap = fn => function (state) { if (state && state.map) useMap(state.map); return fn.apply(null, arguments); };
  useMap(Maps.DEFAULT);
  const api = {
    MIN_PLAYERS, MAX_PLAYERS, START_CASH, CASH_MULT, startCashFor, econOf, scaleMoney, goSalaryFor, salaryOf: inMap(salaryOf), stealCap: inMap(stealCap), START_POINTS, startPointsFor, sellPrice, stockFor, SHOP_OFFER_MIN, SHOP_OFFER_MAX, GO_SALARY, JAIL_FINE, JAIL_FINE_MAX, jailFine, MAX_HOUSES,
    DIFFICULTY_LIST, DIFFICULTIES, PACES, ROUND_LIMITS, PLAYER_COLORS,
    GODS, TILES, GROUPS, GROUP_TILES, OWNABLE, CHANCE, CHEST, ITEMS, ITEM_LIST, MAX_ITEMS,
    MAPS: Maps, useMap, tl, genTiles, applyTiles, create,
    itemTargets: inMap(itemTargets), canUseItem: inMap(canUseItem), act: inMap(act), tick: inMap(tick), options: inMap(options), publicView: inMap(publicView),
    rentOf: inMap(rentOf), rowLen: inMap(rowLen), rowTiles: inMap(rowTiles), rowRent: inMap(rowRent), rowSum: inMap(rowSum), netWorth: inMap(netWorth), liquidity: inMap(liquidity), ownedBy: inMap(ownedBy), groupOwned: inMap(groupOwned),
    buyoutCost: inMap(buyoutCost), canBuyoutAt: inMap(canBuyoutAt), completesGroup: inMap(completesGroup),
    canBuildAt: inMap(canBuildAt), canSellAt: inMap(canSellAt),
    indexOfId, cur, alive
  };
  Object.defineProperty(api, 'BOARD', { get: () => BOARD, enumerable: true });
  Object.defineProperty(api, 'JAIL_POS', { get: () => JAIL_POS, enumerable: true });
  return api;
});
