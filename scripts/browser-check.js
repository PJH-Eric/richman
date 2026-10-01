/* ===== scripts/browser-check.js — 無頭瀏覽器版面與流程檢查（node scripts/browser-check.js） =====
 *
 * 需要 Playwright（npm i -g playwright 或專案內安裝）；沒有就跳過，不算失敗。
 * 3D 棋盤要 WebGL：無頭 Chromium 用軟體繪圖（swiftshader）就能跑，不需要顯示卡。
 * 檢查：各尺寸（手機／平板／桌機 × 直橫向）有沒有水平溢出、主要按鈕是否在畫面內且夠大、
 * 設定彈窗（右上角 → Modal → Esc 關閉回到原焦點、設定保留）、格子說明與我的地產視窗、
 * 單機完整一局到結算（用假時鐘快轉）、線上：建房 → 邀請連結加入 → 觀戰 → 開局 → 聊天 → 撤銷邀請。
 * 截圖存到 screenshots/。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let pw = null;
try { pw = require('playwright'); } catch (e) {
  try { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { pw = null; }
}
if (!pw) { console.log('沒有安裝 Playwright，略過瀏覽器檢查。'); process.exit(0); }

require('./_fast.js')(pw);
const { createServer } = require('../server.js');
const OUT = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function ok(v, name) { if (v) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name); } }

const SIZES = [
  ['手機直向', 390, 844, true], ['手機橫向', 844, 390, true],
  ['平板直向', 820, 1180, true], ['平板橫向', 1180, 820, true],
  ['桌機', 1440, 900, false]
];
const KEY = 'richman';
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

/** 預先寫好本機設定：不跳教學提示、動畫關掉讓測試快一點 */
const seed = (extra) => (extra ? { ...extra } : {});
async function leaveShop(pg) { await pg.click('.shop-ov [data-shopleave="ask"]', { timeout: 3000 }).catch(() => {}); await pg.click('.shop-ov [data-a="decline"]', { timeout: 3000 }).catch(() => {}); }
async function invUse(pg, item) {
  try {
    await pg.click('.mc [data-inv]', { timeout: 3000 });
    const b = await pg.waitForSelector('#tile-body [data-invuse="' + item + '"]:not([disabled])', { timeout: 3000 });
    await b.click();
    return true;
  } catch (e) { await pg.keyboard.press('Escape').catch(() => {}); return false; }
}
async function preset(ctxOrPage, data) {
  await ctxOrPage.addInitScript(([k, d]) => {
    if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(d));
  }, [KEY, { seenHelp: true, nickname: '測試員', char: 'otter', testMap: 'classic40', ...data }]);
}

async function layoutProblems(page) {
  return page.evaluate(() => {
    const out = [];
    const W = innerWidth, H = innerHeight;
    if (document.documentElement.scrollWidth > W + 1) out.push('水平溢出 ' + document.documentElement.scrollWidth + '>' + W);
    for (const sel of ['#btn-settings', '.mc [data-a="roll"]', '#btn-menu-fab', '#side-open', '#chat-fab']) {
      const el = document.querySelector(sel);
      if (!el || el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) out.push(sel + ' 太小 ' + Math.round(r.width) + 'x' + Math.round(r.height));
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(sel + ' 超出畫面');
    }
    /* 設定鈕不能蓋到操作區的按鈕 */
    const g = document.querySelector('#btn-settings');
    if (g) {
      const r = g.getBoundingClientRect();
      for (const b of document.querySelectorAll('.mc button')) {
        const q = b.getBoundingClientRect();
        if (q.width && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top) out.push('設定鈕蓋到操作按鈕');
      }
    }
    const c = document.querySelector('.b3d');
    if (document.querySelector('#screen-game:not([hidden])') && (!c || c.clientWidth < 200 || c.clientHeight < 200)) out.push('3D 畫布太小');
    return out;
  });
}

async function solo(browser, base) {
  console.log('\n[單機：各尺寸版面與 3D 棋盤]');
  for (const [name, w, h, touch] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch });
    await preset(ctx, {});
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(base);
    await page.screenshot({ path: path.join(OUT, name + '-首頁.png') });
    let probs = await layoutProblems(page);
    await page.click('#go-solo');
    probs = probs.concat(await layoutProblems(page));
    await page.screenshot({ path: path.join(OUT, name + '-單機設定.png'), fullPage: true });
    await page.click('#solo-start');
    await page.waitForFunction(() => window.Solo && Solo.board && Solo.board.v3, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    probs = probs.concat(await layoutProblems(page));
    const has3d = await page.evaluate(() => !!(Solo.board && Solo.board.v3));
    ok(has3d, name + '：3D 場景建立成功（WebGL）');
    await page.screenshot({ path: path.join(OUT, name + '-對局.png') });
    ok(!probs.length && !errs.length, name + '：版面正常' + (probs.length ? '（' + [...new Set(probs)].join('；') + '）' : '') + (errs.length ? ' JS 錯誤：' + errs.join('；') : ''));
    await ctx.close();
  }

  console.log('\n[單機：設定、格子說明、我的地產]');
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.click('#btn-settings');
  ok(await page.isVisible('#settings-modal'), '右上角設定 → 開啟 Modal');
  ok(await page.evaluate(() => document.activeElement && !!document.activeElement.closest('#settings-modal')), '焦點移進設定彈窗');
  ok((await page.textContent('#settings-body')).includes('背景音樂') && (await page.textContent('#settings-body')).includes('音效'), '有獨立的背景音樂與音效設定');
  await page.click('[data-key="bgm"]');
  ok(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).bgm === false, KEY), '關掉背景音樂立刻存起來');
  await page.fill('[data-key="sfxVol"]', '0.2').catch(() => {});
  await page.keyboard.press('Escape');
  ok(!(await page.isVisible('#settings-modal')), 'Esc 關閉設定');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'btn-settings'), '關閉後焦點回到設定鈕');
  await page.reload();
  ok(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).bgm === false, KEY), '重新整理後設定仍保留');
  await page.click('#btn-settings');
  await page.click('#set-reset');
  ok(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).bgm === true, KEY), '「恢復預設」把音樂設回開');
  await page.keyboard.press('Escape');

  await page.click('#go-help');
  ok((await page.textContent('#help-body')).includes('命運之神') && (await page.textContent('#help-body')).includes('擲骰子'), '說明頁有完整的文字教學');
  await page.click('#help-go');
  while (await page.isEnabled('#solo-ai [data-step="1"]')) await page.click('#solo-ai [data-step="1"]');
  await page.click('#solo-diff [data-diff="normal"]');
  await page.click('#solo-ai-list [data-ai="0"][data-diff="kid"]');
  await page.click('#solo-ai-list [data-ai="2"][data-diff="hard"]');
  ok(!(await page.$('#solo-diff [aria-checked="true"]')) && /混合難度/.test(await page.textContent('#solo-diff-hint')), '電腦難度不一樣時顯示「混合難度」');
  await page.click('#solo-limit [data-limit="25"]');
  await page.evaluate(() => { App.store.testMap = 'classic40'; });   /* 前面按過「恢復預設」，測試用固定版面要再指定一次 */
  await page.click('#solo-start');
  await page.waitForFunction(() => window.Solo && Solo.board && Solo.board.v3, null, { timeout: 15000 });
  const st = await page.evaluate(() => ({ ai: Solo._debug.state.seats.filter(s => s.ai).map(s => s.id + ':' + s.ai).sort().join(','), lim: Solo._debug.state.opts.roundLimit }));
  ok(st.ai === 'ai0:kid,ai1:normal,ai2:hard,ai3:normal,ai4:normal', '單機 6 人（1 真人＋5 電腦），每個電腦照各自選的難度（' + st.ai + '）');
  ok(st.lim === 25, '回合上限設定生效（25）');

  /* 點 3D 棋盤上的格子 → 說明視窗 */
  await page.evaluate(() => Solo.board.v3.setFollow(false));
  await page.waitForTimeout(1500);
  const box = await page.evaluate(() => { const r = document.querySelector('.b3d').getBoundingClientRect(); return { l: r.left, t: r.top }; });
  const pt = await page.evaluate(() => Solo.board.v3.project(5, 0, 0, 0.3));
  await page.mouse.click(box.l + pt.x - (await page.evaluate(() => document.querySelector('.b3d').offsetLeft)) + 0, box.t + pt.y - (await page.evaluate(() => document.querySelector('.b3d').offsetTop)));
  await page.waitForTimeout(300);
  const opened = await page.isVisible('#tile-modal');
  ok(opened, '點 3D 棋盤上的格子會開啟格子說明');
  if (opened) {
    ok((await page.textContent('#tile-body')).includes('地價'), '格子說明有地價與租金');
    await page.keyboard.press('Escape');
  }
  /* 我的地產視窗 */
  const mineTurn = async () => page.evaluate(() => Solo._debug.state.seats[Solo._debug.state.turn].id === 'me' && Solo._debug.state.phase === 'roll');
  await page.evaluate(() => Solo.skipToMyRoll());
  for (let i = 0; i < 400 && !(await mineTurn()); i++) await page.waitForTimeout(500);
  await page.waitForFunction(() => !Solo.board._debug.busy, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(200);
  const mg = await page.$(".mc .mc-props");
  if (mg) {
    await page.click(".mc .mc-props");
    ok(await page.isVisible('#manage-modal') && (await page.textContent('#manage-body')).includes('現金'), '「我的地產」視窗顯示現金與強制收購說明');
    await page.keyboard.press('Escape');
  } else ok(false, '找不到「我的地產」按鈕');
  /* 道具：遙控骰選點數、機票點 3D 棋盤 */
  if (await mineTurn()) {
    await page.evaluate(() => { const g = Solo._debug; g.state.seats[g.state.turn].items = ['dice', 'fly', 'cat']; Solo.board.render(Rules.publicView(g.state, g.clock)); });
    await page.waitForSelector('.mc-items .it-chip.ready', { timeout: 3000 }).catch(() => {});
    ok(await page.$$eval('.mc-items .it-chip', e => e.length) === 3, '道具列顯示 3 個道具');
    ok(await invUse(page, 'dice'), '道具庫裡按「使用」→ 接著在面板選遙控骰步數');
    ok((await page.$$eval('.mc .pick-btn', e => e.length)) === 12, '遙控骰：出現 1～12 步選單');
    await page.click('.mc [data-n="3"]');
    ok(!!(await page.$('.mc [data-confirm]')) && (await page.textContent('.mc .mc-hint')).length > 0, '遙控骰：點點數只預覽（落點說明＋確認鈕），還沒送出');
    ok(await page.evaluate(() => Solo.board._debug.pick === 'dice' && !Solo.board._debug.sent), '預覽時尚未使用道具');
    await page.click('.mc [data-pickcancel]');
    ok(!(await page.$('.mc .pick-btn')), '「先不用」收起選單');
    ok(await invUse(page, 'fly'), '道具庫裡按「使用」→ 接著在面板選機票目的地');
    ok((await page.$$eval('.mc .tchip', e => e.length)) > 20, '機票：面板列出可飛的格子清單');
    await page.click('.mc [data-fflt="spec"]');
    ok((await page.$$eval('.mc .tchip', e => e.length)) < 20 && (await page.$$eval('.mc .fly-f.on', e => e.length)) === 1, '機票：切到「特別格」只剩特別格');
    await page.click('.mc [data-fflt="all"]');
    await page.click('.mc [data-fsel="12"]');
    ok(!!(await page.$('.mc [data-confirm]')) && (await page.textContent('.mc')).includes(await page.evaluate(() => Rules.TILES[12].name)), '機票：點清單的格子會選取並出現確認鈕');
    ok(await page.evaluate(() => !Solo.board._debug.sent), '選取時還沒送出');
    await page.evaluate(() => Solo.board.v3.setFollow(false));
    await page.waitForTimeout(1200);
    const bx = await page.evaluate(() => { const c = document.querySelector('.b3d'); const r = c.getBoundingClientRect(); const p = Solo.board.v3.project(12, 0, 0, 0.3); return { x: r.left + p.x - c.offsetLeft, y: r.top + p.y - c.offsetTop }; });
    await page.mouse.click(bx.x, bx.y);
    if (!(await page.waitForSelector('.mc [data-confirm]', { timeout: 1500 }).catch(() => null))) await page.evaluate(() => Solo.board.tileClick(12));
    await page.waitForSelector('.mc [data-confirm]', { timeout: 3000 });
    const before = await page.evaluate(() => { const g = Solo._debug; return g.state.seats.find(x => x.id === 'me').pos; });
    ok(before !== 12, '機票：點格子只是選目的地，還沒飛（要按確認）');
    await page.click('.mc [data-confirm]');
    await page.waitForTimeout(400);
    const flew = await page.evaluate(() => { const g = Solo._debug; const i = g.state.seats.findIndex(x => x.id === 'me'); return { pos: g.state.seats[i].pos, items: g.state.seats[i].items.join(',') }; });
    ok(flew.pos === 12 && flew.items === 'dice,cat', '機票：按確認才飛過去並用掉（' + JSON.stringify(flew) + '）');
  }
  /* 攻擊型道具的選目標介面、走到自己的地的蓋房詢問、自製卷軸 */
  {
    await page.evaluate(() => Solo.skipToMyRoll());
    for (let i = 0; i < 400 && !(await mineTurn()); i++) {
      const ph = await page.evaluate(() => { const g = Solo._debug.state; return g.seats[g.turn].id === 'me' ? g.phase : ''; });
      if (ph === 'shop') await leaveShop(page);
      else if (ph === 'buy') await page.click('.mc [data-a="decline"]', { timeout: 5000 }).catch(() => {});
      else if (ph === 'build') await page.click('.mc [data-a="decline"]', { timeout: 5000 }).catch(() => {});
      else if (ph === 'manage') await page.click('.mc [data-a="endTurn"]', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await page.evaluate(() => {
      const g = Solo._debug, me = g.state.seats.find(x => x.id === 'me');
      me.items = ['steal', 'swap', 'bomb'];
      g.state.seats.filter(x => x.id !== 'me').forEach((x, k) => { x.pos = 5 + k; x.cash = 1500; x.jail = false; });
      Solo.board.render(Rules.publicView(g.state, g.clock));
    });
    await page.waitForSelector('.mc .it-chip.ready', { timeout: 4000 }).catch(() => {});
    ok(!(await page.$('.mc [data-item]')), '面板上的道具不能直接按（統一在道具庫使用）');
    ok(await invUse(page, 'steal'), '偷錢卡在道具庫按「使用」');
    ok((await page.$$eval('.mc .tgt-btn', e => e.length)) >= 1, '偷錢卡：出現選對手的按鈕');
    const c0 = await page.evaluate(() => Solo._debug.state.seats.find(x => x.id === 'me').cash);
    await page.click('.mc .tgt-btn:not([disabled])');
    await page.waitForSelector('.mc [data-confirm]', { timeout: 3000 });
    ok(await page.isVisible('.mc [data-confirm]') && (await page.textContent('.mc [data-confirm]')).includes('偷'), '選中對手後出現「偷他的錢」確認鈕（不會一點就用掉）');
    ok(await page.$('.mc .tgt-btn.sel'), '選中的對手有標示');
    await page.click('.mc [data-confirm]');
    await page.waitForTimeout(300);
    const c1 = await page.evaluate(() => Solo._debug.state.seats.find(x => x.id === 'me').cash);
    ok(c1 > c0, '偷錢成功：現金增加（' + c0 + '→' + c1 + '）');
    await page.waitForFunction(() => !Solo.board._debug.busy, null, { timeout: 15000 }).catch(() => {});
    /* 蓋房詢問 */
    await page.evaluate(() => {
      const g = Solo._debug, st = g.state, i = st.turn;
      st.seats[i].cash = 3000; st.props[6].owner = i; st.props[6].houses = 0;
      st.pending = { kind: 'build', tile: 6 }; st.phase = 'build'; st.version++;
      Solo.board.render(Rules.publicView(st, g.clock));
    });
    await page.waitForSelector('.mc [data-a="build"]', { timeout: 4000 }).catch(() => {});
    ok(await page.$('.mc [data-a="build"]:not([disabled])') && await page.$('.mc [data-a="decline"]'), '走到自己的地：面板詢問「蓋」或「不蓋」');
    await page.click('.mc [data-a="build"]');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => Solo._debug.state.props[6].houses) === 1, '按「蓋」：多一棟房子');
    /* 我的地產：不能直接蓋、沒有抵押、沒有收購 */
    await page.evaluate(() => { const g = Solo._debug; Solo.board.openManage(document.body); });
    await page.waitForSelector('#manage-modal', { state: 'visible', timeout: 3000 }).catch(() => {});
    const mtxt = await page.evaluate(() => document.querySelector('#manage-body').innerText);
    ok(!/蓋房 −|抵押|贖回|收購 −/.test(mtxt), '「我的地產」沒有蓋房、抵押、收購按鈕');
    await page.keyboard.press('Escape');
  }
  /* 3D 骰子：擲完要停平、朝上的點數要跟結果一樣 */
  {
    await page.evaluate(() => { const g = Solo._debug; g.state.seats.forEach(x => { x.items = []; }); });
    await page.evaluate(() => Solo.skipToMyRoll());
    for (let i = 0; i < 400 && !(await mineTurn()); i++) {
      const ph = await page.evaluate(() => { const g = Solo._debug.state; return g.seats[g.turn].id === 'me' ? g.phase : ''; });
      if (ph === 'shop') await leaveShop(page);
      else if (ph === 'buy' || ph === 'build') await page.click('.mc [data-a="decline"]', { timeout: 5000 }).catch(() => {});
      else if (ph === 'manage') await page.click('.mc [data-a="endTurn"]', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    const errs0 = await page.evaluate(() => { window.__e = []; window.addEventListener('error', e => window.__e.push(e.message)); return 0; });
    await page.click('.mc [data-a="roll"]');
    await page.waitForFunction(() => Solo._debug.state.dice[0] > 0 && Solo.board.v3 && !Solo.board.v3._debug.diceMoving, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    const dd = await page.evaluate(() => { const v = Solo.board.v3._debug, d = Solo._debug.state.dice; return { shown: [v.diceTop(0), v.diceTop(1)], want: d.slice(), moving: v.diceMoving }; });
    await page.waitForFunction(() => !Solo.board._debug.busy, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    const stuck = await page.evaluate(() => { const st = Solo._debug.state; return st.seats[st.turn].id === 'me' ? [...document.querySelectorAll('.mc [data-a]')].filter(b => b.disabled).map(b => b.dataset.a) : []; });
    ok(!stuck.length, '擲完骰、動畫播完後，操作按鈕不會卡在灰色（' + stuck.join(',') + '）');
    ok(!dd.moving && dd.shown[0] === dd.want[0] && dd.shown[1] === dd.want[1], '3D 骰子停平、朝上點數＝擲出結果（' + JSON.stringify(dd) + '）');
  }
  /* 開視窗時遊戲要暫停 */
  await page.screenshot({ path: path.join(OUT, '平板橫向-對局.png') });
  await page.keyboard.press('Escape');
  ok(await page.isVisible('#menu-modal'), 'Esc 打開暫停選單');
  ok(await page.evaluate(() => Solo.paused), '暫停選單開著時時鐘停住');
  await page.click('#m-home');
  ok(await page.isVisible('#screen-home'), '暫停選單可以回首頁');
  await ctx.close();

  console.log('\n[單機：完整一局打到結算（假時鐘快轉）]');
  const c2 = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await preset(c2, { roundLimit: 25, aiCount: 1, difficulty: 'hard', aiDiffs: ['hard', 'hard', 'hard'], reduceMotion: true, fastAnim: true, bgm: false });
  const p2 = await c2.newPage();
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(e.message));
  await p2.goto(base);
  await p2.click('#go-solo');
  await p2.click('#solo-start');
  await p2.waitForFunction(() => window.Solo && Solo.board && Solo.board.v3, null, { timeout: 15000 });
  /* 快轉遊戲時間（不畫畫面），電腦照自己的腦袋玩，玩家由測試代按「最該按的鍵」 */
  await p2.evaluate(() => Solo.fastForward(1200000, true));
  const done = await p2.waitForSelector('#result:not([hidden])', { timeout: 20000 }).then(() => true, () => false);
  ok(done, '單機一局可以從開始打到結算');
  if (done) {
    await p2.screenshot({ path: path.join(OUT, '平板橫向-結算.png') });
    const res = await p2.evaluate(() => ({ rows: document.querySelectorAll('#result .rank-list li').length, txt: document.querySelector('#result').textContent, st: JSON.parse(localStorage.getItem('richman')).stats }));
    ok(res.rows === 2, '結算列出每個玩家的名次');
    ok(Object.values(res.st).reduce((a, x) => a + x.play, 0) === 1, '這局的戰績記到這台裝置');
    await p2.click('#res-again', { timeout: 25000 });
    ok(await p2.isHidden('#result') && await p2.evaluate(() => Solo._debug.state.round === 1), '「再來一局」重新開始');
  }
  ok(!errs2.length, '完整一局沒有 JS 錯誤' + (errs2.length ? '：' + errs2.join('；') : ''));
  await c2.close();
}

async function online(browser, base) {
  console.log('\n[線上：建房、邀請、觀戰、開局、聊天]');
  const mk = async (name, w, h) => {
    const ctx = await browser.newContext({ viewport: { width: w || 1180, height: h || 820 } });
    await preset(ctx, { nickname: name, bgm: false });
    const page = await ctx.newPage();
    page.errs = [];
    page.on('pageerror', e => page.errs.push(e.message));
    return { ctx, page };
  };
  const A = await mk('房主');
  await A.page.goto(base);
  await A.page.click('#go-online');
  await A.page.waitForFunction(() => Net.connected, null, { timeout: 10000 });
  ok(true, '房主連上伺服器');
  await A.page.click('#lobby-create');
  await A.page.waitForSelector('#screen-room:not([hidden])');
  ok(await A.page.isVisible('#room-invite input'), '房間有邀請連結');
  const link = await A.page.inputValue('#invite-url');
  ok(/invite=/.test(link), '邀請連結帶有 token');
  await A.page.click('[data-act="add-ai"]');
  await A.page.waitForSelector('.seat-row .tag.ai, .seat-row .ai-dd');
  ok(true, '房主加了一個電腦');
  ok(!(await A.page.$('#screen-room select')), '房間裡沒有瀏覽器原生下拉選單');
  await A.page.click('.seat-row .ai-dd');
  await A.page.waitForSelector('.dd-menu .dd-opt');
  ok((await A.page.$$('.dd-menu .dd-opt')).length === 4 && await A.page.getAttribute('.seat-row .ai-dd', 'aria-expanded') === 'true', '自製下拉選單展開，有 4 種難度');
  await A.page.click('.dd-menu .dd-opt[data-val="hard"]');
  await A.page.waitForFunction(() => { const b = document.querySelector('.seat-row .ai-dd'); return b && b.dataset.val === 'hard'; }, null, { timeout: 5000 });
  ok(!(await A.page.$('.dd-menu')), '選完難度：選單收起，電腦難度改成困難');
  await A.page.click('[data-set="roundLimit"][data-val="25"]');
  await A.page.screenshot({ path: path.join(OUT, '平板橫向-房間.png') });

  /* 朋友用邀請連結：選觀戰 */
  const B = await mk('朋友', 820, 1180);
  await B.page.goto(link.replace(/^https?:\/\/[^/]+/, base));
  await B.page.waitForSelector('.invite-card [data-as="spectator"]', { timeout: 10000 });
  ok(await B.page.isVisible('.invite-card [data-as="player"]'), '邀請卡片有「加入遊戲」與「觀戰」');
  await B.page.click('.invite-card [data-as="spectator"]');
  await B.page.waitForSelector('#screen-room:not([hidden])');
  ok((await B.page.textContent('#room-role')).includes('觀戰者'), '用邀請連結觀戰：角色是觀戰者');
  /* 聊天 */
  await B.page.fill('[data-chat="room"] input', '大家好');
  await B.page.press('[data-chat="room"] input', 'Enter');
  await A.page.waitForFunction(() => document.querySelector('[data-chat="room"] .chat-log').textContent.includes('大家好'), null, { timeout: 5000 });
  ok(true, '聊天室訊息傳到房主');

  /* 開局 */
  await A.page.click('[data-act="start"]');
  await A.page.waitForSelector('#screen-game:not([hidden])');
  await B.page.waitForSelector('#screen-game:not([hidden])');
  await A.page.waitForFunction(() => Online.board && Online.board.v3, null, { timeout: 15000 });
  await B.page.waitForFunction(() => Online.board && Online.board.v3, null, { timeout: 15000 });
  ok(true, '開局後兩邊都看到 3D 棋盤');
  ok((await B.page.textContent('#summary')).includes('觀戰者'), '觀戰者的左欄摘要標明觀戰身分');
  ok(!(await B.page.$('#board [data-a="roll"]')), '觀戰者沒有擲骰等操作按鈕');
  ok(await A.page.isVisible('[data-chat="game"]'), '對局左欄有聊天室（寬版）');
  /* 房主玩幾回合，觀戰者看到的局面要一樣 */
  for (let i = 0; i < 60; i++) {
    await A.page.evaluate(() => { const b = Online.board; if (!b || b.primary()) return; const v = Online.room && Online.room.game; if (v && b.mySeat >= 0 && v.turn === b.mySeat && v.phase === 'buy') { const d = document.querySelector('#board [data-a="decline"]'); if (d) d.click(); } });
    await A.page.waitForTimeout(500);
    const r = await A.page.evaluate(() => Online.room && Online.room.game && Online.room.game.round);
    if (r >= 3) break;
  }
  const ra = await A.page.evaluate(() => Online.room.game.round);
  const rb = await B.page.evaluate(() => Online.room.game.round);
  ok(ra >= 2 && Math.abs(ra - rb) <= 1, '房主玩了幾回合，觀戰者看到同一局（第 ' + ra + '／' + rb + ' 回合）');
  await A.page.screenshot({ path: path.join(OUT, '平板橫向-線上對局.png') });
  await B.page.screenshot({ path: path.join(OUT, '平板直向-觀戰.png') });
  const probsB = await layoutProblems(B.page);
  ok(!probsB.length, '觀戰（平板直向）版面正常' + (probsB.length ? '：' + probsB.join('；') : ''));
  /* 觀戰者不能操作：直接送 act 也會被伺服器拒絕 */
  const rej = await B.page.evaluate(() => new Promise(res => { Net.on('error', m => res(m.text)); Net.send({ type: 'act', action: { type: 'roll' } }); setTimeout(() => res(''), 3000); }));
  ok(/觀戰/.test(rej), '伺服器拒絕觀戰者的操作（' + rej + '）');

  /* 撤銷邀請 → 舊連結失效 */
  await A.page.evaluate(() => Online.leaveRoom && 0);
  const C = await mk('路人');
  ok(A.page.errs.length + B.page.errs.length === 0, '線上流程沒有 JS 錯誤' + [...A.page.errs, ...B.page.errs].join('；'));
  await C.ctx.close();
  await A.ctx.close(); await B.ctx.close();
}

(async () => {
  process.env.RICHMAN_TEST_MAP = 'classic40';
  const app = createServer();
  await new Promise(r => app.server.listen(0, r));
  app.start();
  const base = 'http://localhost:' + app.server.address().port;
  let browser = null;
  try {
    browser = await pw.chromium.launch(LAUNCH);
  } catch (e) {
    try { browser = await pw.chromium.launch({ ...LAUNCH, executablePath: '/opt/pw-browsers/chromium' }); } catch (e2) { console.log('無法啟動 Chromium，略過瀏覽器檢查：' + e2.message); app.server.close(); process.exit(0); }
  }
  try {
    await solo(browser, base);
    await online(browser, base);
  } catch (e) {
    fail++; console.log('  ✘ 檢查中斷：' + (e && e.stack || e));
  }
  await browser.close();
  app.stop && app.stop();
  app.server.close();
  console.log('\n瀏覽器檢查：' + pass + ' 通過，' + fail + ' 失敗（截圖在 screenshots/）');
  process.exit(fail ? 1 : 0);
})();
