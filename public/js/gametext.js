/* ===== gametext.js — 遊戲文字翻譯層（規則／伺服器的中文句子 ↔ 目前語言） =====
 *
 * rules.js、lib/rooms.js、server.js 仍然輸出原本的繁體中文句子（線上協定與規則測試完全不變）；
 * 這裡把那些句子用 msgs.js 的樣板「反查」出代碼與參數，再用 I18N 目前語言重新組句。
 * 因為對局紀錄、聊天室系統訊息存的是原句，切換語言時直接重新翻譯就好（不用另外存代碼）。
 *
 * 載入順序：i18n.js → msgs.js → locales.js → gametext.js → 其他。
 * 資料型文字（地名、道具、神明、難度、角色）的對照表來自 locales.js 與 msgs.js 的 PLACES。
 */
(function (root) {
  'use strict';
  var I18N = root.I18N, Msgs = root.Msgs, L = root.LOCALES || {};
  var ZH = L['zh-Hant'] || {};
  var PLACES = Msgs.PLACES, TABLE = Msgs.TABLE;

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var PAT = { n: '(-?[\\d.,]+)', m: '(-?[\\d.,]+)', k: '(-?[\\d.,]+)', a: '(-?[\\d.,]+)', b: '(-?[\\d.,]+)', t: '(-?[\\d.,]+)',
    list: '(.+)', card: '(.+)', gd: '(.+?)', god: '(.+?)', item: '(.+?)', tile: '(.+?)' };

  /* 樣板編譯：{s} 之類換成擷取群組；字面字數越多越先比對（比較具體的句型優先） */
  var RULES = Object.keys(TABLE).map(function (key) {
    var zh = TABLE[key][0], names = [], re = '^';
    zh.split(/(\{\w+\})/).forEach(function (part) {
      var m = /^\{(\w+)\}$/.exec(part);
      if (m) { names.push(m[1]); re += PAT[m[1]] || '(.+?)'; } else re += esc(part);
    });
    return { key: key, re: new RegExp(re + '$'), names: names, lit: zh.replace(/\{\w+\}/g, '').length };
  }).sort(function (x, y) { return y.lit - x.lit || x.names.length - y.names.length; });
  var CARD_RULES = RULES.filter(function (r) { return r.key.indexOf('c.') === 0; });

  /* 反查表：中文名稱 → 代碼（取自 zh 字典） */
  function reverse(prefix, suffix) {
    var out = {};
    Object.keys(ZH).forEach(function (k) {
      if (k.indexOf(prefix) === 0 && k.slice(-suffix.length) === suffix) out[ZH[k]] = k.slice(prefix.length, k.length - suffix.length);
    });
    return out;
  }
  var ITEM_BY_ZH = reverse('item.', '.name'), GOD_BY_ZH = reverse('god.', '.name'), GODDESC_BY_ZH = reverse('god.', '.desc'), ANIMAL_BY_ZH = reverse('animal.', '');
  var cache = {};

  function lang() { return I18N.lang; }
  function isZh() { return I18N.lang === 'zh-Hant'; }
  function isHans() { return I18N.lang === 'zh-Hans'; }
  function t(key, params) { return I18N.t(key, params); }

  function parse(text, rules) {
    var list = rules || RULES;
    for (var i = 0; i < list.length; i++) {
      var m = list[i].re.exec(text);
      if (!m) continue;
      var params = {};
      list[i].names.forEach(function (nm, k) { params[nm] = m[k + 1]; });
      return { key: list[i].key, params: params };
    }
    return null;
  }

  /* ---------- 資料型名稱 ---------- */
  var PREFIX = { '新': 'New ', '小': 'Mini ', '大': 'Grand ' };
  /** 地名、格子名、色組名、主題名（地圖每局隨機生成，名字來自 maps.js） */
  function place(name) {
    if (isZh() || !name) return name;
    if (isHans() && Msgs.PLACES_HANS) {
      if (Msgs.PLACES_HANS[name]) return Msgs.PLACES_HANS[name];
      var hansPrefix = /^([新小大])(.+)$/.exec(name);
      if (hansPrefix && Msgs.PLACES_HANS[hansPrefix[2]]) return hansPrefix[1] + Msgs.PLACES_HANS[hansPrefix[2]];
      return name;
    }
    if (PLACES[name]) return PLACES[name];
    var m = /^([新小大])(.+)$/.exec(name);
    if (m && PLACES[m[2]]) return PREFIX[m[1]] + PLACES[m[2]];
    return name;
  }
  function item(id) { return t('item.' + id + '.name'); }
  function itemDesc(id) { return t('item.' + id + '.desc'); }
  /** 商店用的效果說明：拿掉前面的「擲骰前使用：」 */
  function itemEff(id) { var p = t('item.use'); var d = itemDesc(id); return d.indexOf(p) === 0 ? d.slice(p.length) : d; }
  function god(k) { return t('god.' + k + '.name'); }
  function godDesc(k) { return t('god.' + k + '.desc'); }
  function diff(k) { return t('diff.' + k); }
  function animal(id) { return t('animal.' + id); }
  /** 電腦的名字：單機是動物名（水獺）、線上是「電腦水獺」；暱稱與聊天不翻 */
  function botName(name) {
    if (isZh() || !name) return name;
    if (ANIMAL_BY_ZH[name]) return animal(ANIMAL_BY_ZH[name]);
    var m = /^電腦(.+)$/.exec(name);
    if (m && ANIMAL_BY_ZH[m[1]]) return t('bot.name', { s: animal(ANIMAL_BY_ZH[m[1]]) });
    return name;
  }
  function pname(name, ai) { return ai && ai.indexOf(name) >= 0 ? botName(name) : name; }
  /** 房間名稱：預設是「某某的牌桌」，用句型翻；自訂名稱照原樣 */
  function roomName(name) { return isZh() ? name : tr(name); }

  /** 把規則／伺服器輸出的任何中文句子翻成目前語言（認不得的原樣回傳）。ai：電腦名字清單 */
  function tr(text, ai) {
    if (typeof text !== 'string' || !text || isZh()) return text == null ? '' : text;
    var key = lang() + '|' + text + '|' + (ai ? ai.join(',') : '');
    if (cache[key] !== undefined) return cache[key];
    var hit = parse(text), out = text;
    if (hit) {
      var p = hit.params, q = {};
      Object.keys(p).forEach(function (nm) {
        var v = p[nm];
        if (nm === 'tile') q[nm] = place(v);
        else if (nm === 'item') q[nm] = ITEM_BY_ZH[v] ? item(ITEM_BY_ZH[v]) : v;
        else if (nm === 'god') q[nm] = GOD_BY_ZH[v] ? god(GOD_BY_ZH[v]) : v;
        else if (nm === 'gd') q[nm] = GODDESC_BY_ZH[v] ? godDesc(GODDESC_BY_ZH[v]) : v;
        else if (nm === 'card') { var c = parse(v, CARD_RULES); q[nm] = c ? cardText(c, ai) : v; }
        else if (nm === 'list') q[nm] = v.split('、').map(function (x) { return pname(x, ai); }).join(', ');
        else if (nm === 's' || nm === 'o') q[nm] = pname(v, ai);
        else q[nm] = v;
      });
      out = t('msg.' + hit.key, q);
    }
    if (Object.keys(cache).length > 4000) cache = {};
    cache[key] = out;
    return out;
  }
  function cardText(hit, ai) {
    var q = {};
    Object.keys(hit.params).forEach(function (nm) { q[nm] = nm === 'tile' ? place(hit.params[nm]) : hit.params[nm]; });
    return t('msg.' + hit.key, q);
  }

  /** 地圖主題標題（棋盤中央的兩行字）：theme 物件 → [第一行, 第二行] */
  function themeTitle(theme) {
    var th = root.Maps && root.Maps.THEMES, key = null;
    if (th) Object.keys(th).forEach(function (k) { if (th[k] === theme) key = k; });
    if (!key || isZh()) return theme.title;
    return [t('theme.' + key + '.0'), t('theme.' + key + '.1')];
  }
  /** 例如「52 元」：金額加單位 */
  function cash(n) { return t('u.cash', { n: n }); }

  I18N.onChange(function () { cache = {}; });

  root.GT = { parse: parse, tr: tr, place: place, item: item, itemDesc: itemDesc, itemEff: itemEff, god: god, godDesc: godDesc,
    diff: diff, animal: animal, botName: botName, pname: pname, roomName: roomName, themeTitle: themeTitle, cash: cash,
    ITEM_BY_ZH: ITEM_BY_ZH, RULES: RULES };
})(typeof window !== 'undefined' ? window : this);
