/* 地圖實機檢查：每張地圖都開一局單機，檢查 3D 棋盤格數、飛到每種格子後流程能繼續、道具商店可以買、截圖給人看。 */
'use strict';
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
let pw = null;
try { pw = require('playwright'); } catch (e) { try { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { } }
if (!pw) { console.log('沒有 Playwright，略過'); process.exit(0); }
const { createServer } = require('../server.js');
const OUT = path.join(__dirname, '..', 'screenshots'); fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.MAP_ONLY;
let pass = 0, fail = 0;
const ok = (v, n) => { v ? pass++ : fail++; console.log((v ? '  ✔ ' : '  ✘ ') + n); };
(async () => {
  const app = createServer(); app.start(); await new Promise(r => app.server.listen(0, r));
  const base = 'http://localhost:' + app.server.address().port;
  let browser; try { browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
  const maps = JSON.parse(execSync('node -e "console.log(JSON.stringify(require(\'./public/js/maps.js\').LIST.map(m=>({id:m.id,name:m.name,size:m.size,types:m.tiles.map(t=>t.type)}))))"', { cwd: path.join(__dirname, '..') }).toString());
  for (const m of maps.filter(m => !ONLY || m.id === ONLY)) {
    console.log('\n[' + m.name + '（' + m.size + ' 格）]');
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript((mid) => localStorage.setItem('richman', JSON.stringify({ seenHelp: true, nickname: '測', char: 'otter', reduceMotion: true, fastAnim: true, bgm: false, aiCount: 2, roundLimit: 0, map: mid })), m.id);
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(base); await page.click('#go-solo');
    ok(await page.isVisible('.map-card[data-map="' + m.id + '"][aria-checked="true"]'), '選地圖畫面：目前選的是「' + m.name + '」');
    await page.click('#solo-start');
    await page.waitForFunction(() => window.Solo && Solo.board && Solo.board.v3, null, { timeout: 40000 });
    const info = await page.evaluate(() => { const g = Solo._debug.state; return { map: g.map, n: g.tiles.length, tilesR: Rules.TILES.length, toks: Solo.board.v3._debug.toks.length }; });
    ok(info.map === m.id && info.n === m.size && info.tilesR === m.size, '規則與畫面都是 ' + m.size + ' 格（' + info.map + '）');
    /* 3D 棋盤：每一格都有一個可點的格子物件，位置互不重疊 */
    const geo = await page.evaluate(() => {
      const scene = Solo.board.v3._debug.scene; const ps = [];
      scene.traverse(o => { if (o.userData && o.userData.tile != null) { const w = new (o.position.constructor)(); o.getWorldPosition(w); ps.push([o.userData.tile, +w.x.toFixed(2), +w.z.toFixed(2)]); } });
      const seen = new Set(ps.map(p => p[1] + ',' + p[2]));
      return { n: ps.length, uniq: seen.size };
    });
    ok(geo.n === m.size && geo.uniq === m.size, '3D 棋盤有 ' + geo.n + ' 個格子、位置各不相同（' + geo.uniq + '）');
    await page.evaluate(() => Solo.board.v3.setFollow(false));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, '地圖-' + m.id + '.png') });
    /* 每種格子各飛一次：機票落點後一定要能繼續（有可按的主線按鈕），並在商店買一個道具 */
    const kinds = ['prop', 'station', 'utility', 'tax', 'chance', 'chest', 'park', 'jail', 'shop'].filter(k => m.types.includes(k));
    for (const k of kinds) {
      const idx = m.types.indexOf(k);
      for (let i = 0; i < 600; i++) {
        const st = await page.evaluate(() => { const g = Solo._debug.state; return { me: g.seats[g.turn].id === 'me', ph: g.phase, busy: Solo.board._debug.busy }; });
        if (st.me && st.ph === 'roll' && !st.busy) break;
        if (st.me && !st.busy) {
          const sel = st.ph === 'buy' || st.ph === 'build' || st.ph === 'shop' ? '[data-a="decline"]' : st.ph === 'manage' ? '[data-a="endTurn"]' : st.ph === 'debt' ? '[data-a="bankrupt"]' : null;
          if (sel) await page.click('.mc ' + sel, { timeout: 2000 }).catch(() => {});
        }
        await page.waitForTimeout(250);
      }
      await page.evaluate(([idx]) => { const g = Solo._debug, st = g.state, me = st.seats[st.turn]; me.items = ['fly']; me.cash = 3000; me.pos = idx === 1 ? 2 : 1; me.jail = false; st.again = false; st.doubles = 0; Solo.board.render(Rules.publicView(st, g.clock)); }, [idx]);
      await page.waitForSelector('.mc .it-chip.on[data-item="fly"]', { timeout: 5000 }).catch(() => {});
      await page.click('.mc .it-chip.on[data-item="fly"]', { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(400);
      await page.evaluate(t => Solo.board.tileClick(t), idx);
      await page.waitForTimeout(600);
      let btn = null, ph = '';
      for (let i = 0; i < 48; i++) {
        await page.waitForTimeout(250);
        const s2 = await page.evaluate(() => { const g = Solo._debug.state; return { me: g.seats[g.turn].id === 'me', ph: g.phase, busy: Solo.board._debug.busy, btns: [...document.querySelectorAll('.mc [data-a],.mc [data-shop]')].filter(b => !b.disabled && b.offsetParent).map(b => b.dataset.a || 'shop:' + b.dataset.shop) }; });
        ph = s2.ph; if (!s2.me) { btn = 'next'; break; } if (!s2.busy && s2.btns.length) { btn = s2.btns.join(','); break; }
      }
      const at = await page.evaluate(() => { const g = Solo._debug.state; return g.seats[g.turn].id === 'me' ? g.seats[g.turn].pos : -1; });
      ok(at === idx || at === -1 || btn === 'next' || k === 'chance' || k === 'chest' || k === 'jail', '機票真的飛到第 ' + idx + ' 格（現在在 ' + at + '）');
      ok(!!btn, '飛到「' + k + '」格（第 ' + idx + ' 格）後可繼續：階段 ' + ph + '，按鈕 ' + btn);
      if (k === 'shop' && btn && btn !== 'next') {
        ok(ph === 'shop', '停在道具商店：出現商店面板');
        await page.screenshot({ path: path.join(OUT, '地圖-' + m.id + '-商店.png') });
        const cash0 = await page.evaluate(() => Solo._debug.state.seats[Solo._debug.state.turn].cash);
        await page.click('.mc [data-shop]:not([disabled])', { timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(900);
        const after = await page.evaluate(() => { const st = Solo._debug.state, me = st.seats.find(s => s.id === 'me'); return { cash: me.cash, items: me.items.length }; });
        ok(after.cash < cash0 && after.items >= 1, '買了一個道具：現金 ' + cash0 + ' → ' + after.cash + '，道具 ' + after.items + ' 個');
      }
    }
    ok(!errs.length, '沒有 JS 錯誤' + (errs.length ? '：' + errs.join('；') : ''));
    await ctx.close();
  }
  await browser.close(); app.stop(); app.server.close();
  console.log('\n地圖實機檢查：' + pass + ' 通過，' + fail + ' 失敗');
  process.exit(fail ? 1 : 0);
})();
