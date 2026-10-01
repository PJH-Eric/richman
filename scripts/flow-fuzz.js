/* 流程卡死模糊測試：隨機（含亂按）操作，檢查任何時刻輪到的人都「有路可走」，且遊戲一定會推進。 */
const R = require('../public/js/rules.js');
let bad = 0, games = 0, moves = 0;
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
for (let g = 0; g < 400; g++) {
  const rand = rnd(g + 1), n = 2 + Math.floor(rand() * 7);
  const ps = []; for (let i = 0; i < n; i++) ps.push({ id: 'p' + i, name: 'P' + i, char: 'otter' });
  const st = R.create(ps, { seed: 'f' + g, roundLimit: 25, mapSize: R.MAPS.SIZES[g % R.MAPS.SIZES.length] });
  let now = 0, stall = 0, last = '';
  for (let step = 0; step < 6000 && st.phase !== 'over'; step++) {
    now += 1000;
    const id = st.seats[st.turn].id, o = R.options(st, id);
    const legal = ['roll', 'payJail', 'useCard', 'buy', 'decline', 'settle', 'bankrupt', 'endTurn'].filter(k => o[k]);
    ['build', 'sell', 'buyout'].forEach(k => o[k].forEach(t => legal.push(k + ':' + t)));
    if (o.dice) legal.push('useItem:dice'); 
    const mainOk = o.roll || o.decline || o.buy || o.settle || o.bankrupt || o.endTurn;
    if (!mainOk) { bad++; console.log('✘ 卡死：局' + g + ' 階段 ' + st.phase + ' 輪到 ' + id + ' 沒有主要動作'); break; }
    /* 偏向推進主線，偶爾亂用管理／道具 */
    let pick;
    const main = legal.filter(k => !k.includes(':') && k !== 'bankrupt');
    if (rand() < 0.3 && legal.length > main.length) pick = (() => { const x = legal.filter(k => k.includes(':')); return x[Math.floor(rand() * x.length)]; })();
    else if (main.length) pick = main[Math.floor(rand() * main.length)];
    else pick = 'bankrupt';
    let act;
    if (pick.includes(':')) { const [t, x] = pick.split(':'); act = t === 'useItem' ? (x === 'dice' ? { type: 'useItem', item: 'dice', n: 1 + Math.floor(rand() * 6) } : { type: 'useItem', item: 'dice', n: 1 + Math.floor(rand() * 12) }) : { type: t, tile: Number(x) }; }
    else act = { type: pick };
    const r = R.act(st, id, act, now);
    moves++;
    const sig = st.turn + ':' + st.phase + ':' + st.round + ':' + st.seats.map(s => s.cash + '/' + s.pos).join();
    if (!r.ok) { stall++; } else if (sig === last) stall++; else stall = 0;
    last = sig;
    if (stall > 200) { bad++; console.log('✘ 原地打轉：局' + g + ' ' + st.phase + ' 動作 ' + JSON.stringify(act)); break; }
  }
  games++;
}
console.log(bad ? '✘ 發現 ' + bad + ' 個流程問題' : '✔ ' + games + ' 局、' + moves + ' 步隨機操作：沒有卡死');
process.exit(bad ? 1 : 0);
