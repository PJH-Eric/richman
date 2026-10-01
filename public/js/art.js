/* ===== art.js — 全手繪 SVG 美術（八隻海島動物、40 格地標小圖、骰子、房子、圖示） =====
 *
 * 不用 emoji、不用圖片檔：系統字型會改變 emoji 長相，SVG 在每台裝置都一樣清楚。
 * 地標小圖只是輔助辨認；每一格一定同時寫著名字，不靠顏色或圖案單獨傳達資訊。
 */
(function (root) {
  'use strict';

  let uid = 0;
  const nextId = p => (p || 'g') + (++uid);

  function hibiscus(cx, cy, r, color, center) {
    let out = '';
    for (let i = 0; i < 5; i++) {
      out += '<ellipse cx="' + cx + '" cy="' + (cy - r * 0.55) + '" rx="' + (r * 0.42) + '" ry="' + (r * 0.6) +
        '" fill="' + color + '" transform="rotate(' + (i * 72) + ' ' + cx + ' ' + cy + ')"/>';
    }
    return out + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.22) + '" fill="' + (center || '#FFE08A') + '"/>';
  }


  /* ---------- 八隻海島動物（頭像＋花襯衫肩膀，漸層做立體） ---------- */

  const ANIMALS = [
    { id: 'otter',    name: '水獺', base: '#9A7358', dark: '#6B4A34', light: '#F3E2CC', shirt: '#4FB3E8', ears: 'low',    muzzle: 'wide', whisker: true },
    { id: 'bunny',    name: '兔兔', base: '#FBF3EF', dark: '#E2CFC8', light: '#FFFFFF', shirt: '#F58FB0', ears: 'long',   muzzle: 'small', flower: true },
    { id: 'capybara', name: '水豚', base: '#C0915E', dark: '#936639', light: '#D9B386', shirt: '#7BCB6E', ears: 'tiny',   muzzle: 'capy', leaf: true },
    { id: 'penguin',  name: '企鵝', base: '#334262', dark: '#1F2A42', light: '#FFFFFF', shirt: '#FFB547', ears: 'none',   muzzle: 'beak', hat: true },
    { id: 'shiba',    name: '柴柴', base: '#EE9F4E', dark: '#C9772B', light: '#FFF6EA', shirt: '#6FC9C4', ears: 'point',  muzzle: 'dog' },
    { id: 'turtle',   name: '海龜', base: '#83C986', dark: '#4F9A5A', light: '#D8F1CF', shirt: '#F77F6B', ears: 'none',   muzzle: 'small', spots: true, glasses: true },
    { id: 'koala',    name: '無尾熊', base: '#A9B2BF', dark: '#7F8896', light: '#F1F3F6', shirt: '#B48CF0', ears: 'fluffy', muzzle: 'koala' },
    { id: 'cat',      name: '貓咪', base: '#F4D59C', dark: '#E0A456', light: '#FFF8EA', shirt: '#5C8FE8', ears: 'point',  muzzle: 'small', stripes: true }
  ];
  const ANIMAL_MAP = {};
  ANIMALS.forEach(a => { ANIMAL_MAP[a.id] = a; });

  function ears(a, g) {
    const f = 'url(#' + g + ')';
    switch (a.ears) {
      case 'round':
        return '<circle cx="30" cy="30" r="11" fill="' + a.dark + '"/><circle cx="90" cy="30" r="11" fill="' + a.dark + '"/>' +
          '<circle cx="30" cy="31" r="5.5" fill="' + a.light + '" opacity=".7"/><circle cx="90" cy="31" r="5.5" fill="' + a.light + '" opacity=".7"/>';
      case 'long':
        return '<ellipse cx="43" cy="26" rx="10.5" ry="24" fill="' + f + '" transform="rotate(-10 43 26)"/>' +
          '<ellipse cx="79" cy="26" rx="10.5" ry="24" fill="' + f + '" transform="rotate(12 79 26)"/>' +
          '<ellipse cx="43" cy="27" rx="5" ry="17" fill="#F7B6C6" transform="rotate(-10 43 27)"/>' +
          '<ellipse cx="79" cy="27" rx="5" ry="17" fill="#F7B6C6" transform="rotate(12 79 27)"/>';
      case 'low':
        return '<ellipse cx="25" cy="48" rx="7" ry="6" fill="' + a.dark + '"/><ellipse cx="95" cy="48" rx="7" ry="6" fill="' + a.dark + '"/>';
      case 'tiny':
        return '<ellipse cx="33" cy="30" rx="7" ry="6" fill="' + a.dark + '"/><ellipse cx="87" cy="30" rx="7" ry="6" fill="' + a.dark + '"/>';
      case 'point':
        return '<path d="M22 44 28 12 50 30Z" fill="' + a.dark + '" stroke="' + a.dark + '" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M98 44 92 12 70 30Z" fill="' + a.dark + '" stroke="' + a.dark + '" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M29 36 31 20 43 31Z" fill="#F7B6C6"/><path d="M91 36 89 20 77 31Z" fill="#F7B6C6"/>';
      case 'fluffy':
        return '<circle cx="24" cy="36" r="19" fill="' + a.base + '"/><circle cx="96" cy="36" r="19" fill="' + a.base + '"/>' +
          '<circle cx="25" cy="37" r="11" fill="' + a.light + '"/><circle cx="95" cy="37" r="11" fill="' + a.light + '"/>';
      default: return '';
    }
  }

  function muzzle(a) {
    const eyeY = 54;
    const eyes =
      '<ellipse cx="45" cy="' + eyeY + '" rx="5" ry="6.2" fill="#2A2230"/><ellipse cx="75" cy="' + eyeY + '" rx="5" ry="6.2" fill="#2A2230"/>' +
      '<circle cx="46.8" cy="' + (eyeY - 2.4) + '" r="1.9" fill="#fff"/><circle cx="76.8" cy="' + (eyeY - 2.4) + '" r="1.9" fill="#fff"/>';
    const cheeks = '<ellipse cx="34" cy="68" rx="7" ry="4.5" fill="#FF8FA3" opacity=".55"/><ellipse cx="86" cy="68" rx="7" ry="4.5" fill="#FF8FA3" opacity=".55"/>';
    const smile = '<path d="M53 74q7 7 14 0" stroke="#2A2230" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
    switch (a.muzzle) {
      case 'wide':
        return '<path d="M24 66c0-12 14-20 36-20s36 8 36 20-14 26-36 26-36-14-36-26Z" fill="' + a.light + '" opacity=".9"/>' +
          eyes + cheeks + '<ellipse cx="60" cy="72" rx="20" ry="14" fill="' + a.light + '"/>' +
          '<ellipse cx="60" cy="66" rx="6" ry="4.2" fill="#3A2A22"/>' + smile +
          (a.whisker ? '<g stroke="#6B4A34" stroke-width="1.6" stroke-linecap="round"><path d="M44 70 28 67M44 74 28 76M76 70l16-3M76 74l16 2"/></g>' : '');
      case 'capy':
        return eyes + cheeks + '<rect x="40" y="60" width="40" height="28" rx="14" fill="' + a.light + '"/>' +
          '<ellipse cx="53" cy="68" rx="2.6" ry="3.4" fill="#4A3526"/><ellipse cx="67" cy="68" rx="2.6" ry="3.4" fill="#4A3526"/>' +
          '<path d="M54 79q6 5 12 0" stroke="#4A3526" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
      case 'beak':
        return '<path d="M26 64C26 44 40 34 60 34s34 10 34 30-16 30-34 30-34-10-34-30Z" fill="' + a.light + '"/>' +
          eyes + cheeks + '<path d="M50 66h20l-10 10z" fill="#FFA928" stroke="#E07F10" stroke-width="2" stroke-linejoin="round"/>';
      case 'dog':
        return '<path d="M30 70c4-14 16-18 30-18s26 4 30 18c-4 14-16 20-30 20s-26-6-30-20Z" fill="' + a.light + '"/>' +
          eyes + cheeks + '<ellipse cx="60" cy="67" rx="6" ry="4.4" fill="#2A2230"/>' + smile;
      case 'koala':
        return eyes + cheeks + '<ellipse cx="60" cy="67" rx="9" ry="11" fill="#3B3F4A"/>' +
          '<ellipse cx="57" cy="62" rx="3" ry="2" fill="#fff" opacity=".4"/>' + smile.replace('74', '80').replace('q7 7 14 0', 'q7 5 14 0');
      default:
        return eyes + cheeks + '<ellipse cx="60" cy="66" rx="4" ry="3" fill="#E87A8E"/>' + smile;
    }
  }

  function extras(a) {
    let out = '';
    if (a.spots) out += '<g fill="' + a.dark + '" opacity=".45"><circle cx="40" cy="30" r="5"/><circle cx="82" cy="34" r="4"/><circle cx="62" cy="24" r="3.5"/></g>';
    if (a.stripes) out += '<g stroke="' + a.dark + '" stroke-width="4" stroke-linecap="round"><path d="M52 24v9M60 22v11M68 24v9"/></g>';
    if (a.flower) out += hibiscus(84, 26, 13, '#FF6F91', '#FFE08A');
    if (a.leaf) out += '<path d="M62 22c8-12 22-12 26-8-6 2-12 8-26 8Z" fill="#5DBB63"/><path d="M62 22c8-4 16-7 24-8" stroke="#3E8E44" stroke-width="1.5" fill="none"/>';
    if (a.hat) {
      out += '<ellipse cx="60" cy="30" rx="44" ry="9" fill="#E8C57A" stroke="#B98F3E" stroke-width="2"/>' +
        '<path d="M36 30c0-16 10-22 24-22s24 6 24 22Z" fill="#F3D48E" stroke="#B98F3E" stroke-width="2"/>' +
        '<rect x="36" y="23" width="48" height="6" fill="#4FB3E8"/>' + hibiscus(78, 24, 8, '#FF6F91');
    }
    if (a.glasses) {
      out += '<g><rect x="33" y="46" width="22" height="15" rx="7" fill="#2A2230" opacity=".9"/>' +
        '<rect x="65" y="46" width="22" height="15" rx="7" fill="#2A2230" opacity=".9"/>' +
        '<path d="M55 52h10" stroke="#2A2230" stroke-width="3"/>' +
        '<path d="M37 50l6-2M69 50l6-2" stroke="#fff" stroke-width="2" opacity=".7" stroke-linecap="round"/></g>';
    }
    return out;
  }

  /** 動物頭像。mood：'happy'（預設）｜'shock'（收牌時） */
  function animalSvg(id, opt) {
    opt = opt || {};
    const a = ANIMAL_MAP[id] || ANIMALS[0];
    const g = nextId('ah'), s = nextId('as');
    const headShape = a.muzzle === 'capy'
      ? '<rect x="22" y="26" width="76" height="70" rx="32" fill="url(#' + g + ')"/>'
      : '<ellipse cx="60" cy="60" rx="38" ry="35" fill="url(#' + g + ')"/>';
    let face = muzzle(a);
    if (opt.mood === 'shock') {
      face = face.replace(/<path d="M5[34] [^"]*"[^>]*\/>/, '') +
        '<ellipse cx="60" cy="80" rx="5" ry="6.5" fill="#2A2230"/>';
    }
    return '<svg viewBox="0 0 120 120" class="animal ' + (opt.cls || '') + '" role="img" aria-label="' + a.name + '">' +
      '<defs><radialGradient id="' + g + '" cx="0.38" cy="0.32" r="0.8">' +
      '<stop offset="0" stop-color="' + a.light + '" stop-opacity=".55"/><stop offset=".45" stop-color="' + a.base + '"/>' +
      '<stop offset="1" stop-color="' + a.dark + '"/></radialGradient>' +
      '<linearGradient id="' + s + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a.shirt + '"/>' +
      '<stop offset="1" stop-color="' + shade(a.shirt) + '"/></linearGradient></defs>' +
      /* 花襯衫肩膀 */
      '<path d="M14 120c2-22 20-32 46-32s44 10 46 32Z" fill="url(#' + s + ')"/>' +
      '<path d="M50 90l10 14 10-14" fill="#fff" opacity=".85"/>' +
      hibiscus(30, 108, 7, 'rgba(255,255,255,.75)') + hibiscus(92, 110, 6, 'rgba(255,255,255,.75)') +
      ears(a, g) + headShape + extras(a) + face +
      '</svg>';
  }

  function shade(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = c => Math.max(0, Math.round(c * 0.72));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(f).map(c => c.toString(16).padStart(2, '0')).join('');
  }


  /* ---------- 圖示 ---------- */

  function icon(name) {
    const w = inner => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
    switch (name) {
      case 'gear': return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Zm8.4 3.5a8.4 8.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a8.2 8.2 0 0 0-2-1.2L15.6 3h-3.9l-.4 2.6a8.2 8.2 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a8.4 8.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a8.2 8.2 0 0 0 2 1.2l.4 2.6h3.9l.4-2.6a8.2 8.2 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z"/></svg>';
      case 'close': return w('<path d="M6 6l12 12M18 6 6 18"/>');
      case 'back': return w('<path d="M15 5l-7 7 7 7"/>');
      case 'pause': return w('<path d="M9 5v14M15 5v14"/>');
      case 'chat': return w('<path d="M4 5h16v11H9l-5 4z"/>');
      case 'info': return w('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>');
      case 'link': return w('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>');
      case 'send': return w('<path d="M4 12 20 4l-5 16-3-7z"/>');
      case 'robot': return w('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>');
      case 'eye': return w('<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>');
      case 'sound': return w('<path d="M5 9.5h3l4.5-3.5v12L8 14.5H5z"/><path d="M16.5 9a4 4 0 0 1 0 6"/><path d="M19 6.5a7.5 7.5 0 0 1 0 11"/>');
      case 'music': return w('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>');
      case 'voice': return w('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>');
      case 'feel': return w('<path d="M12 4.5v15M7.5 8v8M16.5 8v8M3.5 10.5v3M20.5 10.5v3"/>');
      case 'see': return w('<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>');
      case 'crown': return w('<path d="M4 18h16l1-10-5 4-4-7-4 7-5-4z"/>');
      case 'plus': return w('<path d="M12 5v14M5 12h14"/>');
      case 'minus': return w('<path d="M5 12h14"/>');
      case 'kick': return w('<path d="M6 6l12 12M18 6 6 18"/>');
      case 'play': return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      case 'dice': return w('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01"/>');
      case 'home': return w('<path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>');
      case 'coin': return w('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.5 9.5q2.5-2 5 0M9.5 14.5q2.5 2 5 0"/>');
      case 'check': return w('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
      case 'flag': return w('<path d="M6 21V4M6 5h11l-2.5 4 2.5 4H6"/>');
      case 'cards': return w('<rect x="5" y="4" width="11" height="15" rx="2"/><path d="M19 8v11a2 2 0 0 1-2 2H9"/>');
      default: return '';
    }
  }


  /** 把一段完整的 <svg> 放進另一張 SVG 的指定位置（巢狀 svg 要給 x/y/寬高，不能靠 CSS） */
  function nest(svg, x, y, w, h, rot) {
    const inner = svg.replace(/^<svg([^>]*)>/, (m, attrs) =>
      '<svg' + attrs.replace(/\sclass="[^"]*"/, '') + ' x="0" y="0" width="' + w + '" height="' + h + '">');
    return '<g transform="translate(' + x + ',' + y + ')' + (rot ? ' rotate(' + rot + ' ' + (w / 2) + ' ' + (h / 2) + ')' : '') + '">' + inner + '</g>';
  }


  /* ---------- 40 格的地標小圖（全部手繪向量，24×24；不用 emoji） ---------- */

  const R = (x, y, w, h, fill, rx) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"' + (rx ? ' rx="' + rx + '"' : '') + '/>';
  const C = (x, y, r, fill) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '"/>';
  const Pth = (d, fill, extra) => '<path d="' + d + '" fill="' + fill + '"' + (extra ? ' ' + extra : '') + '/>';
  const St = (d, stroke, w) => '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + (w || 1.6) + '" stroke-linecap="round" stroke-linejoin="round"/>';

  const GLYPHS = {
    island: () => Pth('M2 20Q12 13 22 20Z', '#F2D08A') + St('M12 18V9', '#8B5A2B', 1.8) +
      Pth('M12 9C8 6 5 8 3.5 10.5C7 9 9.5 9.5 12 9ZM12 9C16 6 19 8 20.5 10.5C17 9 14.5 9.5 12 9ZM12 9C10.5 5 12 3.5 14.5 3.5C13.5 5.5 13 7 12 9Z', '#3DAE6B'),
    boat: () => Pth('M2 14H22Q19 20 12 20Q5 20 2 14Z', '#D8483E') + R(2, 13, 20, 2, '#FFF3D6') + St('M12 13V4', '#5A3A14', 1.6) +
      Pth('M12 4L19 12H12Z', '#FFFFFF', 'stroke="#D8483E" stroke-width=".8"') + St('M4 22Q8 20 12 22T20 22', '#5FC7D9', 1.4),
    beach: () => C(17, 7, 3.6, '#FFC93C') + Pth('M2 15Q6 12 9 15T16 15T22 14V22H2Z', '#3AAFD9') + Pth('M2 19Q6 16 9 19T16 19T22 18V22H2Z', '#1E8FC0') +
      St('M6 14L8 6', '#8B5A2B', 1.4) + Pth('M2 7Q8 1 14 7Z', '#F2574A'),
    turtle: () => Pth('M3 15Q3 6 12 6Q20 6 20 15Z', '#5BAE63') + St('M8 15Q9 8 12 6M15 15Q14 8 12 6M5 11H19', '#3B8747', 1) +
      C(21, 12, 2.6, '#8FCB7C') + R(5, 15, 3, 3, '#8FCB7C', 1.2) + R(15, 15, 3, 3, '#8FCB7C', 1.2) + C(21.8, 11.4, .5, '#23392B'),
    fish: () => Pth('M2 12Q8 4 16 12Q8 20 2 12Z', '#4F7FB8') + Pth('M15 12L22 6V18Z', '#3B5F92') + Pth('M8 8L11 4L12 8Z', '#3B5F92') + C(6.5, 11, 1, '#fff'),
    gorge: () => Pth('M2 21V5L9 3L11 21Z', '#A7B0BB') + Pth('M22 21V4L15 7L13 21Z', '#7F8C99') + Pth('M11 21L12 13L13 21Z', '#4FB3E8') + Pth('M2 9H9M15 11H22', '#C5CCD4', 'stroke="#C5CCD4" stroke-width=".8"'),
    balloon: () => Pth('M12 2C6 2 4 8 7 12L10 16H14L17 12C20 8 18 2 12 2Z', '#F2574A') + St('M9 4Q7 9 10 16M15 4Q17 9 14 16', '#FFD447', 1.2) +
      St('M10 16L10.5 19M14 16L13.5 19', '#5A3A14', .9) + R(9.5, 19, 5, 3.5, '#B9824D', 1),
    spring: () => Pth('M2 17Q12 14 22 17V21Q12 24 2 21Z', '#5FC7D9') + St('M8 12Q6 9 8 6Q10 3 8 1M14 12Q12 9 14 6Q16 3 14 1', '#B7C0C8', 1.3) + C(18, 16.5, 1.4, '#fff') + C(6, 17, 1, '#fff'),
    mountain: () => Pth('M1 21L9 5L14 14L17 9L23 21Z', '#6FA86A') + Pth('M9 5L11.2 9.8L9 9L6.8 9.8Z', '#FFFFFF') + C(19, 5, 2.4, '#FFC93C') + Pth('M1 21H23V22H1Z', '#4C7F49'),
    lake: () => C(8, 8, 3.8, '#FFC93C') + Pth('M16 4A5 5 0 1 0 20 12A4 4 0 1 1 16 4Z', '#D9DEE6') + Pth('M1 16Q6 12 11 16T22 15V22H1Z', '#3FA6D3') + St('M4 19Q8 17 12 19T20 19', '#9ADAF0', 1),
    lantern: () => St('M12 1V4', '#5A3A14', 1.2) + R(8, 4, 8, 3, '#F6C34A', 1) + Pth('M7 7H17Q19 13 17 18H7Q5 13 7 7Z', '#E8503F') + R(8, 18, 8, 2.4, '#F6C34A', 1) +
      St('M12 20.4V23', '#F6C34A', 1.2) + St('M9 8Q8 13 9 17M15 8Q16 13 15 17', '#C43B2F', .9),
    fort: () => R(4, 9, 16, 12, '#C4643F') + Pth('M4 9V6H7V8H9V6H12V8H14V6H17V8H20V9Z', '#A94E2C') + Pth('M10 21V15Q12 12 14 15V21Z', '#5A3A14') + R(6, 11, 2, 2, '#5A3A14') + R(16, 11, 2, 2, '#5A3A14'),
    crate: () => R(2, 13, 9, 7, '#E8503F') + R(11, 13, 9, 7, '#3D7FD6') + R(6, 6, 9, 7, '#F2B93A') + St('M4 13V20M6 13V20M13 13V20M15 13V20M8 6V13M10 6V13', 'rgba(0,0,0,.25)', .8),
    pagoda: () => Pth('M12 1L14 5H10Z', '#E8503F') + Pth('M5 8Q12 3 19 8L17 10H7Z', '#E8503F') + R(8, 10, 8, 3, '#F6C34A') + Pth('M3 15Q12 9 21 15L19 17H5Z', '#D8483E') + R(7, 17, 10, 4, '#F6C34A') + R(11, 18, 2, 3, '#7A4E2A'),
    bridge: () => St('M2 15H22', '#7A4E2A', 2) + St('M3 15Q12 2 21 15', '#8B5A2B', 1.6) + St('M6 10V15M9 7.5V15M12 6.5V15M15 7.5V15M18 10V15', '#B9824D', 1) + Pth('M2 22Q12 18 22 22Z', '#5FC7D9'),
    skewer: () => St('M4 20L20 4', '#8B5A2B', 1.4) + C(8, 16, 2.6, '#C4643F') + C(12, 12, 2.6, '#E8503F') + C(16, 8, 2.6, '#F2B93A') + C(7.4, 15.4, .7, '#fff') + C(11.4, 11.4, .7, '#fff'),
    drop: () => Pth('M12 2C8 8 5 11 5 15A7 7 0 0 0 19 15C19 11 16 8 12 2Z', '#4FB3E8') + Pth('M9 14A3.5 3.5 0 0 0 12 18.5', 'none', 'stroke="#fff" stroke-width="1.4" stroke-linecap="round"'),
    bolt: () => Pth('M13 1L4 13H10L8 23L20 9H13Z', '#FFC93C', 'stroke="#D99A00" stroke-width="1" stroke-linejoin="round"'),
    opera: () => Pth('M2 21Q2 8 12 7Q22 8 22 21Z', '#ECEFF3') + St('M6 21Q6 11 12 10M12 10Q18 11 18 21M9 21Q9 14 12 13M12 13Q15 14 15 21', '#B7C0CC', 1) + R(1, 20.5, 22, 2, '#8896A8'),
    noodle: () => Pth('M3 12H21Q20 20 12 20Q4 20 3 12Z', '#FFF3D6', 'stroke="#D8483E" stroke-width="1.6"') + St('M7 12Q9 8 11 12T15 12', '#F2B93A', 1.4) + St('M9 6Q7 4 9 2M14 7Q12 5 14 3', '#B7C0C8', 1.2) + St('M16 5L21 11', '#8B5A2B', 1.2),
    lanterns: () => St('M1 5Q12 9 23 5', '#5A3A14', 1) + Pth('M2 6Q4 6 4 10Q4 14 2 14Q0 14 0 10Q0 6 2 6Z', '#E8503F', 'transform="translate(1,0)"') +
      Pth('M2 6Q4 6 4 10Q4 14 2 14Q0 14 0 10Q0 6 2 6Z', '#E8503F', 'transform="translate(10,2)"') + Pth('M2 6Q4 6 4 10Q4 14 2 14Q0 14 0 10Q0 6 2 6Z', '#E8503F', 'transform="translate(19,0)"') +
      R(11, 15, 2, 2, '#F6C34A') + R(2, 13.5, 2, 2, '#F6C34A') + R(20, 13.5, 2, 2, '#F6C34A'),
    sail: () => C(18, 6, 3.2, '#FFA53D') + Pth('M11 3L11 15H4Z', '#FFFFFF', 'stroke="#B7C0CC" stroke-width=".6"') + Pth('M12 6L12 15H18Z', '#F2574A') + Pth('M3 16H19L17 20H5Z', '#7A4E2A') + Pth('M1 22Q6 20 11 22T22 21', 'none', 'stroke="#3AAFD9" stroke-width="1.4"'),
    towers: () => R(2, 9, 5, 12, '#5E7FD1') + R(8.5, 4, 6, 17, '#3D5FC4') + R(16, 11, 6, 10, '#7A96DF') + R(3.4, 11, 1.4, 1.4, '#fff') + R(3.4, 15, 1.4, 1.4, '#fff') + R(10, 7, 1.4, 1.4, '#fff') + R(12.6, 7, 1.4, 1.4, '#fff') + R(10, 12, 1.4, 1.4, '#fff') + R(12.6, 12, 1.4, 1.4, '#fff') + R(17.6, 14, 1.4, 1.4, '#fff'),
    tower101: () => St('M12 1V4', '#3B4A66', 1.4) + Pth('M10.5 4H13.5L14 6H10Z', '#38B08A') + Pth('M10 6H14L15 9H9Z', '#38B08A') + Pth('M9 9H15L16 12H8Z', '#2F9A78') + Pth('M8 12H16L17 15H7Z', '#38B08A') + Pth('M7 15H17L18 18H6Z', '#2F9A78') + Pth('M6 18H18L19.5 22H4.5Z', '#38B08A') + R(3, 22, 18, 1.4, '#3B4A66'),
    shop: () => R(4, 10, 16, 11, '#FFF3D6', 2) + Pth('M3 10L5 4H19L21 10Z', '#EF5B5B') + Pth('M3 10H7.4V11.4Q5.2 13 3 11.4Z M7.4 10H11.8V11.4Q9.6 13 7.4 11.4Z M11.8 10H16.2V11.4Q14 13 11.8 11.4Z M16.2 10H21V11.4Q18.6 13 16.2 11.4Z', '#FFFFFF') + R(9.5, 14, 5, 7, '#7B5A3A', 1) + C(13, 17.6, 0.5, '#FFC93C') + R(5.5, 14, 3, 3, '#7FC8F0', 0.6) + R(15.5, 14, 3, 3, '#7FC8F0', 0.6),
    plane: () => Pth('M12 2Q13.6 2 13.6 4V9L21 13.4V15.6L13.6 13.6V18.4L16 20V21.6L12 20.6L8 21.6V20L10.4 18.4V13.6L3 15.6V13.4L10.4 9V4Q10.4 2 12 2Z', '#F2F5F9', 'stroke="#5A6577" stroke-width="1" stroke-linejoin="round"') + R(11.2, 4, 1.6, 3, '#2E7BD6', 0.8),
    train: () => R(4, 3, 16, 15, '#F2F5F9', 4) + R(4, 3, 16, 5, '#2E7BD6', 4) + R(6, 9, 5, 4, '#7FC8F0', 1) + R(13, 9, 5, 4, '#7FC8F0', 1) + C(8, 15.5, 1.2, '#FFC93C') + C(16, 15.5, 1.2, '#FFC93C') + St('M6 21L8 18M18 21L16 18M3 21H21', '#5A6577', 1.4),
    coin: () => C(12, 12, 9, '#FFC93C') + C(12, 12, 6.5, 'none') + St('M12 7V17M9 9.5Q12 7 15 9.5M9 14.5Q12 17 15 14.5', '#B97A00', 1.4),
    gem: () => Pth('M6 3H18L22 9L12 22L2 9Z', '#7AD7F0', 'stroke="#2F8FB5" stroke-width="1" stroke-linejoin="round"') + St('M2 9H22M8 9L12 22L16 9M8 3L6 9M16 3L18 9M12 3V9', '#2F8FB5', .8),
    go: () => Pth('M3 12H16M11 6L18 12L11 18', 'none', 'stroke="#D8483E" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"'),
    jail: () => R(3, 4, 18, 16, '#8896A8', 2) + St('M7 5V19M12 5V19M17 5V19', '#EEF1F5', 2.2),
    park: () => Pth('M2 18Q12 14 22 18V21Q12 24 2 21Z', '#5FC7D9') + St('M8 12Q6 9 8 6Q10 3 8 1M14 12Q12 9 14 6Q16 3 14 1M20 12Q18 9 20 6', '#B7C0C8', 1.3) + C(6, 18, 1, '#fff'),
    gotojail: () => Pth('M3 12L21 12', 'none', 'stroke="none"') + R(5, 3, 14, 10, '#3D5FC4', 2) + R(3, 12, 18, 3, '#2F4A9E', 1.5) + C(12, 8, 2.4, '#FFC93C') + C(12, 19, 3.2, '#EF5B5B') + St('M8 19H16', '#fff', 1.2),
    chance: () => C(12, 12, 10, '#F2A93B') + Pth('M8.5 9.5Q8.5 5.5 12 5.5T15.5 9Q15.5 11 12.8 12.5Q12 13 12 14.5', 'none', 'stroke="#fff" stroke-width="2.4" stroke-linecap="round"') + C(12, 18, 1.5, '#fff'),
    chest: () => Pth('M3 10Q3 4 12 4T21 10Z', '#C4803E') + R(3, 10, 18, 10, '#A8652A', 1) + R(10, 9, 4, 5, '#FFC93C', 1) + St('M3 10H21', '#7A4E2A', 1.2),
    /* 道具 */
    i_dice: () => R(3, 3, 18, 18, '#FFFFFF', 4) + St('M3.6 7Q3.6 3.6 7 3.6H17Q20.4 3.6 20.4 7V17Q20.4 20.4 17 20.4H7Q3.6 20.4 3.6 17Z', '#8896A8', 1) + C(8, 8, 1.7, '#E8503F') + C(16, 16, 1.7, '#E8503F') + C(16, 8, 1.7, '#E8503F') + C(8, 16, 1.7, '#E8503F') + C(12, 12, 1.7, '#E8503F') + Pth('M19 1L21 4H17Z', '#FFC93C'),
    i_free: () => C(12, 12, 9, '#FFC93C') + St('M12 7V17M9 9.5Q12 7 15 9.5M9 14.5Q12 17 15 14.5', '#B97A00', 1.3) + St('M3.5 20.5L20.5 3.5', '#E8503F', 2.4),
    i_shield: () => Pth('M12 2L20 5V12Q20 19 12 22Q4 19 4 12V5Z', '#5E7FD1', 'stroke="#2F4A9E" stroke-width="1.2" stroke-linejoin="round"') + Pth('M12 4.5L17.5 6.6V12Q17.5 17 12 19.6Z', '#7A96DF') + St('M8.5 12L11 14.5L16 8.5', '#FFFFFF', 2),
    i_cat: () => Pth('M4 4L9 8H15L20 4V13Q20 20 12 20Q4 20 4 13Z', '#FFF3D6', 'stroke="#D99A00" stroke-width="1.2" stroke-linejoin="round"') + C(9, 12, 1.2, '#23392B') + C(15, 12, 1.2, '#23392B') + Pth('M11 14.5H13L12 15.6Z', '#E8503F') + St('M6 15L3 14.5M6 16.6L3 17.6M18 15L21 14.5M18 16.6L21 17.6', '#8B5A2B', .8) + R(10, 18.6, 4, 3, '#FFC93C', 1),
    i_steal: () => Pth('M6 9Q6 6 12 6T18 9V19Q18 22 12 22T6 19Z', '#7B5A3A', 'stroke="#4A3320" stroke-width="1.2" stroke-linejoin="round"') + Pth('M9 6L12 2L15 6Z', '#A67C52') + St('M12 10V19M14.6 12Q12 10 9.6 12T12 15T14.6 17.6T9.4 17.6', '#FFC93C', 1.3) + C(19, 6, 3, '#EF5B5B') + St('M17.7 6H20.3', '#fff', 1.4),
    i_swap: () => C(12, 12, 10, '#7A6BE0') + St('M6 9H17M14 6L17 9L14 12', '#FFFFFF', 1.9) + St('M18 15H7M10 12L7 15L10 18', '#FFE08A', 1.9),
    i_bomb: () => C(11, 14, 7.5, '#3A3F4B') + C(8.6, 11.6, 2, '#6B7280') + R(9, 4.6, 5, 3.4, '#8896A8', 1) + St('M13 5Q17 2 20 4', '#8B5A2B', 1.6) + C(20.4, 4, 1.6, '#FFC93C') + C(20.4, 4, .7, '#EF5B5B'),
    i_guard: () => Pth('M12 2Q19 4 19 12Q19 20 12 22Q5 20 5 12Q5 4 12 2Z', '#E8503F', 'stroke="#A82F22" stroke-width="1.2" stroke-linejoin="round"') + St('M12 6V18M8 12H16', '#FFD86B', 1.6) + C(12, 12, 2.4, '#FFD86B') + St('M12 1V-2', '#A82F22', 1),
    i_gobonus: () => Pth('M4 12L12 4L20 12L12 20Z', '#4DBF7A', 'stroke="#2E8A52" stroke-width="1.2" stroke-linejoin="round"') + St('M12 8V16M8 12H16', '#FFFFFF', 2) + C(19, 5, 3.4, '#FFC93C') + St('M17.6 5H20.4M19 3.6V6.4', '#B97A00', 1),
    i_bail: () => R(5, 3, 14, 18, '#FFFDF2', 2) + St('M8 8H16M8 11H16', '#B7A67A', 1.1) + St('M8 15L11 18L16 13', '#4DBF7A', 2) + St('M19 3V9M16.5 3V9', '#6B7280', 1.2),
    i_coupon: () => R(2, 6, 20, 12, '#FF8A5B', 2.5) + C(2, 12, 2.2, '#FFFFFF') + C(22, 12, 2.2, '#FFFFFF') + St('M15 7V17', '#FFFFFF', 1, ) + Pth('M7 15L11 9', 'none', 'stroke="#fff" stroke-width="1.6" stroke-linecap="round"') + C(7, 9.5, 1.1, '#fff') + C(11, 14.5, 1.1, '#fff'),
    i_again: () => R(2, 9, 11, 11, '#FFFFFF', 3) + C(5.5, 12.5, 1.1, '#E8503F') + C(9.5, 16.5, 1.1, '#E8503F') + R(11, 3, 11, 11, '#FFD86B', 3) + C(14.5, 6.5, 1.1, '#B97A00') + C(18.5, 10.5, 1.1, '#B97A00') + C(16.5, 8.5, 1.1, '#B97A00'),
    i_reflect: () => C(12, 12, 10, '#5FC7D9') + St('M17 8H8M11 5L8 8L11 11', '#FFFFFF', 2) + St('M7 16H16M13 13L16 16L13 19', '#FFFFFF', 2),
    i_surge: () => R(3, 3, 18, 18, '#FFE9A8', 3) + St('M6 17L10 12L13 14L18 7', '#E8503F', 2) + St('M14 7H18V11', '#E8503F', 2),
    i_seize: () => St('M7 3V21', '#7A4E2A', 2) + Pth('M7 4H19L16 8L19 12H7Z', '#EF5B5B', 'stroke="#A82F22" stroke-width="1" stroke-linejoin="round"') + C(7, 21, 1.6, '#7A4E2A'),
    i_grab: () => C(12, 12, 10, '#7A6BE0') + St('M8 16V9M12 16V7M16 16V9', '#FFFFFF', 2.2) + Pth('M6 15Q12 22 18 15', 'none', 'stroke="#fff" stroke-width="2" stroke-linecap="round"'),
    i_frame: () => R(3, 4, 18, 16, '#8896A8', 2) + St('M7 5V19M12 5V19M17 5V19', '#EEF1F5', 2.2) + C(18, 6, 4.2, '#E8503F') + St('M18 4V7', '#FFFFFF', 1.6) + C(18, 8.7, .8, '#FFFFFF'),
    i_collect: () => C(9, 15, 6, '#FFC93C') + C(15, 10, 6, '#FFB000') + St('M12 2V7M10 5L12 7L14 5', '#4DBF7A', 1.6),
    i_equal: () => St('M12 3V20M6 20H18', '#7A4E2A', 2) + St('M4 7H20', '#7A4E2A', 2) + Pth('M4 7L1.5 14H6.5Z', '#FFC93C') + Pth('M20 7L17.5 14H22.5Z', '#FFC93C'),
    i_upgrade: () => Pth('M3 12L12 4L21 12', 'none', 'stroke="#C4803E" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"') + R(6, 11, 12, 10, '#FFC93C', 1.5) + R(10, 15, 4, 6, '#A8652A', 1) + C(19, 5, 3.4, '#4DBF7A') + St('M19 3.4V6.6M17.4 5H20.6', '#FFFFFF', 1.2),
    i_freeze: () => C(12, 12, 10, '#BFE6F5') + St('M12 3V21M4.2 7.5L19.8 16.5M4.2 16.5L19.8 7.5', '#4F9BE8', 1.6) + C(12, 12, 2.2, '#FFFFFF'),
    i_chest: () => R(4, 9, 16, 12, '#E8A04A', 2) + Pth('M4 11Q4 4 12 4T20 11Z', '#F2B865', 'stroke="#B97A2A" stroke-width="1"') + R(10.5, 10, 3, 5, '#FFD86B', 1) + St('M4 15H20', '#B97A2A', 1),
    i_cure: () => C(12, 12, 10, '#FFFDF2') + St('M7 7L17 17M17 7L7 17', '#EF5B5B', 2.2) + C(12, 12, 4, 'none') + St('M12 4V6M12 18V20', '#B7A67A', 1.4),
    i_god: () => C(12, 12, 10, '#FFC93C') + St('M12 5L13.6 10.4L19 12L13.6 13.6L12 19L10.4 13.6L5 12L10.4 10.4Z', '#FFFFFF', 1.4) + C(12, 12, 1.6, '#F2A93B'),
    i_salary: () => R(3, 7, 18, 11, '#4DBF7A', 2.5) + C(12, 12.5, 3.6, '#FFE08A') + St('M12 10.6V14.4M10.6 11.8Q12 10.6 13.4 11.8', '#B97A00', 1.1) + C(6, 12.5, 1.1, '#FFFFFF') + C(18, 12.5, 1.1, '#FFFFFF'),
    god_fortune: () => Pth('M3 14Q3 9 12 9T21 14Q21 19 12 19T3 14Z', '#FFC93C', 'stroke="#C98F00" stroke-width="1.2"') + Pth('M6 12Q12 4 18 12', '#FFE27A') + St('M8 15Q12 17 16 15', '#B97A00', 1.1) + C(12, 6, 3, '#F2A93B'),
    god_wealth: () => Pth('M7 8Q4 20 12 21T17 8Z', '#5FBF7E', 'stroke="#2E8A52" stroke-width="1.2" stroke-linejoin="round"') + Pth('M8 8L9 4H15L16 8Z', '#8ED9A6') + St('M12 11V18M14.3 12.8Q12 11 9.9 12.8T12 15T14.3 17.2T9.7 17.2', '#FFF3B0', 1.2),
    god_poor: () => Pth('M6 9Q6 6 12 6T18 9V18Q18 21 12 21T6 18Z', '#9AA3AF', 'stroke="#5F6875" stroke-width="1.2" stroke-linejoin="round"') + St('M9 13L15 17M15 13L9 17', '#F5F7FA', 1.5) + R(9.5, 3, 5, 4, '#7A828E', 1),
    god_unlucky: () => Pth('M6 15Q2 15 3 11T8 8Q9 4 14 5T19 9Q23 10 21 14T17 16Z', '#6B7280', 'stroke="#3F4652" stroke-width="1.2" stroke-linejoin="round"') + St('M9 18L8 21M13 18L12 22M17 18L16 21', '#FFD86B', 1.6) + C(10, 11, 1, '#fff') + C(15, 11, 1, '#fff') + St('M10 14Q12.5 12.6 15 14', '#fff', 1)
  };

  /** 地標圖：inner 內容包成獨立 <svg>，放進格子或畫面任何地方 */
  function glyph(name, cls) {
    const fn = GLYPHS[name];
    return '<svg viewBox="0 0 24 24" class="glyph ' + (cls || '') + '" aria-hidden="true" focusable="false">' + (fn ? fn() : '') + '</svg>';
  }

  /* ---------- 骰子、房子、旅店 ---------- */

  const PIPS = { 1: [[12, 12]], 2: [[7, 7], [17, 17]], 3: [[7, 7], [12, 12], [17, 17]], 4: [[7, 7], [17, 7], [7, 17], [17, 17]],
    5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]], 6: [[7, 6.5], [17, 6.5], [7, 12], [17, 12], [7, 17.5], [17, 17.5]] };

  /** 骰子點數 1～6；0＝還沒擲（顯示問號） */
  function dieSvg(n, cls) {
    const pips = (PIPS[n] || []).map(p => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.3" fill="' + (n === 1 ? '#E0483E' : '#2B2A3A') + '"/>').join('');
    return '<svg viewBox="0 0 24 24" class="die ' + (cls || '') + '" role="img" aria-label="骰子 ' + (n || '未擲') + '">' +
      '<rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#FFFDF7" stroke="#B9824D" stroke-width="1.6"/>' +
      '<rect x="3" y="3" width="18" height="6" rx="3" fill="#fff" opacity=".7"/>' +
      (n ? pips : '<text x="12" y="16.5" text-anchor="middle" font-size="12" font-weight="900" fill="#B9824D">?</text>') + '</svg>';
  }

  function houseSvg() {
    return '<svg viewBox="0 0 24 24" class="house-ico" aria-hidden="true">' + Pth('M2 12L12 3L22 12H19V21H5V12Z', '#3DAE6B', 'stroke="#23703F" stroke-width="1.4" stroke-linejoin="round"') + R(10, 14, 4, 7, '#FFF3D6') + '</svg>';
  }
  function hotelSvg() {
    return '<svg viewBox="0 0 24 24" class="hotel-ico" aria-hidden="true">' + R(3, 5, 18, 16, '#E8503F', 2) + R(3, 3, 18, 3, '#B7352B', 1) + R(6, 9, 3, 3, '#FFF3D6') + R(10.5, 9, 3, 3, '#FFF3D6') + R(15, 9, 3, 3, '#FFF3D6') + R(6, 14, 3, 3, '#FFF3D6') + R(15, 14, 3, 3, '#FFF3D6') + R(10.5, 15, 3, 6, '#7A4E2A') + '</svg>';
  }

  /** 首頁主視覺：一塊大富翁棋盤（色塊格子＋台北101），三隻動物與一對骰子 */
  function heroSvg() {
    const cols = ['#9A6B45', '#7FD3F2', '#F58FBE', '#FFA64D', '#EA5A55', '#F6D24A', '#4DBF7A', '#3D5FC4'];
    let tiles = '';
    for (let i = 0; i < 9; i++) {
      const c = cols[i % 8];
      tiles += '<rect x="' + (44 + i * 30) + '" y="30" width="28" height="22" rx="3" fill="' + c + '"/>';
      tiles += '<rect x="' + (44 + i * 30) + '" y="150" width="28" height="22" rx="3" fill="' + cols[(i + 3) % 8] + '"/>';
    }
    for (let i = 0; i < 3; i++) {
      tiles += '<rect x="14" y="' + (58 + i * 30) + '" width="28" height="26" rx="3" fill="' + cols[(i + 5) % 8] + '"/>';
      tiles += '<rect x="318" y="' + (58 + i * 30) + '" width="28" height="26" rx="3" fill="' + cols[(i + 1) % 8] + '"/>';
    }
    return '<svg viewBox="0 0 360 220" class="hero-svg" aria-label="寶島大富翁：棋盤、台北101、骰子與三隻小動物">' +
      '<rect x="8" y="22" width="344" height="158" rx="18" fill="#FFF3D6" stroke="#B9824D" stroke-width="8"/>' + tiles +
      '<rect x="50" y="60" width="260" height="84" rx="10" fill="#D8F1E0"/>' +
      nest(glyph('tower101'), 158, 62, 44, 80) + nest(glyph('lake'), 78, 74, 46, 46) + nest(glyph('mountain'), 236, 74, 46, 46) +
      nest(animalSvg('otter'), 20, 112, 90, 90) + nest(animalSvg('bunny'), 268, 112, 90, 90) + nest(animalSvg('penguin'), 138, 118, 84, 84) +
      nest(dieSvg(5), 112, 158, 36, 36, -12) + nest(dieSvg(3), 214, 160, 34, 34, 14) + '</svg>';
  }

  root.Art = {
    ANIMALS, ANIMAL_MAP, GLYPHS,
    glyph, dieSvg, houseSvg, hotelSvg, nest, animalSvg, icon, heroSvg, hibiscus
  };
})(typeof self !== 'undefined' ? self : this);
