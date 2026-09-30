/* 道具商店疊層實機檢查：踩到自動打開、滿版、買／賣、離開前要確認、離開後不能再開；各種螢幕尺寸都不能爆版 */
'use strict';
const path = require('path'), { execSync } = require('child_process');
let pw = null;
try { pw = require('playwright'); } catch (e) { try { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { } }
if (!pw) { console.log('沒有 Playwright，略過'); process.exit(0); }
require('./_fast.js')(pw);
const { createServer } = require('../server.js');
let pass = 0, fail = 0;
const ok = (v, n) => { v ? pass++ : fail++; console.log((v ? '  ✔ ' : '  ✘ ') + n); };
const VIEWS = [['手機直向', 390, 844], ['手機橫向', 844, 390], ['平板直向', 820, 1180], ['平板橫向／桌機', 1180, 820]];
(async () => {
  const app = createServer(); app.start(); await new Promise(r => app.server.listen(0, r));
  const base = 'http://localhost:' + app.server.address().port;
  let browser; try { browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => localStorage.setItem('richman', JSON.stringify({ seenHelp: true, nickname: '測', char: 'otter', reduceMotion: true, fastAnim: true, bgm: false, aiCount: 2, roundLimit: 0, mapSize: 64 })));
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(base); await page.click('#go-solo'); await page.click('#solo-start');
  await page.waitForFunction(() => window.Solo && Solo.board && Solo.board.v3, null, { timeout: 30000 });
  const mineRoll = () => page.evaluate(() => { const g = Solo._debug.state; return g.seats[g.turn].id === 'me' && g.phase === 'roll' && !Solo.board._debug.busy; });
  await page.evaluate(() => Solo.skipToMyRoll());
  for (let i = 0; i < 600 && !(await mineRoll()); i++) {
    const ph = await page.evaluate(() => { const g = Solo._debug.state; return g.seats[g.turn].id === 'me' ? g.phase : ''; });
    if (ph === 'shop') { await page.click('.shop-ov [data-shopleave="ask"]').catch(() => {}); await page.click('.shop-ov [data-a="decline"]').catch(() => {}); }
    else if (ph === 'buy' || ph === 'build') await page.click('.mc [data-a="decline"]', { timeout: 3000 }).catch(() => {});
    else if (ph === 'manage') await page.click('.mc [data-a="endTurn"]', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
  /* 把自己放在商店前面，用機票飛進商店 */
  const shopIdx = await page.evaluate(() => {
    const g = Solo._debug, st = g.state, i = st.turn, me = st.seats[i], si = st.tiles.findIndex(t => t.type === 'shop');
    me.items = ['fly', 'cat', 'bomb']; me.points = 300; me.pos = si === 1 ? 2 : 1; me.jail = false;
    Solo.board.render(Rules.publicView(st, g.clock)); return si;
  });
  await page.click('.mc [data-inv]'); await page.click('#tile-body [data-invuse="fly"]');
  await page.click('.mc [data-fsel="' + shopIdx + '"]', { timeout: 4000 });
  await page.click('.mc [data-confirm]');
  await page.waitForSelector('.shop-ov:not([hidden]) .so-item', { timeout: 6000 });
  ok(true, '踩到道具商店：自動打開商店疊層');
  const geo = await page.evaluate(() => { const o = document.querySelector('.shop-ov').getBoundingClientRect(), b = document.querySelector('#board').getBoundingClientRect(); return { dx: Math.abs(o.left - b.left), dy: Math.abs(o.top - b.top), dw: Math.abs(o.width - b.width), dh: Math.abs(o.height - b.height) }; });
  ok(geo.dx < 2 && geo.dy < 2 && geo.dw < 2 && geo.dh < 2, '商店疊層蓋滿整個遊戲畫面');
  const n = await page.$$eval('.shop-ov .so-item', e => e.length);
  ok(n >= 3 && n <= 6, '上架 3～6 樣（' + n + '）');
  ok(/300/.test(await page.textContent('.so-pts')), '顯示道具點數 300');
  /* 各種螢幕尺寸不爆版 */
  for (const [nm, w, h] of VIEWS) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400);
    if (process.env.SHOT) await page.screenshot({ path: '/tmp/shop-' + w + 'x' + h + '.png' });
    const r = await page.evaluate(() => { const c = document.querySelector('.so-card').getBoundingClientRect(), f = document.querySelector('.so-foot .btn3d').getBoundingClientRect(), d = document.documentElement; return { l: c.left, r: c.right, t: c.top, b: c.bottom, fb: f.bottom, ft: f.top, sw: d.scrollWidth, cw: d.clientWidth, iw: innerWidth, ih: innerHeight, fw: f.width, fh: f.height }; });
    ok(r.l >= -1 && r.r <= r.iw + 1 && r.t >= -1 && r.b <= r.ih + 1 && r.sw <= r.cw + 1, nm + '（' + w + '×' + h + '）：商店卡片在畫面內、沒有橫向捲動');
    ok(r.ft >= 0 && r.fb <= r.ih + 1 && r.fh >= 36, nm + '：「離開商店」按鈕看得到、夠大');
    ok(await page.$$eval('.so-body', e => e[0].scrollHeight >= e[0].clientHeight), nm + '：商品區可捲動或完整顯示');
  }
  await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(300);
  /* 買 */
  const info = await page.evaluate(() => { const b = document.querySelector('.shop-ov .so-item:not([disabled])'); return { item: b && b.dataset.shop, pts: Rules.ITEMS[b.dataset.shop].pts, before: Solo._debug.state.seats.find(s => s.id === 'me').points }; });
  await page.click('.shop-ov .so-item[data-shop="' + info.item + '"]');
  await page.waitForFunction(([id, p]) => Solo._debug.state.seats.find(s => s.id === 'me').points === p, [info.item, info.before - info.pts], { timeout: 4000 }).catch(() => {});
  const after = await page.evaluate(() => { const m = Solo._debug.state.seats.find(s => s.id === 'me'); return { p: m.points, it: m.items.slice() }; });
  ok(after.p === info.before - info.pts && after.it.includes(info.item), '買了「' + info.item + '」：點數 −' + info.pts + '、進道具欄');
  ok(await page.isVisible('.shop-ov') && (await page.$eval('.shop-ov [data-shop="' + info.item + '"]', e => e.disabled)), '買完商店仍開著，這樣商品標成已買過（不能再買）');
  /* 賣 */
  await page.click('.shop-ov [data-stab="sell"]');
  const sellN = await page.$$eval('.shop-ov [data-sell]', e => e.length);
  ok(sellN >= 3, '賣道具分頁列出身上的道具（' + sellN + '）');
  const pb = await page.evaluate(() => Solo._debug.state.seats.find(s => s.id === 'me').points);
  await page.click('.shop-ov [data-sell="cat"]');
  await page.waitForFunction(p => Solo._debug.state.seats.find(s => s.id === 'me').points > p, pb, { timeout: 4000 }).catch(() => {});
  ok(await page.evaluate(([p]) => Solo._debug.state.seats.find(s => s.id === 'me').points === p + 15, [pb]), '賣招財貓：換回半價 15 點');
  /* 離開前要確認 */
  await page.click('.shop-ov [data-shopleave="ask"]');
  ok(await page.isVisible('.so-ask') && /不能再進來/.test(await page.textContent('.so-ask')), '按離開：先詢問，並說明離開後不能再進來');
  await page.click('.shop-ov [data-shopleave="no"]');
  ok(!(await page.isVisible('.so-ask')) && await page.isVisible('.shop-ov'), '按「再逛逛」：回到商店');
  await page.keyboard.press('Escape');
  ok(await page.isVisible('.so-ask'), 'Esc：也是先詢問，不會直接離開');
  ok(await page.evaluate(() => Solo._debug.state.phase === 'shop'), '詢問期間仍在商店階段');
  await page.click('.so-ask [data-a="decline"]');
  await page.waitForFunction(() => Solo._debug.state.phase !== 'shop', null, { timeout: 4000 }).catch(() => {});
  ok(!(await page.isVisible('.shop-ov')) && await page.evaluate(() => Solo._debug.state.phase !== 'shop'), '確定離開：疊層關閉、回到遊戲');
  ok(!(await page.$('.shop-ov:not([hidden])')), '關掉後沒有任何按鈕可以再打開商店');
  ok(errs.length === 0, '沒有 JS 錯誤' + (errs.length ? '：' + errs[0] : ''));
  await browser.close(); app.server.close();
  console.log('\n商店疊層檢查：' + pass + ' 通過，' + fail + ' 失敗');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✘ 檢查中斷：' + e.message); process.exit(1); });
