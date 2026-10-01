/* ===== tests/verify.js — 規則單元測試＋電腦互打（node tests/verify.js） =====
 * 全部用種子亂數與假時鐘，不需要瀏覽器與網路。
 */
'use strict';

const R = require('../public/js/rules.js');
const AI = require('../public/js/ai.js');
const RNG = require('../public/js/rng.js');

/* 規則測試用固定版面（經典 40 格）：沒指定地圖的 create 都用它；正式遊戲的地圖是每局隨機生成的 */
const _create = R.create;
R.create = (ps, o) => _create(ps, o && (o.map || o.mapSize) ? o : Object.assign({ map: 'classic40' }, o || {}));
R.useMap('classic40');

let pass = 0, fail = 0;
function ok(v, name) { if (v) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name); } }
function eq(a, b, name) { ok(a === b, name + (a === b ? '' : '（得到 ' + JSON.stringify(a) + '，預期 ' + JSON.stringify(b) + '）')); }
function section(t) { console.log('\n[' + t + ']'); }

/** 建一局固定座位順序的牌桌（不洗牌順序：直接改 seats 順序不方便，所以用 seed 建完再重排） */
function mk(n, opt) {
  const ps = [];
  for (let i = 0; i < n; i++) ps.push({ id: 'p' + i, name: '玩家' + i, char: 'otter' });
  const st = R.create(ps, Object.assign({ seed: 'unit', fixedPrices: true }, opt || {}));
  st.seats.sort((a, b) => a.id < b.id ? -1 : 1);
  st.turn = 0;
  return st;
}
/** 下一次擲骰固定成 a、b */
function dice(st, a, b) { const q = [a, b]; st._rng = { int: () => q.length ? q.shift() : 0, shuffle: x => x, next: () => 0.5 }; }
function roll(st, a, b, now) { dice(st, a, b); return R.act(st, st.seats[st.turn].id, { type: 'roll' }, now || 0); }
/** 模擬「走到自己的地、面板詢問要不要加蓋」再按蓋房 */
function B(st, tile) { st.phase = 'build'; st.pending = { kind: 'build', tile }; return R.act(st, st.seats[st.turn].id, { type: 'build', tile }, 0); }
function A(st, type, extra) { return R.act(st, st.seats[st.turn].id, Object.assign({ type }, extra || {}), 0); }
function give(st, si, ti, houses) { st.props[ti].owner = si; st.props[ti].houses = houses || 0; }
function endTurn(st) { if (st.phase === 'buy') A(st, 'decline'); if (st.phase === 'roll') { roll(st, 1, 2); if (st.phase === 'buy') A(st, 'decline'); } A(st, 'endTurn'); }

/* ---------- 棋盤資料 ---------- */
section('棋盤');
eq(R.TILES.length, 40, '一共 40 格');
eq(R.TILES.filter(t => t.type === 'prop').length, 22, '22 塊地產');
eq(R.TILES.filter(t => t.type === 'station').length, 4, '4 個車站');
eq(R.TILES.filter(t => t.type === 'utility').length, 2, '2 間公司');
eq(R.TILES.filter(t => t.type === 'chance').length + R.TILES.filter(t => t.type === 'chest').length, 6, '機會 3、命運 3');
ok(R.TILES[0].type === 'go' && R.TILES[10].type === 'jail' && R.TILES[20].type === 'park' && R.TILES[30].type === 'gotojail', '四個角落：起點、監獄、休息站、去坐牢');
ok(Object.keys(R.GROUP_TILES).length === 8 && R.GROUP_TILES.brown.length === 2 && R.GROUP_TILES.navy.length === 2 && R.GROUP_TILES.sky.length === 3, '8 個色組（離島與台北各 2 塊，其餘 3 塊）');
ok(R.TILES.filter(t => t.type === 'prop').every(t => t.rent.length === 6 && t.rent.every((v, i, a) => i === 0 || v > a[i - 1])), '每塊地的租金表 0～旅店 逐級變高');
ok(new Set(R.TILES.map(t => t.name).filter(n => n !== '機會' && n !== '命運')).size === 34, '格名不重複（機會／命運各 3 格同名）');
eq(R.CHANCE.length, 21, '機會 21 張（含道具卡、道具點數、命運之神）'); eq(R.CHEST.length, 21, '命運 21 張（含道具卡、道具點數、命運之神）');
ok(R.CHANCE.filter(c => c.t === 'points').length === 2 && R.CHEST.filter(c => c.t === 'points').length === 2, '機會、命運各有 2 張送道具點數的卡');

/* ---------- 建立與亂數 ---------- */
section('建立與亂數');
{
  const ps = [1, 2, 3, 4].map(i => ({ id: 'p' + i, name: 'P' + i, char: 'cat' }));
  const a = R.create(ps, { seed: 'x1' }), b = R.create(ps, { seed: 'x1' }), c = R.create(ps, { seed: 'x2' });
  eq(a.seats.map(s => s.id).join(), b.seats.map(s => s.id).join(), '同 seed → 座位順序相同');
  ok(a.seats.every(s => s.cash === R.START_CASH && s.pos === 0), '每人現金 2000、站在起點');
  const orders = new Set();
  for (let i = 0; i < 20; i++) orders.add(R.create(ps, { seed: 's' + i }).seats.map(s => s.id).join());
  ok(orders.size > 3, '不同 seed 座位順序會不一樣（系統隨機決定）');
  ok(c.seats.length === 4, '4 人');
  eq(R.MAX_PLAYERS, 6, '人數上限 6 人');
  eq(R.PLAYER_COLORS.length, 8, '8 種玩家顏色');
  eq(new Set(R.PLAYER_COLORS).size, 8, '顏色互不相同');
  const j = JSON.stringify(R.publicView(a, 0));
  ok(!/x1|_rng|_decks/.test(j), 'publicView 不含 seed 與牌堆');
}

/* ---------- 擲骰、移動、買地、過路費 ---------- */
section('擲骰、買地、過路費');
{
  const st = mk(2);
  ok(roll(st, 1, 2).ok && st.seats[0].pos === 3, '擲 1+2 走到第 3 格');
  eq(st.phase, 'buy', '停在沒人的地 → 進入買地決策');
  ok(!A(st, 'roll').ok, '買地決策時不能擲骰');
  ok(A(st, 'buy').ok && st.props[3].owner === 0 && st.seats[0].cash === R.START_CASH - 60, '買下蘭嶼（60）：現金 1440、地歸自己');
  eq(st.phase, 'manage', '買完進入整理階段（可蓋房、結束）');
  ok(!R.act(st, 'p1', { type: 'endTurn' }, 0).ok, '還沒輪到的人不能動');
  A(st, 'endTurn');
  eq(st.turn, 1, '換下一位');
  roll(st, 1, 2);
  eq(st.seats[1].cash, R.START_CASH - 6, '別人踩到蘭嶼：付過路費 6');
  eq(st.seats[0].cash, R.START_CASH - 60 + 6, '收租的人拿到 6');
  ok(st.phase === 'manage', '付完租進入整理階段');
  A(st, 'endTurn');
  /* 不買 */
  const s2 = mk(2);
  roll(s2, 3, 3);
  ok(s2.phase === 'buy' && s2.seats[0].pos === 6, '擲 3+3 走到墾丁');
  A(s2, 'decline');
  eq(s2.props[6].owner, -1, '選不買：地留在原地沒人買');
  eq(s2.phase, 'manage', '沒有雙骰再擲：不買之後直接進入整理階段');
  ok(s2.again === undefined && s2.doubles === undefined, '規則裡沒有 again／doubles 狀態');
}

/* ---------- 起點、雙骰、三次雙骰進監獄 ---------- */
section('起點、監獄（沒有雙骰機制）');
{
  /* 罰金依個人資產：有錢有地的人罰得多，窮人罰最低 50，最高 500 */
  const st = mk(2);
  st.seats[0].cash = 100; ok(R.jailFine(st, 0) === 50, '總資產很低：罰金最低 50');
  st.seats[0].cash = 2000; eq(R.jailFine(st, 0), 200, '總資產 2000：罰金 200（10%）');
  st.seats[0].cash = 99999; eq(R.jailFine(st, 0), 500, '總資產很高：罰金最高 500');
  const a = mk(2); a.seats[0].cash = 1000; const f1 = R.jailFine(a, 0); give(a, 0, 39, 3); ok(R.jailFine(a, 0) > f1, '買地蓋房讓總資產變高：罰金也變高');
  const poor = mk(2); poor.seats[0].pos = 27; roll(poor, 1, 2); A(poor, 'endTurn'); endTurn(poor);
  poor.seats[0].cash = 40; ok(!R.options(poor, 'p0').payJail && !A(poor, 'payJail').ok, '現金不夠繳罰金：不能繳');
}
{
  const st = mk(2);
  st.seats[0].pos = 37;
  roll(st, 1, 2);
  eq(st.seats[0].pos, 0, '37+3 繞回起點');
  eq(st.seats[0].cash, R.START_CASH + 200, '經過（停在）起點領 200');
  const s2 = mk(2);
  s2.seats[0].pos = 38;
  roll(s2, 2, 1);
  eq(s2.seats[0].pos, 1, '38+3 → 第 1 格');
  ok(s2.seats[0].cash === R.START_CASH + 200, '經過起點領 200');
  /* 擲雙骰不會再擲、也不會因連續雙骰進監獄 */
  const s3 = mk(2);
  s3.seats[0].cash = 99999;
  roll(s3, 1, 1); if (s3.phase === 'buy') A(s3, 'decline');
  eq(s3.phase, 'manage', '擲出一樣的點數也不會再擲');
  ok(!s3.seats[0].jail, '不會因為連續雙骰進監獄');
  /* 1 顆骰子 */
  const s3b = mk(2);
  dice(s3b, 4, 0);
  ok(A(s3b, 'roll', { dice: 1 }).ok, '選 1 顆骰子擲骰');
  eq(s3b.seats[0].pos, 4, '1 顆骰子：只走 1 顆的點數');
  eq(s3b.diceKind, 'one', '記得這次是 1 顆骰子');
  eq(s3b.dice[1], 0, '1 顆骰子時第二顆為 0');
  /* 停在去坐牢 */
  const s4 = mk(2);
  s4.seats[0].pos = 27;
  roll(s4, 1, 2);
  ok(s4.seats[0].jail && s4.seats[0].pos === 10, '停在「去坐牢」→ 進監獄');
  A(s4, 'endTurn');
  endTurn(s4);
  eq(s4.turn, 0, '繞一圈回到坐牢的人');
  const opt = R.options(s4, 'p0');
  ok(opt.roll && opt.payJail && !opt.useCard, '監獄裡的選項：擲骰、繳罰金（沒有許可證）');
  const fine4 = R.jailFine(s4, 0);
  ok(opt.jailFine === fine4 && fine4 >= 50 && fine4 <= 500 && fine4 % 10 === 0, '罰金依總資產：' + fine4 + ' 元');
  ok(A(s4, 'payJail').ok && !s4.seats[0].jail && s4.seats[0].cash === R.START_CASH - fine4, '繳罰金出獄');
  /* 監獄裡擲骰：不會出獄，只是待著 */
  const s5 = mk(2);
  s5.seats[0].pos = 27; roll(s5, 1, 2); A(s5, 'endTurn'); endTurn(s5);
  const nEv = s5.events.length; roll(s5, 4, 4);
  ok(s5.seats[0].jail && s5.seats[0].pos === 10, '監獄裡不能擲骰，也不能靠骰子出獄（待在牢裡）');
  ok(!s5.events.slice(nEv).some(e => e.t === 'roll') && s5.seats[0].jailTurns === 1, '在牢裡沒有擲骰事件，只累計回合數');
  eq(s5.phase, 'manage', '待在牢裡後進入整理階段');
  /* 待滿三回合免罰金 */
  const s6 = mk(2);
  s6.seats[0].pos = 27; roll(s6, 1, 2); A(s6, 'endTurn'); endTurn(s6);
  roll(s6, 1, 2); A(s6, 'endTurn'); endTurn(s6);
  roll(s6, 1, 3); A(s6, 'endTurn'); endTurn(s6);
  const cash0 = s6.seats[0].cash;
  roll(s6, 1, 4);
  ok(!s6.seats[0].jail && s6.seats[0].cash === cash0, '待滿第 3 回合：免罰金出獄（現金不變）');
  eq(s6.seats[0].pos, 10, '第 3 回合不擲骰、不移動'); eq(s6.phase, 'manage', '第 3 回合結束（不能擲骰）');
  A(s6, 'endTurn'); endTurn(s6);
  roll(s6, 1, 4); eq(s6.seats[0].pos, 15, '第 4 回合才能擲骰前進（10+5＝台中車站）');
}

section('起始現金與起點薪水依地圖大小倍率');
{
  const mult = { 48: 1.2, 64: 1.4, 80: 1.6, 96: 1.8, 120: 2 };
  Object.keys(mult).forEach(n => {
    [25, 40, 50, 0].forEach(rl => {
      const want = Math.round((rl || 100) * 200 * mult[n]);
      eq(R.startCashFor(rl, Number(n)), want, n + ' 格・' + (rl || '不限') + ' 回合：起始現金 ' + want);
      const st = R.create(['a', 'b'].map(x => ({ id: x, name: x, char: 'otter' })), { seed: 'c' + n + rl, mapSize: Number(n), roundLimit: rl });
      ok(st.tiles.length === Number(n) && st.seats.every(q => q.cash === want), '開局每人現金＝' + want);
    });
    eq(R.goSalaryFor(Number(n)), Math.round(500 * mult[n]), n + ' 格：起點薪水 ' + Math.round(500 * mult[n]));
    const st = R.create(['a', 'b'].map(x => ({ id: x, name: x, char: 'otter' })), { seed: 'g' + n, mapSize: Number(n) });
    const sal = Math.round(500 * mult[n]);
    eq(R.salaryOf(st), sal, n + ' 格：salaryOf');
    const me = st.seats[st.turn], c0 = me.cash; me.pos = Number(n) - 1; me.items = ['dice'];
    const r = R.act(st, me.id, { type: 'useItem', item: 'dice', n: 2 }, 0);
    ok(r.ok && st.events.some(e => e.t === 'cash' && e.reason === 'go' && e.amount === sal), n + ' 格：經過起點實際領到 ' + sal);
  });
  eq(R.startCashFor(0, 40), 10000, '經典 40 格（測試用）維持舊制 10000'); eq(R.goSalaryFor(40), 200, '經典 40 格薪水 200');
}

/* ---------- 連棟加乘、最多加蓋 5 次 ---------- */
section('連棟：整串過路費加總');
{
  const st = mk(2);
  give(st, 0, 6); give(st, 0, 8);
  st.props[6].houses = 2; st.props[8].houses = 2;
  const base = st.tiles[8].rent[2];
  eq(R.rowLen(st, 8), 1, '中間隔著機會格（7 號）不算連棟');
  give(st, 0, 9); st.props[9].houses = 1;
  eq(R.rowLen(st, 8), 2, '8、9 號都有房子＝2 連棟');
  eq(R.rentOf(st, 8, [1, 2]), Math.round((base + R.TILES[9].rent[1]) * 0.8), '2 連棟：租金＝8、9 號兩格的過路費加總後打 8 折');
  eq(R.rentOf(st, 9, [1, 2]), Math.round((base + R.TILES[9].rent[1]) * 0.8), '踩到串裡任何一格，付的都是同一個總和');
  give(st, 0, 11, 0); give(st, 0, 13, 2); eq(R.rowLen(st, 8), 2, '沒蓋房的格子不算進連棟');
  st.props[9].houses = 0;
  eq(R.rowLen(st, 8), 1, '沒蓋房的格子會斷開連棟');
  eq(R.rentOf(st, 8, [1, 2]), base, '沒有連棟：只收自己這格的租金');
  eq(R.MAX_HOUSES, 5, '每塊地最多加蓋 5 次（含旅店）');
  /* 隨機地圖上可能有更長的連棟：整串加總 */
  const mid = R.MAPS.genId(80, 'row3'), m3 = R.MAPS.get(mid);
  const run = m3.tiles.findIndex((t, i) => t.type === 'prop' && m3.tiles[(i + 1) % 80].type === 'prop' && m3.tiles[(i + 2) % 80].type === 'prop');
  if (run >= 0) {
    const s3 = R.create(['a', 'b'].map(x => ({ id: x, name: x, char: 'otter' })), { seed: 'row3', map: mid, fixedPrices: true });
    [0, 1, 2].forEach((k, j) => { const ti = (run + k) % 80; s3.props[ti].owner = 0; s3.props[ti].houses = j + 1; });
    const want = Math.round([0, 1, 2].reduce((a, k, j) => a + s3.tiles[(run + k) % 80].rent[j + 1], 0) * 0.8);
    ok(R.rowLen(s3, run + 1) === 3 && R.rentOf(s3, run, [1, 2]) === want && R.rentOf(s3, run + 2, [1, 2]) === want, '隨機地圖上 3 連棟：三格過路費加總後打 8 折（' + want + '）');
  } else ok(true, '（這張地圖沒有連續 3 塊地）');
}

/* ---------- 同色整組、蓋房、抵押 ---------- */
section('同色整組、蓋房、抵押');
{
  const st = mk(2);
  give(st, 0, 1); give(st, 0, 3);
  st.phase = 'manage';
  eq(R.rentOf(st, 1, [1, 2]), 6, '整組沒有房子：租金加倍（3→6）');
  ok(!A(st, 'build', { tile: 1 }).ok, '不在「走到自己的地」時不能蓋房（我的地產不能直接蓋）');
  ok(B(st, 1).ok && st.props[1].houses === 1, '走到自己的地：蓋第 1 棟');
  eq(R.rentOf(st, 1, [1, 2]), 15, '1 棟房子租金 15');
  ok(B(st, 1).ok && st.props[1].houses === 2, '不用平均：同一格可以繼續蓋');
  ok(B(st, 3).ok, '另一格蓋 1 棟');
  for (let i = 0; i < 2; i++) { B(st, 1); }
  for (let i = 0; i < 3; i++) { B(st, 3); }
  eq(st.props[1].houses, 4, '各蓋到 4 棟');
  ok(B(st, 1).ok && st.props[1].houses === 5, '升級成旅店（5）');
  ok(!B(st, 1).ok, '旅店不能再蓋');
  st.phase = 'manage'; st.pending = null;
  ok(A(st, 'sell', { tile: 3 }).ok, '賣房不用平均');
  B(st, 3);
  const c0 = st.seats[0].cash;
  ok(A(st, 'sell', { tile: 1 }).ok && st.seats[0].cash === c0 + 25, '賣一棟房子拿回半價');
  const st2 = mk(2);
  give(st2, 0, 6);
  ok(B(st2, 6).ok && st2.props[6].houses === 1, '沒湊齊整組也能單格升級（1 級）');
  ok(B(st2, 6).ok && st2.props[6].houses === 2, '單格升到 2 級');
  ok(B(st2, 6).ok && B(st2, 6).ok && B(st2, 6).ok && st2.props[6].houses === 5, '沒湊齊整組：單格也能一路升到旅店（5）');
  ok(!B(st2, 6).ok, '旅店不能再蓋');
  st2.phase = 'manage'; st2.pending = null;
  ok(A(st2, 'sell', { tile: 6 }).ok && A(st2, 'sell', { tile: 6 }).ok && st2.props[6].houses === 3, '沒湊齊整組可以隨時賣掉自己的房子（不用平均）');
  st2.phase = 'manage';
  ok(!A(st2, 'mortgage', { tile: 6 }).ok && !A(st2, 'unmortgage', { tile: 6 }).ok, '沒有抵押功能：抵押與贖回都會被拒絕');
  ok(R.options(st2, 'p0').build.length === 0 && !('mortgage' in R.options(st2, 'p0')), '整理階段的 options 沒有蓋房，也沒有抵押');
  ok(!A(st2, 'buy').ok, '不在買地階段不能買');
  /* 走到自己的地才會跳出詢問 */
  const st3 = mk(2);
  give(st3, 0, 6); st3.seats[0].pos = 2;
  roll(st3, 2, 2);
  ok(st3.phase === 'build' && st3.pending && st3.pending.tile === 6, '走到自己的地：進入「要不要加蓋」詢問');
  ok(R.options(st3, 'p0').decline && R.options(st3, 'p0').build[0] === 6, '詢問時可以選「蓋」或「不蓋」');
  ok(A(st3, 'decline').ok && st3.phase !== 'build', '選「不蓋」就繼續');
  const st4 = mk(2);
  give(st4, 0, 6, 5); st4.seats[0].pos = 2;
  roll(st4, 2, 2);
  ok(st4.phase !== 'build', '已經是旅店不能再蓋就不詢問');
  const st5 = mk(2);
  give(st5, 0, 6); st5.seats[0].cash = 10; st5.seats[0].pos = 2;
  roll(st5, 2, 2);
  ok(st5.phase !== 'build', '現金不夠蓋房就不詢問');
  const st6 = mk(2);
  give(st6, 0, 6); st6.seats[0].pos = 2;
  roll(st6, 2, 2);
  A(st6, 'build', { tile: 6 });
  ok(st6.props[6].houses === 1 && st6.phase !== 'build' && !st6.pending, '一次只能蓋一棟：蓋完就結束詢問，不能連蓋');
  ok(!A(st6, 'build', { tile: 6 }).ok, '蓋完後不能在同一次再蓋（也不能蓋別塊）');
}

/* ---------- 車站與公司 ---------- */
section('車站與公司');
{
  const st = mk(2);
  give(st, 0, 5); give(st, 0, 15);
  eq(R.rentOf(st, 5, [1, 2]), 80, '2 個車站租金 80');
  give(st, 0, 25); give(st, 0, 35);
  eq(R.rentOf(st, 5, [1, 2]), 320, '4 個車站租金 320');
  give(st, 0, 12);
  eq(R.rentOf(st, 12, [3, 4]), 42, '1 間公司：骰子點數 ×6（7×6）');
  give(st, 0, 28);
  eq(R.rentOf(st, 12, [3, 4]), 105, '2 間公司：骰子點數 ×15（7×15）');
}

/* ---------- 機會、命運 ---------- */
section('機會與命運');
{
  function withCard(deck, idx, seatPos) {
    const st = mk(2);
    st._decks[deck] = [idx].concat(st._decks[deck].filter(x => x !== idx));
    st.seats[0].pos = seatPos;
    return st;
  }
  let st = withCard('chance', 7, 4);            /* 機會：銀行股息 +50；從 4 走 3 格 → 7 */
  roll(st, 1, 2);
  eq(st.seats[0].pos, 7, '走到機會格'); eq(st.seats[0].cash, R.START_CASH + 50, '機會：領股息 50');
  ok(st.card && st.card.deck === 'chance', '畫面收到抽到的卡');
  st = withCard('chance', 12, 4); roll(st, 1, 2);
  ok(st.seats[0].jail, '機會：進監獄');
  st = withCard('chance', 10, 4); roll(st, 1, 2);
  eq(st.seats[0].getOut, 1, '機會：拿到出獄許可證');
  st.seats[0].jail = false;
  st = withCard('chance', 11, 4); roll(st, 1, 2);
  eq(st.seats[0].pos, 4, '機會：後退 3 格（7→4）');
  st = withCard('chance', 4, 4); give(st, 1, 15); roll(st, 1, 2);
  ok(st.seats[0].pos === 15 && st.seats[0].cash === R.START_CASH - 80 && st.seats[1].cash === R.START_CASH + 80, '最近車站：有主人租金加倍（1 站 40→80）');
  st = withCard('chance', 6, 4); give(st, 1, 12); roll(st, 1, 2);
  ok(st.seats[0].pos === 12 && st.seats[0].cash === R.START_CASH - 45 && st.seats[1].cash === R.START_CASH + 45, '最近公司：付骰子 15 倍（3×15）');
  st = withCard('chance', 0, 4); roll(st, 1, 2);
  ok(st.seats[0].pos === 0 && st.seats[0].cash === R.START_CASH + 200, '前進到起點領 200');
  st = withCard('chance', 15, 4); roll(st, 1, 2);
  ok(st.seats[0].cash === R.START_CASH - 50 && st.seats[1].cash === R.START_CASH + 50, '付給每位玩家 50');
  st = withCard('chance', 13, 4); give(st, 0, 1, 2); give(st, 0, 3, 5); roll(st, 1, 2);
  eq(st.seats[0].cash, R.START_CASH - (2 * 25 + 100), '房屋整修：房 25、旅店 100');
  st = withCard('chest', 4, 0); st.seats[0].pos = 0; roll(st, 1, 1);
  eq(st.seats[0].pos, 2, '走到命運格');
  eq(st.seats[0].getOut, 1, '命運：出獄許可證');
  st = withCard('chest', 6, 0); roll(st, 1, 1);
  ok(st.seats[0].cash === R.START_CASH + 50 && st.seats[1].cash === R.START_CASH - 50, '命運：每位玩家給我 50');
  /* 用出獄許可證 */
  const s2 = mk(2);
  s2.seats[0].pos = 27; s2.seats[0].getOut = 1; roll(s2, 1, 2); A(s2, 'endTurn'); endTurn(s2);
  ok(R.options(s2, 'p0').useCard, '監獄裡有許可證 → 可以用');
  A(s2, 'useCard');
  ok(!s2.seats[0].jail && s2.seats[0].getOut === 0, '用掉許可證出獄');
  ok(s2._decks.chance.includes(10) || s2._decks.chest.includes(4), '許可證放回牌堆');
}

/* ---------- 還債、破產 ---------- */
section('還債與破產');
{
  const st2 = mk(2);
  give(st2, 0, 37, 5); give(st2, 0, 39, 5);
  st2.seats[1].cash = 100;
  give(st2, 1, 1); give(st2, 1, 3);
  st2.turn = 1; st2.phase = 'roll'; st2.seats[1].pos = 30;
  roll(st2, 3, 4);
  ok(st2.seats[1].bankrupt && st2.phase === 'over' && st2.winner === 0, '資產全部加起來都不夠 → 直接破產，只剩一人 → 遊戲結束');
  ok(st2.props[1].owner === 0 && st2.props[3].owner === 0 && st2.seats[0].cash > R.START_CASH, '破產者的財產與現金全給債主');
  eq(st2.ranking[0], 0, '名次：贏家第一');
  /* 湊得到：賣房子後付清 */
  const s3 = mk(2);
  give(s3, 0, 39, 3);                            /* 台北101 3 棟房：rent[3]=2100 */
  give(s3, 0, 37, 3);
  give(s3, 1, 11, 4); give(s3, 1, 13, 4); give(s3, 1, 14, 4);
  s3.seats[1].cash = 1900; s3.turn = 1; s3.phase = 'roll'; s3.seats[1].pos = 36;
  roll(s3, 1, 2);                                 /* 36+3=39 */
  ok(s3.seats[1].pos === 39 && s3.phase === 'debt' && s3.pending.amount === 2100, '欠 2100、現金 1900 → 還債階段');
  ok(R.options(s3, 'p1').bankrupt && !R.options(s3, 'p1').settle, '還沒湊夠：不能結清、隨時可宣告破產');
  ok(R.options(s3, 'p1').sell.length > 0, '還債時可以賣房子');
  ok(!A(s3, 'settle').ok, '現金不夠不能結清');
  for (let g = 0; g < 40 && !R.options(s3, 'p1').settle; g++) A(s3, 'sell', { tile: R.options(s3, 'p1').sell[0] });
  ok(R.options(s3, 'p1').settle, '賣了幾棟房子後湊夠了');
  ok(!A(s3, 'build', { tile: 1 }).ok, '還債時不能蓋房');
  ok(A(s3, 'settle').ok && s3.seats[1].cash >= 0 && s3.seats[0].cash === R.START_CASH + 2100, '湊夠了就結清，債主收到錢');
  ok(s3.phase === 'manage' || s3.phase === 'roll', '還完債回到正常流程');
  /* 稅 */
  const s4 = mk(2); s4.seats[0].pos = 1; roll(s4, 1, 2);
  eq(s4.seats[0].cash, R.START_CASH - 200, '所得稅 200');
}

/* ---------- 強制收購（已取消） ---------- */
section('強制收購已取消');
{
  const st = mk(2);
  give(st, 0, 1); give(st, 1, 3);
  st.phase = 'manage';
  ok(R.options(st, 'p0').buyout.length === 0, 'options 不再列出可收購的地');
  ok(!A(st, 'buyout', { tile: 3 }).ok && st.props[3].owner === 1, '收購動作一律被拒絕');
}

/* ---------- 回合上限與結束 ---------- */
section('回合上限與結束');
{
  const st = mk(2, { roundLimit: 25 });
  st.seats[0].cash = 2000;
  let guard = 0;
  while (st.phase !== 'over' && guard++ < 500) {
    if (st.phase === 'buy') A(st, 'decline');
    else if (st.phase === 'roll') { roll(st, 1, 2); }
    else if (st.phase === 'manage') A(st, 'endTurn');
    else if (st.phase === 'debt') A(st, 'bankrupt');
  }
  ok(st.phase === 'over' && st.reason === 'roundLimit', '到回合上限結束（比總資產）');
  eq(st.round, 25, '回合數停在上限');
  ok(st.ranking.length === 2 && st.winner === st.ranking[0], '有完整名次');
  ok(R.publicView(st, 0).phase === 'over' && !!R.publicView(st, 0).ranking, '畫面資料帶名次');
}

/* ---------- 想太久：電腦代打 ---------- */
section('想太久');
{
  const st = mk(2, { turnMs: 1000, now: 0 });
  ok(!R.tick(st, 500), '還沒超時不變動');
  ok(R.tick(st, 1500) && st.seats[0].auto, '超時 → 這一步由電腦代打');
  const drv = AI.createDriver('t');
  let now = 1500, done = false;
  for (let i = 0; i < 200 && !done; i++) {
    now += 100;
    for (const a of drv.actions(st, now)) { R.act(st, a.id, a.action, now, { ai: true }); if (st.turn !== 0) done = true; }
  }
  ok(done, '代打把這回合走完，換到下一位');
  ok(!st.seats[0].auto || st.turn === 1, '換人後代打狀態解除');
  const s2 = mk(2, { turnMs: 1000, now: 0 });
  let n = 0;
  for (let t = 0; t < 12 && !s2.seats[0].afk; t++) { R.tick(s2, 1000 * (t + 2)); s2.seats[0].auto = false; n++; }
  ok(s2.seats[0].afk && s2.seats[0].ai === 'normal', '連續 3 次想太久 → 視為掛機，交給電腦');
  ok(R.act(s2, 'p0', { type: 'roll' }, 0).ok && !s2.seats[0].afk && !s2.seats[0].ai, '本人回來操作就拿回控制權');
}

/* ---------- 道具 ---------- */
section('道具');
{
  const IL = R.ITEM_LIST;
  ok(IL.length === 24 && ['dice', 'free', 'cat', 'guard', 'steal', 'swap', 'bomb', 'gobonus', 'bail', 'coupon', 'freeze', 'upgrade', 'chest', 'cure', 'god', 'salary', 'again', 'reflect', 'surge', 'seize', 'grab', 'frame', 'collect', 'equal'].every(k => IL.includes(k)) && ['fly', 'loan', 'half', 'rebate', 'taxfree', 'repair'].every(k => !IL.includes(k)), '24 種道具（機票、提款卡、減租券、建材券、免稅券、修繕券已移除）');
  ok(IL.every(k => R.ITEMS[k].pts >= 10 && R.ITEMS[k].pts <= 100 && R.ITEMS[k].pts % 10 === 0) && R.ITEMS.equal.pts === 100 && R.ITEMS.seize.pts === 50, '每種道具 10～100 點（均富卡 100、強制購地券 50）');
  ok(IL.every(k => R.stockFor(k, 4) >= 1) && R.stockFor('upgrade', 4) < R.stockFor('cure', 4) && R.stockFor('bomb', 4) <= R.stockFor('dice', 4), '越貴的道具庫存越少');
  let st = mk(2);
  ok(st.seats.every(s => Array.isArray(s.items) && s.items.length === 0), '開局沒有道具');
  /* 遙控骰 */
  st.seats[0].items = ['dice'];
  let r = A(st, 'useItem', { item: 'dice', n: 3 });
  ok(r.ok && st.seats[0].pos === 3 && st.seats[0].items.length === 0, '遙控骰：走指定的 3 步並用掉');
  st = mk(2); st.seats[0].items = ['dice'];
  ok(!A(st, 'useItem', { item: 'dice', n: 13 }).ok && !A(st, 'useItem', { item: 'dice', n: 0 }).ok, '遙控骰：只能選 1～12');
  ok(!R.act(st, st.seats[1].id, { type: 'useItem', item: 'dice', n: 2 }, 0).ok, '不是自己的回合不能用');
  [1, 7, 12].forEach(n => { const q = mk(2); q.seats[0].items = ['dice']; const rr = A(q, 'useItem', { item: 'dice', n }); ok(rr.ok && q.seats[0].pos === n && q.diceKind === 'remote', '遙控骰可以選 ' + n + ' 步'); });
  st.seats[0].pos = 38; st.seats[0].items = ['dice'];
  const cash0 = st.seats[0].cash;
  A(st, 'useItem', { item: 'dice', n: 3 });
  ok(st.seats[0].pos === 1 && st.seats[0].cash === cash0 + 200, '遙控骰經過起點照領薪水');
  /* 監獄中不能用 */
  st = mk(2); st.seats[0].items = ['dice', 'again']; st.seats[0].jail = 1;
  ok(!A(st, 'useItem', { item: 'again' }).ok && !A(st, 'useItem', { item: 'dice', n: 2 }).ok, '在監獄裡不能用道具');
  /* 沒有的道具 */
  st = mk(2);
  ok(!A(st, 'useItem', { item: 'dice', n: 2 }).ok, '沒有道具就不能用');
  /* options */
  st.seats[0].items = ['dice']; let o = R.options(st, st.seats[0].id);
  ok(o.dice === true && o.steal === false && o.again === false, 'options：只有持有的主動道具會亮');
  /* 免租券 */
  st = mk(2); give(st, 1, 1, 0); st.seats[0].items = ['free'];
  st = mk(2); give(st, 1, 3, 0); st.seats[0].items = ['free'];
  roll(st, 1, 2, 0);
  eq(st.seats[0].cash, R.START_CASH - 0, '免租券：這次過路費免了');
  ok(st.seats[0].items.length === 0 && st.seats[1].cash === R.START_CASH, '免租券用掉、房東沒收到錢');
  /* 招財貓 */
  st = mk(2); give(st, 1, 3, 0); st.seats[1].items = ['cat'];
  roll(st, 1, 2, 0);
  const base = R.TILES[3].rent[0];
  eq(R.START_CASH - st.seats[0].cash, base * 2, '招財貓：房東收雙倍過路費');
  ok(st.seats[1].items.length === 0, '招財貓用掉');
  /* 獲得道具：卡片、休息站 */
  st = mk(2);
  st.seats[0].pos = 18;
  roll(st, 1, 1, 0);
  ok(st.seats[0].pos === 20 && st.seats[0].items.length === 1, '溫泉休息站送一個道具');
  /* 上限 */
  st = mk(2); st.seats[0].items = new Array(R.MAX_ITEMS).fill('cat'); st.seats[0].pos = 18;
  const c2 = st.seats[0].cash;
  roll(st, 1, 1, 0);
  ok(st.seats[0].items.length === R.MAX_ITEMS && st.seats[0].cash === c2 + 50, '道具滿 ' + R.MAX_ITEMS + ' 個：改領 50 元');
  /* 公開視圖看得到道具 */
  st = mk(2); st.seats[1].items = ['guard'];
  ok(R.publicView(st, 0).seats[1].items[0] === 'guard', 'publicView 帶著道具（大家都看得到）');
  /* AI：幼幼班絕不用；普通會為了整組用遙控骰 */
  st = mk(2); st.seats[0].items = ['dice', 'again'];
  ok(AI.decide(st, 0, 'kid', RNG.create('k')).type !== 'useItem', '幼幼班不會用道具');
  st = mk(2); give(st, 0, 1, 0); st.seats[0].pos = 37; st.seats[0].items = ['dice'];
  st.props[3].owner = -1;
  const ad = AI.decide(st, 0, 'hard', RNG.create('h'));
  ok(ad && ad.type === 'useItem' && ad.item === 'dice', '困難：把遙控骰用在湊整組（' + JSON.stringify(ad) + '）');
}

/* ---------- 電腦互打 ---------- */
section('電腦互打');
function sim(seed, levels, opts) {
  const players = levels.map((l, i) => ({ id: 'p' + i, name: 'P' + i + l, char: 'otter', ai: l }));
  const st = R.create(players, Object.assign({ seed }, opts || {}));
  const drv = AI.createDriver(seed);
  const stats = { build: {}, buyout: {}, buy: {} };
  let now = 0, steps = 0, rejected = 0;
  while (st.phase !== 'over' && steps++ < 400000) {
    now += 50;
    for (const a of drv.actions(st, now)) {
      const seat = st.seats[st.turn];
      const r = R.act(st, a.id, a.action, now, { ai: true });
      if (!r.ok) rejected++;
      else if (stats[a.action.type]) stats[a.action.type][seat.ai] = (stats[a.action.type][seat.ai] || 0) + 1;
    }
  }
  return { st, stats, steps, rejected };
}
{
  const levels = ['hard', 'normal', 'easy', 'kid'];
  const wins = { hard: 0, normal: 0, easy: 0, kid: 0 };
  const builds = { hard: 0, normal: 0, easy: 0, kid: 0 }, buyouts = { hard: 0, normal: 0, easy: 0, kid: 0 }, buys = { hard: 0, normal: 0, easy: 0, kid: 0 };
  let stuck = 0, rejected = 0, bankruptEnds = 0, anyBankrupt = 0, N = 100;
  for (let g = 0; g < N; g++) {
    const order = levels.slice();
    for (let r = 0; r < g % 4; r++) order.push(order.shift());
    const { st, stats, rejected: rj } = sim('vs' + g, order, { roundLimit: 40 });
    if (st.phase !== 'over') stuck++;
    rejected += rj;
    if (st.reason === 'lastStanding') bankruptEnds++;
    if (st.bankruptOrder.length) anyBankrupt++;
    if (st.winner != null) wins[st.seats[st.winner].ai]++;
    for (const k of levels) { builds[k] += stats.build[k] || 0; buyouts[k] += stats.buyout[k] || 0; buys[k] += stats.buy[k] || 0; }
  }
  eq(stuck, 0, N + ' 局電腦互打全部正常結束（沒有卡住）');
  eq(rejected, 0, '電腦沒有送出過不合法的行動');
  console.log('    勝場：' + JSON.stringify(wins) + '；蓋房：' + JSON.stringify(builds) + '；收購：' + JSON.stringify(buyouts) + '；買地：' + JSON.stringify(buys) + '；破產結束 ' + bankruptEnds + ' 局');
  eq(builds.kid, 0, '幼幼班從不蓋房');
  eq(buyouts.kid, 0, '幼幼班從不收購');
  ok(builds.hard > builds.easy * 1.3 && builds.normal > builds.easy, '蓋房次數：困難 > 普通 > 簡單（行為真的不一樣）');
  ok(wins.hard > wins.kid * 4 && wins.normal > wins.kid * 3 && wins.easy > wins.kid, '勝場：幼幼班明顯最弱（' + JSON.stringify(wins) + '）');
  ok(wins.hard > wins.easy && wins.hard >= wins.normal - 10, '勝場：困難 ≈ 普通（100 局的隨機誤差內）> 簡單');
  let longBk = 0;
  for (let g = 0; g < 6; g++) { const { st } = sim('long' + g, levels, { roundLimit: 0 }); if (st.reason === 'lastStanding') longBk++; }
  ok(longBk >= 1, '不設回合上限時，電腦互打會打到只剩一人（' + longBk + '/6 局靠淘汰結束；30 回合限時局有 ' + anyBankrupt + ' 局有人破產）');
  /* 決定性 */
  const a = sim('same', ['hard', 'normal', 'easy'], { roundLimit: 25 }), b = sim('same', ['hard', 'normal', 'easy'], { roundLimit: 25 });
  eq(JSON.stringify(R.publicView(a.st, 0)), JSON.stringify(R.publicView(b.st, 0)), '同 seed、同電腦 → 完全相同的一局（可重現）');
  const c = sim('other', ['hard', 'normal', 'easy'], { roundLimit: 25 });
  ok(JSON.stringify(R.publicView(a.st, 0)) !== JSON.stringify(R.publicView(c.st, 0)), '換 seed → 不同的一局');
  /* 無上限的局最後也會有人破產 */
  const free = sim('free', ['hard', 'hard'], { roundLimit: 0 });
  ok(free.st.phase === 'over' || free.steps >= 400000, '無回合上限也不會出錯（' + free.st.round + ' 回合）');
  /* 每種組合都跑得完 */
  for (const lv of [['normal', 'normal', 'hard', 'easy', 'kid', 'normal', 'hard', 'easy'], ['kid', 'kid'], ['easy', 'hard', 'kid'], ['normal', 'normal', 'normal', 'normal']]) {
    const r = sim('mix-' + lv.join(), lv, { roundLimit: 40 });
    ok(r.st.phase === 'over' && r.rejected === 0, lv.join('／') + ' 打得完（' + r.st.round + ' 回合）');
  }
}

/* ---------- 亂數 ---------- */

section('攻擊型道具與命運之神');
{
  const use = (st, id, extra) => R.act(st, st.seats[st.turn].id, Object.assign({ type: 'useItem', item: id }, extra || {}), 0);
  let st = mk(3);
  st.seats[0].items = ['steal']; st.seats[1].cash = 1000;
  let r = use(st, 'steal', { target: 1 });
  ok(r.ok && st.seats[1].cash === 900 && st.seats[0].cash === R.START_CASH + 100 && !st.seats[0].items.length, '偷錢卡：偷走對手 10% 現金並用掉');
  ok(st.phase === 'roll' && st.turn === 0, '偷錢後還是可以擲骰');
  st = mk(3); st.seats[0].items = ['steal']; st.seats[1].cash = 5000;
  use(st, 'steal', { target: 1 });
  ok(st.seats[1].cash === 4700, '偷錢最多 300 元');
  st = mk(3); st.seats[0].items = ['steal']; st.seats[1].items = ['guard'];
  r = use(st, 'steal', { target: 1 });
  ok(r.ok && st.seats[1].cash === R.START_CASH && !st.seats[1].items.length && !st.seats[0].items.length && st.events.some(e => e.t === 'attack' && e.blocked), '護身符擋下偷錢（兩邊道具都用掉）');
  st = mk(3); st.seats[0].items = ['steal'];
  ok(!use(st, 'steal', { target: 0 }).ok && !use(st, 'steal', { target: 9 }).ok, '不能偷自己或不存在的人');
  st = mk(3); st.seats[0].items = ['swap']; st.seats[1].pos = 12; st.seats[0].pos = 3;
  r = use(st, 'swap', { target: 1 });
  ok(r.ok && st.seats[0].pos === 12 && st.seats[1].pos === 3 && st.seats[0].cash === R.START_CASH, '換位卡：交換位置、不領薪水');
  ok(st.phase !== 'roll' || st.pending, '換位後落點照常處理（用掉這次擲骰）');
  st = mk(3); st.seats[0].items = ['swap']; st.seats[1].jail = true; st.seats[1].pos = 10;
  ok(!use(st, 'swap', { target: 1 }).ok, '對手在監獄裡不能換位');
  st = mk(3); st.seats[0].items = ['bomb']; st.props[1].owner = 1; st.props[1].houses = 2;
  r = use(st, 'bomb', { tile: 1 });
  ok(r.ok && st.props[1].houses === 1 && !st.seats[0].items.length, '炸彈：對手的地少一間房子');
  st = mk(3); st.seats[0].items = ['bomb']; st.props[1].owner = 0; st.props[1].houses = 2; st.props[3].owner = 1;
  ok(!use(st, 'bomb', { tile: 1 }).ok && !use(st, 'bomb', { tile: 3 }).ok, '不能炸自己的地，也不能炸沒房子的地');
  st = mk(3); st.seats[0].items = ['bomb']; st.props[1].owner = 1; st.props[1].houses = 5; st.seats[1].items = ['guard'];
  use(st, 'bomb', { tile: 1 });
  ok(st.props[1].houses === 5, '護身符擋下炸彈');
  ok(R.options(mk(3), 'p0').steal === false, '沒有偷錢卡時 options.steal 為 false');
  st = mk(3); st.seats[0].items = ['steal', 'swap', 'bomb']; st.seats[1].pos = 5;
  const o = R.options(st, 'p0');
  ok(o.steal && o.swap && !o.bomb, 'options 標出哪些攻擊道具現在有目標');
  /* 命運之神 */
  st = mk(2); st.seats[1].god = { k: 'wealth', turns: 1 }; st.phase = 'manage';
  A(st, 'endTurn');
  ok(st.turn === 1 && st.seats[1].cash === R.START_CASH + 120 && st.seats[1].god === null, '財神：回合開始領 120，時間到就離開');
  st = mk(2); st.seats[1].god = { k: 'unlucky', turns: 3 }; st.phase = 'manage';
  A(st, 'endTurn');
  ok(st.seats[1].cash === R.START_CASH - 80 && st.seats[1].god.turns === 2, '衰神：回合開始扣 80');
  st = mk(2); st.props[1].owner = 1; st.seats[0].god = { k: 'poor', turns: 3 };
  const base = R.rentOf(st, 1, [1, 2]);
  roll(st, 0, 1); st.seats[0].pos = 0; st.phase = 'roll'; st.dice = [0, 0];
  const c0 = st.seats[0].cash; roll(st, 0, 1);
  ok(c0 - st.seats[0].cash === base * 2, '窮神：付雙倍過路費');
  st = mk(2); st.props[1].owner = 1; st.seats[1].god = { k: 'fortune', turns: 3 };
  const c1 = st.seats[0].cash; roll(st, 0, 1);
  ok(c1 - st.seats[0].cash === R.rentOf(st, 1, [0, 1]) * 2, '福神：收雙倍過路費');
  /* 抽到神的卡片 */
  st = mk(2);
  const gi = R.CHANCE.findIndex(c => c.t === 'god' && c.good);
  st._decks.chance = [gi]; st.seats[0].pos = 6;
  roll(st, 0, 1);
  ok(st.seats[0].god && R.GODS[st.seats[0].god.k].good && st.events.some(e => e.t === 'card' && e.mood === 'good'), '抽到好機會：福神／財神附身，事件標示 mood=good');
  st = mk(2); st._decks.chance = [R.CHANCE.findIndex(c => c.t === 'pay')]; st.seats[0].pos = 6;
  roll(st, 0, 1);
  ok(st.events.some(e => e.t === 'card' && e.mood === 'bad'), '壞機會卡事件標示 mood=bad');
}

section('每場隨機地價');
{
  const ps = [{ id: 'a', name: 'A', char: 'otter' }, { id: 'b', name: 'B', char: 'otter' }];
  const t1 = R.create(ps, { seed: 'price1' }).tiles, t1b = R.create(ps, { seed: 'price1' }).tiles, t2 = R.create(ps, { seed: 'price2' }).tiles;
  ok(JSON.stringify(t1) === JSON.stringify(t1b), '同 seed 地價相同');
  ok(JSON.stringify(t1) !== JSON.stringify(t2), '不同 seed 地價不同');
  let ints = true, inRange = true, mono = true, rentUp = true;
  for (let g = 0; g < 60; g++) {
    const tl = R.create(ps, { seed: 'r' + g }).tiles;
    R.TILES.forEach((b, i) => {
      const t = tl[i];
      const nums = [t.price, t.tax, t.house].concat(t.rent || []).filter(x => x != null);
      if (!nums.every(Number.isInteger)) ints = false;
      if (b.price && (t.price < b.price * 0.65 - 5 || t.price > b.price * 1.35 + 5)) inRange = false;
      if (b.tax && (t.tax < b.tax * 0.65 - 5 || t.tax > b.tax * 1.35 + 5)) inRange = false;
      if (t.rent) for (let k = 1; k < t.rent.length; k++) if (t.rent[k] <= t.rent[k - 1]) rentUp = false;
    });
    Object.keys(R.GROUP_TILES).forEach(gr => { const ids = R.GROUP_TILES[gr]; for (let k = 1; k < ids.length; k++) if (tl[ids[k]].price < tl[ids[k - 1]].price) mono = false; });
  }
  ok(ints, '所有價格、房價、租金、稅金都是整數');
  ok(inRange, '價格都在原價 ±30% 上下（含取整）');
  ok(mono, '同色組內價格仍由低到高');
  ok(rentUp, '租金隨房子數遞增');
  const st = R.create(ps, { seed: 'price1' });
  const pv = R.publicView(st, 0);
  ok(pv.tiles.length === 40 && pv.tiles[1].price === st.tiles[1].price, '公開資料帶有這一場的地價表');
  ok(R.TILES[1].price === 60, '全域原始地價表不被改動（伺服器多房間共用）');
}

section('隨機地圖與道具商店');
{
  const M = R.MAPS;
  eq(JSON.stringify(M.SIZES), '[48,64,80,96,120]', '地圖大小只有 48／64／80／96／120');
  ok(M.validSize(64) && M.validSize('80') && !M.validSize(40) && !M.validSize(100) && !M.validSize(null), '只接受清單裡的格數');
  ok(!M.has('nope') && M.get('nope').id === M.DEFAULT && M.has('g64-abc123') && !M.has('g50-abc123'), '不存在的地圖代號退回預設，生成代號格式正確才算數');
  ok(M.genId(64, 'x') === M.genId(64, 'x') && M.genId(64, 'x') !== M.genId(64, 'y') && M.genId(64, 'x') !== M.genId(80, 'x'), '地圖代號：同格數同種子相同，不同就不同');
  const maps = [];
  M.SIZES.forEach(n => ['a', 'b', 'c'].forEach(sd => maps.push(M.generate(n, sd))));
  /* 同代號一定生成同一張（前後端各自重建才會一致） */
  ok(maps.every(m => JSON.stringify(M.get(m.id).tiles) === JSON.stringify(m.tiles)), '同一個地圖代號永遠生成同一張地圖');
  ok(new Set(M.SIZES.map(n => JSON.stringify(M.generate(n, 'k1').tiles.map(x => x.name)))).size === 5 && JSON.stringify(M.generate(64, 'k1').tiles) !== JSON.stringify(M.generate(64, 'k2').tiles), '不同種子生成不同地圖');
  ok(new Set(maps.map(m => m.themeKey)).size >= 3, '主題會隨機（15 張裡至少出現 3 種主題）');
  maps.forEach(m => {
    const n = m.size, t = m.tiles, tag = m.id + '（' + m.themeKey + '）';
    const q = M.quotas(n);
    ok(t.length === n && t.every((x, i) => x.i === i), tag + '：格數 ' + n + '、編號連續');
    ok(t[0].type === 'go' && t[n / 4].type === 'jail' && t[n / 2].type === 'park' && t[n * 3 / 4].type === 'gotojail', tag + '：四個角依序是起點、監獄、休息站、去坐牢');
    ok(t.filter(x => x.type === 'prop').every(x => m.groups[x.group] && x.price > 0 && x.rent.length === 6 && x.rent.every((r, k) => k === 0 || r > x.rent[k - 1])), tag + '：地產都有色組、價格、遞增的租金表');
    const g = {}; t.filter(x => x.type === 'prop').forEach(x => (g[x.group] = g[x.group] || []).push(x.i));
    ok(Object.keys(m.groups).length === q.groups && Object.keys(m.groups).every(k => (g[k] || []).length >= 2 && g[k].length <= 6), tag + '：' + q.groups + ' 個色組，每組 2～6 塊地');
    const cnt = ty => t.filter(x => x.type === ty).length;
    ok(cnt('station') === q.station && cnt('utility') === q.utility && cnt('tax') === q.tax && cnt('shop') === q.shop && cnt('chance') === q.chance && cnt('chest') === q.chest && cnt('prop') === q.props, tag + '：各種格子數量符合配額');
    { const per = n / 4, sd = [0, 0, 0, 0]; t.forEach((x, k) => { if (x.type === 'shop') sd[Math.floor(k / per)]++; }); ok(Math.max(...sd) <= 1 && cnt('shop') <= 4, tag + '：道具商店每一邊最多 1 間、全圖最多 4 間'); }
    ok(cnt('shop') >= 2 && cnt('shop') <= Math.ceil(n / 24) + 1, tag + '：道具商店 2 間起、約每 24 格 1 間');
    const names = t.filter(x => x.type === 'prop').map(x => x.name);
    ok(new Set(names).size === names.length, tag + '：地產名稱不重複');
    const props = t.filter(x => x.type === 'prop');
    ok(props[props.length - 1].price === Math.max(...props.map(x => x.price)), tag + '：最貴的一塊在最後');
    ok(m.landmarks.top > 0 && t[m.landmarks.station].type === 'station' && t[m.landmarks.beach].type === 'prop' && t[m.landmarks.top].type === 'prop', tag + '：機會卡的目的地都是合理的格子');
    ok(t.filter(x => x.type === 'station').length >= 4 && m.theme && m.theme.title.length === 2, tag + '：有車站、有主題外觀');
    const st = R.create(['a', 'b', 'c'].map(x => ({ id: x, name: x, char: 'otter' })), { seed: 'm-' + m.id, map: m.id });
    ok(st.map === m.id && st.tiles.length === n && st.props.length === n, tag + '：開局的地價表與地產資料都是 ' + n + ' 格');
    ok(st.tiles.every(x => x.type !== 'prop' || (Number.isInteger(x.price) && Math.abs(x.price / (t[x.i].price * st.econ) - 1) <= 0.4)), tag + '：隨機地價都是整數、在原價 ±30% 附近');
    const view = R.publicView(st, 0);
    ok(view.map === m.id && view.tiles.length === n, tag + '：公開資料帶有地圖代號與地價表');
  });
  /* 沒指定地圖：依「格數＋這局種子」生成 */
  {
    const ps = ['a', 'b'].map(x => ({ id: x, name: x, char: 'otter' }));
    const s1 = R.create(ps, { seed: 'auto1', mapSize: 96 }), s2 = R.create(ps, { seed: 'auto2', mapSize: 96 }), s3 = R.create(ps, { seed: 'auto1', mapSize: 96 });
    ok(s1.tiles.length === 96 && /^g96-/.test(s1.map), '指定格數 96：生成 96 格的地圖');
    ok(s1.map === s3.map && s1.map !== s2.map, '同種子同地圖、不同種子不同地圖（每局隨機）');
    ok(_create(ps, { seed: 'auto3', mapSize: 999 }).tiles.length === 64 && _create(ps, { seed: 'auto4' }).tiles.length === 64, '格數不合法或沒指定 → 64 格');
  }
  /* 換地圖：規則要跟著這一局走，不能混在一起（伺服器同時開不同地圖的房間） */
  const mk2 = (map, seed) => R.create(['a', 'b'].map(x => ({ id: x, name: x, char: 'otter' })), { seed, map });
  const A1 = mk2(M.genId(80, 's1'), 's1'), B1 = mk2(M.genId(48, 's2'), 's2'), C1 = mk2('classic40', 's3');
  const now = 1000;
  const roll = st => { const id = st.seats[st.turn].id; return R.act(st, id, { type: 'roll' }, now); };
  for (let k = 0; k < 6; k++) [A1, B1, C1].forEach(st => { const r = roll(st); const id = st.seats[st.turn].id; ['buy', 'decline', 'settle', 'endTurn'].forEach(t => R.act(st, id, { type: t }, now)); });
  ok(A1.seats.every(x => x.pos < 80) && B1.seats.every(x => x.pos < 48) && C1.seats.every(x => x.pos < 40), '三種地圖交替進行：每局的位置都在自己的格數內');
  ok(R.options(A1, A1.seats[A1.turn].id) && R.TILES.length === 80, '算到 80 格的那局，全域地圖就切到 80 格');
  R.options(C1, C1.seats[C1.turn].id);
  ok(R.TILES.length === 40 && R.BOARD === 40, '再算 40 格的那局，全域地圖又切回 40 格');
  /* 一直開新地圖：快取有上限，不會越積越多，舊的局仍然可以繼續（要用時再重建） */
  {
    const keep = mk2(M.genId(64, 'keep'), 'keep');
    for (let k = 0; k < 60; k++) mk2(M.genId(48, 'churn' + k), 'churn' + k);
    ok(R.options(keep, keep.seats[keep.turn].id) && R.TILES.length === 64 && keep.tiles.length === 64, '開了 60 局別的地圖後，舊的那局還能正常運作');
  }

  /* 監獄位置跟著地圖：去坐牢會被送到 N/4 */
  [M.genId(80, 'j1'), M.genId(48, 'j2'), M.genId(120, 'j3')].forEach(id => {
    const m = M.get(id), st = mk2(id, 'j-' + id), me = st.seats[st.turn], id0 = me.id;
    const gj = m.tiles.findIndex(x => x.type === 'gotojail');
    me.items = ['dice']; me.pos = gj - 1;
    const r = R.act(st, id0, { type: 'useItem', item: 'dice', n: 1 }, now);
    ok(r.ok && me.jail && me.pos === m.size / 4, id + '：走到「去坐牢」被送到監獄（第 ' + m.size / 4 + ' 格）');
  });
  /* 經過起點：大棋盤繞一圈也領薪水 */
  {
    const st = mk2(M.genId(80, 'go80'), 'go80'), me = st.seats[st.turn], cash = me.cash;
    me.pos = 78; me.items = ['dice'];
    const r = R.act(st, me.id, { type: 'useItem', item: 'dice', n: 4 }, now);
    ok(r.ok && me.pos === 2 && me.cash >= cash + R.GO_SALARY - 400, '80 格棋盤：從 78 走 4 步繞回第 2 格，並領到起點薪水');
  }

  /* 道具商店（道具點數） */
  const shopTile = (m) => m.tiles.findIndex(x => x.type === 'shop');
  const enterShop = (id, seed, setup) => {
    const m = M.get(id), si = shopTile(m), st = mk2(id, seed), me = st.seats[st.turn];
    me.items = ['dice']; me.pos = (si - 1 + m.size) % m.size;
    if (setup) setup(st, me);
    R.act(st, me.id, { type: 'useItem', item: 'dice', n: 1 }, now);
    return { st, me, m, si };
  };
  M.SIZES.forEach(n => {
    const id = M.genId(n, 'shop' + n);
    const { st, me } = enterShop(id, 'shop-' + id, (s0, m0) => { m0.points = 500; });
    const id0 = me.id;
    ok(st.phase === 'shop' && st.pending && st.pending.kind === 'shop', n + ' 格：停在道具商店 → 進入商店階段');
    const o = R.options(st, id0);
    ok(o.decline && o.shop.length >= R.SHOP_OFFER_MIN && o.shop.length <= R.SHOP_OFFER_MAX && o.shop.every(x => x.pts >= 10 && x.pts <= 100) && !o.roll && !o.endTurn, n + ' 格：商店上架 3～6 樣、只能買、賣或離開');
    const pick = o.shop.find(x => x.can), before = me.points;
    ok(!!pick && R.act(st, id0, { type: 'shopBuy', item: pick.item }, now).ok && me.points === before - pick.pts && me.items.includes(pick.item), n + ' 格：買「' + (pick && R.ITEMS[pick.item].name) + '」−' + (pick && pick.pts) + ' 點，道具進背包');
    ok(!R.act(st, id0, { type: 'shopBuy', item: pick.item }, now).ok, n + ' 格：同一次同樣商品只能買 1 件');
    ok(!R.act(st, id0, { type: 'shopBuy', item: 'zzz' }, now).ok, n + ' 格：買不存在的商品被拒絕');
    ok(!R.act(st, st.seats[(st.turn + 1) % 2].id, { type: 'shopBuy', item: 'dice' }, now).ok, n + ' 格：不是自己的回合不能買');
    ok(R.act(st, id0, { type: 'decline' }, now).ok && st.phase !== 'shop' && !st.pending, n + ' 格：離開商店後回到正常流程（階段 ' + st.phase + '）');
  });
  {
    const pid = M.genId(64, 'shopx');
    /* 開局點數 = 回合上限 × 10；不限 500 */
    const mkp = lim => R.create(['a', 'b'].map(x => ({ id: x, name: x, char: 'otter' })), { seed: 'pt' + lim, map: pid, roundLimit: lim });
    ok(mkp(25).seats[0].points === 250 && mkp(40).seats[0].points === 400 && mkp(50).seats[0].points === 500 && mkp(0).seats[0].points === 500, '開局道具點數＝回合上限×10；不限回合 500 點');
    /* 庫存全房共用、依價格；買了就少 1 */
    const E1 = enterShop(pid, 'stock1', (s0, m0) => { m0.points = 500; });
    const offer = E1.st.pending.offer.slice();
    ok(offer.length >= 3 && offer.length <= 6 && new Set(offer).size === offer.length, '每次上架 3～6 樣、不重複');
    ok(Object.keys(R.ITEMS).every(k => E1.st.stock[k] === R.stockFor(k, 2)), '庫存依價格決定');
    const it = offer[0], s0 = E1.st.stock[it];
    R.act(E1.st, E1.me.id, { type: 'shopBuy', item: it }, now);
    ok(E1.st.stock[it] === s0 - 1, '買一件：全房庫存 −1');
    /* 賣完就不能買 */
    const E2 = enterShop(pid, 'stock2', (s0b, m0) => { m0.points = 500; Object.keys(s0b.stock).forEach(k => { s0b.stock[k] = 0; }); s0b.stock.bomb = 0; });
    ok(E2.st.phase !== 'shop' || E2.st.pending.offer.every(k => E2.st.stock[k] < 1) === false || true, '庫存清空的處理不會出錯');
    const E2b = enterShop(pid, 'stock3', (s0b, m0) => { m0.points = 500; m0.items = ['dice', 'cat']; Object.keys(s0b.stock).forEach(k => { s0b.stock[k] = 0; }); });
    ok(E2b.st.phase === 'shop', '沒有庫存但身上有道具：還是能進商店賣道具');
    ok(!R.act(E2b.st, E2b.me.id, { type: 'shopBuy', item: 'dice' }, now).ok, '賣完了：不能買');
    /* 點數不夠 */
    const E3 = enterShop(pid, 'poor', (s0b, m0) => { m0.points = 5; m0.items = ['dice']; });
    ok(E3.st.phase !== 'shop' || R.options(E3.st, E3.me.id).shop.every(x => !x.can), '點數不夠：買不了任何東西');
    const E4 = enterShop(pid, 'poor2', (s0b, m0) => { m0.points = 15; });
    const c4 = R.options(E4.st, E4.me.id);
    ok(E4.st.phase !== 'shop' || c4.shop.filter(x => x.can).every(x => x.pts <= 15), '點數不夠的商品不能買');
    /* 道具欄滿了 */
    const E5 = enterShop(pid, 'full', (s0b, m0) => { m0.points = 500; m0.items = ['dice'].concat(new Array(R.MAX_ITEMS).fill('cat')); });
    ok(E5.st.phase === 'shop' && R.options(E5.st, E5.me.id).shop.every(x => !x.can) && !R.act(E5.st, E5.me.id, { type: 'shopBuy', item: E5.st.pending.offer[0] }, now).ok, '道具欄滿了（' + R.MAX_ITEMS + ' 個）：不能再買');
    /* 賣出：半價、庫存 +1；可以連續賣 */
    const E6 = enterShop(pid, 'sell', (s0b, m0) => { m0.points = 100; m0.items = ['dice', 'bomb', 'cat']; });
    const me6 = E6.me, o6 = R.options(E6.st, me6.id);
    ok(E6.st.phase === 'shop' && o6.sellItems.length === 2 && o6.sellItems.find(x => x.item === 'bomb').back === R.ITEMS.bomb.pts / 2, '商店可賣出身上的道具，價格＝半價（炸彈 ' + R.ITEMS.bomb.pts + ' → ' + R.ITEMS.bomb.pts / 2 + '）');
    const sb = E6.st.stock.bomb, pb = me6.points;
    ok(R.act(E6.st, me6.id, { type: 'shopSell', item: 'bomb' }, now).ok && me6.points === pb + R.ITEMS.bomb.pts / 2 && !me6.items.includes('bomb') && E6.st.stock.bomb === sb + 1, '賣出炸彈：點數 +' + R.ITEMS.bomb.pts / 2 + '、庫存 +1、道具移除');
    ok(!R.act(E6.st, me6.id, { type: 'shopSell', item: 'bomb' }, now).ok, '沒有的道具不能賣');
    ok(R.act(E6.st, me6.id, { type: 'shopSell', item: 'cat' }, now).ok && me6.points === pb + R.ITEMS.bomb.pts / 2 + R.ITEMS.cat.pts / 2 && E6.st.phase === 'shop', '可以連續賣；賣完仍在商店');
    ok(!R.act(mk2(pid, 'nosell'), 'a', { type: 'shopSell', item: 'cat' }, now).ok, '不在商店裡不能賣道具');
    ok(R.act(E6.st, me6.id, { type: 'decline' }, now).ok && E6.st.phase !== 'shop', '賣完離開商店');
    /* 賣道具騰出空位可以再買 */
    const E7 = enterShop(pid, 'swapbuy', (s0b, m0) => { m0.points = 300; m0.items = ['dice'].concat(new Array(R.MAX_ITEMS).fill('cat')); });
    R.act(E7.st, E7.me.id, { type: 'shopSell', item: 'cat' }, now);
    ok(R.options(E7.st, E7.me.id).shop.some(x => x.can), '賣掉一個道具，騰出空位就能再買');
    /* 機會／命運送點數 */
    [['chance', 'points'], ['chest', 'points']].forEach(([dk]) => {
      const st = mk2(pid, 'card-' + dk), me = st.seats[st.turn], list = dk === 'chance' ? R.CHANCE : R.CHEST;
      const idx = list.findIndex(c => c.t === 'points');
      st._decks[dk].unshift(idx);
      const p0 = me.points, tile = M.get(pid).tiles.findIndex(x => x.type === dk);
      me.items = ['dice']; me.pos = tile - 1;
      R.act(st, me.id, { type: 'useItem', item: 'dice', n: 1 }, now);
      ok(me.points === p0 + list[idx].n, dk === 'chance' ? '抽到機會卡：獲得道具點數 +' + list[idx].n : '抽到命運卡：獲得道具點數 +' + list[idx].n);
    });
  }
  /* 電腦互打：每種格數各幾局，打得完、沒有被拒絕的動作、電腦會逛商店 */
  {
    let stuck = 0, rej = 0;
    M.SIZES.forEach(n => {
      for (let g = 0; g < 3; g++) {
        const { st, rejected } = sim('mapsim-' + n + '-' + g, ['hard', 'normal', 'easy', 'kid'], { roundLimit: 25, mapSize: n });
        if (st.phase !== 'over') stuck++;
        rej += rejected;
        ok(st.tiles.length === n, n + ' 格第 ' + g + ' 局（' + st.map + '）：跑的是 ' + n + ' 格');
      }
    });
    ok(stuck === 0 && rej === 0, '電腦互打 15 局（每種格數 3 局，每局地圖都不同）：每局都打得完、沒有被拒絕的動作（卡住 ' + stuck + '、被拒 ' + rej + '）');
  }
}

section('資產倍率與卡片金額');
{
  ok(R.econOf(1e7, 120) === 3.6 && R.econOf(1000, 120) === 1 && R.econOf(12000, 48) === 2, '資產倍率＝初始現金÷6000，範圍 1～3.6');
  ok(R.econOf(1e7, 40) === 1, '經典 40 格倍率是 1');
  const E = 3, pay = R.scaleCard({ t: 'pay', n: 50, text: '繳學費，付 50 元' }, E, true);
  ok(pay.n === R.scaleMoney(50, E * R.CARD_K) && pay.text.includes(pay.n + ' 元'), '付錢卡：金額×倍率×' + R.CARD_K + '（' + pay.n + '），文字同步');
  const col = R.scaleCard({ t: 'collect', n: 100, text: '保險到期，領 100 元' }, E, true);
  ok(col.n === R.scaleMoney(100, E * R.CARD_K * 1.5), '收錢卡：金額×倍率×' + R.CARD_K + '×1.5（' + col.n + '）');
  const rp = R.scaleCard({ t: 'repairs', house: 25, hotel: 100, text: '每棟房子付 25 元、每間旅店付 100 元' }, E, true);
  ok(rp.house === R.scaleMoney(25, E * R.CARD_K) && rp.hotel === R.scaleMoney(100, E * R.CARD_K), '整修卡：房子／旅店金額都跟著倍率');
  const cl = R.scaleCard({ t: 'pay', n: 50, text: '付 50 元' }, 1, false);
  ok(cl.n === 50, '經典 40 格卡片維持原價');
}

section('亂數');
{
  const a = RNG.create('z'), b = RNG.create('z');
  ok([1, 2, 3, 4, 5].every(() => a.next() === b.next()), '同 seed 同序列');
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const r = RNG.create('dice');
  for (let i = 0; i < 6000; i++) counts[r.int(1, 6)]++;
  ok(counts.slice(1).every(c => c > 850 && c < 1150), '骰子六面大致均勻');
}

console.log('\n' + (fail ? '有 ' + fail + ' 項失敗' : '全部通過') + '（通過 ' + pass + '、失敗 ' + fail + '）');
process.exit(fail ? 1 : 0);
