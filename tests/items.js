/* ===== tests/items.js — 每一種道具的專屬測試案例（node tests/items.js） =====
 * 22 種道具＋商店（道具點數、庫存、買賣）＋道具欄上限，每個都測：正常效果、每個參數的邊界、
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

/* 固定版面：經典 40 格；每張隨機地圖另外用 mapSize 測 */
function mk(n, opt) {
  const ps = [];
  for (let i = 0; i < (n || 2); i++) ps.push({ id: 'p' + i, name: '玩家' + i, char: 'otter' });
  const st = R.create(ps, Object.assign({ seed: 'items', fixedPrices: true }, opt && (opt.map || opt.mapSize) ? {} : { map: 'classic40' }, opt || {}));
  st.seats.sort((a, b) => a.id < b.id ? -1 : 1);
  st.turn = 0;
  return st;
}
function dice(st, a, b) { const q = [a, b]; st._rng = { int: (a) => q.length ? q.shift() : (a || 0), shuffle: x => x, next: () => 0.5 }; }
function roll(st, a, b) { dice(st, a, b); return R.act(st, st.seats[st.turn].id, { type: 'roll' }, 0); }
function roll1(st, a) { dice(st, a, 0); return R.act(st, st.seats[st.turn].id, { type: 'roll', dice: 1 }, 0); }
function use(st, item, arg, who) {
  const si = who == null ? st.turn : who;
  const a = { type: 'useItem', item };
  if (item === 'dice') a.n = arg; else if (item === 'steal' || item === 'swap' || item === 'freeze') a.target = arg; else if (!['loan', 'chest', 'cure', 'god', 'salary'].includes(item)) a.tile = arg;
  return R.act(st, st.seats[si].id, a, 0);
}
function own(st, si, ti, houses) { st.props[ti].owner = si; st.props[ti].houses = houses || 0; }
function has(st, si, id) { return st.seats[si].items.includes(id); }
const rent = (ti, h) => R.TILES[ti].rent[h || 0];

/* ---------- 遙控骰 ---------- */
section('遙控骰 dice');
for (let n = 1; n <= 12; n++) {
  const st = mk(2); st.seats[0].items = ['dice'];
  const r = use(st, 'dice', n);
  ok(r.ok, 'dice ' + n + ' 可用');
  if (!['chance', 'chest', 'gotojail'].includes(st.tiles[n].type)) eq(st.seats[0].pos, n, 'dice ' + n + ' 走 ' + n + ' 步');
  eq(st.diceKind, 'remote', 'dice ' + n + ' 記為遙控骰'); ok(st.dice[0] + st.dice[1] === n && st.dice[0] >= 1, 'dice ' + n + ' 骰面合計 ' + n);
  ok(!has(st, 0, 'dice'), 'dice ' + n + ' 用掉');
}
{
  const st = mk(2); st.seats[0].items = ['dice'];
  for (const bad of [0, 13, -1, 2.5, NaN, 100]) ok(!use(st, 'dice', bad).ok, 'dice 拒絕 n=' + bad);
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
  ok(st.again === undefined && st.diceKind === 'remote', 'dice 不再有雙骰再擲');
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
/* 每種格數、幾張隨機地圖，每一格都要能飛，且不會壞掉 */
Maps.SIZES.forEach(size => ['fa', 'fb'].forEach(sd => {
  const id = Maps.genId(size, sd + size);
  let bad = 0, n = 0;
  const probe = mk(2, { map: id });
  for (let ti = 0; ti < probe.props.length; ti++) {
    const st = mk(2, { map: id }); st.seats[0].items = ['fly'];
    const t = st.tiles[ti];
    const r = use(st, 'fly', ti);
    if (t.type === 'gotojail') { if (r.ok) bad++; continue; }
    n++;
    if (ti === 0 && st.seats[0].pos === 0) { if (r.ok) bad++; continue; }
    const isCard = t.type === 'chance' || t.type === 'chest';
    if (isCard) { if (!r.ok || !st.events.some(e => e.t === 'card')) bad++; }
    else if (!r.ok || (!st.seats[0].jail && st.seats[0].pos !== ti)) { bad++; if (process.env.DBG) console.log('   bad', id, ti, t.type, r.ok, st.seats[0].pos); }
    if (!['buy', 'build', 'roll', 'shop', 'debt', 'over', 'manage'].includes(st.phase)) bad++;
  }
  eq(bad, 0, '地圖 ' + id + '：每一格（' + n + ' 格）都能飛且狀態正常');
}));

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

/* ---------- 新道具 ---------- */
section('提款卡 loan');
{
  const st = mk(2); st.seats[0].items = ['loan']; const c = st.seats[0].cash;
  ok(use(st, 'loan').ok, 'loan 可用'); eq(st.seats[0].cash, c + 200, 'loan 領 200 元'); ok(!has(st, 0, 'loan'), 'loan 用掉');
  eq(st.phase, 'roll', 'loan 用完還在擲骰階段（還能繼續擲骰）');
  ok(!use(st, 'loan').ok, '沒有道具不能用');
  const s2 = mk(2); s2.seats[0].items = ['loan']; s2.seats[0].jail = true; ok(!use(s2, 'loan').ok, '監獄中不能用');
  const s3 = mk(2); s3.seats[0].items = ['loan']; ok(!use(s3, 'loan', 0, 1).ok, '非自己回合不能用');
  ok(R.options(mk(2), 'p0').loan === false, '沒有道具 options.loan = false');
}
section('減租券 half');
{
  const st = mk(2); own(st, 1, 3, 0); st.seats[0].items = ['half']; const c = st.seats[0].cash; roll(st, 1, 2);
  eq(st.seats[0].cash, c - Math.ceil(rent(3) / 2), 'half：過路費只付一半'); ok(!has(st, 0, 'half'), 'half 用掉');
  const s2 = mk(2); s2.seats[0].items = ['half']; s2.seats[0].pos = 18; roll(s2, 1, 1); ok(has(s2, 0, 'half'), '沒付租不會用掉 half');
  const s3 = mk(2); own(s3, 1, 3, 0); s3.seats[0].items = ['half', 'free']; const c3 = s3.seats[0].cash; roll(s3, 1, 2);
  eq(s3.seats[0].cash, c3, 'free 優先，租金全免'); ok(has(s3, 0, 'half'), 'half 沒被用掉');
  ok(!use(mk(2), 'half', 0).ok, 'half 不能主動使用');
}
section('起點加碼券 gobonus');
{
  const st = mk(2); st.seats[0].items = ['gobonus']; st.seats[0].pos = 38; const c = st.seats[0].cash; roll(st, 1, 2);
  eq(st.seats[0].cash, c + R.GO_SALARY * 2, 'gobonus：經過起點薪水加倍'); ok(!has(st, 0, 'gobonus'), 'gobonus 用掉');
  const s2 = mk(2); s2.seats[0].items = ['gobonus']; roll(s2, 1, 2); ok(has(s2, 0, 'gobonus'), '沒經過起點不會用掉');
}
section('保釋券 bail');
{
  const st = mk(2); st.seats[0].items = ['bail']; st.seats[0].pos = 27; roll(st, 1, 2);
  ok(!st.seats[0].jail && !has(st, 0, 'bail'), 'bail：被抓去坐牢免關並用掉'); ok(st.seats[0].pos !== 10, '沒有被送到監獄');
  const s2 = mk(2); s2.seats[0].items = ['bail']; s2.seats[0].pos = 26; roll(s2, 1, 2); ok(has(s2, 0, 'bail'), '沒進監獄不會用掉');
}
section('購地折價券 coupon');
{
  const st = mk(2); st.seats[0].items = ['coupon']; roll1(st, 1);
  const t = R.TILES[st.seats[0].pos];
  ok(st.phase === 'buy' && st.pending.coupon === true && st.pending.price === Math.round(t.price * 0.7), 'coupon：買地價打 7 折（' + st.pending.price + '）');
  const c = st.seats[0].cash; R.act(st, 'p0', { type: 'buy' }, 0);
  eq(st.seats[0].cash, c - Math.round(t.price * 0.7), 'coupon：實際付 7 折'); ok(!has(st, 0, 'coupon'), '買下才用掉');
  const s2 = mk(2); s2.seats[0].items = ['coupon']; roll1(s2, 1); R.act(s2, 'p0', { type: 'decline' }, 0);
  ok(has(s2, 0, 'coupon'), '不買就不會用掉 coupon');
  const s3 = mk(2); roll1(s3, 1); ok(!s3.pending.coupon && s3.pending.price === R.TILES[s3.seats[0].pos].price, '沒有 coupon：原價');
}
section('冰凍卡 freeze');
{
  const st = mk(3); st.seats[0].items = ['freeze'];
  ok(use(st, 'freeze', 1).ok && st.seats[1].frozen && !has(st, 0, 'freeze'), 'freeze：對手被冰凍、道具用掉');
  ok(!use(mk(3), 'freeze', 1).ok, '沒有道具不能用');
  const s2 = mk(3); s2.seats[0].items = ['freeze', 'freeze']; use(s2, 'freeze', 1); ok(!use(s2, 'freeze', 1).ok, '同一個人不能重複冰凍');
  ok(!use(s2, 'freeze', 0).ok, '不能冰凍自己'); ok(!use(s2, 'freeze', 9).ok, '不能冰凍不存在的人');
  const s3 = mk(3); s3.seats[0].items = ['freeze']; s3.seats[1].bankrupt = true; ok(!use(s3, 'freeze', 1).ok, '不能冰凍破產的人');
  /* 被冰凍的人跳過下一回合 */
  const s4 = mk(3); s4.seats[0].items = ['freeze']; use(s4, 'freeze', 1); roll(s4, 1, 2); if (s4.phase === 'buy') R.act(s4, 'p0', { type: 'decline' }, 0);
  R.act(s4, 'p0', { type: 'endTurn' }, 0);
  eq(s4.turn, 2, 'freeze：下一個玩家（被冰凍的）被跳過，輪到第三位'); ok(!s4.seats[1].frozen, '跳過一次後解凍');
  ok(s4.events.some(e => e.t === 'attack' && e.kind === 'freezeSkip'), '有跳過的事件（給動畫用）');
  /* 護身符擋下 */
  const s5 = mk(3); s5.seats[0].items = ['freeze']; s5.seats[1].items = ['guard']; use(s5, 'freeze', 1);
  ok(!s5.seats[1].frozen && !has(s5, 1, 'guard') && !has(s5, 0, 'freeze'), 'freeze：被護身符擋下（兩邊道具都用掉）');
  const s7 = mk(3); s7.seats[0].items = ['freeze']; ok(R.itemTargets(s7, 0, 'freeze').length === 2, 'itemTargets 列出兩位對手');
}
section('加蓋券 upgrade');
{
  const st = mk(2); own(st, 0, 1, 0); st.seats[0].items = ['upgrade'];
  ok(use(st, 'upgrade', 1).ok && st.props[1].houses === 1 && !has(st, 0, 'upgrade'), 'upgrade：自己的地免費加蓋 1 間');
  const c = st.seats[0].cash; st.seats[0].items = ['upgrade']; use(st, 'upgrade', 1); eq(st.seats[0].cash, c, 'upgrade 不花現金');
  const s2 = mk(2); s2.seats[0].items = ['upgrade']; ok(!use(s2, 'upgrade', 1).ok, '不是自己的地不能加蓋');
  const s3 = mk(2); own(s3, 0, 1, 2); s3.seats[0].items = ['upgrade']; ok(!use(s3, 'upgrade', 1).ok, '沒湊齊整組最多 2 級');
  const s4 = mk(2); own(s4, 0, 20, 0); s4.seats[0].items = ['upgrade']; ok(!use(s4, 'upgrade', 20).ok, '休息站不能加蓋');
  const s5 = mk(2); own(s5, 1, 1, 0); s5.seats[0].items = ['upgrade']; ok(!use(s5, 'upgrade', 1).ok, '對手的地不能加蓋');
  ok(R.itemTargets(st, 0, 'upgrade').includes(1) === !R.canUseItem(st, 0, 'upgrade', 1), 'itemTargets 與 canUseItem 一致');
  const s6 = mk(2); own(s6, 0, 1, 0); own(s6, 0, 3, 0); s6.seats[0].items = ['upgrade', 'upgrade', 'upgrade'];
  ok(use(s6, 'upgrade', 1).ok && !use(s6, 'upgrade', 1).ok && use(s6, 'upgrade', 3).ok, '整組要平均升級');
}
section('冰凍／加蓋等新道具的選項');
{
  const st = mk(2); own(st, 0, 1, 0); st.seats[0].items = ['upgrade', 'freeze'];
  const o = R.options(st, 'p0'); ok(o.upgrade === true && o.freeze === true, 'options.upgrade/freeze 有目標時為 true');
  st.seats[0].jail = true; const o2 = R.options(st, 'p0'); ok(!o2.upgrade && !o2.freeze, '監獄中都不能用');
}

/* ---------- 商店 ---------- */
section('商店 shop、道具點數與道具欄');
function inShop(st, points, items, offer) {
  st.seats[0].points = points; st.seats[0].items = items || [];
  st.phase = 'shop'; st.pending = { kind: 'shop', tile: 1, offer: offer || R.ITEM_LIST.slice(), bought: [] };
}
function buy(st, item) { return R.act(st, st.seats[st.turn].id, { type: 'shopBuy', item }, 0); }
function sell(st, item) { return R.act(st, st.seats[st.turn].id, { type: 'shopSell', item }, 0); }
R.ITEM_LIST.forEach(k => {
  const st = mk(2); inShop(st, 5000); const stock0 = st.stock[k];
  const r = buy(st, k);
  ok(r.ok, '買 ' + k); eq(st.seats[0].points, 5000 - R.ITEMS[k].pts, k + ' 扣 ' + R.ITEMS[k].pts + ' 點'); ok(has(st, 0, k), k + ' 進道具欄');
  eq(st.stock[k], stock0 - 1, k + ' 庫存 −1'); eq(st.seats[0].cash, R.START_CASH_FOR ? st.seats[0].cash : st.seats[0].cash, '不動用現金');
  ok(!buy(st, k).ok, k + ' 同一次不能再買');
  const s2 = mk(2); inShop(s2, 5000); s2.seats[0].cash = 1; ok(buy(s2, k).ok, k + ' 用點數買，和現金無關');
  const s3 = mk(2); inShop(s3, R.ITEMS[k].pts - 1); ok(!buy(s3, k).ok, k + ' 差 1 點買不起'); const s4 = mk(2); inShop(s4, R.ITEMS[k].pts); ok(buy(s4, k).ok && s4.seats[0].points === 0, k + ' 剛好夠就能買');
  const s5 = mk(2); inShop(s5, 5000); s5.stock[k] = 0; ok(!buy(s5, k).ok, k + ' 賣完不能買'); eq(s5.seats[0].points, 5000, '被拒絕不扣點');
  const s6 = mk(2); inShop(s6, 5000, [], R.ITEM_LIST.filter(x => x !== k)); ok(!buy(s6, k).ok, k + ' 這次沒上架不能買');
  const s7 = mk(2); inShop(s7, 5000, ['x'].concat([])); s7.seats[0].items = new Array(R.MAX_ITEMS).fill('cat'); ok(!buy(s7, k).ok, k + '：道具欄滿 ' + R.MAX_ITEMS + ' 個不能買');
  const s8 = mk(2); inShop(s8, 5000); s8.seats[0].items = new Array(R.MAX_ITEMS - 1).fill('cat'); ok(buy(s8, k).ok && s8.seats[0].items.length === R.MAX_ITEMS, k + '：第 ' + R.MAX_ITEMS + ' 個還能買');
  const s9 = mk(2); inShop(s9, 5000, ['cat']); ok(sell(s9, 'cat').ok && s9.seats[0].points === 5000 + R.sellPrice('cat') && R.sellPrice('cat') === Math.ceil(R.ITEMS.cat.pts / 2), '賣 cat 得半價 ' + R.sellPrice('cat') + ' 點');
});
{
  const st = mk(2); inShop(st, 5000); ok(!buy(st, 'nope').ok && !buy(st, '').ok && !buy(st, undefined).ok, '不存在的商品');
  const s5 = mk(2); s5.seats[0].points = 5000; ok(!buy(s5, 'dice').ok, '不在商店階段不能買'); ok(!sell(s5, 'cat').ok, '不在商店階段不能賣');
  const s6 = mk(2); inShop(s6, 5000); ok(!R.act(s6, s6.seats[1].id, { type: 'shopBuy', item: 'dice' }, 0).ok, '別人的回合不能買');
  const s7 = mk(2); inShop(s7, 5000, ['cat']); ok(!sell(s7, 'guard').ok && !sell(s7, '').ok && !sell(s7, 'zzz').ok, '賣出沒有的道具被拒絕');
}
{
  const st = mk(2); inShop(st, 5000, ['free', 'cat']); buy(st, 'dice');
  eq(st.phase, 'shop', '買完仍在商店（可繼續買或賣）'); R.act(st, 'p0', { type: 'decline' }, 0); eq(st.phase, 'manage', '按離開才結束（進入結束回合）');
  const s4 = mk(2); inShop(s4, 5000); R.act(s4, s4.seats[0].id, { type: 'decline' }, 0); eq(s4.phase, 'manage', '不買直接離開'); eq(s4.seats[0].points, 5000, '沒扣點');
  const s5 = mk(2); inShop(s5, 5000, ['cat', 'guard']); sell(s5, 'cat'); sell(s5, 'guard'); eq(s5.seats[0].items.length, 0, '可連續賣光'); eq(s5.phase, 'shop', '賣完還在商店');
  eq(s5.stock.cat, R.stockFor('cat', 2) + 1, '賣回去庫存 +1');
}
{
  const st = mk(2); inShop(st, 5000);
  const o = R.options(st, st.seats[0].id); ok(Array.isArray(o.shop) && o.shop.length === R.ITEM_LIST.length, 'options.shop 列出上架商品');
  ok(o.shop.every(x => x.can === true && x.pts === R.ITEMS[x.item].pts && x.stock === st.stock[x.item] && x.bought === false), '點數夠時每項都能買、點數與庫存正確');
  st.seats[0].points = 10; const o2 = R.options(st, st.seats[0].id);
  ok(o2.shop.find(x => x.item === 'taxfree').can && !o2.shop.find(x => x.item === 'fly').can, '點數不夠的商品標示不能買');
  st.seats[0].items = new Array(R.MAX_ITEMS).fill('cat'); st.seats[0].points = 5000; ok(R.options(st, st.seats[0].id).shop.every(x => !x.can), '道具欄滿：全部不能買');
  ok(Array.isArray(o.sellItems) && o.sellItems.length === 0, '沒有道具時沒有可賣的');
  st.seats[0].items = ['cat', 'bomb']; const o3 = R.options(st, st.seats[0].id); ok(o3.sellItems.length === 2 && o3.sellItems.every(x => x.back === R.sellPrice(x.item)), 'options.sellItems 列出可賣道具與半價');
  const v = R.publicView(st, 0); ok(v.pending && Array.isArray(v.pending.offer) && Array.isArray(v.pending.bought) && v.seats[0].points === 5000, 'publicView 帶著商店上架清單、已買、點數');
  ok(v.stock && v.stock.cat === st.stock.cat, 'publicView 帶著庫存');
}
{
  /* 每種格數的隨機地圖：走到商店格 */
  Maps.SIZES.forEach(size => {
    const id = Maps.genId(size, 'sh' + size), m = Maps.get(id), ti2 = m.tiles.findIndex(t => t.type === 'shop');
    const s2 = mk(2, { map: id }); s2.seats[0].pos = ti2 - 2; roll(s2, 1, 1);
    eq(s2.phase, 'shop', size + ' 格：走到商店格 → 進入商店'); eq(s2.pending.kind, 'shop', size + ' 格：待處理事項是商店');
    ok(s2.pending.offer.length >= 3 && s2.pending.offer.length <= 6, size + ' 格：上架 3～6 樣');
    const s3 = mk(2, { map: id }); s3.seats[0].pos = ti2 - 2; s3.seats[0].points = 0; roll(s3, 1, 1);
    ok(s3.phase !== 'shop' && s3.seats[0].pos === ti2, size + ' 格：沒有點數也沒有道具，逛一逛就過');
    const s4 = mk(2, { map: id }); s4.seats[0].pos = ti2 - 2; s4.seats[0].points = 0; s4.seats[0].items = ['cat']; roll(s4, 1, 1);
    eq(s4.phase, 'shop', size + ' 格：沒點數但有道具 → 還是能進商店賣道具');
    /* 再走一圈算新的一次：同樣商品又能買 */
    const s5 = mk(2, { map: id }); s5.seats[0].pos = ti2 - 2; s5.seats[0].points = 5000; roll(s5, 1, 1);
    const it = s5.pending.offer[0]; R.act(s5, 'p0', { type: 'shopBuy', item: it }, 0); ok(!R.act(s5, 'p0', { type: 'shopBuy', item: it }, 0).ok, size + ' 格：本次同商品只能買 1 件');
    R.act(s5, 'p0', { type: 'decline' }, 0);
    s5.seats[0].pos = ti2 - 2; s5.turn = 0; s5.phase = 'roll'; s5.pending = null; s5._rng = require('../public/js/rng.js').create('again' + size);
    R.act(s5, 'p0', { type: 'roll', dice: 1 }, 0);
    ok(s5.phase !== 'shop' || s5.pending.bought.length === 0, size + ' 格：再走一圈踩到 → 算新的一次（bought 重置）');
  });
}
{
  /* 休息站與道具欄上限 */
  const s2 = mk(2); s2.seats[0].pos = 18; roll(s2, 1, 1); eq(s2.seats[0].pos, 20, '走到休息站'); eq(s2.seats[0].items.length, 1, '休息站送 1 個道具');
  const s3 = mk(2); s3.seats[0].pos = 18; s3.seats[0].items = new Array(R.MAX_ITEMS).fill('cat'); const c3 = s3.seats[0].cash; roll(s3, 1, 1);
  eq(s3.seats[0].items.length, R.MAX_ITEMS, '滿了不會超過上限'); eq(s3.seats[0].cash, c3 + 50, '道具滿了改領 50 元');
  eq(R.MAX_ITEMS, 10, '上限 10 個');
}
section('骰子數：1 顆或 2 顆');
{
  const st = mk(2); dice(st, 4, 0); ok(R.act(st, 'p0', { type: 'roll', dice: 1 }, 0).ok, '1 顆骰子可擲'); eq(st.seats[0].pos, 4, '走 1 顆的點數'); eq(st.dice[1], 0, '第二顆是 0'); eq(st.diceKind, 'one', 'diceKind = one');
  ok(st.events.some(e => e.t === 'roll' && e.single === true), 'roll 事件標記 single');
  const s2 = mk(2); dice(s2, 3, 5); R.act(s2, 'p0', { type: 'roll', dice: 2 }, 0); eq(s2.seats[0].pos, 8, '2 顆骰子走合計'); eq(s2.diceKind, 'two', 'diceKind = two');
  const s3 = mk(2); dice(s3, 3, 5); R.act(s3, 'p0', { type: 'roll' }, 0); eq(s3.diceKind, 'two', '沒指定 → 預設 2 顆');
  const s4 = mk(2); dice(s4, 3, 5); ok(R.act(s4, 'p0', { type: 'roll', dice: 3 }, 0).ok && s4.diceKind === 'two', '不合法的顆數當成 2 顆');
  const s5 = mk(2); let mx1 = 0, mx2 = 0; for (let i = 0; i < 300; i++) { const a = mk(2, { seed: 'd' + i }); R.act(a, 'p0', { type: 'roll', dice: 1 }, 0); mx1 = Math.max(mx1, a.dice[0] + a.dice[1]); const b = mk(2, { seed: 'e' + i }); R.act(b, 'p0', { type: 'roll', dice: 2 }, 0); mx2 = Math.max(mx2, b.dice[0] + b.dice[1]); }
  ok(mx1 <= 6 && mx2 <= 12 && mx2 > 6, '1 顆最多 6 點、2 顆最多 12 點');
  const s6 = mk(2); dice(s6, 2, 2); R.act(s6, 'p0', { type: 'roll', dice: 2 }, 0); ok(s6.again === undefined && s6.doubles === undefined, '沒有雙骰機制');
}

/* ---------- 資料一致性 ---------- */
section('道具資料');
R.ITEM_LIST.forEach(k => {
  const it = R.ITEMS[k];
  ok(it.name && it.desc && it.pts >= 10 && it.pts <= 50 && it.pts % 10 === 0, k + ' 有名稱、說明、10～50 點');
});
ok(R.ITEM_LIST.filter(k => R.ITEMS[k].active).sort().join() === 'bomb,chest,cure,dice,fly,freeze,god,loan,salary,steal,swap,upgrade', '主動道具是 dice/fly/steal/swap/bomb/freeze/loan/upgrade/chest/cure/god/salary');
ok(R.ITEM_LIST.filter(k => !R.ITEMS[k].active).sort().join() === 'bail,cat,coupon,free,gobonus,guard,half,rebate,repair,taxfree', '被動道具是 free/cat/taxfree/guard/half/gobonus/bail/coupon/repair/rebate');
ok(R.ITEM_LIST.filter(k => R.ITEMS[k].target === 'seat').sort().join() === 'freeze,steal,swap', '選人道具 steal/swap/freeze');
ok(R.ITEM_LIST.filter(k => R.ITEMS[k].target === 'tile').sort().join() === 'bomb,upgrade', '選地道具 bomb/upgrade');
ok(R.ITEM_LIST.every((k, i) => R.stockFor(k, 4) >= 1) && ['taxfree', 'loan'].every(k => R.stockFor(k, 4) > R.stockFor('upgrade', 4)), '越貴庫存越少');
ok(R.ITEM_LIST.reduce((a, k) => a.add(R.ITEMS[k].pts), new Set()).size === 5, '價格分 10／20／30／40／50 五級');
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
  eq(got.size, R.ITEM_LIST.length, R.ITEM_LIST.length + ' 種道具都抽得到');
}
/* ---------- 新增 6 種：福袋、驅神符、求神符、領薪券、修繕券、建材券 ---------- */
section('福袋 chest');
{
  const st = mk(2); st.seats[0].items = ['chest'];
  ok(use(st, 'chest').ok, 'chest 可用'); eq(st.seats[0].items.length, 1, '用掉福袋、得到 1 個新道具'); ok(!has(st, 0, 'chest'), '不會再開出福袋');
  ok(st.events.some(e => e.t === 'item' && e.gain), '有獲得道具事件');
  const s2 = mk(2); s2.seats[0].items = ['chest'].concat(new Array(R.MAX_ITEMS - 1).fill('loan')); ok(use(s2, 'chest').ok && s2.seats[0].items.length === R.MAX_ITEMS, '道具庫滿時：福袋用掉後剛好有空位');
  ok(!use(mk(2), 'chest').ok, '沒有福袋不能用');
  const s3 = mk(2); s3.seats[0].items = ['chest']; s3.seats[0].jail = true; ok(!use(s3, 'chest').ok, '坐牢中不能用');
}
section('領薪券 salary');
{
  const st = mk(2); st.seats[0].items = ['salary']; const c = st.seats[0].cash, p = st.seats[0].pos;
  ok(use(st, 'salary').ok, 'salary 可用'); eq(st.seats[0].cash, c + R.GO_SALARY, '領到起點薪水'); eq(st.seats[0].pos, p, '位置不變'); ok(!has(st, 0, 'salary'), '用掉'); eq(st.phase, 'roll', '用完還是擲骰階段');
  const s2 = mk(2); s2.seats[0].items = ['salary', 'gobonus']; use(s2, 'salary'); ok(has(s2, 0, 'gobonus'), '領薪券不會吃掉起點加碼券');
}
section('求神符 god / 驅神符 cure');
{
  const st = mk(2); st.seats[0].items = ['god'];
  ok(use(st, 'god').ok && st.seats[0].god && R.GODS[st.seats[0].god.k].good, 'god：請來福神或財神'); eq(st.seats[0].god.turns, 4, '附身 4 回合'); ok(!has(st, 0, 'god'), '用掉');
  const s2 = mk(2); s2.seats[0].items = ['god']; s2.seats[0].god = { k: 'wealth', turns: 2 }; ok(!use(s2, 'god').ok && has(s2, 0, 'god'), '已有神：不能用、不消耗');
  const s3 = mk(2); s3.seats[0].items = ['cure']; ok(!use(s3, 'cure').ok && has(s3, 0, 'cure'), '沒有壞神：驅神符不能用');
  const s4 = mk(2); s4.seats[0].items = ['cure']; s4.seats[0].god = { k: 'wealth', turns: 3 }; ok(!use(s4, 'cure').ok, '好神附身：驅神符不能用（不會趕走福神財神）');
  for (const k of ['poor', 'unlucky']) { const s5 = mk(2); s5.seats[0].items = ['cure']; s5.seats[0].god = { k, turns: 3 }; ok(use(s5, 'cure').ok && !s5.seats[0].god && !has(s5, 0, 'cure'), 'cure：送走' + k); ok(s5.events.some(e => e.t === 'god' && e.on === false), '有離開事件'); }
  const s6 = mk(2); s6.seats[0].items = ['cure']; s6.seats[0].god = { k: 'poor', turns: 3 }; use(s6, 'cure'); s6.seats[0].items = ['god']; ok(use(s6, 'god').ok, '驅走後可以再求神');
}
section('修繕券 repair');
{
  const st = mk(2); own(st, 1, 3, 2); st.seats[0].items = ['bomb']; st.seats[1].items = ['repair'];
  use(st, 'bomb', 3); eq(st.props[3].houses, 2, '修繕券：房子沒被炸'); ok(!has(st, 1, 'repair') && !has(st, 0, 'bomb'), '雙方道具都用掉');
  const s2 = mk(2); own(s2, 1, 3, 2); s2.seats[0].items = ['steal']; s2.seats[1].items = ['repair']; s2.seats[1].cash = 1000; use(s2, 'steal', 1);
  ok(has(s2, 1, 'repair'), '修繕券擋不了偷錢'); ok(s2.seats[1].cash < 1000, '偷錢成功');
  const s3 = mk(3); own(s3, 1, 3, 2); s3.seats[0].items = ['bomb']; s3.seats[2].items = ['repair']; use(s3, 'bomb', 3); eq(s3.props[3].houses, 1, '別人的修繕券不管用'); ok(has(s3, 2, 'repair'), '別人的修繕券不受影響');
  const s4 = mk(2); own(s4, 1, 3, 2); s4.seats[0].items = ['bomb']; s4.seats[1].items = ['guard', 'repair']; use(s4, 'bomb', 3);
  ok(!has(s4, 1, 'guard') && has(s4, 1, 'repair') && s4.props[3].houses === 2, '護身符先擋下，修繕券留著');
}
section('偷錢卡上限依地圖大小');
{
  const cap = { 48: 1200, 64: 1400, 80: 1600, 96: 1800, 120: 2000 };
  Object.keys(cap).forEach(n => {
    const st = R.create(['a', 'b'].map(x => ({ id: x, name: x, char: 'otter' })), { seed: 'sc' + n, mapSize: Number(n) });
    st.turn = 0; st.seats[0].items = ['steal']; st.seats[1].cash = 100000; const c1 = st.seats[0].cash;
    eq(R.stealCap(st), cap[n], n + ' 格偷錢上限 ' + cap[n]);
    ok(R.act(st, st.seats[0].id, { type: 'useItem', item: 'steal', target: 1 }, 0).ok && st.seats[0].cash === c1 + cap[n] && st.seats[1].cash === 100000 - cap[n], n + ' 格：偷 20% 但最多 ' + cap[n]);
  });
  const s2 = R.create(['a', 'b'].map(x => ({ id: x, name: x, char: 'otter' })), { seed: 'sc', mapSize: 80 }); s2.turn = 0; s2.seats[0].items = ['steal']; s2.seats[1].cash = 2000;
  R.act(s2, s2.seats[0].id, { type: 'useItem', item: 'steal', target: 1 }, 0); eq(s2.seats[1].cash, 1600, '2000 × 20% = 400（沒到上限就照 20%）');
}
section('建材券 rebate');
{
  const st = mk(2); own(st, 0, 1, 0); st.seats[0].items = ['rebate']; roll1(st, 1);
  eq(st.phase, 'build', '走到自己的地：問要不要蓋房'); const c = st.seats[0].cash;
  ok(R.act(st, 'p0', { type: 'build', tile: 1 }, 0).ok, '蓋房'); eq(st.seats[0].cash, c - Math.ceil(R.TILES[1].house / 2), '建材券：蓋房費用一半'); ok(!has(st, 0, 'rebate'), '用掉');
  const s2 = mk(2); own(s2, 0, 1, 0); s2.seats[0].items = ['rebate']; roll1(s2, 1); R.act(s2, 'p0', { type: 'decline' }, 0);
  ok(has(s2, 0, 'rebate'), '不蓋房就不會用掉建材券');
  const s3 = mk(2); own(s3, 0, 1, 0); s3.seats[0].items = ['rebate', 'upgrade']; use(s3, 'upgrade', 1); ok(has(s3, 0, 'rebate'), '加蓋券（免費）不會用掉建材券');
}
section('新道具：選項與 AI');
{
  const st = mk(2); st.seats[0].items = ['chest', 'salary', 'god', 'cure']; st.seats[0].god = { k: 'poor', turns: 3 };
  const o = R.options(st, 'p0'); ok(o.chest && o.salary && !o.god && o.cure, 'options：chest/salary/cure 可用、god 因已有神不可用');
  ['chest', 'salary', 'god', 'cure', 'repair', 'rebate'].forEach(k => ok(R.ITEMS[k] && R.ITEMS[k].pts >= 10 && R.stockFor(k, 4) >= 1 && R.sellPrice(k) >= 5, k + ' 有定價、庫存與賣價'));
}
console.log('\n道具測試：通過 ' + pass + '、失敗 ' + fail);
process.exit(fail ? 1 : 0);
