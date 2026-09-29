/* ===== scripts/ui-stall-check.js — 實機「亂按」卡死檢查 =====
 * 單機開局後，玩家由腳本像小孩一樣亂按所有看得到、可以按的東西（擲骰、買地、道具、道具庫、我的地產、格子說明…），
 * 電腦照常玩。任何時刻「輪到我、動畫沒在播、卻沒有任何可按的操作」超過 8 秒就算卡死，並印出當下畫面 HTML。 */
'use strict';
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
let pw = null;
try { pw = require('playwright'); } catch (e) { try { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { } }
if (!pw) { console.log('沒有 Playwright，略過'); process.exit(0); }
const { createServer } = require('../server.js');
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
const ACTIONS = Number(process.env.STALL_ACTIONS || 220);
let bad = 0;
(async () => {
  const app = createServer(); await new Promise(r => app.server.listen(0, r));
  const base = 'http://localhost:' + app.server.address().port;
  let browser;
  try { browser = await pw.chromium.launch(LAUNCH); } catch (e) { browser = await pw.chromium.launch({ ...LAUNCH, executablePath: '/opt/pw-browsers/chromium' }); }
  for (const [name, w, h] of [['平板橫向', 1180, 820], ['手機直向', 390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900 });
    await ctx.addInitScript(() => { if (!localStorage.getItem('richman')) localStorage.setItem('richman', JSON.stringify({ seenHelp: true, nickname: '亂按', char: 'otter', reduceMotion: true, fastAnim: true, bgm: false, sfx: false, aiCount: 3, roundLimit: 0 })); });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(base); await page.click('#go-solo'); await page.click('#solo-start');
    await page.waitForFunction(() => window.Solo && Solo.board && Solo.board.v3, null, { timeout: 20000 });
    let idle = 0, clicks = 0, busyAt = 0, oppAt = 0;
    const t0 = Date.now();
    while (clicks < ACTIONS && Date.now() - t0 < 240000) {
      if (await page.isVisible('#result')) { console.log('  （一局打完，再開一局）'); await page.click('#res-again'); await page.waitForTimeout(500); continue; }
      const info = await page.evaluate(() => {
        const g = Solo._debug.state, me = g.seats[g.turn].id === 'me';
        const vis = e => e.offsetParent !== null && !e.disabled;
        const btns = [...document.querySelectorAll('.mc [data-a], .mc [data-item], .mc .pick-btn, .mc [data-pickcancel], .mc [data-inv]')].filter(vis).map(e => e.dataset.a ? 'a:' + e.dataset.a : e.dataset.item ? 'i:' + e.dataset.item : e.dataset.n ? 'n:' + e.dataset.n : e.dataset.inv ? 'inv' : 'cancel');
        return { me, phase: g.phase, busy: Solo.board._debug.busy, btns, modal: [...document.querySelectorAll('[role=dialog]')].some(d => d.getClientRects().length > 0 && getComputedStyle(d).visibility !== 'hidden' && !d.closest('[hidden]')), ver: g.version, clock: Solo._debug.clock, paused: !!Solo.paused, cur: g.seats[g.turn].id + ':' + (g.seats[g.turn].ai || 'human'), pend: JSON.stringify(g.pending), html: document.querySelector('.mc') ? document.querySelector('.mc').innerHTML.slice(0, 800) : '' };
      });
      if (info.modal) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); continue; }
      if (info.busy) { if (!busyAt) busyAt = Date.now(); if (Date.now() - busyAt > 20000) { bad++; console.log('  ✘ [' + name + '] 動畫／佇列卡住超過 20 秒：階段 ' + info.phase + ' 輪到' + (info.me ? '我' : '別人')); break; } } else busyAt = 0;
      if (!info.me || info.busy) { if (!info.me && !info.busy) { if (!oppAt || oppAt.ver !== info.ver) oppAt = { ver: info.ver, clock: info.clock }; if (info.clock - oppAt.clock > 25000 && !info.paused) { bad++; console.log('  ✘ [' + name + '] 遊戲時間過了 25 秒電腦還沒動：階段 ' + info.phase + ' cur=' + info.cur + ' pending=' + info.pend); break; } } else oppAt = 0; await page.waitForTimeout(150); idle = 0; continue; }
      oppAt = 0;
      if (!info.btns.length) {
        idle += 1; await page.waitForTimeout(400);
        if (idle * 0.4 > 8) { bad++; console.log('  ✘ [' + name + '] 卡死：階段 ' + info.phase + '，沒有可按的操作\n' + info.html); break; }
        continue;
      }
      idle = 0;
      /* 主線 60%、其他亂按 40% */
      const main = info.btns.filter(b => ['a:roll', 'a:buy', 'a:decline', 'a:endTurn', 'a:settle'].includes(b));
      const pool = Math.random() < 0.6 && main.length ? main : info.btns;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const sel = pick.startsWith('a:') ? '.mc [data-a="' + pick.slice(2) + '"]' : pick.startsWith('i:') ? '.mc [data-item="' + pick.slice(2) + '"]' : pick.startsWith('n:') ? '.mc [data-n="' + pick.slice(2) + '"]' : pick === 'inv' ? '.mc [data-inv]' : '.mc [data-pickcancel]';
      try { await page.click(sel, { timeout: 4000 }); clicks++; }
      catch (e) { bad++; console.log('  ✘ [' + name + '] 按不到 ' + pick + '（被蓋住或停用）：' + e.message.split('\n').slice(0,12).join(' | ')); break; }
      await page.waitForTimeout(80);
    }
    if (!bad || true) console.log('  ' + name + '：亂按 ' + clicks + ' 次，JS 錯誤 ' + errs.length + (errs.length ? '：' + errs[0] : ''));
    if (errs.length) bad++;
    await ctx.close();
  }
  await browser.close(); app.server.close();
  console.log(bad ? '✘ 發現 ' + bad + ' 個卡死／錯誤' : '✔ 亂按檢查：沒有卡死');
  process.exit(bad ? 1 : 0);
})();
