/* ===== maps.js — 地圖資料（瀏覽器與伺服器共用） =====
 *
 * 每張地圖都是一圈「四角＋四邊」的方形棋盤：格數 N 一定是 4 的倍數，
 *   0＝起點、N/4＝監獄、N/2＝休息站、N*3/4＝去坐牢，其餘是地產、車站、公司、稅金、機會／命運、道具商店。
 * 規則（rules.js）只認格子的 type，不認地圖，所以新增地圖只要在這裡加資料。
 * 這裡只放「資料」：地價會在開局時由 rules.js 依 ±30% 隨機浮動。
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Maps = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 房價依地價分級；租金＝基本租金的 1／5／15／45／65／90 倍 */
  function houseCost(price) { return price <= 130 ? 50 : price <= 210 ? 100 : price <= 290 ? 150 : price <= 380 ? 200 : 250; }
  const RENT_UP = 1.5;   /* 過路費整體調高倍數（原本地價約 6.3%，現在約 9.4%） */
  function rentLadder(price) {
    const r0 = Math.max(3, Math.round(price / 16 * RENT_UP));
    return [r0, r0 * 5, r0 * 15, r0 * 45, r0 * 65, r0 * 90];
  }
  const P = (name, group, price, glyph) => ({ type: 'prop', name, group, price, house: houseCost(price), rent: rentLadder(price), glyph });
  const ST = (name, price) => ({ type: 'station', name, price: price || 200, glyph: name.indexOf('機場') >= 0 ? 'plane' : 'train' });
  const UT = (name, glyph, price) => ({ type: 'utility', name, price: price || 150, glyph });
  const TAX = (name, tax, glyph) => ({ type: 'tax', name, tax, glyph: glyph || 'coin' });
  const CHANCE_T = { type: 'chance', name: '機會' }, CHEST_T = { type: 'chest', name: '命運' };
  const SHOP = { type: 'shop', name: '道具商店', glyph: 'shop' };
  const corner = (go, jail, park, gotojail, n) => ({ 0: { type: 'go', name: go }, [n / 4]: { type: 'jail', name: jail }, [n / 2]: { type: 'park', name: park }, [n * 3 / 4]: { type: 'gotojail', name: gotojail } });

  /** 依「格子 → 內容」的稀疏表排出整圈；缺的格子就是 bug，直接丟錯（測試會抓到） */
  function ring(n, cells) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      if (!c) throw new Error('地圖第 ' + i + ' 格沒有內容');
      out.push(Object.assign({}, c, c.rent ? { rent: c.rent.slice() } : {}, { i }));
    }
    return out;
  }
  function fill(n, corners, list) {
    const cells = Object.assign({}, corners);
    let k = 0;
    for (let i = 0; i < n; i++) if (!cells[i]) cells[i] = list[k++];
    if (k !== list.length) throw new Error('地圖格數不合：多了 ' + (list.length - k) + ' 個內容');
    return ring(n, cells);
  }

  /* ---------- 1. 台灣一圈（40 格，原本的地圖，沒有道具商店） ---------- */
  const TAIWAN_GROUPS = {
    brown:  { name: '離島', color: '#9A6B45' }, sky: { name: '南灣', color: '#7FD3F2' }, pink: { name: '東岸', color: '#F58FBE' },
    orange: { name: '山城', color: '#FFA64D' }, red: { name: '古都', color: '#EA5A55' }, yellow: { name: '中台', color: '#F6D24A' },
    green:  { name: '北海岸', color: '#4DBF7A' }, navy: { name: '台北', color: '#3D5FC4' }
  };
  const taiwan40 = [
    { type: 'go', name: '起點' },
    { type: 'prop', name: '綠島', group: 'brown', price: 60, house: 50, rent: [2, 10, 30, 90, 160, 250], glyph: 'island' },
    CHEST_T,
    { type: 'prop', name: '蘭嶼', group: 'brown', price: 60, house: 50, rent: [4, 20, 60, 180, 320, 450], glyph: 'boat' },
    TAX('所得稅', 200),
    ST('台北車站'),
    { type: 'prop', name: '墾丁', group: 'sky', price: 100, house: 50, rent: [6, 30, 90, 270, 400, 550], glyph: 'beach' },
    CHANCE_T,
    { type: 'prop', name: '小琉球', group: 'sky', price: 100, house: 50, rent: [6, 30, 90, 270, 400, 550], glyph: 'turtle' },
    { type: 'prop', name: '東港', group: 'sky', price: 120, house: 50, rent: [8, 40, 100, 300, 450, 600], glyph: 'fish' },
    { type: 'jail', name: '監獄' },
    { type: 'prop', name: '太魯閣', group: 'pink', price: 140, house: 100, rent: [10, 50, 150, 450, 625, 750], glyph: 'gorge' },
    UT('電力公司', 'bolt'),
    { type: 'prop', name: '鹿野高台', group: 'pink', price: 140, house: 100, rent: [10, 50, 150, 450, 625, 750], glyph: 'balloon' },
    { type: 'prop', name: '礁溪溫泉', group: 'pink', price: 160, house: 100, rent: [12, 60, 180, 500, 700, 900], glyph: 'spring' },
    ST('台中車站'),
    { type: 'prop', name: '阿里山', group: 'orange', price: 180, house: 100, rent: [14, 70, 200, 550, 750, 950], glyph: 'mountain' },
    CHEST_T,
    { type: 'prop', name: '日月潭', group: 'orange', price: 180, house: 100, rent: [14, 70, 200, 550, 750, 950], glyph: 'lake' },
    { type: 'prop', name: '鹿港老街', group: 'orange', price: 200, house: 100, rent: [16, 80, 220, 600, 800, 1000], glyph: 'lantern' },
    { type: 'park', name: '溫泉休息站' },
    { type: 'prop', name: '安平古堡', group: 'red', price: 220, house: 150, rent: [18, 90, 250, 700, 875, 1050], glyph: 'fort' },
    CHANCE_T,
    { type: 'prop', name: '駁二特區', group: 'red', price: 220, house: 150, rent: [18, 90, 250, 700, 875, 1050], glyph: 'crate' },
    { type: 'prop', name: '蓮池潭', group: 'red', price: 240, house: 150, rent: [20, 100, 300, 750, 925, 1100], glyph: 'pagoda' },
    ST('高雄車站'),
    { type: 'prop', name: '內灣', group: 'yellow', price: 260, house: 150, rent: [22, 110, 330, 800, 975, 1150], glyph: 'bridge' },
    { type: 'prop', name: '逢甲夜市', group: 'yellow', price: 260, house: 150, rent: [22, 110, 330, 800, 975, 1150], glyph: 'skewer' },
    UT('自來水公司', 'drop'),
    { type: 'prop', name: '台中歌劇院', group: 'yellow', price: 280, house: 150, rent: [24, 120, 360, 850, 1025, 1200], glyph: 'opera' },
    { type: 'gotojail', name: '去坐牢' },
    { type: 'prop', name: '基隆廟口', group: 'green', price: 300, house: 200, rent: [26, 130, 390, 900, 1100, 1275], glyph: 'noodle' },
    { type: 'prop', name: '九份老街', group: 'green', price: 300, house: 200, rent: [26, 130, 390, 900, 1100, 1275], glyph: 'lanterns' },
    CHEST_T,
    { type: 'prop', name: '漁人碼頭', group: 'green', price: 320, house: 200, rent: [28, 150, 450, 1000, 1200, 1400], glyph: 'sail' },
    ST('花蓮車站'),
    CHANCE_T,
    { type: 'prop', name: '信義區', group: 'navy', price: 350, house: 200, rent: [35, 175, 500, 1100, 1300, 1500], glyph: 'towers' },
    TAX('奢侈稅', 100, 'gem'),
    { type: 'prop', name: '台北101', group: 'navy', price: 400, house: 200, rent: [50, 200, 600, 1400, 1700, 2000], glyph: 'tower101' }
  ].map((t, i) => Object.assign({}, t, { i }, t.rent ? { rent: t.rent.map(x => Math.round(x * RENT_UP)) } : {}));   /* 經典版手寫租金也一起調高 */

  /* ---------- 2. 台灣環島加大版（56 格） ---------- */
  const TAIWAN56_GROUPS = Object.assign({}, TAIWAN_GROUPS, {
    purple: { name: '花東縱谷', color: '#A56BE8' }, teal: { name: '桃竹苗', color: '#1FB8C4' }
  });
  const taiwan56 = fill(56, corner('起點', '監獄', '溫泉休息站', '去坐牢', 56), [
    /* 1-13 */ P('綠島', 'brown', 60, 'island'), CHEST_T, P('蘭嶼', 'brown', 60, 'boat'), P('澎湖', 'brown', 80, 'sail'), TAX('所得稅', 200), ST('台北車站'),
    P('墾丁', 'sky', 100, 'beach'), CHANCE_T, P('小琉球', 'sky', 100, 'turtle'), P('東港', 'sky', 120, 'fish'), SHOP, P('池上', 'purple', 130, 'lantern'), P('玉里', 'purple', 130, 'bridge'),
    /* 15-27 */ P('瑞穗', 'purple', 150, 'spring'), UT('電力公司', 'bolt'), P('太魯閣', 'pink', 160, 'gorge'), P('鹿野高台', 'pink', 160, 'balloon'), CHEST_T, P('礁溪溫泉', 'pink', 180, 'spring'),
    ST('台中車站'), P('阿里山', 'orange', 190, 'mountain'), P('日月潭', 'orange', 190, 'lake'), CHANCE_T, P('鹿港老街', 'orange', 210, 'lantern'), P('清境農場', 'orange', 210, 'mountain'), SHOP,
    /* 29-41 */ P('安平古堡', 'red', 230, 'fort'), P('駁二特區', 'red', 230, 'crate'), CHEST_T, P('蓮池潭', 'red', 250, 'pagoda'), P('佛光山', 'red', 250, 'pagoda'), ST('高雄車站'),
    P('內灣', 'yellow', 270, 'bridge'), P('逢甲夜市', 'yellow', 270, 'skewer'), UT('自來水公司', 'drop'), P('台中歌劇院', 'yellow', 290, 'opera'), CHANCE_T, P('彩虹眷村', 'yellow', 300, 'balloon'), TAX('奢侈稅', 100, 'gem'),
    /* 43-55 */ P('基隆廟口', 'green', 310, 'noodle'), P('九份老街', 'green', 310, 'lanterns'), CHEST_T, P('漁人碼頭', 'green', 330, 'sail'), P('野柳地質公園', 'green', 350, 'gorge'), ST('花蓮車站'), CHANCE_T,
    P('大溪老街', 'teal', 360, 'lantern'), P('新竹城隍廟', 'teal', 370, 'pagoda'), P('三義木雕', 'teal', 380, 'crate'), P('信義區', 'navy', 400, 'towers'), P('西門町', 'navy', 420, 'skewer'), P('台北101', 'navy', 460, 'tower101')
  ]);

  /* ---------- 3. 世界旅行（48 格） ---------- */
  const WORLD_GROUPS = {
    brown:  { name: '東南亞', color: '#9A6B45' }, sky: { name: '大洋洲', color: '#7FD3F2' }, pink: { name: '日韓', color: '#F58FBE' },
    orange: { name: '中東非洲', color: '#FFA64D' }, red: { name: '南歐', color: '#EA5A55' }, yellow: { name: '西歐', color: '#F6D24A' },
    green:  { name: '北美西岸', color: '#4DBF7A' }, navy: { name: '大都會', color: '#3D5FC4' }
  };
  const world48 = fill(48, corner('起點', '監獄', '度假島', '去坐牢', 48), [
    /* 1-11 */ P('曼谷', 'brown', 60, 'lantern'), CHEST_T, P('吉隆坡', 'brown', 60, 'towers'), P('峇里島', 'brown', 80, 'beach'), TAX('所得稅', 200), ST('桃園機場'),
    P('雪梨', 'sky', 100, 'opera'), CHANCE_T, P('墨爾本', 'sky', 100, 'bridge'), P('奧克蘭', 'sky', 120, 'sail'), SHOP,
    /* 13-23 */ P('釜山', 'pink', 140, 'fish'), P('首爾', 'pink', 140, 'towers'), UT('電力公司', 'bolt'), P('京都', 'pink', 160, 'pagoda'), CHEST_T, P('大阪', 'pink', 160, 'skewer'),
    ST('成田機場'), P('開羅', 'orange', 180, 'fort'), CHANCE_T, P('伊斯坦堡', 'orange', 180, 'lantern'), P('杜拜', 'orange', 200, 'tower101'),
    /* 25-35 */ P('開普敦', 'orange', 220, 'mountain'), P('雅典', 'red', 240, 'fort'), CHEST_T, P('羅馬', 'red', 240, 'opera'), P('巴塞隆納', 'red', 260, 'beach'), ST('希斯洛機場'),
    P('威尼斯', 'red', 260, 'boat'), SHOP, P('阿姆斯特丹', 'yellow', 280, 'bridge'), UT('自來水公司', 'drop'), CHANCE_T,
    /* 37-47 */ P('柏林', 'yellow', 300, 'crate'), P('巴黎', 'yellow', 320, 'towers'), P('倫敦', 'yellow', 340, 'opera'), CHEST_T, P('溫哥華', 'green', 360, 'mountain'), P('舊金山', 'green', 360, 'bridge'),
    ST('甘迺迪機場'), P('洛杉磯', 'green', 380, 'beach'), P('東京', 'navy', 400, 'tower101'), P('紐約', 'navy', 440, 'towers'), P('台北', 'navy', 480, 'tower101')
  ]);

  /* ---------- 4～6. 夢幻主題：沿用 40 格結構，換名字與配色，第 38 格改成道具商店 ---------- */
  const PROP_SLOTS = { brown: [1, 3], sky: [6, 8, 9], pink: [11, 13, 14], orange: [16, 18, 19], red: [21, 23, 24], yellow: [26, 27, 29], green: [31, 32, 34], navy: [37, 39] };
  function reskin(o) {
    return taiwan40.map(t => {
      const c = Object.assign({}, t, t.rent ? { rent: t.rent.slice() } : {});
      if (t.type === 'go') c.name = o.corners[0]; else if (t.type === 'jail') c.name = o.corners[1];
      else if (t.type === 'park') c.name = o.corners[2]; else if (t.type === 'gotojail') c.name = o.corners[3];
      else if (t.type === 'station') { c.name = o.stations[[5, 15, 25, 35].indexOf(t.i)]; c.glyph = o.stationGlyph || 'train'; }
      else if (t.type === 'utility') { const k = t.i === 12 ? 0 : 1; c.name = o.utilities[k][0]; c.glyph = o.utilities[k][1]; }
      else if (t.type === 'tax' && t.i === 4) c.name = o.tax;
      else if (t.i === 38) return Object.assign({ i: 38 }, SHOP);
      else if (t.type === 'prop') {
        const list = PROP_SLOTS[t.group], k = list.indexOf(t.i);
        c.name = o.props[t.group][k][0]; c.glyph = o.props[t.group][k][1];
      }
      return c;
    });
  }
  const park40 = reskin({
    corners: ['入口大門', '鬼屋', '冰淇淋休息站', '闖進鬼屋'], stations: ['小火車東站', '小火車南站', '小火車西站', '小火車北站'],
    utilities: [['發電機房', 'bolt'], ['噴水池', 'drop']], tax: '入場費',
    props: {
      brown: [['售票亭', 'crate'], ['旋轉茶杯', 'lantern']], sky: [['碰碰車', 'boat'], ['旋轉木馬', 'balloon'], ['海盜船', 'sail']],
      pink: [['空中纜車', 'bridge'], ['小飛象', 'balloon'], ['鏡子迷宮', 'gorge']], orange: [['大怒神', 'tower101'], ['雲霄飛車', 'bridge'], ['自由落體', 'towers']],
      red: [['鬼屋探險', 'fort'], ['恐龍樂園', 'mountain'], ['叢林飛車', 'turtle']], yellow: [['摩天輪', 'balloon'], ['煙火廣場', 'lanterns'], ['旋轉咖啡杯', 'skewer']],
      green: [['水上樂園', 'fish'], ['冰雪王國', 'mountain'], ['魔法學院', 'opera']], navy: [['童話大道', 'towers'], ['夢幻城堡', 'fort']]
    }
  });
  const sea40 = reskin({
    corners: ['珊瑚礁出發', '海妖洞穴', '海龜休息站', '掉進漩渦'], stations: ['潛水艇東港', '潛水艇南港', '潛水艇西港', '潛水艇北港'],
    utilities: [['海流發電廠', 'bolt'], ['海水淡化廠', 'drop']], tax: '海洋保育稅',
    props: {
      brown: [['海藻森林', 'island'], ['沙丘淺灘', 'beach']], sky: [['珊瑚礁', 'fish'], ['小丑魚灣', 'fish'], ['海星灘', 'turtle']],
      pink: [['水母花園', 'balloon'], ['海馬谷', 'fish'], ['貝殼城', 'spring']], orange: [['沉船灣', 'boat'], ['鯨魚歌廳', 'opera'], ['海底隧道', 'bridge']],
      red: [['海龜島', 'turtle'], ['鯊魚灣', 'fish'], ['魟魚廣場', 'crate']], yellow: [['深海熱泉', 'spring'], ['燈籠魚街', 'lantern'], ['海底火山', 'mountain']],
      green: [['海底神殿', 'pagoda'], ['珍珠市集', 'skewer'], ['龍宮', 'fort']], navy: [['亞特蘭提斯', 'towers'], ['深海皇宮', 'tower101']]
    }
  });
  const space40 = reskin({
    corners: ['發射台', '黑洞', '太空站', '被吸進黑洞'], stations: ['太空梭甲站', '太空梭乙站', '太空梭丙站', '太空梭丁站'], stationGlyph: 'plane',
    utilities: [['太陽能板', 'bolt'], ['冰礦場', 'drop']], tax: '太空垃圾稅',
    props: {
      brown: [['月球', 'lake'], ['火衛一', 'crate']], sky: [['水星', 'mountain'], ['金星', 'balloon'], ['地球', 'island']],
      pink: [['火星', 'gorge'], ['穀神星', 'crate'], ['灶神星', 'mountain']], orange: [['木衛二', 'lake'], ['木衛三', 'spring'], ['木星', 'balloon']],
      red: [['土衛六', 'fort'], ['土星環', 'lantern'], ['土衛二', 'lake']], yellow: [['天王星', 'balloon'], ['海王星', 'lake'], ['冥王星', 'crate']],
      green: [['半人馬座', 'towers'], ['織女星', 'lanterns'], ['天狼星', 'tower101']], navy: [['獵戶座', 'towers'], ['銀河中心', 'tower101']]
    }
  });
  park40[38].name = '紀念品商店'; sea40[38].name = '海底商店'; space40[38].name = '太空商店';

  /* ---------- 地圖清單 ---------- */
  /* landmarks：機會卡「前往某地」用；top＝最貴的一格，beach＝早期旅遊地，station＝第一個車站／機場 */
  const CHANCE_TEXT = {
    taiwan40: { 1: '前往台北101，看看跨年煙火', 2: '週末衝墾丁！前進到墾丁', 3: '搭高鐵到台北車站' }
  };
  function cardTexts(name) { return { top: '前往' + name.top + '，享受最棒的風景', beach: '假期到了！前進到' + name.beach, station: '前往' + name.station }; }
  function def(id, name, desc, tiles, groups, theme, extra) {
    const n = tiles.length, byName = i => tiles[i].name;
    const landmarks = extra && extra.landmarks || { top: n - 1, beach: tiles.findIndex(t => t.type === 'prop'), station: tiles.findIndex(t => t.type === 'station') };
    const texts = extra && extra.texts || cardTexts({ top: byName(landmarks.top), beach: byName(landmarks.beach), station: byName(landmarks.station) });
    return { id, name, desc, size: n, tiles, groups, theme, landmarks, texts, shops: tiles.filter(t => t.type === 'shop').length };
  }
  const THEMES = {
    island: { bg: '#BFE9F5', sea: '#5CC6D8', sand: '#F0D29C', base: '#B9824D', title: ['寶島', '大富翁'], titleColor: '#B9824D', deco: 'palm' },
    island56: { bg: '#BFE9F5', sea: '#5CC6D8', sand: '#F0D29C', base: '#B9824D', title: ['環島', '大富翁'], titleColor: '#B9824D', deco: 'palm' },
    world: { bg: '#CFE4FA', sea: '#6DA8E8', sand: '#E9F1D4', base: '#7B8FB5', title: ['世界', '旅行'], titleColor: '#5B7BB8', deco: 'globe' },
    park: { bg: '#FFE0EE', sea: '#F8A8CB', sand: '#FFF0B5', base: '#E27AAA', title: ['歡樂', '遊樂園'], titleColor: '#D8558D', deco: 'balloon' },
    sea: { bg: '#A6DCF2', sea: '#2F86C6', sand: '#7CC8E4', base: '#2F9AA8', title: ['海底', '世界'], titleColor: '#1F7F94', deco: 'bubble' },
    space: { bg: '#20204A', sea: '#131338', sand: '#3B3B7A', base: '#4A4A9A', title: ['太空', '探險'], titleColor: '#7B7BE0', deco: 'star' }
  };
  const LIST = [
    def('taiwan40', '寶島一圈', '經典 40 格，環繞台灣的地標（沒有道具商店）', taiwan40, TAIWAN_GROUPS, THEMES.island, { landmarks: { top: 39, beach: 6, station: 5 }, texts: CHANCE_TEXT.taiwan40 }),
    def('taiwan56', '環島加大版', '56 格，多了離島、花東縱谷與桃竹苗，2 間道具商店', taiwan56, TAIWAN56_GROUPS, THEMES.island56),
    def('world48', '世界旅行', '48 格，從曼谷一路玩到台北，有機場與 2 間道具商店', world48, WORLD_GROUPS, THEMES.world),
    def('park40', '歡樂遊樂園', '40 格，遊樂設施當地產，1 間道具商店', park40, Object.assign({}, TAIWAN_GROUPS, { brown: { name: '入口區', color: '#9A6B45' }, sky: { name: '兒童區', color: '#7FD3F2' }, pink: { name: '夢幻區', color: '#F58FBE' }, orange: { name: '刺激區', color: '#FFA64D' }, red: { name: '冒險區', color: '#EA5A55' }, yellow: { name: '節慶區', color: '#F6D24A' }, green: { name: '水樂園', color: '#4DBF7A' }, navy: { name: '城堡區', color: '#3D5FC4' } }), THEMES.park),
    def('sea40', '海底世界', '40 格，潛水艇當車站，1 間道具商店', sea40, Object.assign({}, TAIWAN_GROUPS, { brown: { name: '淺灘', color: '#9A6B45' }, sky: { name: '珊瑚區', color: '#7FD3F2' }, pink: { name: '花園區', color: '#F58FBE' }, orange: { name: '沉船區', color: '#FFA64D' }, red: { name: '鯊魚區', color: '#EA5A55' }, yellow: { name: '深海區', color: '#F6D24A' }, green: { name: '神殿區', color: '#4DBF7A' }, navy: { name: '王國', color: '#3D5FC4' } }), THEMES.sea),
    def('space40', '太空探險', '40 格，行星與恆星，太空梭當車站，1 間道具商店', space40, Object.assign({}, TAIWAN_GROUPS, { brown: { name: '月球區', color: '#9A6B45' }, sky: { name: '內行星', color: '#7FD3F2' }, pink: { name: '小行星帶', color: '#F58FBE' }, orange: { name: '木星系', color: '#FFA64D' }, red: { name: '土星系', color: '#EA5A55' }, yellow: { name: '外行星', color: '#F6D24A' }, green: { name: '恆星', color: '#4DBF7A' }, navy: { name: '星系核心', color: '#3D5FC4' } }), THEMES.space)
  ];
  const BY_ID = {};
  LIST.forEach(m => { BY_ID[m.id] = m; });
  const DEFAULT = 'taiwan40';

  return { LIST, BY_ID, DEFAULT, get: id => BY_ID[id] || BY_ID[DEFAULT], has: id => !!BY_ID[id] };
});
