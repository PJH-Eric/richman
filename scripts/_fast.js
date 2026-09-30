/* 測試加速：Playwright 預設每個動作等 30 秒；找不到東西時 8 秒就放棄，整套測試才不會卡在逾時上 */
'use strict';
module.exports = function speedUp(pw, ms) {
  ms = ms || 8000;
  if (!pw || pw.__fast) return pw;
  pw.__fast = true;
  const launch = pw.chromium.launch.bind(pw.chromium);
  pw.chromium.launch = async (...a) => {
    const b = await launch(...a);
    const nc = b.newContext.bind(b), np = b.newPage.bind(b);
    b.newContext = async (...x) => { const c = await nc(...x); c.setDefaultTimeout(ms); return c; };
    b.newPage = async (...x) => { const p = await np(...x); p.setDefaultTimeout(ms); return p; };
    return b;
  };
  return pw;
};
