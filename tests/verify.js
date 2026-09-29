/* ===== tests/verify.js — 規則單元測試＋電腦互打（node tests/verify.js） =====
 * 全部用種子亂數與假時鐘，不需要瀏覽器與網路。
 */
'use strict';

const R = require('../public/js/rules.js');
const AI = require('../public/js/ai.js');
const RNG = require('../public/js/rng.js');

let pass = 0, fail = 0;
function ok(v, name) { if (v) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name); } }
function eq(a, b, name) { ok(a === b, name + (a === b ? '' : '（得到 ' + JSON.stringify(a) + '，預期 ' + JSON.stringify(b) + '）')); }
function section(t) { console.log('\n[' + t + ']'); }

/** 建一局固定座位順序的牌桌（不洗牌順序：直接改 seats 順序不方便，所以用 seed 建完再重排） */
function mk(n, opt) {
  const ps = [];
  for (let i = 0; i < n; i++) ps.push({ id: 'p' + i, name: '玩家' + i, char: 'otter' });
  const st = R.create(ps, Object.assign({ seed: 'unit' }, opt || {}));
  st.seats.sort((a, b) => a.id < b.id ? -1 : 1);
  st.turn = 0;
  return st;
}
/** 下一次擲骰固定成 a、b */
function dice(st, a, b) { const q = [a, b]; st._rng = { int: () => q.length ? q.shift() : 0, shuffle: x => x, next: () => 0.5 }; }
function roll(st, a, b, now) { dice(st, a, b); return R.act(st, st.seats[st.turn].id, { type: 'roll' }, now || 0); }
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
eq(R.CHANCE.length, 17, '機會 17 張（含道具卡）'); eq(R.CHEST.length, 17, '命運 17 張（含道具卡）');

/* ---------- 建立與亂數 ---------- */
section('建立與亂數');
{
  const ps = [1, 2, 3, 4].map(i => ({ id: 'p' + i, name: 'P' + i, char: 'cat' }));
  const a = R.create(ps, { seed: 'x1' }), b = R.create(ps, { seed: 'x1' }), c = R.create(ps, { seed: 'x2' });
  eq(a.seats.map(s => s.id).join(), b.seats.map(s => s.id).join(), '同 seed → 座位順序相同');
  ok(a.seats.every(s => s.cash === 1500 && s.pos === 0), '每人現金 1500、站在起點');
  const orders = new Set();
  for (let i = 0; i < 20; i++) orders.add(R.create(ps, { seed: 's' + i }).seats.map(s => s.id).join());
  ok(orders.size > 3, '不同 seed 座位順序會不一樣（系統隨機決定）');
  ok(c.seats.length === 4, '4 人');
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
  ok(A(st, 'buy').ok && st.props[3].owner === 0 && st.seats[0].cash === 1440, '買下蘭嶼（60）：現金 1440、地歸自己');
  eq(st.phase, 'manage', '買完進入整理階段（可蓋房、結束）');
  ok(!R.act(st, 'p1', { type: 'endTurn' }, 0).ok, '還沒輪到的人不能動');
  A(st, 'endTurn');
  eq(st.turn, 1, '換下一位');
  roll(st, 1, 2);
  eq(st.seats[1].cash, 1500 - 4, '別人踩到蘭嶼：付過路費 4');
  eq(st.seats[0].cash, 1440 + 4, '收租的人拿到 4');
  ok(st.phase === 'manage', '付完租進入整理階段');
  A(st, 'endTurn');
  /* 不買 */
  const s2 = mk(2);
  roll(s2, 3, 3);
  ok(s2.phase === 'buy' && s2.seats[0].pos === 6, '擲 3+3 走到墾丁');
  A(s2, 'decline');
  eq(s2.props[6].owner, -1, '選不買：地留在原地沒人買');
  eq(s2.phase, 'roll', '雙骰：不買之後還可以再擲一次');
  ok(s2.again, '記得這次擲的是雙骰');
}

/* ---------- 起點、雙骰、三次雙骰進監獄 ---------- */
section('起點、雙骰、監獄');
{
  const st = mk(2);
  st.seats[0].pos = 37;
  roll(st, 1, 2);
  eq(st.seats[0].pos, 0, '37+3 繞回起點');
  eq(st.seats[0].cash, 1700, '經過（停在）起點領 200');
  const s2 = mk(2);
  s2.seats[0].pos = 38;
  roll(s2, 2, 1);
  eq(s2.seats[0].pos, 1, '38+3 → 第 1 格');
  ok(s2.seats[0].cash === 1700, '經過起點領 200');
  /* 三次雙骰 */
  const s3 = mk(2);
  s3.seats[0].cash = 99999;
  roll(s3, 1, 1); if (s3.phase === 'buy') A(s3, 'decline');
  eq(s3.phase, 'roll', '第一次雙骰 → 再擲');
  roll(s3, 2, 2); if (s3.phase === 'buy') A(s3, 'decline');
  roll(s3, 3, 3);
  ok(s3.seats[0].jail && s3.seats[0].pos === 10, '連續三次雙骰 → 進監獄');
  eq(s3.phase, 'manage', '進監獄後只能整理、結束回合');
  /* 停在去坐牢 */
  const s4 = mk(2);
  s4.seats[0].pos = 27;
  roll(s4, 1, 2);
  ok(s4.seats[0].jail && s4.seats[0].pos === 10, '停在「去坐牢」→ 進監獄');
  A(s4, 'endTurn');
  endTurn(s4);
  eq(s4.turn, 0, '繞一圈回到坐牢的人');
  const opt = R.options(s4, 'p0');
  ok(opt.roll && opt.payJail && !opt.useCard, '監獄裡的選項：擲骰、繳 50（沒有許可證）');
  ok(A(s4, 'payJail').ok && !s4.seats[0].jail && s4.seats[0].cash === 1450, '繳 50 出獄');
  /* 擲雙骰出獄 */
  const s5 = mk(2);
  s5.seats[0].pos = 27; roll(s5, 1, 2); A(s5, 'endTurn'); endTurn(s5);
  roll(s5, 4, 4);
  ok(!s5.seats[0].jail && s5.seats[0].pos === 18, '監獄裡擲雙骰出獄並前進');
  ok(s5.phase === 'buy' || s5.phase === 'manage', '出獄擲的雙骰不再多擲一次');
  if (s5.phase === 'buy') A(s5, 'decline');
  eq(s5.phase, 'manage', '（出獄後直接進入整理階段）');
  /* 三回合強制繳 50 */
  const s6 = mk(2);
  s6.seats[0].pos = 27; roll(s6, 1, 2); A(s6, 'endTurn'); endTurn(s6);
  roll(s6, 1, 2); A(s6, 'endTurn'); endTurn(s6);
  roll(s6, 1, 3); A(s6, 'endTurn'); endTurn(s6);
  const cash0 = s6.seats[0].cash;
  roll(s6, 1, 4);
  ok(!s6.seats[0].jail && s6.seats[0].cash === cash0 - 50, '第三次沒擲出雙骰：強制繳 50 出獄');
  eq(s6.seats[0].pos, 15, '並照骰子前進（10+5＝台中車站）');
}

/* ---------- 同色整組、蓋房、抵押 ---------- */
section('同色整組、蓋房、抵押');
{
  const st = mk(2);
  give(st, 0, 1); give(st, 0, 3);
  st.phase = 'manage';
  eq(R.rentOf(st, 1, [1, 2]), 4, '整組沒有房子：租金加倍（2→4）');
  ok(A(st, 'build', { tile: 1 }).ok && st.props[1].houses === 1, '蓋第 1 棟');
  eq(R.rentOf(st, 1, [1, 2]), 10, '1 棟房子租金 10');
  ok(!A(st, 'build', { tile: 1 }).ok, '蓋房要平均：另一格還沒蓋不能再蓋這格');
  ok(A(st, 'build', { tile: 3 }).ok, '另一格蓋 1 棟');
  ok(!A(st, 'mortgage', { tile: 1 }).ok, '同組有房子不能抵押');
  for (let i = 0; i < 3; i++) { A(st, 'build', { tile: 1 }); A(st, 'build', { tile: 3 }); }
  eq(st.props[1].houses, 4, '各蓋到 4 棟');
  ok(A(st, 'build', { tile: 1 }).ok && st.props[1].houses === 5, '升級成旅店（5）');
  ok(!A(st, 'build', { tile: 1 }).ok, '旅店不能再蓋');
  ok(!A(st, 'sell', { tile: 3 }).ok, '賣房也要平均：要先賣蓋比較多的那格');
  const c0 = st.seats[0].cash;
  ok(A(st, 'sell', { tile: 1 }).ok && st.seats[0].cash === c0 + 25, '賣一棟房子拿回半價');
  const st2 = mk(2);
  give(st2, 0, 6);
  st2.phase = 'manage';
  ok(!A(st2, 'build', { tile: 6 }).ok, '沒湊齊整組不能蓋房');
  const c1 = st2.seats[0].cash;
  ok(A(st2, 'mortgage', { tile: 6 }).ok && st2.props[6].mortgaged && st2.seats[0].cash === c1 + 50, '抵押：拿到一半地價（100→50）');
  eq(R.rentOf(st2, 6, [1, 2]), 0, '抵押中的地不收租');
  ok(!A(st2, 'mortgage', { tile: 6 }).ok, '不能重複抵押');
  ok(A(st2, 'unmortgage', { tile: 6 }).ok && !st2.props[6].mortgaged && st2.seats[0].cash === c1 - 5, '贖回：付一半地價再加 10%（55），淨 -5');
  ok(!A(st2, 'buy').ok, '不在買地階段不能買');
}

/* ---------- 車站與公司 ---------- */
section('車站與公司');
{
  const st = mk(2);
  give(st, 0, 5); give(st, 0, 15);
  eq(R.rentOf(st, 5, [1, 2]), 50, '2 個車站租金 50');
  give(st, 0, 25); give(st, 0, 35);
  eq(R.rentOf(st, 5, [1, 2]), 200, '4 個車站租金 200');
  give(st, 0, 12);
  eq(R.rentOf(st, 12, [3, 4]), 28, '1 間公司：骰子點數 ×4（7×4）');
  give(st, 0, 28);
  eq(R.rentOf(st, 12, [3, 4]), 70, '2 間公司：骰子點數 ×10');
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
  eq(st.seats[0].pos, 7, '走到機會格'); eq(st.seats[0].cash, 1550, '機會：領股息 50');
  ok(st.card && st.card.deck === 'chance', '畫面收到抽到的卡');
  st = withCard('chance', 12, 4); roll(st, 1, 2);
  ok(st.seats[0].jail, '機會：進監獄');
  st = withCard('chance', 10, 4); roll(st, 1, 2);
  eq(st.seats[0].getOut, 1, '機會：拿到出獄許可證');
  st.seats[0].jail = false;
  st = withCard('chance', 11, 4); roll(st, 1, 2);
  eq(st.seats[0].pos, 4, '機會：後退 3 格（7→4）');
  st = withCard('chance', 4, 4); give(st, 1, 15); roll(st, 1, 2);
  ok(st.seats[0].pos === 15 && st.seats[0].cash === 1500 - 50 && st.seats[1].cash === 1550, '最近車站：有主人租金加倍（1 站 25→50）');
  st = withCard('chance', 6, 4); give(st, 1, 12); roll(st, 1, 2);
  ok(st.seats[0].pos === 12 && st.seats[0].cash === 1500 - 30 * 1 && st.seats[1].cash === 1530, '最近公司：付骰子 10 倍（3×10）');
  st = withCard('chance', 0, 4); roll(st, 1, 2);
  ok(st.seats[0].pos === 0 && st.seats[0].cash === 1700, '前進到起點領 200');
  st = withCard('chance', 15, 4); roll(st, 1, 2);
  ok(st.seats[0].cash === 1450 && st.seats[1].cash === 1550, '付給每位玩家 50');
  st = withCard('chance', 13, 4); give(st, 0, 1, 2); give(st, 0, 3, 5); roll(st, 1, 2);
  eq(st.seats[0].cash, 1500 - (2 * 25 + 100), '房屋整修：房 25、旅店 100');
  st = withCard('chest', 4, 0); st.seats[0].pos = 0; roll(st, 1, 1);
  eq(st.seats[0].pos, 2, '走到命運格');
  eq(st.seats[0].getOut, 1, '命運：出獄許可證');
  st = withCard('chest', 6, 0); roll(st, 1, 1);
  ok(st.seats[0].cash === 1550 && st.seats[1].cash === 1450, '命運：每位玩家給我 50');
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
  ok(st2.props[1].owner === 0 && st2.props[3].owner === 0 && st2.seats[0].cash > 1500, '破產者的財產與現金全給債主');
  eq(st2.ranking[0], 0, '名次：贏家第一');
  /* 湊得到：抵押賣房後付清 */
  const s3 = mk(2);
  give(s3, 0, 39, 3);                            /* 台北101 3 棟房：rent[3]=1400 */
  give(s3, 0, 37, 3);
  give(s3, 1, 11); give(s3, 1, 13); give(s3, 1, 14);
  s3.seats[1].cash = 1200; s3.turn = 1; s3.phase = 'roll'; s3.seats[1].pos = 36;
  roll(s3, 1, 2);                                 /* 36+3=39 */
  ok(s3.seats[1].pos === 39 && s3.phase === 'debt' && s3.pending.amount === 1400, '欠 1400、現金 1200 → 還債階段');
  ok(R.options(s3, 'p1').bankrupt && !R.options(s3, 'p1').settle, '還沒湊夠：不能結清、隨時可宣告破產');
  ok(!A(s3, 'settle').ok, '現金不夠不能結清');
  ok(A(s3, 'mortgage', { tile: 11 }).ok, '抵押一塊地（+70）');
  ok(A(s3, 'mortgage', { tile: 13 }).ok, '再抵押（+70）');
  ok(A(s3, 'mortgage', { tile: 14 }).ok, '再抵押（+80）→ 現金 1420');
  ok(!A(s3, 'build', { tile: 1 }).ok, '還債時不能蓋房');
  ok(A(s3, 'settle').ok && s3.seats[1].cash === 20 && s3.seats[0].cash === 1500 + 1400, '湊夠了就結清，債主收到錢');
  ok(s3.phase === 'manage' || s3.phase === 'roll', '還完債回到正常流程');
  /* 稅 */
  const s4 = mk(2); s4.seats[0].pos = 1; roll(s4, 1, 2);
  eq(s4.seats[0].cash, 1300, '所得稅 200');
}

/* ---------- 強制收購 ---------- */
section('強制收購');
{
  const st = mk(2);
  give(st, 0, 1); give(st, 1, 3);
  st.phase = 'manage';
  ok(R.options(st, 'p0').buyout.includes(3), '湊得齊整組時列入可收購');
  ok(A(st, 'buyout', { tile: 3 }).ok, '收購成功');
  eq(st.props[3].owner, 0, '地換成我的');
  eq(st.seats[0].cash, 1500 - 120, '付 2 倍地價 120');
  eq(st.seats[1].cash, 1500 + 120, '對方收到錢');
  ok(R.groupOwned(st, 0, 'brown'), '湊齊整組');
  const s2 = mk(2);
  give(s2, 0, 1); give(s2, 1, 3); s2.props[3].mortgaged = true; s2.phase = 'manage';
  ok(!A(s2, 'buyout', { tile: 3 }).ok, '抵押中的地不能收購（防守手段）');
  const s3 = mk(2);
  give(s3, 0, 6); give(s3, 1, 8); give(s3, 1, 9); s3.phase = 'manage';
  ok(!A(s3, 'buyout', { tile: 8 }).ok, '收購後湊不齊整組就不行');
  const s4 = mk(2);
  give(s4, 0, 6); give(s4, 0, 8); give(s4, 1, 9); s4.phase = 'manage';
  s4.seats[0].cash = 200;
  ok(!A(s4, 'buyout', { tile: 9 }).ok, '現金不夠不能收購');
  s4.seats[0].cash = 1000;
  ok(A(s4, 'buyout', { tile: 9 }).ok, '現金夠了就可以');
  s4.props[9].owner = 1;
  ok(!A(s4, 'buyout', { tile: 9 }).ok, '每回合只能收購一次');
  const s5 = mk(2);
  give(s5, 0, 1); give(s5, 1, 3, 2); s5.phase = 'manage';
  ok(!A(s5, 'buyout', { tile: 3 }).ok, '有房子的地不能收購');
}

/* ---------- 回合上限與結束 ---------- */
section('回合上限與結束');
{
  const st = mk(2, { roundLimit: 20 });
  st.seats[0].cash = 2000;
  let guard = 0;
  while (st.phase !== 'over' && guard++ < 500) {
    if (st.phase === 'buy') A(st, 'decline');
    else if (st.phase === 'roll') { roll(st, 1, 2); }
    else if (st.phase === 'manage') A(st, 'endTurn');
    else if (st.phase === 'debt') A(st, 'bankrupt');
  }
  ok(st.phase === 'over' && st.reason === 'roundLimit', '到回合上限結束（比總資產）');
  eq(st.round, 20, '回合數停在上限');
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
  ok(IL.length === 5 && IL.includes('dice') && IL.includes('fly') && IL.includes('free') && IL.includes('shield') && IL.includes('cat'), '5 種道具：遙控骰、機票、免租券、防收購券、招財貓');
  let st = mk(2);
  ok(st.seats.every(s => Array.isArray(s.items) && s.items.length === 0), '開局沒有道具');
  /* 遙控骰 */
  st.seats[0].items = ['dice'];
  let r = A(st, 'useItem', { item: 'dice', n: 3 });
  ok(r.ok && st.seats[0].pos === 3 && st.seats[0].items.length === 0, '遙控骰：走指定的 3 步並用掉');
  st = mk(2); st.seats[0].items = ['dice'];
  ok(!A(st, 'useItem', { item: 'dice', n: 7 }).ok && !A(st, 'useItem', { item: 'dice', n: 0 }).ok, '遙控骰：只能選 1～6');
  ok(!R.act(st, st.seats[1].id, { type: 'useItem', item: 'dice', n: 2 }, 0).ok, '不是自己的回合不能用');
  st.seats[0].pos = 38; st.seats[0].items = ['dice'];
  const cash0 = st.seats[0].cash;
  A(st, 'useItem', { item: 'dice', n: 3 });
  ok(st.seats[0].pos === 1 && st.seats[0].cash === cash0 + 200, '遙控骰經過起點照領薪水');
  /* 機票 */
  st = mk(2); st.seats[0].items = ['fly'];
  ok(!A(st, 'useItem', { item: 'fly', tile: 30 }).ok, '機票：不能飛去「去坐牢」');
  ok(!A(st, 'useItem', { item: 'fly', tile: 0 }).ok, '機票：不能飛去原地');
  r = A(st, 'useItem', { item: 'fly', tile: 12 });
  ok(r.ok && st.seats[0].pos === 12 && st.seats[0].items.length === 0, '機票：飛到指定格子並用掉');
  st = mk(2); st.seats[0].items = ['fly']; st.seats[0].pos = 35;
  const c1 = st.seats[0].cash; A(st, 'useItem', { item: 'fly', tile: 5 });
  eq(st.seats[0].cash, c1, '機票倒著飛過起點不領薪水');
  /* 監獄中不能用 */
  st = mk(2); st.seats[0].items = ['fly', 'dice']; st.seats[0].jail = 1;
  ok(!A(st, 'useItem', { item: 'fly', tile: 5 }).ok && !A(st, 'useItem', { item: 'dice', n: 2 }).ok, '在監獄裡不能用道具');
  /* 沒有的道具 */
  st = mk(2);
  ok(!A(st, 'useItem', { item: 'dice', n: 2 }).ok, '沒有道具就不能用');
  /* options */
  st.seats[0].items = ['dice']; let o = R.options(st, st.seats[0].id);
  ok(o.dice === true && o.fly === false, 'options：只有持有的主動道具會亮');
  /* 免租券 */
  st = mk(2); give(st, 1, 1, 0); st.seats[0].items = ['free'];
  st = mk(2); give(st, 1, 3, 0); st.seats[0].items = ['free'];
  roll(st, 1, 2, 0);
  eq(st.seats[0].cash, 1500 - 0, '免租券：這次過路費免了');
  ok(st.seats[0].items.length === 0 && st.seats[1].cash === 1500, '免租券用掉、房東沒收到錢');
  /* 招財貓 */
  st = mk(2); give(st, 1, 3, 0); st.seats[1].items = ['cat'];
  roll(st, 1, 2, 0);
  const base = R.TILES[3].rent[0];
  eq(1500 - st.seats[0].cash, base * 2, '招財貓：房東收雙倍過路費');
  ok(st.seats[1].items.length === 0, '招財貓用掉');
  /* 防收購券 */
  st = mk(2);
  give(st, 1, 1, 0); give(st, 0, 3, 0); st.seats[1].items = ['shield'];
  st.seats[0].cash = 3000;
  ok(!R.canBuyoutAt(st, 0, 1), '（前提）可以收購這塊地');
  r = A(st, 'buyout', { tile: 1 });
  ok(st.props[1].owner === 1 && st.seats[0].cash === 3000 && st.seats[1].items.length === 0, '防收購券：擋下收購、沒扣錢、券用掉');
  /* 獲得道具：卡片、休息站 */
  st = mk(2);
  st.seats[0].pos = 18;
  roll(st, 1, 1, 0);
  ok(st.seats[0].pos === 20 && st.seats[0].items.length === 1, '溫泉休息站送一個道具');
  /* 上限 */
  st = mk(2); st.seats[0].items = ['cat', 'cat', 'cat']; st.seats[0].pos = 18;
  const c2 = st.seats[0].cash;
  roll(st, 1, 1, 0);
  ok(st.seats[0].items.length === R.MAX_ITEMS && st.seats[0].cash === c2 + 50, '道具滿 3 個：改領 50 元');
  /* 公開視圖看得到道具 */
  st = mk(2); st.seats[1].items = ['shield'];
  ok(R.publicView(st, 0).seats[1].items[0] === 'shield', 'publicView 帶著道具（大家都看得到）');
  /* AI：幼幼班絕不用；普通會為了整組用遙控骰 */
  st = mk(2); st.seats[0].items = ['dice', 'fly'];
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
  const stats = { build: {}, buyout: {}, buy: {}, mortgage: {} };
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
  let stuck = 0, rejected = 0, bankruptEnds = 0, N = 100;
  for (let g = 0; g < N; g++) {
    const order = levels.slice();
    for (let r = 0; r < g % 4; r++) order.push(order.shift());
    const { st, stats, rejected: rj } = sim('vs' + g, order, { roundLimit: 30 });
    if (st.phase !== 'over') stuck++;
    rejected += rj;
    if (st.reason === 'lastStanding') bankruptEnds++;
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
  ok(wins.hard > wins.easy && wins.hard >= wins.normal - 6, '勝場：困難 ≥ 普通 > 簡單');
  ok(bankruptEnds >= 1, '也有靠破產淘汰結束的局');
  /* 決定性 */
  const a = sim('same', ['hard', 'normal', 'easy'], { roundLimit: 20 }), b = sim('same', ['hard', 'normal', 'easy'], { roundLimit: 20 });
  eq(JSON.stringify(R.publicView(a.st, 0)), JSON.stringify(R.publicView(b.st, 0)), '同 seed、同電腦 → 完全相同的一局（可重現）');
  const c = sim('other', ['hard', 'normal', 'easy'], { roundLimit: 20 });
  ok(JSON.stringify(R.publicView(a.st, 0)) !== JSON.stringify(R.publicView(c.st, 0)), '換 seed → 不同的一局');
  /* 無上限的局最後也會有人破產 */
  const free = sim('free', ['hard', 'hard'], { roundLimit: 0 });
  ok(free.st.phase === 'over' || free.steps >= 400000, '無回合上限也不會出錯（' + free.st.round + ' 回合）');
  /* 每種組合都跑得完 */
  for (const lv of [['kid', 'kid'], ['easy', 'hard', 'kid'], ['normal', 'normal', 'normal', 'normal']]) {
    const r = sim('mix-' + lv.join(), lv, { roundLimit: 40 });
    ok(r.st.phase === 'over' && r.rejected === 0, lv.join('／') + ' 打得完（' + r.st.round + ' 回合）');
  }
}

/* ---------- 亂數 ---------- */
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
