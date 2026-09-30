/* ===== scripts/run-e2e.js — 平行跑完整實機（Playwright）測試 =====
 * 用法：node scripts/run-e2e.js [--quick] [--jobs=N] [--only=名稱,名稱]
 *   --quick  只跑最重要的（瀏覽器主流程＋道具流程），跳過捲動、卡死掃描、地圖
 *   --jobs   同時跑幾個（預設＝CPU 核心數）
 * 每個測試檔各開自己的伺服器（port 0），所以可以放心同時跑；輸出等該項跑完再一次印，不會交錯。
 * 3D 在自動化瀏覽器裡自動用低畫質（board3d.js 偵測 navigator.webdriver），版面不變、算圖快很多。 */
'use strict';
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const flag = n => (args.find(a => a.startsWith('--' + n + '=')) || '').split('=')[1];
const quick = args.includes('--quick');
const jobs = Math.max(1, Number(flag('jobs')) || os.cpus().length);
const only = (flag('only') || '').split(',').filter(Boolean);

const ALL = [
  { name: 'browser', file: 'browser-check.js', quick: true },
  { name: 'shop', file: 'shop-check.js', quick: true },
  { name: 'items', file: 'item-flow-check.js', quick: true },
  { name: 'online-items', file: 'online-item-check.js', quick: true },
  { name: 'scroll-portrait', file: 'scroll-check.js', env: { SCROLL_ONLY: '直向' } },
  { name: 'scroll-landscape', file: 'scroll-check.js', env: { SCROLL_ONLY: '橫向' } },
  { name: 'stall', file: 'ui-stall-check.js' },
  { name: 'maps', file: 'map-check.js' }
];
let list = ALL.filter(j => !quick || j.quick);
if (only.length) list = ALL.filter(j => only.includes(j.name));

const results = [];
function run(job) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(__dirname, job.file)], { env: Object.assign({}, process.env, job.env || {}), cwd: path.join(__dirname, '..') });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('close', code => {
      const sec = Math.round((Date.now() - t0) / 1000);
      const bad = out.split('\n').filter(l => /✘/.test(l));
      console.log('\n===== ' + job.name + '：' + (code === 0 ? '通過' : '失敗（exit ' + code + '）') + '，' + sec + ' 秒 =====');
      console.log(code === 0 ? out.trim().split('\n').slice(-3).join('\n') : (bad.length ? bad.join('\n') : out.trim().split('\n').slice(-15).join('\n')));
      results.push({ name: job.name, code, sec });
      resolve();
    });
  });
}
(async () => {
  const t0 = Date.now();
  const queue = list.slice();
  console.log('平行度 ' + jobs + '，共 ' + queue.length + ' 項：' + queue.map(j => j.name).join('、'));
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => { while (queue.length) await run(queue.shift()); }));
  const failed = results.filter(r => r.code !== 0);
  console.log('\n總共 ' + Math.round((Date.now() - t0) / 1000) + ' 秒；' + (failed.length ? '失敗：' + failed.map(r => r.name).join('、') : '全部通過'));
  process.exit(failed.length ? 1 : 0);
})();
