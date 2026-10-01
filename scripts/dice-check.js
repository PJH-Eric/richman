/* 擲骰顆數實機檢查：連續開多局（不重新整理頁面），畫面選幾顆就必須擲幾顆（防止舊局的事件監聽殘留） */
'use strict';
const path = require('path'), { execSync } = require('child_process');
let pw = null;
try { pw = require('playwright'); } catch (e) { try { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { } }
if (!pw) { console.log('沒有 Playwright，略過'); process.exit(0); }
require('./_fast.js')(pw);
const { createServer } = require('../server.js');
let pass = 0, fail = 0;
const ok = (v, n) => { v ? pass++ : fail++; console.log((v ? '  ✔ ' : '  ✘ ') + n); };
(async () => {
  const app = createServer(); app.start(); await new Promise(r => app.server.listen(0, r));
  const base = 'http://localhost:' + app.server.address().port;
  let browser; try { browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem('richman', JSON.stringify({ seenHelp: true, nickname: '測', char: 'otter', reduceMotion: true, fastAnim: true, bgm: false, aiCount: 2 })));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base);
  /* 第 1 局選 1 顆；第 2、3 局完全不碰選擇器，直接擲（預設 2 顆）；第 4 局選 1 顆、第 5 局選 2 顆 */
  const plan = [['1', 1], [null, 2], [null, 2], ['1', 1], ['2', 2]];
  for (let g = 0; g < plan.length; g++) {
    await p.click('#go-solo').catch(() => {}); await p.click('#solo-start');
    await p.waitForSelector('[data-dn]', { timeout: 40000 }); await p.waitForTimeout(400);
    const [pick, want] = plan[g];
    if (pick) await p.click('[data-dn="' + pick + '"]');
    const shown = await p.evaluate(() => Number(document.querySelector('.dc-btn.sel').dataset.dn));
    await p.click('[data-a="roll"]'); await p.waitForTimeout(300);
    const kind = await p.evaluate(() => Solo._debug.state.diceKind);
    ok(shown === want, '第 ' + (g + 1) + ' 局：畫面顯示選 ' + want + ' 顆');
    ok(kind === (want === 1 ? 'one' : 'two'), '第 ' + (g + 1) + ' 局：實際擲 ' + want + ' 顆（' + kind + '）');
    await p.evaluate(() => { Solo.stop(); UI.show('home'); }); await p.waitForTimeout(250);
  }
  /* 模擬「另一個模式的棋盤沒收掉」：先在同一個棋盤元素上建一個不會被 stop 的棋盤，再開單機局 */
  await p.evaluate(() => {
    window.__stray = 0;
    const sb = Board.create(document.querySelector('#board'), document.querySelector('#summary'), { myId: 'me', solo: true, settings: () => App.store, onAct: () => { window.__stray++; } });
    window.__sb = sb;
  });
  await p.click('#go-solo').catch(() => {}); await p.click('#solo-start');
  await p.waitForSelector('[data-dn]', { timeout: 40000 }); await p.waitForTimeout(400);
  await p.click('[data-dn="1"]'); await p.click('[data-a="roll"]'); await p.waitForTimeout(300);
  const r = await p.evaluate(() => ({ stray: window.__stray, dead: window.__sb.dead, kind: Solo._debug.state.diceKind }));
  ok(r.dead && r.stray === 0, '同一個棋盤元素開新局時，沒收掉的舊棋盤會被拆掉、不會送出操作');
  ok(r.kind === 'one', '舊棋盤殘留時，選 1 顆仍然只擲 1 顆（' + r.kind + '）');
  await p.evaluate(() => { Solo.stop(); UI.show('home'); });
  ok(!errs.length, '沒有 JS 錯誤' + errs.join('；'));
  await browser.close(); app.stop(); app.server.close();
  console.log('\n擲骰顆數檢查：' + pass + ' 通過，' + fail + ' 失敗');
  process.exit(fail ? 1 : 0);
})();
