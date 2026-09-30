/* ===== scripts/scroll-check.js — 各畫面在各尺寸下「內容是不是真的捲得到」（node scripts/scroll-check.js） =====
 * 檢查：
 *   1. 文件本身比視窗高時，能不能捲（html／body 沒被 overflow:hidden 鎖住）
 *   2. 容器內容比容器高時，有沒有 overflow:auto|scroll，且 scrollTop 真的能動
 *   3. 內容被 overflow:hidden 直接裁掉（看不到、也捲不到）
 * 需要 Playwright；沒有就略過。
 */
'use strict';
const path = require('path');
const { execSync } = require('child_process');
let pw = null;
try { pw = require('playwright'); } catch (e) {
  try { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { pw = null; }
}
if (!pw) { console.log('沒有安裝 Playwright，略過捲動檢查。'); process.exit(0); }
require('./_fast.js')(pw);
const { createServer } = require('../server.js');

let pass = 0, fail = 0;
function ok(v, name) { if (v) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name); } }
const ALL_SIZES = [['手機直向', 390, 844], ['手機橫向', 844, 390], ['平板直向', 820, 1180], ['平板橫向', 1180, 820], ['小手機直向', 360, 640], ['矮視窗橫向', 667, 320]];

const SIZES = process.env.SCROLL_ONLY ? ALL_SIZES.filter(x => x[0].includes(process.env.SCROLL_ONLY)) : ALL_SIZES;
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

async function scrollProblems(page) {
  await page.waitForTimeout(450);   /* 等自製卷軸更新位置 */
  return page.evaluate(async () => {
    const out = [];
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const se = document.scrollingElement;
    if (se.scrollHeight > innerHeight + 2) {
      window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 250)); const before = window.scrollY; window.scrollTo(0, 99999); await new Promise(r => setTimeout(r, 400));
      const moved = window.scrollY > before + 1;
      const ho = getComputedStyle(document.documentElement).overflowY, bo = getComputedStyle(document.body).overflowY;
      /* body 自己當捲動容器也算（html 高度 100% 時） */
      const bodyMoved = document.body.scrollTop > 0;
      if (!moved && !bodyMoved) out.push('頁面比視窗高（' + se.scrollHeight + '>' + innerHeight + '）卻捲不動（html ' + ho + ' / body ' + bo + '）');
      se.scrollTop = 0; document.body.scrollTop = 0;
      const pageBar = [...document.querySelectorAll('.cs-track')].some(t => t.style.display === 'block' && t.getBoundingClientRect().right >= innerWidth - 2);
      if (!pageBar && !document.body.classList.contains('in-game') && !document.querySelector('.modal:not([hidden])')) out.push('頁面可以捲，但看不到自製卷軸');
    }
    /* 彈窗整張卡片一定要在視窗內（太高就要在卡片裡面捲），不能被切掉 */
    document.querySelectorAll('.modal:not([hidden]) .modal-card').forEach(c => {
      const r = c.getBoundingClientRect();
      if (r.width > 0 && (r.bottom > innerHeight + 2 || r.top < -2)) out.push('彈窗超出視窗（上 ' + Math.round(r.top) + '／下 ' + Math.round(r.bottom) + '，視窗高 ' + innerHeight + '）');
    });
    const skip = el => el.closest('canvas, svg, .b3d, .cam-btns') || el.matches('html, body');
    for (const el of document.querySelectorAll('body *')) {
      if (skip(el) || !vis(el)) continue;
      const cs = getComputedStyle(el);
      if (el.scrollHeight <= el.clientHeight + 3 || el.clientHeight === 0) continue;
      const oy = cs.overflowY;
      const id = el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : el.tagName.toLowerCase();
      if (oy === 'auto' || oy === 'scroll') {
        const b = el.scrollTop; el.scrollTop = 99999; await new Promise(r => setTimeout(r, 30));
        if (el.scrollTop <= b) out.push(id + ' 有 overflow:' + oy + ' 但捲不動');
        el.scrollTop = 0;
        if (!el.classList.contains('cs')) out.push(id + ' 沒有套用自製卷軸（還在用原生卷軸）');
        else {
          const rr = el.getBoundingClientRect(), hit = document.elementFromPoint(Math.min(innerWidth - 2, rr.right - 8), Math.min(innerHeight - 2, Math.max(1, rr.top + Math.min(rr.height, innerHeight - rr.top) / 2)));
          const covered = !hit || !el.contains(hit) && !hit.closest('#cs-layer');
          const shown = () => [...document.querySelectorAll('.cs-track')].some(t => t.style.display === 'block');
          for (let k = 0; k < 6 && !covered && !shown(); k++) await new Promise(r => setTimeout(r, 80));   /* 卷軸是下一個影格才更新，慢的機器多等一下 */
          if (!covered && !shown()) out.push(id + ' 看不到自製卷軸');
        }
      } else if (oy === 'hidden' || oy === 'clip') {
        /* 文字省略號（單行）不算；其他被裁掉的才算 */
        if (cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') continue;
        /* 只在真的有可見內容超出時回報 */
        const r = el.getBoundingClientRect();
        let hiddenKid = null;
        for (const k of el.children) { const kr = k.getBoundingClientRect(); if (kr.height > 0 && vis(k) && kr.bottom > r.bottom + 3 && getComputedStyle(k).position !== 'absolute') { hiddenKid = k; break; } }
        if (hiddenKid) out.push(id + ' 內容被裁掉（overflow:hidden，' + el.scrollHeight + '>' + el.clientHeight + '）');
      }
    }
    return out;
  });
}

(async () => {
  const app = createServer(); app.start();
  await new Promise(r => app.server.listen(0, r));
  const base = 'http://localhost:' + app.server.address().port;
  let browser;
  try { browser = await pw.chromium.launch(LAUNCH); } catch (e) {
    try { browser = await pw.chromium.launch({ ...LAUNCH, executablePath: '/opt/pw-browsers/chromium' }); } catch (e2) { console.log('無法啟動 Chromium，略過：' + e2.message); process.exit(0); }
  }
  for (const [name, w, h] of SIZES) {
    console.log('\n[' + name + ' ' + w + '×' + h + ']');
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900 });
    await ctx.addInitScript(() => { if (!localStorage.getItem('richman')) localStorage.setItem('richman', JSON.stringify({ seenHelp: true, nickname: '測試員', char: 'otter', reduceMotion: true, bgm: false, aiCount: 7, roundLimit: 25 })); });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    let tk = Date.now();
    const check = async (label) => { const p = await scrollProblems(page); ok(!p.length, label + (p.length ? '：' + p.join('；') : '') + (process.env.TIMING ? '  [' + (Date.now() - tk) + 'ms]' : '')); tk = Date.now(); };
    await page.goto(base);
    await page.waitForSelector('#screen-home:not([hidden])');
    await check('首頁');
    await page.click('#go-help'); await page.waitForSelector('#screen-help:not([hidden])'); await check('說明頁');
    await page.click('#help-go'); await page.waitForSelector('#screen-solo:not([hidden])');
    while (await page.isEnabled('#solo-ai [data-step="1"]')) await page.click('#solo-ai [data-step="1"]');
    await check('單機設定（8 人）');
    await page.click('#btn-settings'); await page.waitForSelector('#settings-modal', { state: 'visible' }); await check('設定視窗'); await page.keyboard.press('Escape');
    await page.click('#solo-start');
    await page.waitForFunction(() => window.Solo && Solo.board && Solo.board.v3, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    await check('對局畫面（8 人）');
    if (await page.isVisible('#side-open')) { await page.click('#side-open'); await page.waitForTimeout(400); await check('對局：資訊抽屜'); await page.click('#side-close'); await page.waitForTimeout(400); }
    await page.evaluate(() => { const g = Solo._debug; g.state.seats.find(s => s.id === 'me').items = ['dice', 'fly', 'cat']; Solo.board.render(Rules.publicView(g.state, g.clock)); });
    if (await page.isVisible('#menu-modal')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    if (await page.isVisible('.mc .mc-props')) { await page.click('.mc .mc-props'); await page.waitForSelector('#manage-modal', { state: 'visible' }); await check('我的地產視窗'); await page.keyboard.press('Escape'); }
    await page.evaluate(() => Solo.fastForward(1200000, true));
    await page.waitForSelector('#result:not([hidden])', { timeout: 30000 }).catch(() => {});
    if (await page.isVisible('#result')) { await check('結算畫面（8 人）'); await page.keyboard.press('Escape').catch(()=>{}); await page.click('#res-home'); await page.waitForSelector('#screen-home:not([hidden])'); await check('結算後回到首頁（不能還鎖著捲動）'); }
    await page.click('#go-online'); await page.waitForFunction(() => Net.connected, null, { timeout: 10000 });
    await check('線上大廳');
    await page.click('#lobby-create'); await page.waitForSelector('#screen-room:not([hidden])');
    await page.click('[data-set="max"][data-val="8"]').catch(() => {});
    await page.click('[data-set="roundLimit"][data-val="25"]').catch(() => {});
    for (let i = 0; i < 7; i++) await page.click('[data-act="add-ai"]', { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
    await check('房間等待室（8 人）');
    ok(!errs.length, '沒有 JS 錯誤' + (errs.length ? '：' + errs.join('；') : ''));
    await ctx.close();
  }
  await browser.close(); app.stop(); app.server.close();
  console.log('\n捲動檢查：' + pass + ' 通過，' + fail + ' 失敗');
  process.exit(fail ? 1 : 0);
})();
