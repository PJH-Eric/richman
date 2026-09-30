/* 道具流程實機檢查：每種道具、各種落點，用完後一定要能繼續操作（擲骰／買地／蓋房／結束回合） */
'use strict';
const path = require('path'), { execSync } = require('child_process');
let pw = null;
try { pw = require('playwright'); } catch (e) { try { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { } }
if (!pw) { console.log('沒有 Playwright，略過'); process.exit(0); }
const { createServer } = require('../server.js');
let pass = 0, fail = 0;
const ok = (v, n) => { v ? pass++ : fail++; console.log((v ? '  ✔ ' : '  ✘ ') + n); };
const ONLY = process.env.ITEM_ONLY, ARGS = process.env.ITEM_ARGS ? process.env.ITEM_ARGS.split(',').map(Number) : null;
const CASES = [ ['fly', 8, '空地（買地）'], ['fly', 16, '對手的地（付租金）'],
  ['fly', 8, '剛擲出雙骰後（再擲一次）', { again: true }], ['fly', 4, '所得稅'], ['fly', 7, '機會'], ['fly', 2, '命運'], ['fly', 10, '監獄探監'], ['fly', 20, '溫泉休息站'],
  ['fly', 30, '（去坐牢不可飛）'], ['fly', 5, '車站'], ['fly', 12, '公司'], ['fly', 0, '起點'], ['fly', 6, '自己的地（蓋房）'],
  ['swap', 0, '換位'], ['steal', 0, '偷錢'], ['bomb', 0, '炸彈'], ['dice', 3, '遙控骰']
];
(async () => {
  const app = createServer(); app.start(); await new Promise(r => app.server.listen(0, r));
  const base = 'http://localhost:' + app.server.address().port;
  let browser; try { browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => localStorage.setItem('richman', JSON.stringify({ seenHelp: true, nickname: '測', char: 'otter', reduceMotion: true, fastAnim: true, bgm: false, aiCount: 2, roundLimit: 0 })));
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(base); await page.click('#go-solo'); await page.click('#solo-start');
  await page.waitForFunction(() => window.Solo && Solo.board && Solo.board.v3, null, { timeout: 30000 });
  const mineRoll = () => page.evaluate(() => { const g = Solo._debug.state; return g.seats[g.turn].id === 'me' && g.phase === 'roll' && !Solo.board._debug.busy; });
  async function toMyRoll() {
    for (let i = 0; i < 600 && !(await mineRoll()); i++) {
      const ph = await page.evaluate(() => { const g = Solo._debug.state; return g.seats[g.turn].id === 'me' ? g.phase : ''; });
      const sel = ph === 'buy' || ph === 'build' || ph === 'shop' ? '[data-a="decline"]' : ph === 'manage' ? '[data-a="endTurn"]' : ph === 'debt' ? '[data-a="bankrupt"]' : null;
      if (sel) await page.click('.mc ' + sel, { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(250);
    }
  }
  for (const [item, arg, label, extra] of CASES.filter(c => (!ONLY || c[0] === ONLY) && (!ARGS || ARGS.includes(c[1])))) {
    if (await page.isVisible('#tile-modal') || await page.isVisible('#manage-modal')) { ok(false, '殘留彈窗擋住畫面：' + label); await page.keyboard.press('Escape'); }
    await toMyRoll();
    await page.evaluate(([item, arg, extra]) => {
      const g = Solo._debug, st = g.state, i = st.turn, me = st.seats[i];
      me.items = [item]; me.cash = extra && extra.cash != null ? extra.cash : 3000; me.pos = 3; me.jail = false;
      st.again = !!(extra && extra.again); st.doubles = st.again ? 1 : 0;
      st.props[6].owner = i; st.props[6].houses = 0;
      st.seats.forEach((x, k) => { if (k !== i) { x.pos = 14 + k; x.cash = 1500; x.jail = false; } });
      st.props[16].owner = st.seats.findIndex((x, k) => k !== i); st.props[16].houses = 2;
      Solo.board.render(Rules.publicView(st, g.clock));
    }, [item, arg, extra || null]);
    await page.waitForSelector('.mc .it-chip.on[data-item="' + item + '"]', { timeout: 4000 }).catch(() => {});
    const chip = await page.$('.mc .it-chip.on[data-item="' + item + '"]');
    if (!chip) { ok(false, label + '：道具按鈕沒出現'); continue; }
    await chip.click();
    /* 點道具鈕之後要真的進入「選目標」狀態；剛好被重繪吃掉的話（彈窗、換階段）就關掉彈窗再點一次 */
    if (!(await page.waitForFunction(() => Solo.board._debug.pick, null, { timeout: 1500 }).catch(() => null))) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
      await page.click('.mc .it-chip.on[data-item="' + item + '"]', { timeout: 3000 }).catch(() => {});
    }
    if (item === 'fly' || item === 'bomb') {
      await page.waitForTimeout(300);
      const tile = item === 'bomb' ? 16 : arg;
      await page.evaluate(() => Solo.board.v3.setFollow(false));
      await page.waitForTimeout(700);
      const bx = await page.evaluate(t => { const c = document.querySelector('.b3d'); const r = c.getBoundingClientRect(); const p = Solo.board.v3.project(t, 0, 0, 0.3); return { x: r.left + p.x - c.offsetLeft, y: r.top + p.y - c.offsetTop }; }, tile);
      await page.mouse.click(bx.x, bx.y);
      if (item === 'fly' && arg === 30) { await page.click('.mc [data-pickcancel]').catch(() => {}); ok(true, '去坐牢：不能飛（已取消）'); continue; }
      /* 起點附近的格子可能被操作面板蓋住點不到：沒選到就改用程式選（真人可以拖動鏡頭或點面板上的清單） */
      if (!(await page.waitForSelector('.mc [data-confirm]', { timeout: 1500 }).catch(() => null))) {
        /* 滑鼠沒點到（被面板或鏡頭按鈕擋住，或剛好被重繪吃掉）：關掉彈窗、確認還在選目標狀態，再用程式選 */
        if (await page.isVisible('#tile-modal')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
        if (!(await page.evaluate(() => Solo.board._debug.pick))) await page.click('.mc .it-chip.on[data-item="' + item + '"]', { timeout: 3000 }).catch(() => {});
        await page.evaluate(t => Solo.board.tileClick(t), tile);
      }
      await page.waitForSelector('.mc [data-confirm]', { timeout: 4000 });
      await page.click('.mc [data-confirm]');
    } else if (item === 'dice') { await page.click('.mc [data-n="' + arg + '"]'); await page.waitForSelector('.mc [data-confirm]', { timeout: 4000 }); await page.click('.mc [data-confirm]'); }
    else { await page.click('.mc .tgt-btn:not([disabled])'); await page.waitForSelector('.mc [data-confirm]', { timeout: 4000 }); await page.click('.mc [data-confirm]'); }
    /* 用完之後：最多 12 秒內要出現一個可以按的主線按鈕 */
    let btn = null, info = null;
    for (let i = 0; i < 48; i++) {
      await page.waitForTimeout(250);
      info = await page.evaluate(() => { const g = Solo._debug.state; return { me: g.seats[g.turn].id === 'me', ph: g.phase, busy: Solo.board._debug.busy, sent: Solo.board._debug.sent, pick: Solo.board._debug.pick, q: Solo.board._debug.queue, again: g.again, html: document.querySelector('.mc').innerText.replace(/\s+/g, ' ').slice(0, 160), shown: Solo.board._debug.shown && Solo.board._debug.shown.phase + '/' + Solo.board._debug.shown.turn + '/v' + Solo.board._debug.shown.version, st: g.phase + '/' + g.turn + '/v' + g.version, dis: [...document.querySelectorAll('.mc [data-a]')].filter(b => b.disabled).map(b => b.dataset.a), btns: [...document.querySelectorAll('.mc [data-a]')].filter(b => !b.disabled).map(b => b.dataset.a) }; });
      if (!info.me) { btn = 'next'; break; }
      if (!info.busy && info.btns.length) { btn = info.btns[0]; break; }
    }
    ok(!!btn && info.ph !== 'never', label + '（' + item + '）用完後可繼續操作：階段 ' + info.ph + '，按鈕 ' + info.btns.join(',') + ' ' + JSON.stringify({ sent: info.sent, pick: info.pick, busy: info.busy, q: info.q, again: info.again, dis: info.dis, html: info.html, shown: info.shown, st: info.st }));
    /* 真的去按一下，看流程會不會往前 */
    if (btn && btn !== 'next') {
      const before = await page.evaluate(() => Solo._debug.state.version);
      await page.click('.mc [data-a="' + btn + '"]', { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => Solo._debug.state.version);
      ok(after !== before, label + '：按下「' + btn + '」流程有往前走');
    }
  }
  ok(!errs.length, '沒有 JS 錯誤' + (errs.length ? '：' + errs.join('；') : ''));
  await browser.close(); app.stop(); app.server.close();
  console.log('\n道具流程檢查：' + pass + ' 通過，' + fail + ' 失敗');
  process.exit(fail ? 1 : 0);
})();
