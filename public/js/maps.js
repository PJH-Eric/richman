/* ===== maps.js — 地圖資料（瀏覽器與伺服器共用） =====
 *
 * 地圖不再是固定幾張：每一局依「格數（48／64／80／96／120）＋種子」隨機生成（主題、地名、色組、特殊格位置都不同），
 * 同一個地圖代號（例如 g64-abc123）在任何地方都會生成同一張，所以只要在對局狀態裡存代號，前後端就能各自重建。
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

  /* ---------- 經典 40 格（只給測試用的隱藏地圖：固定版面，玩家選不到） ---------- */
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


  /* ---------- 隨機地圖生成 ---------- */
  const SIZES = [48, 64, 80, 96, 120];
  const DEFAULT_SIZE = 64;
  function hashStr(str) {
    str = String(str);
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return (h >>> 0) || 1;
  }
  function prng(seed) {
    let a = hashStr(seed);
    const r = {
      next() { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; },
      int(lo, hi) { return lo + Math.floor(r.next() * (hi - lo + 1)); },
      pick(arr) { return arr[Math.floor(r.next() * arr.length)]; },
      shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
    };
    return r;
  }
  const sizeOf = n => SIZES.includes(Number(n)) ? Number(n) : DEFAULT_SIZE;
  const GEN_RE = /^g(48|64|80|96|120)-([0-9a-z]{1,10})$/;
  /** 依格數與種子（任意字串）得到地圖代號 */
  const keyOf = seed => hashStr('map|' + seed).toString(36).slice(0, 8);
  function genId(size, seed) { return 'g' + sizeOf(size) + '-' + keyOf(seed); }

  /* 色組：依「離起點由近到遠、越來越貴」的順序，最多 14 組 */
  const GROUP_KEYS = ['brown', 'sky', 'purple', 'pink', 'orange', 'red', 'yellow', 'green', 'lime', 'teal', 'maroon', 'magenta', 'slate', 'navy'];
  const GROUP_COLORS = ['#9A6B45', '#7FD3F2', '#A56BE8', '#F58FBE', '#FFA64D', '#EA5A55', '#F6D24A', '#4DBF7A', '#B7D94C', '#1FB8C4', '#8C2F3E', '#C2408F', '#7B8FB5', '#3D5FC4'];
  const W = s => s.split(' ').map(x => { const k = x.split(':'); return [k[0], k[1]]; });
  const THEME_DATA = {
    taiwan: {
      name: '寶島', theme: 'island', top: ['台北101', 'tower101'], corners: ['起點', '監獄', '溫泉休息站', '去坐牢'], shop: '道具商店',
      stations: ['台北車站', '台中車站', '高雄車站', '花蓮車站', '台南車站', '新竹車站'], stationGlyph: 'train',
      utilities: [['電力公司', 'bolt'], ['自來水公司', 'drop'], ['瓦斯公司', 'bolt']], taxes: ['所得稅', '奢侈稅', '房屋稅', '地價稅'],
      groups: ['離島', '南灣', '花東縱谷', '東岸', '山城', '古都', '中台', '北海岸', '嘉南平原', '桃竹苗', '中部山區', '雙北', '北部精華', '首都圈'],
      stems: W('綠島:island 蘭嶼:boat 澎湖:sail 金門:fort 馬祖:lantern 墾丁:beach 小琉球:turtle 東港:fish 七星潭:beach 池上:lantern 玉里:bridge 瑞穗:spring 六十石山:mountain 太魯閣:gorge 鹿野高台:balloon 礁溪溫泉:spring 羅東夜市:skewer 阿里山:mountain 日月潭:lake 鹿港老街:lantern 清境農場:mountain 安平古堡:fort 駁二特區:crate 蓮池潭:pagoda 佛光山:pagoda 內灣:bridge 逢甲夜市:skewer 台中歌劇院:opera 彩虹眷村:balloon 基隆廟口:noodle 九份老街:lanterns 漁人碼頭:sail 野柳地質公園:gorge 嘉義文化路:skewer 奮起湖:mountain 北港朝天宮:pagoda 布袋港:sail 大溪老街:lantern 新竹城隍廟:pagoda 三義木雕:crate 北埔老街:lantern 台南孔廟:pagoda 赤崁樓:fort 旗津海岸:beach 愛河:boat 淡水老街:skewer 陽明山:mountain 故宮博物院:opera 西門町:skewer 象山步道:mountain 信義區:towers')
    },
    world: {
      name: '世界旅行', theme: 'world', top: ['紐約', 'tower101'], corners: ['起點', '監獄', '度假島', '去坐牢'], shop: '機場免稅店',
      stations: ['桃園機場', '成田機場', '希斯洛機場', '甘迺迪機場', '戴高樂機場', '仁川機場'], stationGlyph: 'plane',
      utilities: [['電力公司', 'bolt'], ['自來水公司', 'drop'], ['天然氣公司', 'bolt']], taxes: ['所得稅', '奢侈稅', '關稅', '機場稅'],
      groups: ['東南亞', '大洋洲', '日韓', '中東', '非洲', '南歐', '東歐', '西歐', '北歐', '北美西岸', '北美東岸', '拉丁美洲', '東亞金融', '大都會'],
      stems: W('曼谷:lantern 吉隆坡:towers 峇里島:beach 河內:boat 新加坡:sail 雪梨:opera 墨爾本:bridge 奧克蘭:sail 釜山:fish 首爾:towers 京都:pagoda 大阪:skewer 北京:fort 上海:towers 香港:towers 開羅:fort 伊斯坦堡:lantern 杜拜:tower101 開普敦:mountain 馬拉喀什:lantern 雅典:fort 羅馬:opera 巴塞隆納:beach 威尼斯:boat 佛羅倫斯:opera 里斯本:sail 阿姆斯特丹:bridge 布魯塞爾:crate 柏林:crate 布拉格:fort 維也納:opera 巴黎:towers 倫敦:opera 愛丁堡:fort 都柏林:lantern 溫哥華:mountain 舊金山:bridge 洛杉磯:beach 拉斯維加斯:gem 芝加哥:towers 多倫多:towers 墨西哥城:pagoda 里約:beach 布宜諾斯艾利斯:opera 東京:tower101 台北:tower101')
    },
    park: {
      name: '歡樂遊樂園', theme: 'park', top: ['城堡王座', 'tower101'], corners: ['入口大門', '鬼屋', '冰淇淋休息站', '闖進鬼屋'], shop: '紀念品商店',
      stations: ['小火車東站', '小火車南站', '小火車西站', '小火車北站', '小火車中央站', '小火車山頂站'], stationGlyph: 'train',
      utilities: [['發電機房', 'bolt'], ['噴水池', 'drop'], ['鍋爐房', 'bolt']], taxes: ['入場費', '停車費', '拍照費', '寄物費'],
      groups: ['入口區', '兒童區', '泡泡區', '甜點區', '刺激區', '冒險區', '節慶區', '水樂園', '極光區', '冰雪區', '魔法區', '劇院區', '夢幻區', '城堡區'],
      stems: W('售票亭:crate 旋轉茶杯:lantern 迷你高爾夫:island 碰碰車:boat 旋轉木馬:balloon 海盜船:sail 小小動物園:turtle 空中纜車:bridge 小飛象:balloon 鏡子迷宮:gorge 泡泡屋:spring 冰淇淋大道:skewer 棉花糖屋:lantern 爆米花車:crate 糖果城堡:fort 大怒神:towers 雲霄飛車:bridge 自由落體:towers 激流勇進:fish 鬼屋探險:fort 恐龍樂園:mountain 叢林飛車:turtle 木乃伊墓:pagoda 摩天輪:balloon 煙火廣場:lanterns 旋轉咖啡杯:skewer 花車遊行:lantern 水上樂園:fish 造浪池:beach 漂漂河:boat 滑水道:sail 冰雪王國:mountain 企鵝館:fish 極地探險:mountain 溜冰場:lake 魔法學院:opera 童話大道:towers 夢幻城堡:fort 幸運轉盤:gem 海洋劇場:opera 太空山:mountain 蒸汽火車:train 音樂噴泉:drop 飛行傘塔:balloon 賽車場:crate')
    },
    sea: {
      name: '海底世界', theme: 'sea', top: ['深海皇宮', 'tower101'], corners: ['珊瑚礁出發', '海妖洞穴', '海龜休息站', '掉進漩渦'], shop: '海底商店',
      stations: ['潛水艇東港', '潛水艇南港', '潛水艇西港', '潛水艇北港', '潛水艇中央港', '潛水艇深海港'], stationGlyph: 'train',
      utilities: [['海流發電廠', 'bolt'], ['海水淡化廠', 'drop'], ['熱泉發電站', 'bolt']], taxes: ['海洋保育稅', '珍珠稅', '航道稅', '漁獲稅'],
      groups: ['淺灘', '珊瑚區', '花園區', '珍珠區', '沉船區', '鯊魚區', '深海區', '神殿區', '光之洞', '極地區', '火山區', '歌劇區', '城邦', '王國'],
      stems: W('海藻森林:island 沙丘淺灘:beach 潮間帶:turtle 珊瑚礁:fish 小丑魚灣:fish 海星灘:turtle 珊瑚花園:beach 水母花園:balloon 海葵谷:spring 海馬谷:fish 貝殼城:spring 珍珠灣:gem 螺旋洞:gorge 泡泡街:balloon 海螺市集:skewer 沉船灣:boat 鯨魚歌廳:opera 海底隧道:bridge 燈塔礁:towers 海龜島:turtle 鯊魚灣:fish 魟魚廣場:crate 鱟之谷:mountain 深海熱泉:spring 燈籠魚街:lantern 海底火山:mountain 磷光洞:lanterns 海底神殿:pagoda 珍珠市集:skewer 龍宮:fort 海蛇拱門:bridge 冰洋岬:mountain 企鵝冰原:fish 極光海:lake 冰川灣:mountain 藍洞:lake 海底圖書館:opera 亞特蘭提斯:towers 章魚劇場:opera 昆布林:island 河豚村:fish 鮟鱇燈塔:lantern 海豚灣:beach 海獅岩:mountain 水晶洞:gem 珊瑚宮:fort')
    },
    space: {
      name: '太空探險', theme: 'space', top: ['黑洞邊緣', 'tower101'], corners: ['發射台', '黑洞', '太空站', '被吸進黑洞'], shop: '太空商店',
      stations: ['太空梭甲站', '太空梭乙站', '太空梭丙站', '太空梭丁站', '太空梭戊站', '太空梭己站'], stationGlyph: 'plane',
      utilities: [['太陽能板', 'bolt'], ['冰礦場', 'drop'], ['核融合爐', 'bolt']], taxes: ['太空垃圾稅', '軌道稅', '燃料稅', '通行稅'],
      groups: ['月球區', '內行星', '火星區', '木星系', '土星系', '外行星', '彗星帶', '恆星', '星雲', '星座', '星團', '銀河臂', '星系核心', '奇點'],
      stems: W('月球:lake 火衛一:crate 衛星基地:fort 水星:mountain 金星:balloon 地球:island 軌道旅館:towers 火星:gorge 穀神星:crate 灶神星:mountain 小行星礦場:crate 木衛一:spring 木衛二:lake 木衛三:spring 木星:balloon 土衛六:fort 土星環:lantern 土衛二:lake 土星:balloon 天王星:balloon 海王星:lake 冥王星:crate 凱龍星:mountain 彗星站:lantern 柯伊伯帶:crate 歐特雲:lake 太陽風帶:lanterns 半人馬座:towers 織女星:lanterns 天狼星:tower101 北極星:lantern 蟹狀星雲:spring 馬頭星雲:mountain 獵戶星雲:balloon 玫瑰星雲:lanterns 仙女座:towers 獵戶座:opera 銀河中心:towers 月球背面:lake 太空電梯:bridge 星際市集:skewer 脈衝星:bolt 量子港:sail 織女港:sail 天鵝座:balloon 南十字座:lantern 飛馬座:towers')
    }
  };
  const THEME_KEYS = Object.keys(THEME_DATA);
  const THEMES = {
    island: { bg: '#BFE9F5', sea: '#5CC6D8', sand: '#F0D29C', base: '#B9824D', title: ['寶島', '大富翁'], titleColor: '#B9824D', deco: 'palm' },
    world: { bg: '#CFE4FA', sea: '#6DA8E8', sand: '#E9F1D4', base: '#7B8FB5', title: ['世界', '旅行'], titleColor: '#5B7BB8', deco: 'globe' },
    park: { bg: '#FFE0EE', sea: '#F8A8CB', sand: '#FFF0B5', base: '#E27AAA', title: ['歡樂', '遊樂園'], titleColor: '#D8558D', deco: 'balloon' },
    sea: { bg: '#A6DCF2', sea: '#2F86C6', sand: '#7CC8E4', base: '#2F9AA8', title: ['海底', '世界'], titleColor: '#1F7F94', deco: 'bubble' },
    space: { bg: '#20204A', sea: '#131338', sand: '#3B3B7A', base: '#4A4A9A', title: ['太空', '探險'], titleColor: '#7B7BE0', deco: 'star' }
  };
  /** 各格數的格子配額：特殊格（機會、命運、車站、公司、稅、商店）與地產數量 */
  function quotas(n) {
    const L = n - 4;
    const shop = Math.min(4, Math.max(2, Math.round(L / 24))), chance = Math.round(L / 14), chest = Math.round(L / 15);
    const station = Math.max(4, Math.round(n / 20)), utility = n >= 96 ? 3 : 2, tax = n >= 96 ? 4 : n >= 80 ? 3 : 2;
    const props = L - shop - chance - chest - station - utility - tax;
    const groups = Math.min(14, Math.max(8, Math.round(props / 4)));
    return { L, shop, chance, chest, station, utility, tax, props, groups };
  }
  /** 依格數＋種子生成一張完整地圖（同輸入永遠同輸出） */
  function generate(size, seed) { return build(sizeOf(size), keyOf(seed)); }
  function build(n, key) {
    const q = quotas(n), rng = prng('gen|' + n + '|' + key);
    const themeKey = rng.pick(THEME_KEYS), td = THEME_DATA[themeKey];
    /* 地名：先用原名，不夠再加「新」「小」前綴；最貴的一格固定是主題地標 */
    const stems = rng.shuffle(td.stems.slice());
    const names = stems.slice();
    ['新', '小', '大'].forEach(pre => { if (names.length < q.props) stems.forEach(st => names.push([pre + st[0], st[1]])); });
    const propNames = names.slice(0, q.props - 1);
    /* 色組大小：平均分配，多出來的隨機給幾組 */
    const base = Math.floor(q.props / q.groups), extra = q.props - base * q.groups;
    const sizes = new Array(q.groups).fill(base);
    rng.shuffle(sizes.map((_, i) => i)).slice(0, extra).forEach(i => sizes[i]++);
    const groups = {}, order = [];
    for (let g = 0; g < q.groups; g++) {
      /* 色組挑選：均勻取用 14 色，越後面越貴 */
      const ci = q.groups === 14 ? g : Math.round(g * 13 / (q.groups - 1));
      const key = GROUP_KEYS[ci];
      groups[key] = { name: td.groups[ci], color: GROUP_COLORS[ci] };
      for (let k = 0; k < sizes[g]; k++) order.push(key);
    }
    /* 價格：60 → 約 540，依整條路線的位置線性增加，同色組內小幅遞增 */
    const price = idx => { const t = idx / Math.max(1, q.props - 1); return Math.round((60 + t * 480) / 10) * 10; };
    /* 特殊格：均勻散開、車站每隔一段一個 */
    const slots = [];
    const S = q.L - q.props;
    for (let k = 0; k < S; k++) slots.push(Math.min(q.L - 1, Math.floor((k + 0.15 + rng.next() * 0.7) * q.L / S)));
    for (let k = 1; k < slots.length; k++) if (slots[k] <= slots[k - 1]) slots[k] = slots[k - 1] + 1;
    const types = new Array(S).fill(null);
    for (let k = 0; k < q.station; k++) { let at = Math.min(S - 1, Math.round((k + 0.5) * S / q.station)); while (types[at]) at = (at + 1) % S; types[at] = 'S'; }
    const rest = [];
    for (let k = 0; k < q.utility; k++) rest.push('U'); for (let k = 0; k < q.tax; k++) rest.push('T');
    for (let k = 0; k < q.shop; k++) rest.push('$'); for (let k = 0; k < q.chance; k++) rest.push('C'); for (let k = 0; k < q.chest; k++) rest.push('H');
    rng.shuffle(rest);
    for (let k = 0; k < S; k++) if (!types[k]) types[k] = rest.pop();
    /* 道具商店：每一邊（一排）最多一間——同一邊有兩間以上的，跟沒有商店的那一邊交換 */
    const sideOf = k => Math.min(3, Math.floor(slots[k] / (q.L / 4)));
    for (let guard = 0; guard < 20; guard++) {
      const cnt = [0, 0, 0, 0]; types.forEach((t, k) => { if (t === '$') cnt[sideOf(k)]++; });
      const dup = types.findIndex((t, k) => t === '$' && cnt[sideOf(k)] > 1);
      const empty = cnt.map((c, i) => c === 0 ? i : -1).filter(i => i >= 0);
      if (dup < 0 || !empty.length) break;
      const cand = types.map((t, k) => k).filter(k => empty.includes(sideOf(k)) && types[k] !== 'S' && types[k] !== '$');
      if (!cand.length) break;
      const k2 = cand[Math.floor(rng.next() * cand.length)];
      types[dup] = types[k2]; types[k2] = '$';
    }
    const specialAt = {};
    slots.forEach((sl, k) => { specialAt[sl] = types[k]; });
    /* 依序鋪滿整圈 */
    const list = [], counters = { S: 0, U: 0, T: 0 };
    let pi = 0;
    for (let i = 0; i < q.L; i++) {
      const sp = specialAt[i];
      if (sp === 'S') list.push(ST(td.stations[counters.S++ % td.stations.length], 200)), list[list.length - 1].glyph = td.stationGlyph;
      else if (sp === 'U') { const u = td.utilities[counters.U++ % td.utilities.length]; list.push(UT(u[0], u[1])); }
      else if (sp === 'T') { const nm = td.taxes[counters.T % td.taxes.length]; list.push(TAX(nm, counters.T % 2 === 0 ? 200 : 100, counters.T % 2 === 0 ? 'coin' : 'gem')); counters.T++; }
      else if (sp === '$') list.push(Object.assign({}, SHOP, { name: td.shop }));
      else if (sp === 'C') list.push(CHANCE_T);
      else if (sp === 'H') list.push(CHEST_T);
      else {
        const last = pi === q.props - 1;
        const nm = last ? td.top : propNames[pi];
        list.push(P(nm[0], order[pi], price(pi) + (last ? 20 : 0), nm[1]));
        pi++;
      }
    }
    const tiles = fill(n, corner(td.corners[0], td.corners[1], td.corners[2], td.corners[3], n), list);
    const id = 'g' + n + '-' + key;
    const top = tiles.reduce((b, t) => t.type === 'prop' && (b < 0 || t.price > tiles[b].price) ? t.i : b, -1);
    const beach = tiles.findIndex(t => t.type === 'prop');
    const station = tiles.findIndex(t => t.type === 'station');
    const landmarks = { top, beach, station };
    const texts = cardTexts({ top: tiles[top].name, beach: tiles[beach].name, station: tiles[station].name });
    const shops = tiles.filter(t => t.type === 'shop').length;
    return { id, name: td.name + '・' + n + ' 格', desc: n + ' 格・' + td.name + '主題', size: n, tiles, groups, theme: THEMES[td.theme], landmarks, texts, shops, themeKey };
  }

  /* ---------- 地圖登記 ---------- */
  const CHANCE_TEXT = {
    classic40: { 1: '前往台北101，看看跨年煙火', 2: '週末衝墾丁！前進到墾丁', 3: '搭高鐵到台北車站' }
  };
  function cardTexts(name) { return { top: '前往' + name.top + '，享受最棒的風景', beach: '假期到了！前進到' + name.beach, station: '前往' + name.station }; }
  const BY_ID = {};
  BY_ID.classic40 = {
    id: 'classic40', name: '經典 40 格', desc: '經典 40 格（測試用）', size: taiwan40.length, tiles: taiwan40, groups: TAIWAN_GROUPS, theme: THEMES.island,
    landmarks: { top: 39, beach: 6, station: 5 }, texts: CHANCE_TEXT.classic40, shops: 0, themeKey: 'taiwan'
  };
  const CACHE = [];   /* 生成過的地圖：只留最近 24 張，伺服器不會越積越多 */
  const DEFAULT = genId(DEFAULT_SIZE, 'default');
  function parse(id) { const m = GEN_RE.exec(String(id)); return m ? { size: Number(m[1]), key: m[2] } : null; }
  function get(id) {
    if (BY_ID[id]) return BY_ID[id];
    const hit = CACHE.find(m => m.id === id);
    if (hit) return hit;
    const p = parse(id);
    if (!p) return get(DEFAULT);
    const m = build(p.size, p.key);
    CACHE.push(m); if (CACHE.length > 24) CACHE.shift();
    return m;
  }
  const has = id => !!BY_ID[id] || !!parse(id);
  /** 給玩家選的：是不是合法的「格數」 */
  const validSize = n => SIZES.includes(Number(n));

  return { LIST: [], SIZES, DEFAULT_SIZE, DEFAULT, BY_ID, THEMES, genId, generate, sizeOf, validSize, get, has, parse, quotas };
});
