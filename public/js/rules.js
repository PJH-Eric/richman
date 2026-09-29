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
 *   debt    —— 付不出錢，等玩家賣房／抵押湊錢，或宣告破產
 *   manage  —— 這回合的事都做完了，可以蓋房、抵押，然後結束回合
 *   over    —— 只剩一人（或到回合上限）
 *
 * 已確認的規則（簡易版；不做交易與拍賣）：
 *   - 40 格；起點領 200；起始現金 1500；2～4 人；系統隨機決定座位順序。
 *   - 沒人買的地不拍賣，留在原地，下次有人停到還能買。
 *   - 同色整組都是自己的才能蓋房；每格最多 4 棟房，再升級成 1 間旅店；蓋房要平均。
 *   - 強制收購（簡易版取代交易）：自己的回合可以用 2 倍地價，向對手買下「一塊」能讓你湊齊整組的地
 *     （沒有房子、沒在抵押才行，每回合一次）；對手想防守就把那塊地先抵押起來。
 *   - 抵押：整組沒有房子才能抵押，抵押拿一半地價，贖回要加 10%；抵押中的地不收租。
 *   - 擲出雙骰可再擲一次，連三次雙骰進監獄。
 *   - 監獄：繳 50、用出獄許可證、或擲出雙骰出獄；第三回合還沒出就強制繳 50 並照骰子前進。
 *   - 付不出錢：先賣房、抵押還債；所有資產加起來都不夠就破產，資產全給債主（給銀行就回收）。
 *   - 最後一個沒破產的人獲勝；房主／單機可設回合上限，到了就比總資產。
 */
(function (root, factory) {
  'use strict';
  const api = factory(typeof require === 'function' && typeof module === 'object'
    ? require('./rng.js') : root.RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Rules = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 4;
  const START_CASH = 1500;
  const GO_SALARY = 200;
  const JAIL_FINE = 50;
  const JAIL_POS = 10;
  const MAX_HOUSES = 5;            /* 5＝旅店 */
  const BOARD = 40;

  const DIFFICULTY_LIST = ['kid', 'easy', 'normal', 'hard'];
  const DIFFICULTIES = {
    kid: { name: '幼幼班' }, easy: { name: '簡單' }, normal: { name: '普通' }, hard: { name: '困難' }
  };
  const PACES = { slow: 1.5, normal: 1, fast: 0.6 };
  const ROUND_LIMITS = [0, 20, 30, 40];   /* 0＝沒有上限 */
  const PLAYER_COLORS = ['#EF5B5B', '#3F8CFF', '#3DAE6B', '#FFA53D'];

  /* ---------- 棋盤 ---------- */

  const GROUPS = {
    brown:  { name: '離島', color: '#9A6B45' },
    sky:    { name: '南灣', color: '#7FD3F2' },
    pink:   { name: '東岸', color: '#F58FBE' },
    orange: { name: '山城', color: '#FFA64D' },
    red:    { name: '古都', color: '#EA5A55' },
    yellow: { name: '中台', color: '#F6D24A' },
    green:  { name: '北海岸', color: '#4DBF7A' },
    navy:   { name: '台北', color: '#3D5FC4' }
  };

  function P(name, group, price, house, rent, glyph) {
    return { type: 'prop', name, group, price, house, rent, glyph };
  }
  const TILES = [
    { type: 'go', name: '起點' },
    P('綠島', 'brown', 60, 50, [2, 10, 30, 90, 160, 250], 'island'),
    { type: 'chest', name: '命運' },
    P('蘭嶼', 'brown', 60, 50, [4, 20, 60, 180, 320, 450], 'boat'),
    { type: 'tax', name: '所得稅', tax: 200, glyph: 'coin' },
    { type: 'station', name: '台北車站', price: 200, glyph: 'train' },
    P('墾丁', 'sky', 100, 50, [6, 30, 90, 270, 400, 550], 'beach'),
    { type: 'chance', name: '機會' },
    P('小琉球', 'sky', 100, 50, [6, 30, 90, 270, 400, 550], 'turtle'),
    P('東港', 'sky', 120, 50, [8, 40, 100, 300, 450, 600], 'fish'),
    { type: 'jail', name: '監獄' },
    P('太魯閣', 'pink', 140, 100, [10, 50, 150, 450, 625, 750], 'gorge'),
    { type: 'utility', name: '電力公司', price: 150, glyph: 'bolt' },
    P('鹿野高台', 'pink', 140, 100, [10, 50, 150, 450, 625, 750], 'balloon'),
    P('礁溪溫泉', 'pink', 160, 100, [12, 60, 180, 500, 700, 900], 'spring'),
    { type: 'station', name: '台中車站', price: 200, glyph: 'train' },
    P('阿里山', 'orange', 180, 100, [14, 70, 200, 550, 750, 950], 'mountain'),
    { type: 'chest', name: '命運' },
    P('日月潭', 'orange', 180, 100, [14, 70, 200, 550, 750, 950], 'lake'),
    P('鹿港老街', 'orange', 200, 100, [16, 80, 220, 600, 800, 1000], 'lantern'),
    { type: 'park', name: '溫泉休息站' },
    P('安平古堡', 'red', 220, 150, [18, 90, 250, 700, 875, 1050], 'fort'),
    { type: 'chance', name: '機會' },
    P('駁二特區', 'red', 220, 150, [18, 90, 250, 700, 875, 1050], 'crate'),
    P('蓮池潭', 'red', 240, 150, [20, 100, 300, 750, 925, 1100], 'pagoda'),
    { type: 'station', name: '高雄車站', price: 200, glyph: 'train' },
    P('內灣', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150], 'bridge'),
    P('逢甲夜市', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150], 'skewer'),
    { type: 'utility', name: '自來水公司', price: 150, glyph: 'drop' },
    P('台中歌劇院', 'yellow', 280, 150, [24, 120, 360, 850, 1025, 1200], 'opera'),
    { type: 'gotojail', name: '去坐牢' },
    P('基隆廟口', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275], 'noodle'),
    P('九份老街', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275], 'lanterns'),
    { type: 'chest', name: '命運' },
    P('漁人碼頭', 'green', 320, 200, [28, 150, 450, 1000, 1200, 1400], 'sail'),
    { type: 'station', name: '花蓮車站', price: 200, glyph: 'train' },
    { type: 'chance', name: '機會' },
    P('信義區', 'navy', 350, 200, [35, 175, 500, 1100, 1300, 1500], 'towers'),
    { type: 'tax', name: '奢侈稅', tax: 100, glyph: 'gem' },
    P('台北101', 'navy', 400, 200, [50, 200, 600, 1400, 1700, 2000], 'tower101')
  ];
  TILES.forEach((t, i) => { t.i = i; });
  const STATION_RENT = [25, 50, 100, 200];
  const GROUP_TILES = {};
  TILES.forEach(t => { if (t.type === 'prop') (GROUP_TILES[t.group] = GROUP_TILES[t.group] || []).push(t.i); });
  const R_OWNABLE_PROPS = TILES.filter(t => t.type === 'prop').map(t => t.i);
  const OWNABLE = TILES.filter(t => t.type === 'prop' || t.type === 'station' || t.type === 'utility').map(t => t.i);

  /* ---------- 機會／命運 ---------- */

  const CHANCE = [
    { t: 'moveTo', to: 0, text: '前進到起點，領 200 元' },
    { t: 'moveTo', to: 39, text: '前往台北101，看看跨年煙火' },
    { t: 'moveTo', to: 6, text: '週末衝墾丁！前進到墾丁' },
    { t: 'moveTo', to: 5, text: '搭高鐵到台北車站' },
    { t: 'nearest', kind: 'station', text: '前進到最近的車站；如果有主人，租金加倍' },
    { t: 'nearest', kind: 'station', text: '前進到最近的車站；如果有主人，租金加倍' },
    { t: 'nearest', kind: 'utility', text: '前進到最近的公司；如果有主人，付骰子點數的 10 倍' },
    { t: 'collect', n: 50, text: '銀行發放股息，領 50 元' },
    { t: 'collect', n: 150, text: '定存到期，領 150 元' },
    { t: 'collect', n: 100, text: '統一發票中獎，領 100 元' },
    { t: 'getOut', text: '獲得一張「出獄許可證」，可以留著以後用' },
    { t: 'moveBack', n: 3, text: '走錯路，後退 3 格' },
    { t: 'jail', text: '違規停車被拖吊，直接進監獄！' },
    { t: 'repairs', house: 25, hotel: 100, text: '房屋整修：每棟房子付 25 元、每間旅店付 100 元' },
    { t: 'pay', n: 15, text: '超速罰單，付 15 元' },
    { t: 'eachPay', n: 50, text: '你被選為社區主委，付給每位玩家 50 元' },
    { t: 'item', text: '撿到一個道具箱，獲得一個隨機道具' }
  ];
  const CHEST = [
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
    { t: 'item', text: '抽中摸彩獎品，獲得一個隨機道具' }
  ];
  const CHANCE_GETOUT = 10, CHEST_GETOUT = 4;

  /* ---------- 道具 ----------
   * 來源：停在「溫泉休息站」、抽到「道具箱」卡。最多帶 3 個；帶滿了就改領 50 元。
   * active：自己挑時機用（擲骰前）；passive：條件到了自動用掉。 */
  const MAX_ITEMS = 3;
  const ITEMS = {
    dice:   { name: '遙控骰', active: true,  desc: '擲骰前使用：自己決定這回合走 1～6 步（不算雙骰）' },
    fly:    { name: '機票',   active: true,  desc: '擲骰前使用：直接飛到棋盤上任何一格（不會領起點薪水，落點照常處理）' },
    free:   { name: '免租券', active: false, desc: '下一次要付過路費時自動用掉，這次不用付' },
    shield: { name: '防收購券', active: false, desc: '別人想強制收購你的地時自動擋下（用掉）' },
    cat:    { name: '招財貓', active: false, desc: '下一次有人付你過路費時，租金加倍（用掉）' }
  };
  const ITEM_LIST = Object.keys(ITEMS);

  /* ---------- 建立 ---------- */

  function hide(state, key, val) { Object.defineProperty(state, key, { value: val, enumerable: false, writable: true }); }

  /**
   * @param {{id,name,char,ai?}[]} players
   * @param {{seed,pace,now,roundLimit,startCash,turnMs}} o
   */
  function create(players, o) {
    o = o || {};
    const rng = RNG.create(String(o.seed || 'seed') + '-rules');
    const order = rng.shuffle(players.slice());
    const seats = order.map(p => ({
      id: p.id, name: p.name, char: p.char, ai: p.ai || null,
      cash: o.startCash || START_CASH, pos: 0, jail: false, jailTurns: 0, getOut: 0, items: [],
      bankrupt: false, auto: false, timeouts: 0, afk: false
    }));
    const props = TILES.map(() => ({ owner: -1, houses: 0, mortgaged: false }));
    const now = o.now || 0;
    const state = {
      version: 0,
      opts: {
        pace: PACES[o.pace] ? o.pace : 'normal',
        roundLimit: ROUND_LIMITS.includes(Number(o.roundLimit)) ? Number(o.roundLimit) : 0,
        turnMs: Number(o.turnMs) || 0
      },
      seats, props, turn: 0, round: 1, phase: 'roll', dice: [0, 0], doubles: 0, again: false,
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
  function countKind(state, si, type) { return OWNABLE.filter(i => TILES[i].type === type && state.props[i].owner === si).length; }
  function mortgageValue(t) { return Math.floor(t.price / 2); }
  function unmortgageCost(t) { return Math.ceil(Math.floor(t.price / 2) * 11 / 10); }

  /** 租金；opt.double 車站加倍、opt.tenX 公司固定 10 倍（機會卡） */
  function rentOf(state, ti, dice, opt) {
    opt = opt || {};
    const t = TILES[ti], p = state.props[ti];
    if (p.owner < 0 || p.mortgaged) return 0;
    if (t.type === 'prop') {
      if (p.houses > 0) return t.rent[p.houses];
      return t.rent[0] * (groupOwned(state, p.owner, t.group) ? 2 : 1);
    }
    if (t.type === 'station') return STATION_RENT[Math.max(0, countKind(state, p.owner, 'station') - 1)] * (opt.double ? 2 : 1);
    const d = dice ? dice[0] + dice[1] : 7;
    return (opt.tenX || countKind(state, p.owner, 'utility') >= 2 ? 10 : 4) * d;
  }

  /** 一個人手上能換成現金的最大金額（現金＋抵押＋賣房） */
  function liquidity(state, si) {
    const s = state.seats[si];
    let v = s.cash;
    for (const i of ownedBy(state, si)) {
      const t = TILES[i], p = state.props[i];
      v += p.houses * Math.floor((t.house || 0) / 2);
      if (!p.mortgaged) v += mortgageValue(t);
    }
    return v;
  }

  function netWorth(state, si) {
    const s = state.seats[si];
    let v = s.cash;
    for (const i of ownedBy(state, si)) {
      const t = TILES[i], p = state.props[i];
      v += p.mortgaged ? mortgageValue(t) : t.price;
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
    if (id === 'fly') {
      if (!(Number.isInteger(arg) && arg >= 0 && arg < BOARD)) return '請選要飛去的格子';
      if (arg === s.pos) return '你已經在這一格了';
      if (TILES[arg].type === 'gotojail') return '不能飛去「去坐牢」';
    }
    return null;
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
      say(state, s.name + ' 現金不夠付 ' + money(amount) + '，要先賣房子或抵押地產');
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
      const t = TILES[i], p = state.props[i];
      cash += p.houses * Math.floor((t.house || 0) / 2);
      p.houses = 0;
    }
    const heir = to >= 0 && !state.seats[to].bankrupt ? to : -1;
    for (const i of ownedBy(state, si)) {
      const p = state.props[i];
      if (heir >= 0) p.owner = heir;
      else { p.owner = -1; p.mortgaged = false; }
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
    const s = state.seats[si], t = TILES[s.pos], p = state.props[s.pos];
    if (t.type === 'prop' || t.type === 'station' || t.type === 'utility') {
      if (p.owner < 0) {
        state.pending = { kind: 'buy', tile: t.i, price: t.price };
        state.phase = 'buy';
        return;
      }
      if (p.owner === si) { say(state, s.name + ' 來到自己的 ' + t.name); return; }
      if (p.mortgaged) { say(state, t.name + ' 抵押中，不收過路費'); return; }
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
      say(state, s.name + ' 停在 ' + state.seats[p.owner].name + ' 的 ' + t.name + '，付過路費 ' + money(rent));
      charge(state, si, p.owner, rent, 'rent');
      return;
    }
    if (t.type === 'tax') {
      say(state, s.name + ' 繳' + t.name + ' ' + money(t.tax));
      charge(state, si, -1, t.tax, 'tax');
      return;
    }
    if (t.type === 'gotojail') { say(state, s.name + ' 被抓去坐牢'); sendToJail(state, si); return; }
    if (t.type === 'chance' || t.type === 'chest') { drawCard(state, si, t.type); return; }
    if (t.type === 'jail') say(state, s.name + ' 來監獄探監（只是路過）');
    else if (t.type === 'park') { say(state, s.name + ' 在溫泉休息站泡腳，撿到一個道具'); gainItem(state, si); }
  }

  function drawCard(state, si, deck) {
    const s = state.seats[si];
    const list = deck === 'chance' ? CHANCE : CHEST;
    const order = state._decks[deck];
    const idx = order.shift();
    const card = list[idx];
    if (card.t !== 'getOut') order.push(idx);
    state.card = { n: ++state.cardSeq, deck, text: card.text, seat: si };
    ev(state, { t: 'card', seat: si, deck, text: card.text });
    say(state, s.name + ' 抽到' + (deck === 'chance' ? '機會' : '命運') + '：' + card.text);
    switch (card.t) {
      case 'collect': s.cash += card.n; ev(state, { t: 'cash', seat: si, to: -2, amount: card.n, reason: 'card' }); break;
      case 'pay': charge(state, si, -1, card.n, 'card'); break;
      case 'getOut': s.getOut++; break;
      case 'item': gainItem(state, si); break;
      case 'jail': sendToJail(state, si); break;
      case 'moveTo': moveBy(state, si, card.to, true, {}); break;
      case 'moveBack': moveBy(state, si, (s.pos - card.n + BOARD) % BOARD, false, {}); break;
      case 'nearest': {
        let to = s.pos;
        for (let k = 1; k <= BOARD; k++) {
          const c = (s.pos + k) % BOARD;
          if (TILES[c].type === card.kind) { to = c; break; }
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
  }

  /** 這一步的事都處理完了：該再擲一次、進入整理階段，還是換人（換人後不能再動） */
  function afterResolve(state, si) {
    if (state.phase === 'buy' || state.phase === 'debt' || state.phase === 'over') return;
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
    const base = { roll: 900, buy: 600, decline: 450, build: 550, sell: 450, mortgage: 450, unmortgage: 450, buyout: 800, end: 350, pay: 500, settle: 450, bankrupt: 1200 }[kind] || 400;
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
    const t = TILES[ti];
    if (!t || t.type !== 'prop') return '只有地產可以蓋房子';
    const p = state.props[ti];
    if (p.owner !== si) return '這塊地不是你的';
    if (!groupOwned(state, si, t.group)) return '要先買齊同色的整組地才能蓋房子';
    if (GROUP_TILES[t.group].some(i => state.props[i].mortgaged)) return '這一組有地在抵押中，先贖回來';
    if (p.houses >= MAX_HOUSES) return '已經是旅店了';
    const min = Math.min.apply(null, groupHouses(state, t.group));
    if (p.houses > min) return '要平均蓋：先把同組其他格蓋到一樣多';
    if (state.seats[si].cash < t.house) return '現金不夠（要 ' + money(t.house) + '）';
    return null;
  }

  function canSellAt(state, si, ti) {
    const t = TILES[ti];
    if (!t || t.type !== 'prop') return '這格沒有房子';
    const p = state.props[ti];
    if (p.owner !== si) return '這塊地不是你的';
    if (p.houses <= 0) return '這格沒有房子';
    const max = Math.max.apply(null, groupHouses(state, t.group));
    if (p.houses < max) return '要平均賣：先賣同組蓋比較多的那格';
    return null;
  }

  function canMortgageAt(state, si, ti) {
    const bad = checkTileOwn(state, si, ti);
    if (bad) return bad;
    const t = TILES[ti], p = state.props[ti];
    if (p.mortgaged) return '已經抵押了';
    if (t.type === 'prop' && GROUP_TILES[t.group].some(i => state.props[i].houses > 0)) return '同組還有房子，要先全部賣掉';
    return null;
  }

  function canUnmortgageAt(state, si, ti) {
    const bad = checkTileOwn(state, si, ti);
    if (bad) return bad;
    const t = TILES[ti], p = state.props[ti];
    if (!p.mortgaged) return '這塊地沒有抵押';
    if (state.seats[si].cash < unmortgageCost(t)) return '現金不夠（要 ' + money(unmortgageCost(t)) + '）';
    return null;
  }

  /** 買了這塊，同組其他格都是自己的 → 湊齊整組 */
  function completesGroup(state, si, ti) {
    const t = TILES[ti];
    return t.type === 'prop' && GROUP_TILES[t.group].every(i => i === ti || state.props[i].owner === si);
  }

  function buyoutCost(ti) { return TILES[ti].price * 2; }

  function canBuyoutAt(state, si, ti) {
    const t = TILES[ti];
    if (!t || t.type !== 'prop') return '只有地產可以收購';
    const p = state.props[ti];
    if (p.owner < 0) return '這塊地還沒有主人，直接停上去買就好';
    if (p.owner === si) return '這塊地已經是你的了';
    if (state.boughtOut) return '這回合已經收購過一次了';
    if (p.mortgaged) return '抵押中的地不能收購';
    if (p.houses > 0) return '有房子的地不能收購';
    if (!completesGroup(state, si, ti)) return '收購後要能湊齊同色整組才行';
    if (state.seats[si].cash < buyoutCost(ti)) return '現金不夠（要 ' + money(buyoutCost(ti)) + '）';
    return null;
  }

  /**
   * 執行一個行動。
   * action：{ type: 'useItem'|'roll'|'payJail'|'useCard'|'buy'|'decline'|'build'|'sell'|'mortgage'|'unmortgage'|'buyout'|'settle'|'bankrupt'|'endTurn', tile? }
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
        const arg = id === 'dice' ? Number(action.n) : Number(action.tile);
        const err = canUseItem(state, si, id, arg);
        if (err) return { ok: false, reason: 'illegal', text: err };
        const n0 = state.eventSeq;
        useUp(state, si, id);
        if (id === 'dice') {
          state.dice = [arg, 0];
          state.doubles = 0; state.again = false;
          ev(state, { t: 'roll', seat: si, dice: [arg, 0], single: true });
          say(state, s.name + ' 用「遙控骰」，走 ' + arg + ' 步');
          moveBy(state, si, (s.pos + arg) % BOARD, true, {});
        } else {
          say(state, s.name + ' 用「機票」飛到 ' + TILES[arg].name);
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
        const t = TILES[state.pending.tile];
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
      case 'decline':
        if (ph !== 'buy' || !state.pending) return fail('bad-phase');
        say(state, s.name + ' 決定不買 ' + TILES[state.pending.tile].name);
        state.pending = null; state.phase = 'roll';
        afterResolve(state, si);
        hold = 'decline';
        break;
      case 'build': case 'sell': case 'mortgage': case 'unmortgage': {
        const okPhase = ph === 'roll' || ph === 'manage' || (ph === 'buy' && type !== 'build') ||
          (ph === 'debt' && (type === 'sell' || type === 'mortgage'));
        if (!okPhase) return fail('bad-phase');
        const ti = Number(action.tile);
        const err = type === 'build' ? canBuildAt(state, si, ti) : type === 'sell' ? canSellAt(state, si, ti)
          : type === 'mortgage' ? canMortgageAt(state, si, ti) : canUnmortgageAt(state, si, ti);
        if (err) return { ok: false, reason: 'illegal', text: err };
        const t = TILES[ti], p = state.props[ti];
        if (type === 'build') {
          s.cash -= t.house; p.houses++;
          ev(state, { t: 'build', seat: si, tile: ti, houses: p.houses });
          say(state, s.name + ' 在 ' + t.name + (p.houses === MAX_HOUSES ? ' 蓋了旅店' : ' 蓋了第 ' + p.houses + ' 棟房子'));
        } else if (type === 'sell') {
          const back = Math.floor(t.house / 2);
          s.cash += back; p.houses--;
          ev(state, { t: 'build', seat: si, tile: ti, houses: p.houses });
          say(state, s.name + ' 賣掉 ' + t.name + ' 的一棟房子，拿回 ' + money(back));
        } else if (type === 'mortgage') {
          s.cash += mortgageValue(t); p.mortgaged = true;
          ev(state, { t: 'mortgage', seat: si, tile: ti, on: true });
          say(state, s.name + ' 抵押了 ' + t.name + '，拿到 ' + money(mortgageValue(t)));
        } else {
          s.cash -= unmortgageCost(t); p.mortgaged = false;
          ev(state, { t: 'mortgage', seat: si, tile: ti, on: false });
          say(state, s.name + ' 贖回了 ' + t.name + '，花 ' + money(unmortgageCost(t)));
        }
        hold = type;
        break;
      }
      case 'buyout': {
        if (ph !== 'roll' && ph !== 'manage') return fail('bad-phase');
        const ti = Number(action.tile);
        const err = canBuyoutAt(state, si, ti);
        if (err) return { ok: false, reason: 'illegal', text: err };
        const t = TILES[ti], p = state.props[ti];
        const cost = buyoutCost(ti), from = p.owner;
        if (hasItem(state, from, 'shield')) {
          useUp(state, from, 'shield');
          state.boughtOut = true;
          say(state, state.seats[from].name + ' 的「防收購券」擋下了 ' + s.name + ' 對 ' + t.name + ' 的收購！');
          hold = 'decline';
          break;
        }
        s.cash -= cost; state.seats[from].cash += cost;
        p.owner = si; state.boughtOut = true;
        ev(state, { t: 'buyout', seat: si, from, tile: ti, price: cost });
        ev(state, { t: 'cash', seat: si, to: from, amount: cost, reason: 'buyout' });
        say(state, s.name + ' 用 ' + money(cost) + ' 強制收購了 ' + state.seats[from].name + ' 的 ' + t.name + '，湊齊整組！');
        hold = 'buyout';
        break;
      }
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
      build: [], sell: [], mortgage: [], unmortgage: [], buyout: [], liquidity: 0, dice: false, fly: false };
    if (si < 0 || state.phase === 'over' || si !== state.turn) return out;
    const s = state.seats[si], ph = state.phase;
    out.liquidity = liquidity(state, si);
    if (ph === 'roll') {
      out.roll = true;
      out.dice = !canUseItem(state, si, 'dice', 1);
      out.fly = !canUseItem(state, si, 'fly', (s.pos + 1) % BOARD);
      if (s.jail) { out.payJail = s.cash >= JAIL_FINE; out.useCard = s.getOut > 0; }
    }
    if (ph === 'buy' && state.pending) {
      out.buy = s.cash >= TILES[state.pending.tile].price;
      out.decline = true;
    }
    if (ph === 'debt' && state.pending) {
      out.settle = s.cash >= state.pending.amount;
      out.bankrupt = true;
    }
    if (ph === 'manage') out.endTurn = true;
    const manageable = ph === 'roll' || ph === 'manage';
    if (manageable) for (const i of R_OWNABLE_PROPS) if (!canBuyoutAt(state, si, i)) out.buyout.push(i);
    for (const i of ownedBy(state, si)) {
      if (manageable && !canBuildAt(state, si, i)) out.build.push(i);
      if ((manageable || ph === 'debt' || ph === 'buy') && !canSellAt(state, si, i)) out.sell.push(i);
      if ((manageable || ph === 'debt' || ph === 'buy') && !canMortgageAt(state, si, i)) out.mortgage.push(i);
      if ((manageable || ph === 'buy') && !canUnmortgageAt(state, si, i)) out.unmortgage.push(i);
    }
    return out;
  }

  /** 送給所有人（含觀戰者）的畫面資料；牌堆順序與 seed 不會出去。大富翁沒有隱藏資訊。 */
  function publicView(state, now) {
    return {
      version: state.version,
      boughtOut: state.boughtOut,
      opts: state.opts,
      seats: state.seats.map((s, i) => ({
        id: s.id, name: s.name, char: s.char, ai: s.ai, cash: s.cash, pos: s.pos, jail: s.jail, jailTurns: s.jailTurns,
        getOut: s.getOut, items: s.items.slice(), bankrupt: s.bankrupt, auto: s.auto, afk: s.afk, worth: netWorth(state, i)
      })),
      props: state.props.map(p => ({ owner: p.owner, houses: p.houses, mortgaged: p.mortgaged })),
      turn: state.turn, round: state.round, phase: state.phase, dice: state.dice, doubles: state.doubles,
      pending: state.pending ? { kind: state.pending.kind, tile: state.pending.tile, price: state.pending.price,
        amount: state.pending.amount, creditor: state.pending.creditor, reason: state.pending.reason } : null,
      card: state.card, events: state.events.slice(-24), eventSeq: state.eventSeq, log: state.log.slice(-30),
      winner: state.winner, reason: state.reason, ranking: state.ranking,
      turnLeftMs: state.opts.turnMs && state.deadline && state.phase !== 'over' ? Math.max(0, state.deadline - (now == null ? 0 : now)) : null
    };
  }

  return {
    MIN_PLAYERS, MAX_PLAYERS, START_CASH, GO_SALARY, JAIL_FINE, MAX_HOUSES, BOARD,
    DIFFICULTY_LIST, DIFFICULTIES, PACES, ROUND_LIMITS, PLAYER_COLORS,
    TILES, GROUPS, GROUP_TILES, OWNABLE, CHANCE, CHEST, ITEMS, ITEM_LIST, MAX_ITEMS, canUseItem,
    create, act, tick, options, publicView, rentOf, netWorth, liquidity, ownedBy, groupOwned,
    mortgageValue, unmortgageCost, canBuyoutAt, buyoutCost, completesGroup, canBuildAt, canSellAt, canMortgageAt, canUnmortgageAt, indexOfId, cur, alive
  };
});
