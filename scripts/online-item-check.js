/* 線上實機道具檢查：兩個真人瀏覽器（房主＋朋友）連到同一個伺服器，輪流用每種道具，
 * 用完後「輪到的那個人」一定要能繼續操作（買地／蓋房／結束回合），另一位也看得到結果。 */
'use strict';
const path = require('path'), { execSync } = require('child_process');
let pw = null;
try { pw = require('playwright'); } catch (e) { try { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { } }
if (!pw) { console.log('沒有 Playwright，略過'); process.exit(0); }
require('./_fast.js')(pw);
const { createServer } = require('../server.js');
let pass = 0, fail = 0;
const ok = (v, n) => { v ? pass++ : fail++; console.log((v ? '  ✔ ' : '  ✘ ') + n); };
const CASES = [['fly', 8, '飛到空地'], ['fly', 16, '飛到對手的地'], ['fly', 7, '飛到機會'], ['fly', 6, '飛到自己的地'], ['steal', 0, '偷錢'], ['swap', 0, '換位'], ['bomb', 0, '炸彈'], ['dice', 4, '遙控骰'], ['fly', 5, '飛到車站'], ['fly', 4, '飛到所得稅']];
(async () => {
  process.env.RICHMAN_TEST_MAP = 'classic40';
  const app = createServer(); app.start(); await new Promise(r => app.server.listen(0, r));
  const base = 'http://localhost:' + app.server.address().port;
  let browser; try { browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript((n) => localStorage.setItem('richman', JSON.stringify({ testMap: 'classic40', seenHelp: true, nickname: n, char: 'otter', reduceMotion: true, fastAnim: true, bgm: false })), name);
    const page = await ctx.newPage(); page.errs = []; page.on('pageerror', e => page.errs.push(e.message)); return page;
  };
  const A = await mk('房主'), B = await mk('朋友');
  await A.goto(base); await A.click('#go-online'); await A.waitForFunction(() => Net.connected);
  await A.click('#lobby-create'); await A.waitForSelector('#screen-room:not([hidden])');
  const link = await A.inputValue('#invite-url');
  await B.goto(link.replace(/^https?:\/\/[^/]+/, base));
  await B.waitForSelector('.invite-card [data-as="player"]'); await B.click('.invite-card [data-as="player"]');
  await B.waitForSelector('#screen-room:not([hidden])');
  await B.click('[data-act="ready"]');
  await A.click('[data-act="start"]');
  for (const p of [A, B]) { await p.waitForSelector('#screen-game:not([hidden])'); await p.waitForFunction(() => Online.board && Online.board.v3, null, { timeout: 20000 }); }
  ok(true, '兩位真人開局');
  const room = [...app.hub.rooms.values()][0], gs = room.game.state;
  const pageOf = (i) => (gs.seats[i].name === '房主' ? A : B);
  const dbg = (p) => p.evaluate(() => ({ busy: Online.board._debug.busy, sent: Online.board._debug.sent, pick: Online.board._debug.pick }));
async function invUse(pg, item) {
  try {
    await pg.click('.mc [data-inv]', { timeout: 3000 });
    const b = await pg.waitForSelector('#tile-body [data-invuse="' + item + '"]:not([disabled])', { timeout: 3000 });
    await b.click();
    return true;
  } catch (e) { await pg.keyboard.press('Escape').catch(() => {}); return false; }
}
async function leaveShop(pg) { await pg.click('.shop-ov [data-shopleave="ask"]', { timeout: 3000 }).catch(() => {}); await pg.click('.shop-ov [data-a="decline"]', { timeout: 3000 }).catch(() => {}); }
  const settle = async () => { /* 讓當前輪到的人回到 roll 階段、動畫靜止 */
    for (let i = 0; i < 400; i++) {
      const p = pageOf(gs.turn), d = await dbg(p);
      if (gs.phase === 'roll' && !d.busy && !d.sent) return true;
      if (gs.phase === 'shop') { await leaveShop(p); await p.waitForTimeout(200); continue; }
      const sel = gs.phase === 'buy' || gs.phase === 'build' ? '[data-a="decline"]' : gs.phase === 'manage' ? '[data-a="endTurn"]' : gs.phase === 'debt' ? '[data-a="bankrupt"]' : gs.phase === 'roll' ? null : null;
      if (sel) await p.click('.mc ' + sel, { timeout: 2000 }).catch(() => {});
      await p.waitForTimeout(200);
    }
    return false;
  };
  for (const [item, arg, label] of CASES) {
    if (gs.phase === 'over') break;
    const okRoll = await settle(); if (!okRoll) { ok(false, label + '：開始前流程就停住 ' + gs.phase); break; }
    const i = gs.turn, other = 1 - i, me = gs.seats[i], p = pageOf(i), q = pageOf(other);
    me.items = [item]; me.cash = 3000; me.pos = 3; me.jail = false;
    gs.seats[other].pos = 14; gs.seats[other].cash = 1500; gs.seats[other].jail = false; gs.seats[other].god = null; gs.seats[other].items = [];
    gs.props.forEach(pr => { if (pr.owner !== -1 && pr.owner !== other) { } });
    gs.props[6].owner = i; gs.props[6].houses = 0; gs.props[16].owner = other; gs.props[16].houses = 2; gs.props[8].owner = -1;
    gs.version++; room.changed = true; app.flush();
    await p.waitForSelector('.mc .it-chip.ready', { timeout: 6000 }).catch(() => {});
    if (!(await invUse(p, item))) { ok(false, label + '：道具庫裡的「使用」按鈕沒出現'); continue; }
    if (item === 'fly') {
      await p.click('.mc [data-fsel="' + arg + '"]', { timeout: 4000 });
      await p.waitForSelector('.mc [data-confirm]', { timeout: 4000 }); await p.click('.mc [data-confirm]');
    } else if (item === 'bomb') {
      await p.waitForTimeout(300); await p.evaluate(() => Online.board.v3.setFollow(false)); await p.waitForTimeout(600);
      const tile = item === 'bomb' ? 16 : arg;
      const bx = await p.evaluate(t => { const c = document.querySelector('.b3d'); const r = c.getBoundingClientRect(); const pr = Online.board.v3.project(t, 0, 0, 0.3); return { x: r.left + pr.x - c.offsetLeft, y: r.top + pr.y - c.offsetTop }; }, tile);
      await p.mouse.click(bx.x, bx.y);
      for (let r = 0; r < 3; r++) {   /* 3D 點選偶爾點在鏡頭按鈕上：沒反應就再點一次 */
        await p.waitForTimeout(1200);
        if (await p.$('.mc [data-confirm]')) break;
        const b2 = await p.evaluate(t => { const c = document.querySelector('.b3d'); const r = c.getBoundingClientRect(); const pr = Online.board.v3.project(t, 0, 0, 0.3); return { x: r.left + pr.x - c.offsetLeft, y: r.top + pr.y - c.offsetTop }; }, tile);
        await p.mouse.click(b2.x + r * 3, b2.y - r * 3);
      }
      if (!(await p.waitForSelector('.mc [data-confirm]', { timeout: 1500 }).catch(() => null))) await p.evaluate(t => Online.board.tileClick(t), tile);
      await p.waitForSelector('.mc [data-confirm]', { timeout: 4000 });
      await p.click('.mc [data-confirm]');
    } else if (item === 'dice') { await p.click('.mc [data-n="' + arg + '"]'); await p.waitForSelector('.mc [data-confirm]', { timeout: 4000 }); await p.click('.mc [data-confirm]'); }
    else { await p.click('.mc .tgt-btn:not([disabled])'); await p.waitForSelector('.mc [data-confirm]', { timeout: 4000 }); await p.click('.mc [data-confirm]'); }
    let btn = null, info = null;
    for (let k = 0; k < 48; k++) {
      await p.waitForTimeout(250);
      const st = await dbg(p);
      info = { turn: gs.turn === i, ph: gs.phase, busy: st.busy, pick: st.pick, sent: st.sent, btns: await p.evaluate(() => [...document.querySelectorAll('.mc [data-a]')].filter(b => !b.disabled && b.offsetParent).map(b => b.dataset.a)) };
      if (!info.turn) { btn = 'next'; break; }
      if (!st.busy && info.btns.length) { btn = info.btns[0]; break; }
    }
    ok(!!btn, label + '（線上 ' + item + '）用完後可繼續操作：階段 ' + info.ph + '，按鈕 ' + info.btns.join(',') + (btn ? '' : ' ' + JSON.stringify(info)));
    if (btn && btn !== 'next') {
      const v0 = gs.version; await p.click('.mc [data-a="' + btn + '"]', { timeout: 4000 }).catch(() => {}); await p.waitForTimeout(600);
      ok(gs.version !== v0, label + '：按下「' + btn + '」流程有往前走');
    }
    /* 另一位的畫面要同步（位置一致） */
    await q.waitForTimeout(500);
    const seen = await q.evaluate(() => Online.room.game.seats.map(s => s.pos).join());
    ok(seen === gs.seats.map(s => s.pos).join(), label + '：對手畫面與伺服器一致');
  }
  /* 對局中重新整理頁面：要回到同一局，而且輪到我時仍然有按鈕可以按 */
  {
    await settle();
    const i = gs.turn, p = pageOf(i);
    gs.seats[i].items = ['fly']; gs.version++; room.changed = true; app.flush();
    await p.waitForSelector('.mc .it-chip.ready', { timeout: 6000 }).catch(() => {});
    await invUse(p, 'fly');   /* 開著選格子的狀態直接重新整理 */
    await p.reload();
    await p.waitForFunction(() => window.Online && Online.board && Online.board.v3 && Online.room && Online.room.game, null, { timeout: 25000 }).catch(() => {});
    const back = await p.evaluate(() => !!(window.Online && Online.board && Online.room && Online.room.game));
    ok(back, '對局中重新整理：回到同一局');
    await p.waitForTimeout(1500);
    const btns = await p.evaluate(() => [...document.querySelectorAll('.mc [data-a]')].filter(b => !b.disabled && b.offsetParent).map(b => b.dataset.a));
    ok(gs.turn !== i || btns.includes('roll'), '重新整理後輪到我時有擲骰按鈕：' + btns.join(','));
    const still = await p.evaluate(() => Online.board._debug.pick);
    ok(!still, '重新整理後不會殘留選格子狀態');
  }
  ok(!A.errs.length && !B.errs.length, '沒有 JS 錯誤' + [...A.errs, ...B.errs].join('；'));
  await browser.close(); app.stop(); app.server.close();
  console.log('\n線上道具實機檢查：' + pass + ' 通過，' + fail + ' 失敗');
  process.exit(fail ? 1 : 0);
})();
