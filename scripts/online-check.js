/* ===== scripts/online-check.js — 線上房間生命週期測試（node scripts/online-check.js） =====
 *
 * 1. 真的開一台伺服器、用多個 WebSocket 用戶端走一遍：
 *    建房、加入、觀戰、邀請連結（驗證／撤銷／重發）、權限、聊天、準備、開局、
 *    輪到誰才能動、觀戰者不能操作、斷線重連拿回座位、踢人、房間清空後關閉與邀請失效。
 * 2. 用假時鐘直接驅動 hub，把一整局（真人不動＋電腦）快轉打完，並測想太久／斷線太久由電腦代打。
 */
'use strict';

const { createServer } = require('../server.js');
const { createHub, TURN_MS } = require('../lib/rooms.js');
const Rules = require('../public/js/rules.js');

let pass = 0, fail = 0;
function ok(v, name) { if (v) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(port, key, name, char) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const c = { ws, msgs: [], room: undefined, lobby: [], errors: [], me: null, closed: false };
    c.send = m => ws.send(JSON.stringify(m));
    c.act = (type, extra) => c.send({ type: 'act', action: Object.assign({ type }, extra || {}) });
    c.wait = async (pred, ms) => {
      const end = Date.now() + (ms || 3000);
      while (Date.now() < end) { const r = pred(c); if (r) return r; await sleep(15); }
      return null;
    };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      c.msgs.push(m);
      if (m.type === 'room') c.room = m.room;
      if (m.type === 'lobby') c.lobby = m.rooms;
      if (m.type === 'welcome') c.me = m;
      if (m.type === 'error') c.errors.push(m);
    };
    ws.onopen = () => { c.send({ type: 'hello', key, name, char }); };
    ws.onclose = () => { c.closed = true; };
    ws.onerror = reject;
    const t = setInterval(() => { if (c.me) { clearInterval(t); resolve(c); } }, 10);
  });
}

async function liveTest() {
  console.log('\n[真的連線：房間生命週期]');
  const app = createServer();
  app.start();
  await new Promise(r => app.server.listen(0, r));
  const port = app.server.address().port;

  const health = await (await fetch('http://127.0.0.1:' + port + '/health')).json();
  ok(health.ok && health.game === 'richman', '/health 回報正常');
  const pres = await (await fetch('http://127.0.0.1:' + port + '/api/presence')).json();
  ok(pres.gameId === 'richman', '/api/presence 可給遊戲大廳查人數');

  const host = await client(port, 'key-host-123', '房主', 'otter');
  const bob = await client(port, 'key-bob-4567', '小明', 'bunny');
  const spec = await client(port, 'key-spec-890', '路人', 'cat');
  ok(host.me && host.me.name === '房主', 'hello 後拿到身分');

  host.send({ type: 'create', max: 3, pace: 'fast', roundLimit: 25 });
  await host.wait(c => c.room);
  const rid = host.room.id;
  ok(host.room.you.host && host.room.you.role === 'player', '建房者是房主也是玩家');
  ok(host.room.max === 3 && host.room.pace === 'fast' && host.room.roundLimit === 25, '建房設定生效（人數、節奏、回合上限）');
  ok(await bob.wait(c => c.lobby.some(r => r.id === rid && r.roundLimit === 25)), '大廳列表看得到新房間與回合上限');

  const tok = host.room.invite.token;
  bob.send({ type: 'inviteInfo', invite: tok });
  const info = await bob.wait(c => c.msgs.find(m => m.type === 'inviteInfo'));
  ok(info && info.ok && info.id === rid, '邀請連結可以查到房間');
  bob.send({ type: 'join', invite: tok, as: 'player' });
  await bob.wait(c => c.room && c.room.id === rid);
  ok(bob.room.you.role === 'player', '用邀請連結加入遊戲 → 玩家');

  spec.send({ type: 'join', roomId: rid, as: 'spectator' });
  await spec.wait(c => c.room && c.room.id === rid);
  ok(spec.room.you.role === 'spectator', '選觀戰 → 觀戰者');

  /* 權限 */
  spec.send({ type: 'settings', max: 2 });
  await spec.wait(c => c.errors.length);
  ok(spec.errors.some(e => /房主/.test(e.text)), '非房主不能改設定');
  bob.send({ type: 'start' });
  await bob.wait(c => c.errors.length);
  ok(bob.errors.some(e => /房主/.test(e.text)), '非房主不能開局');
  spec.send({ type: 'ready', ready: true });
  await spec.wait(c => c.errors.length >= 2);
  ok(spec.errors.some(e => /觀戰者/.test(e.text)), '觀戰者不用準備');
  bob.send({ type: 'settings', roundLimit: 0 });
  await bob.wait(c => c.errors.length >= 2);
  ok(host.room.roundLimit === 25, '玩家不能改回合上限');

  /* 邀請：撤銷與重發 */
  host.send({ type: 'invite', revoke: true });
  await host.wait(c => c.room && !c.room.invite.active);
  const late = await client(port, 'key-late-111', '晚到', 'koala');
  late.send({ type: 'join', invite: tok, as: 'player' });
  await late.wait(c => c.errors.length);
  ok(late.errors.some(e => /撤銷/.test(e.text)), '撤銷後舊連結不能用');
  host.send({ type: 'invite' });
  await host.wait(c => c.room && c.room.invite.active && c.room.invite.token !== tok);
  ok(host.room.invite.token !== tok, '重發得到新 token');
  late.send({ type: 'join', invite: host.room.invite.token, as: 'player' });
  await late.wait(c => c.room && c.room.id === rid);
  ok(late.room.you.role === 'player', '新連結可以加入（第 3 個座位）');
  const late2 = await client(port, 'key-late-222', '又一個', 'penguin');
  late2.send({ type: 'join', roomId: rid, as: 'player' });
  await late2.wait(c => c.room && c.room.id === rid);
  ok(late2.room.you.role === 'spectator' && late2.msgs.some(m => m.type === 'notice'), '座位滿了想上桌 → 轉觀戰並提示');

  /* 聊天：觀戰者也能聊 */
  spec.send({ type: 'chat', text: '加油！' });
  ok(await host.wait(c => c.room && c.room.chat.some(m => m.text === '加油！' && m.spec)), '觀戰者的聊天大家都收到，且標示觀戰');

  /* 踢人 */
  host.send({ type: 'kick', personId: late2.me.personId });
  ok(await late2.wait(c => c.msgs.some(m => m.type === 'kicked')), '房主可以請人離開');
  late2.send({ type: 'join', roomId: rid, as: 'spectator' });
  ok(await late2.wait(c => c.errors.some(e => /請出/.test(e.text))), '被請出後短時間內不能再進來');

  /* 準備與開局 */
  host.send({ type: 'start' });
  await host.wait(c => c.errors.some(e => /準備/.test(e.text)));
  ok(host.errors.some(e => /準備/.test(e.text)), '有人沒準備不能開局');
  bob.send({ type: 'ready', ready: true });
  late.send({ type: 'ready', ready: true });
  await host.wait(c => c.room.seats.filter(s => s.ready).length === 2);
  host.send({ type: 'start' });
  const g = await host.wait(c => c.room && c.room.game);
  ok(!!g, '全員準備好 → 開局');
  const game = host.room.game;
  ok(game.seats.length === 3 && game.seats.every(s => s.cash === Rules.startCashFor(host.room.roundLimit, game.tiles.length) && s.pos === 0), '3 人各拿起始現金（依地圖大小倍率）、站在起點');
  ok(game.props.length === 64 && game.props.every(p => p.owner === -1), '預設 64 格、地都還沒有主人');
  ok(!JSON.stringify(host.room).includes('seed') && !JSON.stringify(host.room).includes('_decks'), '送到瀏覽器的資料沒有 seed 與牌堆');
  ok(spec.room.game && spec.room.you.role === 'spectator', '觀戰者也看到棋盤');
  ok(game.opts.roundLimit === 25 && game.turnLeftMs > 0, '對局帶入回合上限與回合倒數');

  /* 對局中想加入 → 觀戰 */
  const mid = await client(port, 'key-mid-333', '中途', 'shiba');
  mid.send({ type: 'join', roomId: rid, as: 'player' });
  await mid.wait(c => c.room && c.room.id === rid);
  ok(mid.room.you.role === 'spectator', '對局中加入只能觀戰');

  /* 輪到誰才能動 */
  const byId = { [host.me.personId]: host, [bob.me.personId]: bob, [late.me.personId]: late };
  const turnId = game.seats[game.turn].id;
  const cur = byId[turnId];
  const other = Object.values(byId).find(c => c !== cur);
  other.act('roll');
  ok(await other.wait(c => c.errors.some(e => /還沒輪到/.test(e.text))), '還沒輪到的人擲骰會被拒絕');
  spec.act('roll');
  ok(await spec.wait(c => c.errors.some(e => /觀戰者不能操作/.test(e.text))), '觀戰者不能操作');
  cur.act('endTurn');
  ok(await cur.wait(c => c.errors.some(e => /現在不能/.test(e.text))), '階段不對的操作被拒絕（還沒擲骰不能結束回合）');
  cur.act('roll');
  const rolled = await host.wait(c => c.room.game && c.room.game.dice[0] > 0, 3000);
  ok(!!rolled, '輪到的人擲骰 → 伺服器算出骰子並廣播');
  ok(host.room.game.events.some(e => e.t === 'roll'), '事件裡有擲骰紀錄（畫面用來播動畫）');
  const sum = host.room.game.dice[0] + host.room.game.dice[1];
  const seatNow = host.room.game.seats[game.turn];
  const mv = host.room.game.events.filter(e => e.t === 'move' && e.seat === game.turn)[0];
  ok(seatNow.pos === sum % 40 || (mv && mv.to === sum % 40) || host.room.game.turn !== game.turn || seatNow.jail, '棋子依骰子走到對的格子（' + sum + ' 步）');
  const buying = host.room.game.phase === 'buy';
  if (buying) {
    cur.act('buy');
    ok(await host.wait(c => c.room.game.props.some(p => p.owner === game.turn)), '買下地產後所有人都看到主人');
  } else ok(true, '（這次擲骰沒有停在空地上，略過買地）');

  /* 亂送的操作不會讓伺服器出錯 */
  cur.send({ type: 'act', action: { type: 'build', tile: 9999 } });
  cur.send({ type: 'act', action: { type: 'nonsense' } });
  cur.send({ type: 'act' });
  await sleep(100);
  ok(app.hub.rooms.has(rid) && !cur.closed, '亂送的操作被擋下，伺服器沒事');

  /* 斷線重連：同一把 key 拿回座位 */
  const bobKey = 'key-bob-4567';
  bob.ws.close();
  ok(await host.wait(c => c.room.seats.some(s => s.id === bob.me.personId && !s.online)), '斷線的人顯示離線');
  const bob2 = await client(port, bobKey, '小明', 'bunny');
  await bob2.wait(c => c.room && c.room.id === rid);
  ok(bob2.room && bob2.room.you.role === 'player' && bob2.me.personId === bob.me.personId, '重連後回到同一個座位');
  ok(bob2.room.game && bob2.room.game.seats.length === 3, '重連後拿到目前的棋局');

  /* 離開與關房 */
  for (const c of [spec, mid, late, bob2]) c.send({ type: 'leave' });
  await sleep(100);
  host.send({ type: 'leave' });
  await sleep(150);
  ok(!app.hub.rooms.has(rid), '最後一個真人離開 → 房間關閉');
  late2.send({ type: 'inviteInfo', invite: host.room ? host.room.invite.token : 'zzz' });
  const inv2 = await late2.wait(c => c.msgs.filter(m => m.type === 'inviteInfo').pop());
  ok(inv2 && !inv2.ok, '房間關閉後邀請連結失效');

  for (const c of [host, bob2, spec, late, late2, mid]) try { c.ws.close(); } catch (e) { /* 忽略 */ }
  app.stop();
  app.server.close();
}

function hubTest() {
  console.log('\n[假時鐘：整局快轉、電腦補位、想太久與斷線代打]');
  let now = 1000;
  const hub = createHub({ now: () => now });
  const a = hub.identify('aaaaaaaa1', '阿明', 'otter');
  const b = hub.identify('bbbbbbbb2', '小華', 'bunny');
  const { room } = hub.createRoom(a, { max: 4, pace: 'fast', roundLimit: 25 });
  hub.join(b, room.id, 'player');
  ok(hub.addAI(a, 'hard').ok && hub.addAI(a, 'kid').ok, '房主可以加電腦補位（可指定難度）');
  ok(!hub.addAI(a).ok, '座位滿了不能再加電腦');
  const kidAI = room.seats.find(s => s.kind === 'ai' && s.diff === 'kid');
  ok(!hub.setAIDiff(b, kidAI.id, 'hard').ok, '只有房主能改電腦難度');
  ok(hub.setAIDiff(a, kidAI.id, 'easy').ok && kidAI.diff === 'easy', '房主可以替單一電腦換難度');
  ok(room.seats.filter(s => s.kind === 'ai').map(s => s.diff).join(',') === 'hard,easy', '每個電腦的難度各自不同');
  ok(!hub.setAIDiff(a, kidAI.id, 'super').ok, '不存在的難度會被拒絕');
  hub.setReady(b, true);
  ok(hub.startGame(a).ok, '2 真人＋2 電腦開局');
  const st = room.game.state;
  ok(st.seats.filter(x => x.ai).map(x => x.ai).sort().join(',') === 'easy,hard', '開局後每個電腦照各自的難度出手');
  ok(st.opts.turnMs === TURN_MS.fast && st.opts.roundLimit === 25, '回合倒數與回合上限帶進對局');

  /* 兩位真人都不動：想太久 → 代打；連續想太久 → 掛機交給電腦；b 還會斷線 */
  hub.markOffline(b.id);
  let taken = false, autoSeen = false, afk = false, guard = 0;
  while (room.game && guard++ < 400000) {
    now += 20;
    hub.tick(now);
    if (!taken && st.seats.find(s => s.id === b.id).ai === 'normal') taken = true;
    if (st.seats.some(s => s.auto)) autoSeen = true;
    if (st.seats.some(s => s.afk)) afk = true;
  }
  ok(taken, '斷線超過 30 秒 → 電腦代打，對局不會卡住');
  ok(autoSeen, '真人想太久 → 這一步先由電腦代打');
  ok(afk, '連續想太久 → 視為掛機交給電腦');
  ok(!room.game && room.lastGame && room.lastGame.phase === 'over', '整局打完（真人不動也會因代打而結束）');
  ok(room.lastGame.ranking && room.lastGame.ranking.length === 4 && room.lastGame.winner === room.lastGame.ranking[0], '結算資料有完整名次');
  ok(room.lastGame.reason === 'roundLimit' || room.lastGame.reason === 'lastStanding', '結束原因：' + room.lastGame.reason);
  ok(room.seats.filter(s => s.kind === 'human').every(s => !s.ready), '結束後大家要重新按準備');
  now += 31000; hub.tick(now);
  ok(!room.seats.some(s => s.personId === b.id), '斷線太久的人在等待中讓出座位');
  hub.leave(a);
  ok(!hub.rooms.has(room.id), '沒有真人就關房');

  /* 回合上限由房主決定 */
  const c = hub.identify('cccccccc3', '阿志', 'cat');
  const d = hub.identify('dddddddd4', '小玉', 'koala');
  const r2 = hub.createRoom(c, { max: 4 }).room;
  ok(r2.roundLimit === 40, '沒指定時回合上限預設 40');
  hub.join(d, r2.id, 'player');
  ok(!hub.settings(d, { roundLimit: 0 }).ok, '只有房主能改回合上限');
  ok(hub.settings(c, { roundLimit: 50 }).ok && r2.roundLimit === 50, '房主改成 50 回合');
  ok(!hub.settings(c, { roundLimit: 7 }).ok || r2.roundLimit === 50, '不在選項裡的回合上限不生效');
  ok(hub.roomView(r2, d.id).roundLimit === 50 && hub.listRooms()[0].roundLimit === 50, '玩家與大廳都看得到回合上限');
  /* 地圖由房主決定 */
  ok(r2.mapSize === 64 && hub.roomView(r2, d.id).mapSize === 64, '沒指定時地圖大小預設 64 格');
  ok(!hub.settings(d, { mapSize: 48 }).ok, '只有房主能換地圖大小');
  ok(hub.settings(c, { mapSize: 48 }).ok && r2.mapSize === 48, '房主把地圖改成 48 格');
  ok(hub.settings(c, { mapSize: 50 }).ok && r2.mapSize === 48, '不在選項裡的格數不生效');
  ok(hub.settings(c, { mapSize: '../x' }).ok && r2.mapSize === 48, '亂填的格數不生效');
  ok(hub.roomView(r2, d.id).mapSize === 48 && hub.listRooms().some(x => x.mapSize === 48), '玩家與大廳都看得到地圖大小');
  ok(hub.createRoom(hub.identify('mapmapmap1', '地圖房主', 'cat'), { mapSize: 120 }).room.mapSize === 120, '建房時可以指定地圖大小');
  ok(hub.createRoom(hub.identify('mapmapmap2', '亂填房主', 'cat'), { mapSize: 7 }).room.mapSize === 64, '建房時亂填格數會退回 64'); 

  /* 真人中途離開 → 電腦代打，不影響其他人 */
  hub.addAI(c, 'normal');
  hub.setReady(d, true);
  ok(hub.startGame(c).ok, '2 真人＋1 電腦開局');
  hub.leave(d);
  ok(r2.game.state.seats.find(s => s.id === d.id).ai === 'normal', '對局中離開 → 位子交給電腦代打');
  ok(/^g48-/.test(r2.game.state.map) && r2.game.state.tiles.length === 48, '對局用的是房主選的格數（每局隨機生成的 48 格地圖）');
  const gs = r2.game.state;
  guard = 0;
  c.online = true;
  while (r2.game && guard++ < 200000 && !gs.seats.find(s => s.id === c.id).bankrupt) {
    now += 20; hub.tick(now);
    const cur = gs.seats[gs.turn];
    if (cur.id === c.id && !cur.auto) {
      const opt = Rules.options(gs, c.id);
      /* 真人 c 很認真：擲骰、買地、結束回合 */
      const r = opt.roll ? 'roll' : opt.buy ? 'buy' : opt.decline ? 'decline' : opt.endTurn ? 'endTurn' : opt.settle ? 'settle' : opt.bankrupt ? 'bankrupt' : null;
      if (r) hub.gameAct(c, { type: r });
    }
    if (gs.round > 8) break;
  }
  ok(gs.round > 8 || !r2.game, '真人一直操作、其他座位由電腦接手，可以連續打很多回合');
  hub.leave(c);

  /* 6 人房：上限、滿員、開局 */
  const h1 = hub.identify('hhhhhhh81', '六人房主', 'otter');
  const r8 = hub.createRoom(h1, { max: 6, pace: 'fast', roundLimit: 25 }).room;
  ok(r8.max === 6, '房間人數上限可以到 6');
  ok(hub.createRoom(hub.identify('hhhhhhh82', '過量', 'cat'), { max: 12 }).room.max === 6, '超過 6 人的設定會被壓回 6');
  let added = 0;
  while (hub.addAI(h1, 'normal').ok) added++;
  ok(added === 5 && r8.seats.length === 6, '加滿 5 個電腦＝6 人');
  ok(hub.startGame(h1).ok && r8.game.state.seats.length === 6, '6 人開局');
  let n8 = 0;
  const g8 = r8.game.state;
  while (g8.phase !== 'over' && n8++ < 200000) {
    now += 60; hub.tick(now);
    if (g8.seats[g8.turn].id === h1.id) {
      const o = Rules.options(g8, h1.id);
      const t = o.roll ? 'roll' : o.buy ? 'buy' : g8.phase === 'buy' || g8.phase === 'build' || g8.phase === 'shop' ? 'decline' : o.settle ? 'settle' : o.endTurn ? 'endTurn' : g8.phase === 'debt' ? 'bankrupt' : null;
      if (t) hub.gameAct(h1, { type: t });
    }
    if (g8.round > 10) break;
  }
  ok(g8.round > 10 || g8.phase === 'over', '6 人一起打得下去（' + g8.round + ' 回合）');

  /* 線上使用道具：item / tile / target 欄位要能通過伺服器過濾 */
  {
    const p1 = hub.identify('itemtest001', '道具測試', 'otter');
    const ri = hub.createRoom(p1, { max: 3, pace: 'fast', roundLimit: 25 }).room;
    hub.addAI(p1, 'normal'); hub.addAI(p1, 'normal');
    ok(hub.startGame(p1).ok, '道具測試開局');
    const gs = ri.game.state;
    const mine = () => gs.seats.findIndex(x => x.id === p1.id);
    const fresh = (item) => {
      gs.turn = mine(); gs.phase = 'roll'; gs.pending = null;
      const me = gs.seats[gs.turn]; me.items = [item]; me.cash = 3000; me.pos = 3; me.jail = false;
      gs.seats.forEach((x, k) => { if (k !== gs.turn) { x.pos = 14 + k; x.cash = 1500; x.jail = false; x.god = null; x.items = []; } });
      T8 = gs.tiles.findIndex((t, i) => i >= 6 && t.type === 'prop'); gs.props[T8].owner = -1;
      return me;
    };
    let T8 = 8;
    let me = fresh('fly');
    let r = hub.gameAct(p1, { type: 'useItem', item: 'fly', tile: T8 });
    ok(r && r.ok !== false && me.pos === T8 && gs.phase === 'buy', '線上：飛機飛到指定格，接著進入買地（階段 ' + gs.phase + '）');
    hub.gameAct(p1, { type: 'decline' });
    ok(Rules.options(gs, p1.id).endTurn || gs.turn !== mine(), '線上：飛機用完後可以結束回合');
    me = fresh('dice');
    r = hub.gameAct(p1, { type: 'useItem', item: 'dice', n: 3 });
    ok(me.pos !== 3 && !me.items.includes('dice'), '線上：遙控骰欄位 n 有送到並生效');
    me = fresh('steal'); const vic = gs.seats.findIndex((x, k) => k !== gs.turn), c0 = me.cash, v0 = gs.seats[vic].cash;
    r = hub.gameAct(p1, { type: 'useItem', item: 'steal', target: vic });
    ok(me.cash > c0 && gs.seats[vic].cash < v0, '線上：偷錢 target 有送到並生效');
    me = fresh('swap'); const o2 = gs.seats.findIndex((x, k) => k !== gs.turn); const op = gs.seats[o2].pos;
    hub.gameAct(p1, { type: 'useItem', item: 'swap', target: o2 });
    ok(me.pos === op || gs.seats[o2].pos === 3, '線上：換位 target 有送到並生效');
    me = fresh('bomb'); gs.props[16].owner = o2; gs.props[16].houses = 2;
    hub.gameAct(p1, { type: 'useItem', item: 'bomb', tile: 16 });
    ok(gs.props[16].houses < 2 || !me.items.includes('bomb'), '線上：炸彈 tile 有送到並生效');
    hub.leave(p1);
  }
}

async function closeTest() {
  console.log('\n[實體玩家歸零 → 房間自動關閉]');
  const app = createServer();
  app.start();
  await new Promise(r => app.server.listen(0, r));
  const port = app.server.address().port;
  const host = await client(port, 'key-close-host1', '房主', 'otter');
  const spec = await client(port, 'key-close-spec1', '觀戰者', 'cat');
  host.send({ type: 'create', max: 3, pace: 'fast' });
  await host.wait(c => c.room);
  const rid = host.room.id, tok = host.room.invite.token;
  host.send({ type: 'addAI', diff: 'normal' });
  spec.send({ type: 'join', invite: tok, as: 'spectator' });
  await spec.wait(c => c.room && c.room.id === rid);
  ok(spec.room.you.role === 'spectator', '觀戰者進房');
  host.send({ type: 'leave' });
  ok(await spec.wait(c => c.msgs.some(m => m.type === 'closed')), '只剩 AI 與觀戰者 → 房間關閉並通知觀戰者');
  ok(await spec.wait(c => c.room === null), '觀戰者被送回大廳');
  const list = await (await fetch('http://127.0.0.1:' + port + '/api/rooms')).json();
  ok(!list.rooms.some(r => r.id === rid), '大廳列表已移除該房間');
  const c2 = await client(port, 'key-close-late01', '晚到', 'bunny');
  c2.send({ type: 'inviteInfo', invite: tok });
  const inf = await c2.wait(c => c.msgs.find(m => m.type === 'inviteInfo'));
  ok(inf && !inf.ok, '邀請連結跟著失效');
  host.ws.close(); spec.ws.close(); c2.ws.close();
  app.stop(); app.server.close();
}

(async () => {
  console.log('\n寶島大富翁 線上測試');
  try { await liveTest(); } catch (e) { fail++; console.log('  ✘ 連線測試出錯：' + (e && e.stack)); }
  try { await closeTest(); } catch (e) { fail++; console.log('  ✘ 關房測試出錯：' + (e && e.stack)); }
  try { hubTest(); } catch (e) { fail++; console.log('  ✘ hub 測試出錯：' + (e && e.stack)); }
  console.log('\n' + (fail ? '✘ ' : '✔ ') + '通過 ' + pass + ' 項，失敗 ' + fail + ' 項\n');
  process.exit(fail ? 1 : 0);
})();
