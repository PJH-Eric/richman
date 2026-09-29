/* ===== board3d.js — 3D 棋盤（three.js） =====
 *
 * 只負責「畫」：40 格的立體棋盤、棋子（跳著走）、骰子（翻滾）、房子與旅店、擁有者標記、
 * 可拖曳轉視角、點格子看說明。遊戲規則與動畫排程都在 board.js，這裡不判斷任何規則。
 *
 * three.js 放在 public/vendor/three.min.js（MIT，隨專案發佈，不靠外部網路），第一次進對局才載入。
 * 棋子有四種形狀（圓柱、方塊、三角錐、菱形）＋顏色＋頭上的小動物，色盲也分得出來。
 */
(function (root) {
  'use strict';

  const R = root.Rules;
  const T = R.TILES;
  const COLORS = R.PLAYER_COLORS;
  const CW = 1.55, TOTAL = CW * 2 + 9;
  const TILE_H = 0.3;
  const FONT = '"jf-openhuninn","Arial Rounded MT Bold","PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';

  let threeP = null;
  function loadThree() {
    if (!threeP) threeP = import(new URL('vendor/three.min.js', document.baseURI).href);
    return threeP;
  }

  /* 第 c 條欄／列（1～11）中心在世界座標的位置；棋盤中心是 (0,0) */
  function axis(c) {
    let acc = 0;
    for (let k = 1; k < c; k++) acc += k === 1 || k === 11 ? CW : 1;
    return acc + (c === 1 || c === 11 ? CW : 1) / 2 - TOTAL / 2;
  }
  function gridPos(i) {
    if (i === 0) return { row: 11, col: 11, side: 'c', rot: 0 };
    if (i < 10) return { row: 11, col: 11 - i, side: 'b', rot: 0 };
    if (i === 10) return { row: 11, col: 1, side: 'c', rot: -Math.PI / 2 };
    if (i < 20) return { row: 11 - (i - 10), col: 1, side: 'l', rot: -Math.PI / 2 };
    if (i === 20) return { row: 1, col: 1, side: 'c', rot: Math.PI };
    if (i < 30) return { row: 1, col: 1 + (i - 20), side: 't', rot: Math.PI };
    if (i === 30) return { row: 1, col: 11, side: 'c', rot: Math.PI / 2 };
    return { row: 1 + (i - 30), col: 11, side: 'r', rot: Math.PI / 2 };
  }
  const TILE_POS = T.map((t, i) => { const g = gridPos(i); return { x: axis(g.col), z: axis(g.row) }; });

  function svgImage(svg, px) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" '));
    });
  }
  const imgCache = {};
  function cached(key, make) { return imgCache[key] || (imgCache[key] = make()); }

  function wrapText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return [text];
    const mid = Math.ceil(text.length / 2);
    return [text.slice(0, mid), text.slice(mid)];
  }

  /** 建立 3D 場景；回傳 Promise（three.js 還要載入） */
  async function create(container, opt) {
    const THREE = await loadThree();
    opt = opt || {};
    const canvas = document.createElement('canvas');
    canvas.className = 'b3d';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '3D 棋盤，可以拖曳轉動視角，點格子看說明');
    container.insertBefore(canvas, container.firstChild);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'default' });
    } catch (e) { canvas.remove(); throw e; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#BFE9F5');
    const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 200);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xE3BC7E, 1.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(6, 14, 9);
    scene.add(sun);

    let dirty = true;
    const std = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0 }, extra || {}));

    /* ---------- 場景：沙灘、海、棋盤底座、中央標題、椰子樹 ---------- */
    const sea = new THREE.Mesh(new THREE.CircleGeometry(60, 48), std('#5CC6D8', { roughness: 0.4 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.6; scene.add(sea);
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(11.6, 12.4, 0.5, 48), std('#F0D29C'));
    sand.position.y = -0.32; scene.add(sand);
    const base = new THREE.Mesh(new THREE.BoxGeometry(TOTAL + 0.5, TILE_H - 0.02, TOTAL + 0.5), std('#B9824D'));
    base.position.y = (TILE_H - 0.02) / 2; scene.add(base);

    const cc = document.createElement('canvas'); cc.width = cc.height = 512;
    (function () {
      const g = cc.getContext('2d');
      g.fillStyle = '#FFF1CF'; g.fillRect(0, 0, 512, 512);
      g.strokeStyle = '#E2B47A'; g.lineWidth = 6; g.setLineDash([16, 12]); g.strokeRect(12, 12, 488, 488);
      g.setLineDash([]);
      g.fillStyle = '#3CB7C8';
      for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(20, 400 + k * 22); for (let x = 20; x <= 492; x += 24) g.quadraticCurveTo(x + 6, 388 + k * 22, x + 12, 400 + k * 22); g.lineTo(492, 512); g.lineTo(20, 512); g.closePath(); g.globalAlpha = 0.16; g.fill(); }
      g.globalAlpha = 1;
      g.fillStyle = '#B9824D'; g.font = '900 78px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('寶島', 256, 150); g.fillText('大富翁', 256, 250);
    })();
    const ctex = new THREE.CanvasTexture(cc); ctex.colorSpace = THREE.SRGBColorSpace;
    const inlay = new THREE.Mesh(new THREE.PlaneGeometry(TOTAL - CW * 2, TOTAL - CW * 2), new THREE.MeshStandardMaterial({ map: ctex, roughness: 0.9 }));
    inlay.rotation.x = -Math.PI / 2; inlay.position.y = TILE_H - 0.01; scene.add(inlay);

    for (let k = 0; k < 9; k++) {           /* 椰子樹 */
      const a = k / 9 * Math.PI * 2 + 0.3, rr = 9.6 + (k % 3) * 0.5;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.6, 8), std('#8B5A2B')); trunk.position.y = 0.8; tree.add(trunk);
      for (let l = 0; l < 5; l++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.3, 4), std('#3DAE6B'));
        leaf.position.set(Math.cos(l * 1.26) * 0.5, 1.7, Math.sin(l * 1.26) * 0.5);
        leaf.rotation.z = Math.cos(l * 1.26) * -1.2; leaf.rotation.x = Math.sin(l * 1.26) * 1.2;
        tree.add(leaf);
      }
      tree.position.set(Math.cos(a) * rr, -0.1, Math.sin(a) * rr);
      tree.scale.setScalar(0.9 + (k % 4) * 0.12);
      scene.add(tree);
    }

    /* ---------- 40 個格子（文字一律朝向預設視角，看得懂；擁有者用顏色＋形狀＋旗子標出來） ---------- */
    const tileObjs = [];
    const pickables = [];
    const houseMat = std('#3DAE6B'), hotelMat = std('#E0483E');
    const INN = { b: [0, -1], t: [0, 1], l: [1, 0], r: [-1, 0], c: [0, 0] };

    function shapeMesh(k, color, size) {
      let geo;
      if (k % 4 === 0) geo = new THREE.CylinderGeometry(size * 0.5, size * 0.5, size * 0.3, 24);
      else if (k % 4 === 1) geo = new THREE.BoxGeometry(size, size * 0.3, size);
      else if (k % 4 === 2) geo = new THREE.ConeGeometry(size * 0.62, size * 0.6, 3);
      else geo = new THREE.OctahedronGeometry(size * 0.62);
      const m = new THREE.Mesh(geo, std(color, { roughness: 0.45 }));
      if (k % 4 === 3) m.scale.y = 0.55;
      return m;
    }

    function pill(c, x, y, w, h, fill, stroke) {
      c.beginPath();
      const r = h / 2;
      c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
      c.fillStyle = fill; c.fill();
      if (stroke) { c.lineWidth = 4; c.strokeStyle = stroke; c.stroke(); }
    }

    T.forEach((t, i) => {
      const g = gridPos(i);
      const side = g.side;
      const ww = side === 'l' || side === 'r' || side === 'c' ? CW : 1;
      const wd = side === 'b' || side === 't' || side === 'c' ? CW : 1;
      const inn = INN[side];
      const tan = [Math.abs(inn[1]), Math.abs(inn[0])];
      const PX = 220, K = 1.5;                 /* 畫的時候用 220 為單位，實際貼圖放大 1.5 倍讓字更銳利 */
      const cv = document.createElement('canvas');
      cv.width = Math.round(ww * PX * K); cv.height = Math.round(wd * PX * K);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 16;
      const bg = side === 'c' ? '#FFE9B8' : t.type === 'chance' ? '#FFF1C9' : t.type === 'chest' ? '#E1F5E8' : t.type === 'tax' ? '#FBE0DA' : t.type === 'station' ? '#E9F1FB' : t.type === 'utility' ? '#F3F0E4' : '#FFFBEF';
      const glyphName = t.glyph || (t.type === 'go' ? 'go' : t.type);
      function paint(img) {
        const c = cv.getContext('2d'), W = cv.width / K, H = cv.height / K, B = 70;
        c.setTransform(K, 0, 0, K, 0, 0);
        c.fillStyle = bg; c.fillRect(0, 0, W, H);
        c.strokeStyle = '#BFA678'; c.lineWidth = 5; c.strokeRect(2.5, 2.5, W - 5, H - 5);
        let cx = 0, cy = 0, cw = W, ch = H;
        if (t.type === 'prop') {
          c.fillStyle = R.GROUPS[t.group].color;
          if (side === 'b') { c.fillRect(0, 0, W, B); cy = B; ch = H - B; }
          else if (side === 't') { c.fillRect(0, H - B, W, B); ch = H - B; }
          else if (side === 'l') { c.fillRect(W - B, 0, B, H); cw = W - B; }
          else if (side === 'r') { c.fillRect(0, 0, B, H); cx = B; cw = W - B; }
        }
        const price = t.price || t.tax;
        const landscape = cw > ch;
        const corner = side === 'c';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        const nameFont = fs => '900 ' + fs + 'px ' + FONT;
        let fs = corner ? 68 : 62;
        c.font = nameFont(fs);
        const areaW = landscape ? cw * 0.6 : cw - 8;
        let lines = wrapText(c, t.name, areaW);
        while (fs > 30 && lines.some(l => c.measureText(l).width > areaW)) { fs -= 3; c.font = nameFont(fs); lines = wrapText(c, t.name, areaW); }
        const pillH = price ? 58 : 0;
        if (!landscape) {
          const gs = Math.min(cw * (corner ? 0.6 : 0.5), ch * (corner ? 0.46 : 0.3));
          const total = gs + 8 + lines.length * (fs + 4) + (price ? pillH + 8 : 0);
          let y = cy + (ch - total) / 2;
          if (img) c.drawImage(img, cx + (cw - gs) / 2, y, gs, gs);
          y += gs + 8;
          c.fillStyle = '#1F140C'; c.font = nameFont(fs);
          lines.forEach(l => { c.fillText(l, cx + cw / 2, y + fs / 2); y += fs + 4; });
          if (price) { const pw = 150; pill(c, cx + (cw - pw) / 2, y + 4, pw, pillH, t.tax ? '#FFD3CC' : '#FFE9A8', '#C9A24A'); c.fillStyle = '#4A2C0A'; c.font = '900 42px ' + FONT; c.fillText(String(price), cx + cw / 2, y + 4 + pillH / 2 + 1); }
        } else {
          const gs = Math.min(ch * 0.6, cw * 0.34);
          if (img) c.drawImage(img, cx + 12, cy + (ch - gs) / 2, gs, gs);
          const tx = cx + 12 + gs + (cw - gs - 12) / 2;
          const total = lines.length * (fs + 4) + (price ? pillH + 8 : 0);
          let y = cy + (ch - total) / 2;
          c.fillStyle = '#2E1F14'; c.font = nameFont(fs);
          lines.forEach(l => { c.fillText(l, tx, y + fs / 2); y += fs + 4; });
          if (price) { const pw = 140; pill(c, tx - pw / 2, y + 4, pw, pillH, t.tax ? '#FFD3CC' : '#FFE9A8', '#C9A24A'); c.fillStyle = '#4A2C0A'; c.font = '900 40px ' + FONT; c.fillText(String(price), tx, y + 4 + pillH / 2 + 1); }
        }
        tex.needsUpdate = true; dirty = true;
      }
      paint(null);
      cached('g:' + glyphName, () => svgImage(root.Art.glyph(glyphName), 256)).then(img => { if (img) paint(img); });

      const grp = new THREE.Group();
      grp.position.set(TILE_POS[i].x, 0, TILE_POS[i].z);
      const sideMat = std('#BFA678');
      const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(ww * 0.97, TILE_H, wd * 0.97), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
      body.position.y = TILE_H / 2;
      body.userData.tile = i;
      grp.add(body);
      pickables.push(body);
      const houses = new THREE.Group(); houses.position.y = TILE_H; grp.add(houses);
      const mark = new THREE.Group(); mark.position.y = TILE_H; grp.add(mark);
      scene.add(grp);
      tileObjs.push({ grp, body, topMat, houses, mark, ww, wd, inn, tan, key: '' });
    });

    let curTile = -1;
    function setTiles(v) {
      dirty = true;
      v.props.forEach((p, i) => {
        const o = tileObjs[i], t = T[i];
        if (!t.price) return;
        const key = p.owner + ':' + p.houses + ':' + p.mortgaged;
        if (o.key === key) return;
        o.key = key;
        o.houses.clear(); o.mark.clear();
        o.topMat.color.setScalar(p.mortgaged ? 0.5 : 1);
        const at = (a, b) => [o.inn[0] * a + o.tan[0] * b, o.inn[1] * a + o.tan[1] * b];   /* a：往中央；b：沿格子橫向 */
        const bandA = CW / 2 - 0.15;
        if (t.type === 'prop') {
          if (p.houses === 5) {
            const q = at(bandA, 0);
            const m = new THREE.Mesh(new THREE.BoxGeometry(o.tan[0] ? 0.72 : 0.3, 0.34, o.tan[0] ? 0.3 : 0.72), hotelMat); m.position.set(q[0], 0.17, q[1]); o.houses.add(m);
            const roof = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 4), std('#B7352B')); roof.position.set(q[0], 0.44, q[1]); roof.rotation.y = Math.PI / 4; o.houses.add(roof);
          } else {
            for (let k = 0; k < p.houses; k++) {
              const q = at(bandA, (k - (p.houses - 1) / 2) * 0.24);
              const h = new THREE.Group();
              const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.2), houseMat); b.position.y = 0.085; h.add(b);
              const r = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.15, 4), std('#D8483E')); r.position.y = 0.245; r.rotation.y = Math.PI / 4; h.add(r);
              h.position.set(q[0], 0, q[1]);
              o.houses.add(h);
            }
          }
        }
        if (p.owner >= 0) {
          const col = COLORS[p.owner];
          /* 1. 整格外框 */
          const fw = o.ww * 0.97, fd = o.wd * 0.97, th = 0.07;
          [[0, -fd / 2 + th / 2, fw, th], [0, fd / 2 - th / 2, fw, th], [-fw / 2 + th / 2, 0, th, fd], [fw / 2 - th / 2, 0, th, fd]].forEach(a => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(a[2], 0.06, a[3]), std(col, { roughness: 0.4 })); m.position.set(a[0], 0.03, a[1]); o.mark.add(m);
          });
          /* 2. 旗子：旗桿＋跟棋子同形狀的旗面，遠遠就看得到是誰的 */
          const pa = -(CW / 2 - 0.2), pb = -0.5 + 0.2;
          const q = at(pa, pb);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 8), std('#5A3A14')); pole.position.set(q[0], 0.31, q[1]); o.mark.add(pole);
          const flag = shapeMesh(p.owner, col, 0.34); flag.position.set(q[0], 0.66, q[1]);
          if (p.owner % 4 === 0 || p.owner % 4 === 1) flag.rotation.x = Math.PI / 2;
          o.mark.add(flag);
          if (p.mortgaged) { const x = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.1), std('#4A3B2C')); x.position.set(0, 0.04, 0); x.rotation.y = 0.6; o.mark.add(x); const x2 = x.clone(); x2.rotation.y = -0.6; o.mark.add(x2); }
        }
      });
    }

    /* 目前那一格：發光、抬高，上面浮一張名牌 */
    const labelCv = document.createElement('canvas'); labelCv.width = 512; labelCv.height = 128;
    const labelTex = new THREE.CanvasTexture(labelCv); labelTex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false }));
    label.scale.set(3.4, 0.85, 1); label.renderOrder = 10; label.visible = false; scene.add(label);
    function paintLabel(i) {
      const t = T[i], c = labelCv.getContext('2d');
      c.clearRect(0, 0, 512, 128);
      const price = t.price ? '  ' + t.price : t.tax ? '  稅 ' + t.tax : '';
      c.font = '900 56px ' + FONT;
      const w = Math.min(500, c.measureText(t.name + price).width + 60);
      pill(c, (512 - w) / 2, 24, w, 80, '#FFFBEF', '#7A4E2A');
      c.fillStyle = '#2E1F14'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(t.name + price, 256, 66, 460);
      labelTex.needsUpdate = true;
    }
    function highlight(tile) {
      if (curTile === tile) return;
      dirty = true;
      if (curTile >= 0) { tileObjs[curTile].topMat.emissive.setHex(0x000000); tileObjs[curTile].grp.position.y = 0; }
      curTile = tile;
      if (tile >= 0) {
        tileObjs[tile].topMat.emissive.setHex(0x6A5510); tileObjs[tile].grp.position.y = 0.08;
        paintLabel(tile);
        label.position.set(TILE_POS[tile].x, 3.0, TILE_POS[tile].z);
        label.visible = true;
      } else label.visible = false;
    }
    const pops = [];
    function pop(tile) { dirty = true; pops.push({ o: tileObjs[tile], t0: performance.now() }); }

    /* ---------- 棋子（形狀＋顏色＋頭上的小動物；輪到誰，腳下有金色光環轉圈） ---------- */
    const toks = [];
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 10, 36), new THREE.MeshBasicMaterial({ color: 0xFFD447 }));
    ring.rotation.x = Math.PI / 2; ring.visible = false; scene.add(ring);
    let activeSeat = -1;
    function setActive(i) { if (activeSeat !== i) { activeSeat = i; dirty = true; } }
    function seatShape(k, color) {
      const m = std(color, { roughness: 0.45 });
      let mesh;
      if (k % 4 === 0) mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.55, 28), m);
      else if (k % 4 === 1) mesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), m);
      else if (k % 4 === 2) mesh = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 3), m);
      else { mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.44), m); mesh.scale.y = 1.25; }
      mesh.position.y = k % 4 === 2 ? 0.4 : k % 4 === 3 ? 0.55 : 0.28;
      return mesh;
    }
    function faceTexture(char, color) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const g = c.getContext('2d');
      function draw(img) {
        g.clearRect(0, 0, 128, 128);
        g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill();
        if (img) { g.save(); g.beginPath(); g.arc(64, 64, 54, 0, 7); g.clip(); g.drawImage(img, 8, 14, 112, 112); g.restore(); }
        g.strokeStyle = color; g.lineWidth = 14; g.beginPath(); g.arc(64, 64, 57, 0, 7); g.stroke();
        tex.needsUpdate = true; dirty = true;
      }
      draw(null);
      cached('a:' + char, () => svgImage(root.Art.animalSvg(char), 256)).then(img => { if (img) draw(img); });
      return tex;
    }
    function setSeats(seats) {
      dirty = true;
      while (toks.length > seats.length) { const t = toks.pop(); scene.remove(t.grp); }
      seats.forEach((s, i) => {
        if (toks[i] && toks[i].char === s.char) return;
        if (toks[i]) scene.remove(toks[i].grp);
        const grp = new THREE.Group();
        grp.add(seatShape(i, COLORS[i]));
        const sh = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
        sh.rotation.x = -Math.PI / 2; sh.position.y = 0.01; grp.add(sh);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: faceTexture(s.char, COLORS[i]), transparent: true }));
        sp.scale.set(1.2, 1.2, 1); sp.position.y = i % 4 === 2 ? 1.5 : 1.42;
        grp.add(sp);
        scene.add(grp);
        const start = TILE_POS[s.pos || 0];
        grp.position.set(start.x, TILE_H, start.z);
        toks[i] = { grp, char: s.char, from: grp.position.clone(), to: grp.position.clone(), t0: 0, dur: 1, arc: 0 };
      });
    }
    function setTok(i, tile, ox, oz, o) {
      const t = toks[i];
      if (!t) return;
      const p = TILE_POS[tile];
      const to = new THREE.Vector3(p.x + (ox || 0) * 1, TILE_H, p.z + (oz || 0) * 1);
      if (t.to.distanceTo(to) < 0.001) return;
      dirty = true;
      t.from = t.grp.position.clone(); t.to = to; t.t0 = performance.now();
      t.dur = Math.max(1, (o && o.dur) || 120);
      t.arc = o && o.jump ? 1.2 : 0.35;
      if (o && o.instant) { t.dur = 1; t.arc = 0; }
    }
    function hideTok(i, hide) { if (toks[i] && toks[i].grp.visible === hide) { toks[i].grp.visible = !hide; dirty = true; } }

    /* ---------- 骰子 ---------- */
    const FACES = [3, 4, 1, 6, 2, 5];      /* +x -x +y -y +z -z，對面相加 7 */
    function pipTexture(n) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#FFFDF4'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#E2CFA5'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
      const P = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[n];
      g.fillStyle = n === 1 ? '#E0483E' : '#3B2A1E';
      P.forEach(([x, y]) => { g.beginPath(); g.arc(64 + x * 32, 64 + y * 32, n === 1 ? 17 : 12, 0, 7); g.fill(); });
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    }
    const dieMats = FACES.map(n => new THREE.MeshStandardMaterial({ map: pipTexture(n), roughness: 0.5 }));
    const dice = [0, 1].map(k => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), dieMats);
      m.position.set(k ? 1 : -1, TILE_H + 0.43, 0.2);
      m.visible = false;
      scene.add(m);
      return { mesh: m, x: k ? 1 : -1, z: 0.2, spin: new THREE.Vector3(), target: null, settle: 0 };
    });
    /* 骰子丟在輪到的棋子前面（往棋盤中央的方向），跟著棋子看就一定看得到 */
    function anchorDice() {
      const t = toks[activeSeat];
      const px = t ? t.grp.position.x : 0, pz = t ? t.grp.position.z : 0;
      const len = Math.hypot(px, pz) || 1;
      const dx = -px / len, dz = -pz / len;
      const cx = t ? px + dx * 2.3 : 0, cz = t ? pz + dz * 2.3 : 0.2;
      const sp = single ? 0 : 0.6;
      dice.forEach((d, k) => { d.x = cx + (k ? 1 : -1) * -dz * sp; d.z = cz + (k ? 1 : -1) * dx * sp; });
    }
    const UP = {
      1: [0, 0, 0], 6: [Math.PI, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2], 2: [-Math.PI / 2, 0, 0], 5: [Math.PI / 2, 0, 0]
    };
    let rolling = false, rollStart = 0, single = false;
    function faceQuat(v, yaw) {
      const e = UP[v] || UP[1];
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2], 'XYZ'));
      const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      return qy.multiply(q);
    }
    function rollBegin(isSingle) {
      dirty = true;
      single = !!isSingle;
      anchorDice();
      rolling = true; rollStart = performance.now();
      dice.forEach((d, k) => { d.mesh.visible = !(single && k === 1); d.spin.set(6 + Math.random() * 6, 5 + Math.random() * 6, 4 + Math.random() * 6); d.settle = 0; d.target = null; });
    }
    function rollEnd(d0, d1) {
      dirty = true;
      rolling = false; shownDice = d0 + ',' + d1;
      single = !d1; anchorDice();
      [d0, d1].forEach((v, k) => { dice[k].settle = performance.now(); dice[k].mesh.visible = !!v; if (v) dice[k].target = faceQuat(v, (Math.random() - 0.5) * 1.2); });
    }
    let shownDice = '';
    function showDice(dv) {
      if (rolling) return;
      const key = dv ? dv[0] + ',' + dv[1] : '';
      if (key === shownDice) return;
      shownDice = key; dirty = true;
      single = !!dv && !dv[1]; anchorDice();
      dice.forEach((d, k) => {
        const v = dv && dv[k];
        d.mesh.visible = !!v;
        if (v) { d.mesh.quaternion.copy(faceQuat(v, k ? 0.3 : -0.25)); d.mesh.position.set(d.x, TILE_H + 0.43, d.z); d.target = null; }
      });
    }

    /* ---------- 相機：拖曳轉動、滾輪／雙指縮放 ---------- */
    let follow = true, zoomGoal = 0.62;
    const cam = { az: 0, el: 1.02, zoom: 0.62, fit: 20, target: new THREE.Vector3(0, 0, 0.4) };
    let w = 1, h = 1;
    function resize() {
      w = Math.max(1, canvas.clientWidth); h = Math.max(1, canvas.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const half = camera.fov * Math.PI / 360;
      const hHalf = Math.atan(Math.tan(half) * camera.aspect);
      cam.fit = 8.3 / Math.tan(Math.min(half * 1.05, hHalf));
      camera.updateProjectionMatrix();
      dirty = true;
      placeBtns();
    }
    function placeCamera() {
      const r = cam.fit * cam.zoom;
      camera.position.set(
        cam.target.x + r * Math.sin(cam.az) * Math.cos(cam.el),
        cam.target.y + r * Math.sin(cam.el),
        cam.target.z + r * Math.cos(cam.az) * Math.cos(cam.el));
      camera.lookAt(cam.target);
    }
    const ptrs = new Map();
    let down = null, pinch = 0;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); down = null; }
    });
    canvas.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) { zoomGoal = Math.min(1.6, Math.max(0.32, zoomGoal * pinch / d)); dirty = true; }
        pinch = d; return;
      }
      if (down) {
        down.moved += Math.abs(dx) + Math.abs(dy);
        if (down.moved > 6) {
          dirty = true;
          cam.az -= dx * 0.008;
          cam.el = Math.min(1.35, Math.max(0.5, cam.el + dy * 0.005));
        }
      }
    });
    function up(e) {
      const wasDown = down;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = 0;
      if (e.type === 'pointerup' && wasDown && wasDown.moved <= 6 && performance.now() - wasDown.t < 500) pick(e);
      if (!ptrs.size) down = null;
    }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { e.preventDefault(); dirty = true; zoomGoal = Math.min(1.6, Math.max(0.32, zoomGoal * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
    canvas.addEventListener('dblclick', () => { dirty = true; cam.az = 0; cam.el = 1.02; zoomGoal = follow ? 0.62 : 1; });
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    function pick(e) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      if (hit && opt.onTile) opt.onTile(hit.object.userData.tile);
    }
    function setView(az) { cam.az = az; }
    function setFollow(on) { follow = !!on; zoomGoal = follow ? 0.62 : 1; dirty = true; syncBtns(); }

    /* 畫面左上角的視角按鈕：跟著棋子／看全圖／轉正 */
    const btns = document.createElement('div');
    btns.className = 'cam-btns';
    btns.innerHTML = '<button type="button" class="btn3d sand small" data-cam="follow">跟著棋子</button>' +
      '<button type="button" class="btn3d sand small" data-cam="all">看全圖</button>' +
      '<button type="button" class="btn3d sand small" data-cam="reset" aria-label="轉回正面">轉正</button>';
    container.appendChild(btns);
    function syncBtns() {
      btns.querySelector('[data-cam="follow"]').setAttribute('aria-pressed', String(follow));
      btns.querySelector('[data-cam="all"]').setAttribute('aria-pressed', String(!follow));
    }
    btns.addEventListener('click', e => {
      const b = e.target.closest('[data-cam]');
      if (!b) return;
      if (b.dataset.cam === 'reset') { cam.az = 0; cam.el = 1.02; dirty = true; }
      else setFollow(b.dataset.cam === 'follow');
    });
    syncBtns();
    function placeBtns() { btns.style.left = (canvas.offsetLeft + 8) + 'px'; btns.style.top = (canvas.offsetTop + 8) + 'px'; }

    /* ---------- 主迴圈 ---------- */
    let raf = 0, dead = false, lastRing = 0;
    const tmp = new THREE.Vector3();
    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      toks.forEach((t, i) => {
        const k = Math.min(1, (now - t.t0) / t.dur);
        const e = k < 1 ? k : 1;
        t.grp.position.lerpVectors(t.from, t.to, e);
        t.grp.position.y = TILE_H + Math.sin(Math.PI * e) * t.arc;
        /* 同一格多顆時，稍微前後擺動，看得出誰是誰 */
      });
      dice.forEach((d, k) => {
        if (rolling && d.mesh.visible) {
          const tt = (now - rollStart) / 1000;
          d.mesh.rotation.x += d.spin.x * 0.016; d.mesh.rotation.y += d.spin.y * 0.016; d.mesh.rotation.z += d.spin.z * 0.016;
          d.mesh.position.set(d.x + Math.sin(tt * 4 + k) * 0.35, TILE_H + 0.43 + Math.abs(Math.sin(tt * 9 + k)) * 1.1, d.z + Math.cos(tt * 5 + k) * 0.3);
        } else if (d.target) {
          const s = Math.min(1, (now - d.settle) / 260);
          d.mesh.quaternion.slerp(d.target, 0.35);
          d.mesh.position.lerp(tmp.set(d.x, TILE_H + 0.43, d.z), 0.3);
          if (s >= 1) { d.mesh.quaternion.copy(d.target); d.target = null; }
        }
      });
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i], k = (now - p.t0) / 600;
        if (k >= 1) { p.o.grp.scale.setScalar(1); pops.splice(i, 1); continue; }
        p.o.grp.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.12);
      }
      const at = toks[activeSeat];
      if (at && at.grp.visible) { ring.visible = true; ring.position.set(at.grp.position.x, TILE_H + 0.05 + (at.grp.position.y - TILE_H), at.grp.position.z); const still = opt.reduce && opt.reduce(); const sc = still ? 1 : 1 + Math.sin(now / 250) * 0.08; ring.scale.set(sc, sc, 1); if (!still && now - lastRing > 45) { lastRing = now; dirty = true; } } else ring.visible = false;
      /* 相機：跟著輪到的棋子（或看全圖），慢慢滑過去 */
      const dtc = Math.min(0.1, (now - (frame.last || now)) / 1000); frame.last = now;
      const ft = toks[activeSeat];
      const gx = follow && ft ? ft.grp.position.x : 0, gz = follow && ft ? ft.grp.position.z : 0.4;
      const kk = 1 - Math.exp(-dtc * 5);
      const ex = gx - cam.target.x, ez = gz - cam.target.z, ez2 = zoomGoal - cam.zoom;
      if (Math.abs(ex) + Math.abs(ez) + Math.abs(ez2) > 0.002) {
        cam.target.x += ex * kk; cam.target.z += ez * kk; cam.zoom += ez2 * kk; dirty = true;
      }
      const moving = rolling || dice.some(d => d.target) || pops.length || toks.some(t => now - t.t0 < t.dur + 40);
      if (dirty || moving) { dirty = false; placeCamera(); renderer.render(scene, camera); }
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    raf = requestAnimationFrame(frame);

    return {
      setTiles, highlight, pop, setSeats, setActive, setFollow, setTok, hideTok, rollBegin, rollEnd, showDice, setView,
      get rolling() { return rolling; },
      /** 格子在畫面上的位置（給飄字用），單位 px，相對於棋盤容器左上角 */
      project(tile, ox, oz, y) {
        const p = TILE_POS[tile];
        const v = new THREE.Vector3(p.x + (ox || 0), y == null ? TILE_H + 0.8 : y, p.z + (oz || 0)).project(camera);
        return { x: (v.x * 0.5 + 0.5) * w + canvas.offsetLeft, y: (-v.y * 0.5 + 0.5) * h + canvas.offsetTop };
      },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        ro.disconnect();
        scene.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
        });
        renderer.dispose();
        canvas.remove(); btns.remove();
      },
      _debug: { cam, scene, toks, camera, get size() { return [w, h]; } }
    };
  }

  root.Board3D = { create, TILE_POS, gridPos };
})(typeof self !== 'undefined' ? self : this);
