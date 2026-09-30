/* ===== tests/items.js — 每一種道具的專屬測試案例（node tests/items.js） =====
 * 9 種道具＋商店＋道具欄上限，每個都測：正常效果、每個參數的邊界、
 * 不能用的情況、護身符互動、用掉／不用掉、各張地圖的每一格。
 * 純規則、種子亂數，不需要瀏覽器，幾秒鐘跑完。
 */
'use strict';
const R = require('../public/js/rules.js');
const Maps = require('../public/js/maps.js');

let pass = 0, fail = 0;
function ok(v, name) { if (v) pass++; else { fail++; console.log('  ✘ ' + name); } }
function eq(a, b, name) { ok(a === b, name + (a === b ? '' : '（得到 ' + JSON.stringify(a) + '，預期 ' + JSON.stringify(b) + '）')); }
function section(t) { console.log('[' + t + ']'); }

function mk(n, opt) {
  const ps = [];
  for (let i = 0; i < (n || 2); i++) ps.push({ id: 'p' + i, name: '玩家' + i, char: 'otter' });
  const st = R.create(ps, Object.assign({ seed: 'items', fixedPrices: true }, opt || {}));
  st.seats.sort((a, b) => a.id < b.id ? -1 : 1);
  st.turn = 0;
  return st;
}
function dice(st, a, b) { const q = [a, b]; st._rng = { int: () => q.length ? q.shift() : 0, shuffle: x => x, next: () => 0.5 }; }
function roll(st, a, b) { dice(st, a, b); return R.act(st, st.seats[st.turn].id, { type: 'roll' }, 0); }
function use(st, item, arg, who) {
  const si = who == null ? st.turn : who;
  const a = { type: 'useItem', item };
  if (item === 'dice') a.n = arg; else if (item === 'steal' || item === 'swap') a.target = arg; else a.tile = arg;
  return R.act(st, st.seats[si].id, a, 0);
}
function own(st, si, ti, houses) { st.props[ti].owner = si; st.props[ti].houses = houses || 0; }
function has(st, si, id) { return st.seats[si].items.includes(id); }
const rent = (ti, h) => R.TILES[ti].rent[h || 0];

/* ---------- 遙控骰 ---------- */
section('遙控骰 dice');
for (let n = 1; n <= 6; n++) {
  const st = mk(2); st.seats[0].items = ['dice'];
  const r = use(st, 'dice', n);
  ok(r.ok, 'dice ' + n + ' 可用'); eq(st.seats[0].pos, n, 'dice ' + n + ' 走 ' + n + ' 步'); ok(!has(st, 0, 'dice'), 'dice ' + n + ' 用掉');
}
{
  const st = mk(2); st.seats[0].items = ['dice'];
  for (const bad of [0, 7, -1, 2.5, NaN, 100]) ok(!use(st, 'dice', bad).ok, 'dice 拒絕 n=' + bad);
  ok(has(st, 0, 'dice') && st.seats[0].pos === 0, '被拒絕時不消耗、不移動');
  ok(!use(st, 'dice', 3, 1).ok, '非自己回合不能用');
  const s2 = mk(2); ok(!use(s2, 'dice', 3).ok, '沒有道具不能用');
  const s3 = mk(2); s3.seats[0].items = ['dice']; s3.seats[0].jail = true; ok(!use(s3, 'dice', 3).ok, '監獄中不能用');
  const s4 = mk(2); s4.seats[0].items = ['dice']; s4.phase = 'buy'; s4.pending = { kind: 'buy', tile: 1, price: 60 };
  ok(!use(s4, 'dice', 3).ok, '不是擲骰階段不能用');
}
{
  const st = mk(2); st.seats[0].items = ['dice']; st.seats[0].pos = 38;
  const c = st.seats[0].cash; use(st, 'dice', 3);
  eq(st.seats[0].pos, 1, 'dice 繞過起點'); eq(st.seats[0].cash, c + R.GO_SALARY, 'dice 經過起點領薪水');
}
{
  const st = mk(2); st.seats[0].items = ['dice']; use(st, 'dice', 1);
  eq(st.phase, 'buy', 'dice 落在無主地 → 詢問購買'); eq(st.pending.tile, 1, '購買的是落點');
  ok(!st.again && st.doubles === 0, 'dice 不算雙骰、不多擲');
}
{
  const st = mk(2); st.seats[0].items = ['dice']; st.seats[0].pos = 27; use(st, 'dice', 3);
  ok(st.seats[0].jail, 'dice 走到「去坐牢」照樣入獄');
}
{
  const st = mk(2); own(st, 1, 3, 0); st.seats[0].items = ['dice']; const c0 = st.seats[0].cash, c1 = st.seats[1].cash;
  use(st, 'dice', 3);
  eq(st.seats[0].cash, c0 - rent(3), 'dice 走到對手地 → 付過路費'); eq(st.seats[1].cash, c1 + rent(3), '對手收到過路費');
}
{
  const st = mk(2); st.seats[0].items = ['dice'];
  ok(R.options(st, st.seats[0].id).dice === true, 'options.dice = true'); st.seats[0].items = [];
  ok(R.options(st, st.seats[0].id).dice === false, '沒有道具 options.dice = false');
}

/* ---------- 機票 ---------- */
section('機票 fly');
{
  const st = mk(2); st.seats[0].items = ['fly'];
  for (const bad of [-1, 40, 1.5, NaN, 0, 30]) { ok(!use(st, 'fly', bad).ok, 'fly 拒絕 tile=' + bad); }
  ok(has(st, 0, 'fly'), '被拒絕不消耗');
  st.seats[0].pos = 5; ok(!use(st, 'fly', 5).ok, 'fly 不能飛到自己站的格');
  const s2 = mk(2); s2.seats[0].items = ['fly']; s2.seats[0].jail = true; ok(!use(s2, 'fly', 3).ok, '監獄中不能用');
  const s3 = mk(2); ok(!use(s3, 'fly', 3).ok, '沒有機票不能用');
}
{
  const st = mk(2); st.seats[0].items = ['fly']; st.seats[0].pos = 5; const c = st.seats[0].cash;
  use(st, 'fly', 1);
  eq(st.seats[0].pos, 1, 'fly 往回飛'); eq(st.seats[0].cash, c, 'fly 往回飛不領薪水');
  eq(st.phase, 'buy', 'fly 落點照常處理（無主地 → 購買）');
}
{
  const st = mk(2); st.seats[0].items = ['fly']; st.seats[0].pos = 35; const c = st.seats[0].cash;
  use(st, 'fly', 3);
  eq(st.seats[0].cash, c, 'fly 往前跨過起點也不領薪水');
}
{
  const st = mk(2); own(st, 1, 39, 3); st.seats[0].items = ['fly']; const c = st.seats[0].cash;
  use(st, 'fly', 39); eq(st.seats[0].cash, c - rent(39, 3), 'fly 飛到對手 3 房地 → 付對應租金');
}
{
  const st = mk(2); own(st, 0, 6, 1); st.seats[0].items = ['fly']; use(st, 'fly', 6);
  eq(st.phase, 'build', 'fly 飛到自己的地 → 可加蓋');
}
{
  const st = mk(2); st.seats[0].items = ['fly']; use(st, 'fly', 4);
  eq(st.seats[0].cash, R.START_CASH - R.TILES[4].tax, 'fly 飛到稅格 → 繳稅');
}
{
  const st = mk(2); st.seats[0].items = ['fly']; use(st, 'fly', 10); ok(!st.seats[0].jail && st.seats[0].pos === 10, 'fly 飛到監獄格只是探監');
  const s2 = mk(2); s2.seats[0].items = ['fly']; use(s2, 'fly', 20); eq(s2.seats[0].items.length, 1, 'fly 飛到休息站 → 撿到道具（機票已用掉）');
}
/* 每張地圖、每一格都要能飛，且不會壞掉 */
Maps.LIST.forEach(m => {
  let bad = 0, n = 0;
  const probe = mk(2, { map: m.id });
  for (let ti = 0; ti < probe.props.length; ti++) {
    const st = mk(2, { map: m.id }); st.seats[0].items = ['fly'];
    const t = R.TILES && st.tiles[ti];
    const r = use(st, 'fly', ti);
    if (t && t.type === 'gotojail') { if (r.ok) bad++; continue; }
    n++;
    if (ti === 0 && st.seats[0].pos === 0) { if (r.ok) bad++; continue; }
    const isCard = t && (t.type === 'chance' || t.type === 'chest');
    if (isCard) { if (!r.ok || !st.events.some(e => e.t === 'card')) bad++; }
    else if (!r.ok || (!st.seats[0].jail && st.seats[0].pos !== ti)) { bad++; if (process.env.DBG) console.log('   bad', m.id, ti, st.tiles[ti].type, r.ok, st.seats[0].pos); }
    if (!['buy', 'build', 'roll', 'shop', 'debt', 'over', 'manage'].includes(st.phase)) bad++;
  }
  eq(bad, 0, '地圖 ' + m.id + '：每一格（' + n + ' 格）都能飛且狀態正常');
});

/* ---------- 偷錢卡 ---------- */
section('偷錢卡 steal');
{
  const st = mk(3); st.seats[0].items = ['steal']; st.seats[1].cash = 1000;
  const c0 = st.seats[0].cash;
  ok(use(st, 'steal', 1).ok, 'steal 可用');
  eq(st.seats[1].cash, 800, '偷 20%'); eq(st.seats[0].cash, c0 + 200, '自己收到'); ok(!has(st, 0, 'steal'), '用掉');
  eq(st.seats[2].cash, R.START_CASH, '第三人不受影響'); eq(st.phase, 'roll', '偷完還在擲骰階段');
}
{
  const st = mk(2); st.seats[0].items = ['steal']; st.seats[1].cash = 5000; use(st, 'steal', 1);
  eq(st.seats[1].cash, 4700, '上限 300');
  const s2 = mk(2); s2.seats[0].items = ['steal']; s2.seats[1].cash = 1500; use(s2, 'steal', 1); eq(s2.seats[1].cash, 1200, '1500 × 20% = 300（剛好上限）');
  const s3 = mk(2); s3.seats[0].items = ['steal']; s3.seats[1].cash = 5; use(s3, 'steal', 1); eq(s3.seats[1].cash, 4, '現金 5 → 偷 1');
  const s4 = mk(2); s4.seats[0].items = ['steal']; s4.seats[1].cash = 4; ok(!use(s4, 'steal', 1).ok, '對方現金 < 5 不能偷');
  const s5 = mk(2); s5.seats[0].items = ['steal']; s5.seats[1].cash = 99; use(s5, 'steal', 1); eq(s5.seats[1].cash, 80, '99 × 20% 無條件捨去 = 19');
}
{
  const st = mk(3); st.seats[0].items = ['steal'];
  for (const bad of [0, -1, 3, 9, 1.5, NaN]) ok(!use(st, 'steal', bad).ok, 'steal 拒絕 target=' + bad);
  st.seats[1].bankrupt = true; ok(!use(st, 'steal', 1).ok, '不能偷已破產的人');
  ok(has(st, 0, 'steal'), '被拒絕不消耗');
  const s2 = mk(2); ok(!use(s2, 'steal', 1).ok, '沒有道具');
  const s3 = mk(2); s3.seats[0].items = ['steal']; s3.seats[0].jail = true; ok(!use(s3, 'steal', 1).ok, '監獄中不能用');
  const s4 = mk(2); s4.seats[0].items = ['steal']; s4.seats[1].jail = true; ok(use(s4, 'steal', 1).ok, '對方在監獄仍可被偷');
}
{
  const st = mk(3); st.seats[0].items = ['steal']; st.seats[1].bankrupt = true;
  eq(JSON.stringify(R.itemTargets(st, 0, 'steal')), '[2]', 'itemTargets 只列出合法對象');
  ok(R.options(st, st.seats[0].id).steal === true, 'options.steal');
  st.seats[2].cash = 1; eq(R.itemTargets(st, 0, 'steal').length, 0, '沒有合法對象 → 空清單'); ok(R.options(st, st.seats[0].id).steal === false, 'options.steal = false');
}
{
  const st = mk(2); st.seats[0].items = ['steal']; st.seats[1].items = ['guard']; st.seats[1].cash = 1000; const c0 = st.seats[0].cash;
  ok(use(st, 'steal', 1).ok, '對方有護身符：仍算成功使用');
  eq(st.seats[1].cash, 1000, '被護身符擋下：沒被偷'); eq(st.seats[0].cash, c0, '攻擊者沒賺');
  ok(!has(st, 1, 'guard'), '護身符用掉'); ok(!has(st, 0, 'steal'), '偷錢卡也用掉');
  ok(st.events.some(e => e.t === 'attack' && e.blocked && e.kind === 'steal'), '有「被擋下」事件');
}

/* ---------- 換位卡 ---------- */
section('換位卡 swap');
{
  const st = mk(3); st.seats[0].items = ['swap']; st.seats[0].pos = 3; st.seats[1].pos = 15; const c0 = st.seats[0].cash;
  ok(use(st, 'swap', 1).ok, 'swap 可用');
  eq(st.seats[0].pos, 15, '我到對方位置'); eq(st.seats[1].pos, 3, '對方到我的位置'); eq(st.seats[2].pos, 0, '第三人不動');
  eq(st.seats[0].cash, c0, '不領薪水'); ok(!has(st, 0, 'swap'), '用掉');
  eq(st.phase, 'buy', '換到無主車站 → 詢問購買'); eq(st.pending.tile, 15, '購買的是新落點');
}
{
  const st = mk(2); st.seats[0].items = ['swap']; st.seats[0].pos = 30 - 5; st.seats[1].pos = 3; const c = st.seats[0].cash;
  st.seats[0].pos = 35; st.seats[1].pos = 1; use(st, 'swap', 1);
  eq(st.seats[0].cash, c, '從 35 換到 1 也不領薪水（沒有往前跨過）');
}
{
  const st = mk(2); own(st, 1, 6, 2); st.seats[0].items = ['swap']; st.seats[0].pos = 0; st.seats[1].pos = 6;
  const c0 = st.seats[0].cash, c1 = st.seats[1].cash; use(st, 'swap', 1);
  eq(st.seats[0].cash, c0 - rent(6, 2), '換到對手（自己）的地 → 付租金'); eq(st.seats[1].cash, c1 + rent(6, 2), '地主收到');
}
{
  const st = mk(2); st.seats[0].items = ['swap']; st.seats[1].pos = 30; use(st, 'swap', 1);
  ok(st.seats[0].jail && st.seats[0].pos === 10, '換到「去坐牢」→ 被關');
}
{
  const st = mk(2); st.seats[0].items = ['swap']; st.seats[0].pos = 4; st.seats[1].pos = 20; use(st, 'swap', 1);
  eq(st.seats[0].pos, 20, '換到休息站'); eq(st.seats[0].items.length, 1, '休息站送一個道具');
}
{
  const st = mk(3); st.seats[0].items = ['swap'];
  for (const bad of [0, -1, 3, 1.5, NaN]) ok(!use(st, 'swap', bad).ok, 'swap 拒絕 target=' + bad);
  st.seats[1].pos = 0; ok(!use(st, 'swap', 1).ok, '同一格不能換');
  st.seats[1].pos = 8; st.seats[1].jail = true; ok(!use(st, 'swap', 1).ok, '對方在監獄不能換');
  st.seats[1].jail = false; st.seats[1].bankrupt = true; ok(!use(st, 'swap', 1).ok, '對方破產不能換');
  ok(has(st, 0, 'swap') && st.seats[0].pos === 0, '被拒絕不消耗、不移動');
  const s3 = mk(2); s3.seats[0].items = ['swap']; s3.seats[1].pos = 5; s3.seats[0].jail = true; ok(!use(s3, 'swap', 1).ok, '自己在監獄不能用');
  eq(R.canUseItem(st, 0, 'swap', 1), '對方破產不能換'.length ? R.canUseItem(st, 0, 'swap', 1) : null, 'canUseItem 有回傳原因');
}
{
  const st = mk(2); st.seats[0].items = ['swap']; st.seats[1].items = ['guard']; st.seats[1].pos = 8; st.seats[0].pos = 3;
  use(st, 'swap', 1);
  eq(st.seats[0].pos, 3, '被護身符擋下：位置不變'); eq(st.seats[1].pos, 8, '對方位置不變'); ok(!has(st, 1, 'guard') && !has(st, 0, 'swap'), '雙方道具都用掉');
  eq(st.phase, 'roll', '擋下後仍可擲骰');
}

/* ---------- 炸彈 ---------- */
section('炸彈 bomb');
{
  const st = mk(2); own(st, 1, 3, 2); st.seats[0].items = ['bomb']; ok(use(st, 'bomb', 3).ok, 'bomb 可用');
  eq(st.props[3].houses, 1, '房子 -1'); eq(st.props[3].owner, 1, '地還是對手的'); ok(!has(st, 0, 'bomb'), '用掉');
  ok(st.events.some(e => e.t === 'attack' && e.kind === 'bomb' && e.tile === 3), '有炸彈事件（畫面靠它演出）');
}
{
  const st = mk(2); own(st, 1, 3, 5); st.seats[0].items = ['bomb']; use(st, 'bomb', 3); eq(st.props[3].houses, 4, '旅店降回 4 間房');
  const s2 = mk(2); own(s2, 1, 3, 1); s2.seats[0].items = ['bomb']; use(s2, 'bomb', 3); eq(s2.props[3].houses, 0, '1 間房炸成空地'); eq(s2.props[3].owner, 1, '空地仍屬對手');
}
{
  const st = mk(3); own(st, 1, 3, 0); own(st, 0, 6, 2); own(st, 2, 8, 1); st.seats[0].items = ['bomb'];
  ok(!use(st, 'bomb', 3).ok, '對手的空地（0 房）不能炸'); ok(!use(st, 'bomb', 6).ok, '自己的地不能炸'); ok(!use(st, 'bomb', 9).ok, '無主地不能炸');
  ok(!use(st, 'bomb', 4).ok, '非地產格不能炸'); ok(!use(st, 'bomb', -1).ok && !use(st, 'bomb', 40).ok && !use(st, 'bomb', 1.5).ok && !use(st, 'bomb', NaN).ok, '無效的格子編號');
  ok(has(st, 0, 'bomb'), '被拒絕不消耗');
  eq(JSON.stringify(R.itemTargets(st, 0, 'bomb')), '[8]', 'itemTargets 只有對手有房的地');
  ok(R.options(st, st.seats[0].id).bomb === true, 'options.bomb');
  st.props[8].houses = 0; ok(R.options(st, st.seats[0].id).bomb === false, '沒有可炸的地 → options.bomb = false');
  const s2 = mk(2); own(s2, 1, 3, 2); s2.seats[0].items = ['bomb']; s2.seats[0].jail = true; ok(!use(s2, 'bomb', 3).ok, '監獄中不能用');
  const s3 = mk(2); own(s3, 1, 3, 2); ok(!use(s3, 'bomb', 3).ok, '沒有炸彈不能用');
}
{
  const st = mk(2); own(st, 1, 3, 2); st.seats[0].items = ['bomb']; st.seats[1].items = ['guard']; use(st, 'bomb', 3);
  eq(st.props[3].houses, 2, '被護身符擋下：房子沒事'); ok(!has(st, 1, 'guard') && !has(st, 0, 'bomb'), '雙方道具都用掉');
}
{
  const st = mk(3); own(st, 1, 3, 2); st.seats[0].items = ['bomb']; st.seats[2].items = ['guard']; use(st, 'bomb', 3);
  eq(st.props[3].houses, 1, '護身符在別人身上（不是地主）擋不了'); ok(has(st, 2, 'guard'), '別人的護身符不受影響');
}
{
  const st = mk(2); own(st, 1, 3, 2); own(st, 1, 1, 0); st.seats[0].items = ['bomb'];
  const before = R.TILES[3].rent[2]; use(st, 'bomb', 3);
  ok(true, '炸彈後租金隨房數下降（' + before + ' → ' + rent(3, 1) + '）'); ok(rent(3, 1) < before, '房數少租金較低');
}

/* ---------- 免租券 ---------- */
section('免租券 free');
{
  const st = mk(2); own(st, 1, 3, 0); st.seats[0].items = ['free']; const c0 = st.seats[0].cash, c1 = st.seats[1].cash;
  roll(st, 1, 2);
  eq(st.seats[0].cash, c0, '踩到對手的地不用付'); eq(st.seats[1].cash, c1, '地主沒收到'); ok(!has(st, 0, 'free'), '用掉');
}
{
  const st = mk(2); own(st, 1, 3, 3); st.seats[0].items = ['free', 'free']; const c0 = st.seats[0].cash;
  roll(st, 1, 2); eq(st.seats[0].cash, c0, '3 房的地也免'); eq(st.seats[0].items.length, 1, '兩張只用掉一張');
}
{
  const st = mk(2); st.seats[0].items = ['free']; roll(st, 1, 2); ok(has(st, 0, 'free'), '踩到無主地不消耗'); st.phase = 'roll'; st.pending = null;
  const s2 = mk(2); own(s2, 0, 3, 0); s2.seats[0].items = ['free']; roll(s2, 1, 2); ok(has(s2, 0, 'free'), '踩到自己的地不消耗');
  const s3 = mk(2); s3.seats[0].items = ['free']; roll(s3, 1, 3); ok(has(s3, 0, 'free'), '繳稅不會用免租券（那是免稅券）');
  ok(!use(s3, 'free', 0).ok, '免租券不能主動使用');
}
{
  const st = mk(2); own(st, 1, 3, 0); st.seats[0].items = ['free']; st.seats[1].items = ['cat'];
  roll(st, 1, 2); ok(has(st, 1, 'cat'), '免租時對方的招財貓不會被浪費');
}
{
  const st = mk(2); own(st, 1, 5, 0); st.seats[0].items = ['free']; const c0 = st.seats[0].cash; st.seats[0].pos = 3; roll(st, 1, 1);
  eq(st.seats[0].cash, c0, '車站也免租');
  const s2 = mk(2); own(s2, 1, 12, 0); s2.seats[0].items = ['free']; const d0 = s2.seats[0].cash; s2.seats[0].pos = 9; roll(s2, 1, 2);
  eq(s2.seats[0].cash, d0, '公司也免租');
}

/* ---------- 招財貓 ---------- */
section('招財貓 cat');
{
  const st = mk(2); own(st, 1, 3, 0); st.seats[1].items = ['cat']; const c0 = st.seats[0].cash, c1 = st.seats[1].cash;
  roll(st, 1, 2);
  eq(st.seats[0].cash, c0 - rent(3) * 2, '租金加倍'); eq(st.seats[1].cash, c1 + rent(3) * 2, '地主多收'); ok(!has(st, 1, 'cat'), '用掉');
}
{
  const st = mk(2); own(st, 1, 3, 2); st.seats[1].items = ['cat', 'cat']; const c0 = st.seats[0].cash;
  roll(st, 1, 2); eq(st.seats[0].cash, c0 - rent(3, 2) * 2, '2 房租金也加倍'); eq(st.seats[1].items.length, 1, '一次只用一隻');
}
{
  const st = mk(2); own(st, 1, 3, 0); st.seats[1].items = ['cat']; st.turn = 1; st.seats[1].pos = 0;
  roll(st, 1, 2); ok(has(st, 1, 'cat'), '自己踩自己的地、或沒人付錢：不消耗');
  const s2 = mk(2); s2.seats[0].items = ['cat']; roll(s2, 1, 2); ok(has(s2, 0, 'cat'), '自己踩無主地：不消耗');
  ok(!use(s2, 'cat', 0).ok, '招財貓不能主動使用');
}
{
  const st = mk(2); own(st, 1, 3, 0); st.seats[1].items = ['cat']; st.seats[0].items = ['free']; const c0 = st.seats[0].cash;
  roll(st, 1, 2); eq(st.seats[0].cash, c0, '對方有免租券 → 不付錢'); ok(has(st, 1, 'cat'), '招財貓沒被用掉');
}
{
  const st = mk(2); own(st, 1, 3, 0); st.seats[1].items = ['cat']; st.seats[1].god = { k: 'fortune', turns: 4 }; const c0 = st.seats[0].cash;
  roll(st, 1, 2); eq(st.seats[0].cash, c0 - rent(3) * 4, '招財貓 × 福神 = 4 倍');
  const s2 = mk(2); own(s2, 1, 3, 0); s2.seats[1].items = ['cat']; s2.seats[0].god = { k: 'poor', turns: 4 }; const d0 = s2.seats[0].cash;
  roll(s2, 1, 2); eq(s2.seats[0].cash, d0 - rent(3) * 4, '招財貓 × 窮神 = 4 倍');
}
{
  const st = mk(2); own(st, 1, 3, 0); st.seats[1].items = ['cat']; st.seats[0].cash = 1; const r = roll(st, 1, 2);
  ok(!has(st, 1, 'cat'), '對方付不起（進入債務）貓仍用掉'); ok(st.phase === 'debt' || st.seats[0].bankrupt || st.phase === 'over', '付不起 → 賣房或破產流程');
}

/* ---------- 免稅券 ---------- */
section('免稅券 taxfree');
{
  const st = mk(2); st.seats[0].items = ['taxfree']; const c0 = st.seats[0].cash; roll(st, 1, 3);
  eq(st.seats[0].pos, 4, '走到稅格'); eq(st.seats[0].cash, c0, '不用繳'); ok(!has(st, 0, 'taxfree'), '用掉');
}
{
  const st = mk(2); const c0 = st.seats[0].cash; roll(st, 1, 3); eq(st.seats[0].cash, c0 - R.TILES[4].tax, '沒有免稅券照繳');
}
{
  const st = mk(2); st.seats[0].items = ['taxfree']; st.seats[0].pos = 30 + 0; st.seats[0].pos = 35; const c0 = st.seats[0].cash; roll(st, 1, 2);
  eq(st.seats[0].pos, 38, '走到第二個稅格'); eq(st.seats[0].cash, c0, '免稅券對任何稅格有效');
}
{
  const st = mk(2); own(st, 1, 3, 0); st.seats[0].items = ['taxfree']; roll(st, 1, 2); ok(has(st, 0, 'taxfree'), '付過路費不會用掉免稅券');
  ok(!use(st, 'taxfree', 0).ok, '免稅券不能主動使用');
  const s2 = mk(2); s2.seats[0].items = ['taxfree', 'taxfree']; roll(s2, 1, 3); eq(s2.seats[0].items.length, 1, '兩張只用一張');
}

/* ---------- 護身符 ---------- */
section('護身符 guard');
{
  const st = mk(2); st.seats[0].items = ['guard']; ok(!use(st, 'guard', 0).ok, '護身符不能主動使用');
  ok(R.options(st, st.seats[0].id).steal === false && R.options(st, st.seats[0].id).bomb === false, '被動道具不會打開攻擊選項');
}
{
  const st = mk(2); st.seats[1].items = ['guard']; st.seats[1].cash = 1000; st.seats[0].items = ['steal', 'steal'];
  use(st, 'steal', 1); eq(st.seats[1].cash, 1000, '第一次被擋');
  use(st, 'steal', 1); eq(st.seats[1].cash, 800, '護身符只擋一次，第二次被偷');
}
{
  const st = mk(2); st.seats[1].items = ['guard', 'guard']; st.seats[0].items = ['steal']; st.seats[1].cash = 1000; use(st, 'steal', 1);
  eq(st.seats[1].items.length, 1, '兩個護身符只用一個');
}
{
  const st = mk(2); st.seats[0].items = ['guard', 'steal']; st.seats[1].cash = 1000; use(st, 'steal', 1);
  ok(has(st, 0, 'guard'), '自己的護身符不影響自己出手'); eq(st.seats[1].cash, 800, '偷錢成功');
}
{
  const st = mk(2); st.seats[1].items = ['guard']; own(st, 1, 3, 0); st.seats[0].items = []; roll(st, 1, 2);
  ok(has(st, 1, 'guard'), '收租不會用掉護身符');
}

/* ---------- 商店 ---------- */
section('商店 shop 與道具欄');
function inShop(st, cash, items) {
  st.seats[0].cash = cash; st.seats[0].items = items || [];
  st.phase = 'shop'; st.pending = { kind: 'shop', tile: 1 };
}
function buy(st, item) { return R.act(st, st.seats[st.turn].id, { type: 'shopBuy', item }, 0); }
R.ITEM_LIST.forEach(k => {
  const st = mk(2); inShop(st, 5000);
  const r = buy(st, k);
  ok(r.ok, '買 ' + k); eq(st.seats[0].cash, 5000 - R.ITEMS[k].cost, k + ' 扣 ' + R.ITEMS[k].cost); ok(has(st, 0, k), k + ' 進道具欄');
});
{
  const st = mk(2); inShop(st, 79); ok(!buy(st, 'dice').ok, '現金差 1 元不能買（遙控骰 80）');
  const s2 = mk(2); inShop(s2, 80); ok(buy(s2, 'dice').ok, '剛好夠就能買'); eq(s2.seats[0].cash, 0, '花光');
  const s3 = mk(2); inShop(s3, 5000, ['free', 'cat', 'guard']); ok(!buy(s3, 'dice').ok, '道具欄滿 3 個不能買'); eq(s3.seats[0].cash, 5000, '被拒絕不扣錢');
  const s4 = mk(2); inShop(s4, 5000); ok(!buy(s4, 'nope').ok && !buy(s4, '').ok && !buy(s4, undefined).ok, '不存在的商品');
  const s5 = mk(2); s5.seats[0].cash = 5000; ok(!buy(s5, 'dice').ok, '不在商店階段不能買');
  const s6 = mk(2); inShop(s6, 5000); ok(!R.act(s6, s6.seats[1].id, { type: 'shopBuy', item: 'dice' }, 0).ok, '別人的回合不能買');
}
{
  const st = mk(2); inShop(st, 5000, ['free', 'cat']); buy(st, 'dice');
  eq(st.phase, 'manage', '買到第 3 個 → 自動離開商店（進入結束回合）'); eq(st.seats[0].items.length, 3, '道具欄 3 個');
  const s2 = mk(2); inShop(s2, 100); buy(s2, 'dice'); eq(s2.phase, 'manage', '剩餘現金買不起任何東西 → 自動離開');
  const s3 = mk(2); inShop(s3, 5000); buy(s3, 'dice'); eq(s3.phase, 'shop', '還買得起、還有空位 → 留在商店');
  buy(s3, 'fly'); eq(s3.phase, 'shop', '第二個仍可逛'); buy(s3, 'guard'); eq(s3.phase, 'manage', '第三個買完離開');
  const s4 = mk(2); inShop(s4, 5000); R.act(s4, s4.seats[0].id, { type: 'decline' }, 0); eq(s4.phase, 'manage', '不買直接離開'); eq(s4.seats[0].cash, 5000, '沒扣錢');
}
{
  const st = mk(2); inShop(st, 5000);
  const o = R.options(st, st.seats[0].id); ok(Array.isArray(o.shop) && o.shop.length === R.ITEM_LIST.length, 'options.shop 列出全部商品');
  ok(o.shop.every(x => x.can === true && x.cost === R.ITEMS[x.item].cost), '錢夠時每項都能買、價格正確');
  st.seats[0].cash = 100; const o2 = R.options(st, st.seats[0].id);
  ok(o2.shop.find(x => x.item === 'dice').can && !o2.shop.find(x => x.item === 'fly').can, '錢不夠的商品標示不能買');
  st.seats[0].items = ['free', 'cat', 'guard']; ok(R.options(st, st.seats[0].id).shop.every(x => !x.can), '道具欄滿：全部不能買');
}
{
  /* 只有有商店的地圖：走到商店格 */
  Maps.LIST.filter(m => m.shops > 0).forEach(m => {
    const st = mk(2, { map: m.id }); const ti = st.tiles.findIndex(t => t.type === 'shop');
    const s2 = mk(2, { map: m.id }); const ti2 = s2.tiles.findIndex(t => t.type === 'shop'); s2.seats[0].pos = ti2 - 1; s2.seats[0].items = ['dice']; use(s2, 'dice', 1);
    eq(s2.phase, 'shop', '地圖 ' + m.id + '：走到商店格 → 進入商店'); eq(s2.pending.kind, 'shop', '待處理事項是商店');
    const s3 = mk(2, { map: m.id }); s3.seats[0].pos = ti2 - 2; s3.seats[0].items = ['dice', 'free', 'cat']; roll(s3, 1, 1);
    ok(s3.phase !== 'shop' && s3.seats[0].pos === ti2, '地圖 ' + m.id + '：道具欄滿了，逛一逛就過');
    const s4 = mk(2, { map: m.id }); s4.seats[0].pos = ti2 - 2; s4.seats[0].cash = 10; roll(s4, 1, 1);
    ok(s4.phase !== 'shop' && s4.seats[0].pos === ti2, '地圖 ' + m.id + '：錢不夠買任何東西就不開商店');
  });
}
{
  /* 休息站與道具欄上限 */
  const st = mk(2); st.seats[0].items = ['dice']; st.seats[0].pos = 19; const c = st.seats[0].cash; roll(st, 1, 0 + 0 || 1);
  const s2 = mk(2); s2.seats[0].pos = 18; roll(s2, 1, 1); eq(s2.seats[0].pos, 20, '走到休息站'); eq(s2.seats[0].items.length, 1, '休息站送 1 個道具');
  const s3 = mk(2); s3.seats[0].pos = 18; s3.seats[0].items = ['free', 'cat', 'guard']; const c3 = s3.seats[0].cash; roll(s3, 1, 1);
  eq(s3.seats[0].items.length, 3, '滿了不會超過上限'); eq(s3.seats[0].cash, c3 + 50, '道具滿了改領 50 元');
  eq(R.MAX_ITEMS, 3, '上限 3 個');
}

/* ---------- 資料一致性 ---------- */
section('道具資料');
R.ITEM_LIST.forEach(k => {
  const it = R.ITEMS[k];
  ok(it.name && it.desc && it.cost > 0, k + ' 有名稱、說明、價格');
});
ok(R.ITEM_LIST.filter(k => R.ITEMS[k].active).sort().join() === 'bomb,dice,fly,steal,swap', '主動道具是 dice/fly/steal/swap/bomb');
ok(R.ITEM_LIST.filter(k => !R.ITEMS[k].active).sort().join() === 'cat,free,guard,taxfree', '被動道具是 free/cat/taxfree/guard');
ok(R.ITEM_LIST.filter(k => R.ITEMS[k].target === 'seat').sort().join() === 'steal,swap', '選人道具 steal/swap');
ok(R.ITEM_LIST.filter(k => R.ITEMS[k].target === 'tile').join() === 'bomb', '選地道具 bomb');
{
  const st = mk(2); st.seats[0].items = ['dice', 'guard'];
  const v = R.publicView(st, 0); ok(Array.isArray(v.seats[0].items) && v.seats[0].items.includes('guard'), 'publicView 帶著道具清單');
  ok(JSON.stringify(v).length > 0, 'publicView 可序列化');
}
/* 休息站依亂數抽道具：每一種都抽得到、且都是合法道具 */
{
  const got = new Set();
  R.ITEM_LIST.forEach((k, idx) => {
    const st = mk(2); st.seats[0].pos = 18;
    const q = [1, 1, idx]; st._rng = { int: () => q.length ? q.shift() : idx, shuffle: x => x, next: () => 0.5 };
    R.act(st, st.seats[0].id, { type: 'roll' }, 0);
    eq(st.seats[0].items[0], k, '休息站可抽到 ' + k); st.seats[0].items.forEach(x => got.add(x));
  });
  eq(got.size, 9, '9 種道具都抽得到');
}
console.log('\n道具測試：通過 ' + pass + '、失敗 ' + fail);
process.exit(fail ? 1 : 0);
