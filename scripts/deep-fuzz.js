/* 深度規則模糊測試：所有道具（含偷錢／換位／炸彈／護身符）、財神、蓋房詢問、負債，隨機打很多局。
 * 檢查：1) options 列出的動作，act 一定要接受；2) 被拒絕的動作不能改動狀態；3) 每一步都符合不變條件
 * （現金為整數且非 NaN、位置合法、地產主人合法、道具不超過上限、階段與 pending 對得上）；4) 不會卡死。 */
'use strict';
const R = require('../public/js/rules.js');
let bad = 0, games = 0, moves = 0, endings = {}, usedItems = {};
const SEEDS = Number(process.env.FUZZ_GAMES || 300);
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const fail = (m) => { bad++; if (bad < 25) console.log('✘ ' + m); };
function snap(st) { return JSON.stringify({ t: st.turn, p: st.phase, v: st.version, s: st.seats.map(s => [s.cash, s.pos, s.items, s.god, s.jail, s.bankrupt]), pr: st.props, pend: st.pending }); }
function invariants(st, g) {
  const T = R.tl(st), n = st.seats.length;
  st.seats.forEach((s, i) => {
    if (!Number.isInteger(s.cash)) fail('局' + g + ' ' + s.name + ' 現金不是整數：' + s.cash);
    if (!(s.pos >= 0 && s.pos < T.length)) fail('局' + g + ' 位置不合法 ' + s.pos);
    if (s.items.length > R.MAX_ITEMS) fail('局' + g + ' 道具超過上限');
    if (s.items.some(k => !R.ITEMS[k])) fail('局' + g + ' 出現不明道具 ' + s.items);
    if (s.god && !R.GODS[s.god.k]) fail('局' + g + ' 不明的神 ' + JSON.stringify(s.god));
    if (s.god && !(s.god.turns >= 0)) fail('局' + g + ' 神附身回合數不合法');
    if (s.bankrupt && ((st.props.some(p => p.owner === i)) )) fail('局' + g + ' 破產者還有地產');
  });
  st.props.forEach((p, i) => {
    if (!(p.owner === -1 || (p.owner >= 0 && p.owner < n))) fail('局' + g + ' 地產 ' + i + ' 主人不合法 ' + p.owner);
    if (p.owner === -1 && p.houses) fail('局' + g + ' 無主地有房子 ' + i);
    if (p.houses < 0 || p.houses > 5) fail('局' + g + ' 房子數不合法 ' + i + ':' + p.houses);
    if (p.owner !== -1 && T[i].type !== 'prop' && !T[i].price) fail('局' + g + ' 不能買的格子有主人 ' + i);
  });
  if (st.phase !== 'over') {
    if (st.seats[st.turn].bankrupt) fail('局' + g + ' 輪到已破產的人');
    if (['buy', 'build', 'shop', 'debt'].includes(st.phase) && !st.pending) fail('局' + g + ' 階段 ' + st.phase + ' 沒有 pending');
    if (!['buy', 'build', 'shop', 'debt'].includes(st.phase) && st.pending) fail('局' + g + ' 階段 ' + st.phase + ' 卻有 pending ' + JSON.stringify(st.pending));
  }
}
for (let g = 0; g < SEEDS; g++) {
  const rand = rnd(g * 7 + 3), n = 2 + Math.floor(rand() * 7);
  const ps = []; for (let i = 0; i < n; i++) ps.push({ id: 'p' + i, name: 'P' + i, char: 'otter' });
  const mapSize = R.MAPS.SIZES[g % R.MAPS.SIZES.length];
  const st = R.create(ps, { seed: 'd' + g, roundLimit: 25, mapSize });
  /* 讓道具一開始就很多，才測得到 */
  st.seats.forEach(s => { while (s.items.length < 3) s.items.push(R.ITEM_LIST[Math.floor(rand() * R.ITEM_LIST.length)]); });
  let now = 0, stall = 0, last = '';
  for (let step = 0; step < 8000 && st.phase !== 'over'; step++) {
    now += 1000;
    const id = st.seats[st.turn].id, si = st.turn, s = st.seats[si];
    /* 隨機補道具／神，讓所有分支都被走到 */
    if (rand() < 0.05 && s.items.length < R.MAX_ITEMS) s.items.push(R.ITEM_LIST[Math.floor(rand() * R.ITEM_LIST.length)]);
    const o = R.options(st, id);
    /* 列出所有「options 說可以」的動作 */
    const acts = [];
    ['roll', 'payJail', 'useCard', 'buy', 'decline', 'settle', 'bankrupt', 'endTurn'].forEach(k => { if (o[k]) acts.push(k === 'roll' ? { type: 'roll', dice: rand() < 0.5 ? 1 : 2 } : { type: k }); });
    ['build', 'sell', 'buyout'].forEach(k => o[k].forEach(t => acts.push({ type: k, tile: t })));
    if (o.dice) for (let k = 1; k <= 12; k++) acts.push({ type: 'useItem', item: 'dice', n: k });
    ['again', 'collect', 'chest', 'cure', 'god', 'salary'].forEach(k => { if (o[k]) acts.push({ type: 'useItem', item: k }); });
    if (o.upgrade) R.itemTargets(st, si, 'upgrade').forEach(t => acts.push({ type: 'useItem', item: 'upgrade', tile: t }));
    if (o.sellItems) o.sellItems.forEach(x => acts.push({ type: 'shopSell', item: x.item }));
    if (o.surge) R.itemTargets(st, si, 'surge').forEach(t => acts.push({ type: 'useItem', item: 'surge', tile: t }));
    ['steal', 'swap', 'freeze', 'grab', 'frame', 'equal'].forEach(k => { if (o[k]) R.itemTargets(st, si, k).forEach(t => acts.push({ type: 'useItem', item: k, target: t })); });
    if (o.shop && o.shop.length) o.shop.forEach(x => { if (x.can) acts.push({ type: 'shopBuy', item: x.item }); });
    if (o.bomb) R.itemTargets(st, si, 'bomb').forEach(t => acts.push({ type: 'useItem', item: 'bomb', tile: t }));
    ['free', 'cat', 'guard', 'reflect', 'seize', 'coupon'].forEach(k => { if (s.items.includes(k) && R.canUseItem && !R.canUseItem(st, si, k)) acts.push({ type: 'useItem', item: k }); });
    const main = acts.filter(a => !['sell', 'buyout', 'useItem', 'shopBuy', 'shopSell', 'bankrupt'].includes(a.type) || (a.type === 'bankrupt' && rand() < 0.3));
    if (!(o.roll || o.decline || o.buy || o.settle || o.bankrupt || o.endTurn)) { fail('卡死：局' + g + ' 階段 ' + st.phase + ' 沒有主要動作'); break; }
    const side = acts.filter(a => !main.includes(a));
    const a = rand() < 0.4 && side.length ? side[Math.floor(rand() * side.length)] : main.length ? main[Math.floor(rand() * main.length)] : { type: 'bankrupt' };
    const before = snap(st);
    const r = R.act(st, id, a, now);
    moves++;
    if (!r.ok) fail('局' + g + ' options 說可以、act 卻拒絕：階段 ' + st.phase + ' ' + JSON.stringify(a) + ' → ' + (r.err || r.msg || r.reason || JSON.stringify(r)));
    else if (a.type === 'shopSell') usedItems.shopSell = (usedItems.shopSell || 0) + 1;
    else if (a.type === 'shopBuy') usedItems.shopBuy = (usedItems.shopBuy || 0) + 1;
    else if (a.type === 'useItem') usedItems[a.item] = (usedItems[a.item] || 0) + 1;
    /* 亂丟不合法動作：必須被拒絕且不改動狀態 */
    if (rand() < 0.25) {
      const junk = [{ type: 'shopBuy', item: 'bomb' }, { type: 'shopBuy', item: 'zzz' }, { type: 'shopSell', item: 'zzz' }, { type: 'roll', dice: 7 }, { type: 'useItem', item: 'dice', n: 13 }, { type: 'useItem', item: 'freeze', target: 99 }, { type: 'useItem', item: 'upgrade', tile: 'q' }, { type: 'buy' }, { type: 'build', tile: 1 }, { type: 'useItem', item: 'steal', target: 99 }, { type: 'useItem', item: 'fly', tile: -3 }, { type: 'useItem', item: 'bomb', tile: 'x' },
        { type: 'useItem', item: 'nope' }, { type: 'settle' }, { type: 'mortgage', tile: 39 }, { type: 'buyout', tile: 1 }, { type: 'endTurn' }, { type: 'roll' }, { type: 'zzz' }, {}][Math.floor(rand() * 20)];
      const who = rand() < 0.5 ? id : st.seats[(si + 1) % st.seats.length].id;
      const o2 = R.options(st, who), b2 = snap(st);
      const legal = (junk.type === 'build' && o2.build.includes(junk.tile)) || (junk.type === 'shopBuy' && (o2.shop || []).some(x => x.can && x.item === junk.item)) || (junk.type === 'buy' && o2.buy) || (junk.type === 'endTurn' && o2.endTurn) || (junk.type === 'roll' && o2.roll) || (junk.type === 'settle' && o2.settle);
      const rr = R.act(st, who, junk, now);
      if (!legal && rr.ok) fail('局' + g + ' 不合法動作被接受：' + JSON.stringify(junk) + ' 階段 ' + st.phase);
      if (!rr.ok && snap(st) !== b2) fail('局' + g + ' 被拒絕的動作卻改了狀態：' + JSON.stringify(junk));
    }
    invariants(st, g);
    const sig = snap(st);
    if (sig === last || sig === before) stall++; else stall = 0;
    last = sig;
    if (stall > 300) { fail('原地打轉：局' + g + ' ' + st.phase); break; }
  }
  endings[st.phase === 'over' ? st.reason : 'unfinished'] = (endings[st.phase === 'over' ? st.reason : 'unfinished'] || 0) + 1;
  games++;
}
console.log('地圖：' + R.MAPS.LIST.map(m => m.id).join('、') + '；商店購買次數：' + (usedItems.shopBuy || 0));
console.log('結局分布：' + JSON.stringify(endings) + '；道具使用次數：' + JSON.stringify(usedItems));
console.log(bad ? '✘ 發現 ' + bad + ' 個問題' : '✔ ' + games + ' 局、' + moves + ' 步：不變條件全部成立');
process.exit(bad ? 1 : 0);
