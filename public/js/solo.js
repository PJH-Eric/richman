/* ===== solo.js — 單機對電腦 =====
 * 規則全交給 Rules，電腦全交給 AI.createDriver；這裡只負責「可暫停的遊戲時鐘」與畫面串接。
 * 玩家操作 → Rules.act（跟線上伺服器用同一套）→ 把最新的 publicView 交給棋盤播動畫。
 */
(function (root) {
  'use strict';
  const { $ } = root.UI;
  let game = null;

  function start(cfg) {
    stop();
    const R = root.Rules;
    const others = root.Art.ANIMALS.filter(a => a.id !== cfg.char);
    /* 電腦的角色隨機挑，不跟玩家撞 */
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    const diffs = (cfg.aiDiffs && cfg.aiDiffs.length ? cfg.aiDiffs : [cfg.difficulty || 'normal']).slice(0, cfg.aiCount);
    while (diffs.length < cfg.aiCount) diffs.push(diffs[diffs.length - 1]);
    cfg.aiDiffs = diffs;
    cfg.kind = diffs.every(d => d === diffs[0]) ? diffs[0] : 'mixed';
    const players = [{ id: 'me', name: cfg.name, char: cfg.char }];
    for (let i = 0; i < cfg.aiCount; i++) players.push({ id: 'ai' + i, name: others[i].name, char: others[i].id, ai: diffs[i] });
    const seed = root.RNG.newSeed();
    /* 動作節奏跟著最簡單的電腦：有幼幼班電腦在，小朋友也跟得上 */
    const easiest = R.DIFFICULTY_LIST.find(k => diffs.includes(k)) || 'normal';
    const state = R.create(players, { seed, pace: R.DIFFICULTIES[easiest].pace, now: 0, roundLimit: cfg.roundLimit, turnMs: 0 });
    const driver = root.AI.createDriver(seed + '-ai');
    const ui = root.App.modals;
    game = {
      cfg, state, driver,
      clock: 0, last: performance.now(), paused: false, raf: 0, timer: 0, ended: false, drawn: -1,
      board: root.Board.create($('#board'), $('#summary'), {
        myId: 'me', solo: true,
        settings: () => root.App.store,
        onAct: a => act(a),
        manage: ui.manage, tile: ui.tile
      })
    };
    root.UI.chat.enabled = false;
    draw();
    loop();
    /* 背景分頁 rAF 會停；回來時自動暫停，避免電腦自己玩完 */
    game.timer = setInterval(() => { if (game && !game.paused && document.hidden) pause(true); }, 500);
  }

  function loop() {
    if (!game) return;
    const now = performance.now();
    const dt = Math.min(100, now - game.last);   /* 卡頓時不要一口氣快轉 */
    game.last = now;
    if (!game.paused && !game.ended) { game.clock += dt; step(); }
    game.raf = requestAnimationFrame(loop);
  }

  function step() {
    const g = game, R = root.Rules;
    let changed = R.tick(g.state, g.clock);
    /* 動畫還在播就先不讓電腦動，玩家看得清楚每一步 */
    if (!g.board._debug.busy) {
      for (const a of g.driver.actions(g.state, g.clock)) {
        const r = R.act(g.state, a.id, a.action, g.clock, { ai: true });
        if (r.ok) changed = true;
      }
    }
    if (changed || g.state.version !== g.drawn) draw();
  }

  function act(a) {
    if (!game || game.paused || game.ended) { if (game) game.board.render(root.Rules.publicView(game.state, game.clock)); return; }
    const r = root.Rules.act(game.state, 'me', a, game.clock);
    if (!r.ok && r.text) root.UI.toast(r.text, 'bad');
    draw(true);
  }

  function draw(force) {
    if (!game) return;
    const v = root.Rules.publicView(game.state, game.clock);
    game.drawn = game.state.version;
    game.board.render(v);
    if (v.phase === 'over' && !game.ended) {
      game.ended = true;
      waitIdle(() => showResult(v));
    }
  }
  /* 等最後一段動畫播完再出結算 */
  function waitIdle(fn) {
    const g = game;
    const t = setInterval(() => {
      if (game !== g) { clearInterval(t); return; }
      if (!g.board._debug.busy) { clearInterval(t); setTimeout(() => { if (game === g) fn(); }, 700); }
    }, 150);
  }

  function showResult(v) {
    if (!game) return;
    const win = v.winner === game.board.mySeat;
    root.Store.record(root.App.store, game.cfg.kind, win);
    root.Sound.sfx(win ? 'win' : 'lose');
    const st = root.App.store.stats[game.cfg.kind] || { play: 0, win: 0 };
    const diffName = game.cfg.kind === 'mixed' ? '混合難度' : root.Rules.DIFFICULTIES[game.cfg.kind].name;
    const box = $('#result');
    box.innerHTML = root.Board.resultHtml(v, 'me', '一共玩了 ' + v.round + ' 回合｜' + diffName + '：玩了 ' + st.play + ' 局、贏 ' + st.win + ' 局');
    $('#result-actions').innerHTML =
      '<button type="button" class="btn3d coral" id="res-again">再來一局</button>' +
      '<button type="button" class="btn3d sand" id="res-home">回首頁</button>';
    box.hidden = false;
    $('#res-again').onclick = () => { box.hidden = true; start(game.cfg); };
    $('#res-home').onclick = () => { box.hidden = true; stop(); root.UI.show('home'); };
    $('#res-again').focus({ preventScroll: true });
  }

  /** silent：只停時鐘不開選單（例如打開設定彈窗時） */
  function pause(auto, silent, from) {
    if (!game || game.ended || game.paused) return;
    game.paused = true;
    if (!silent) root.App.openMenu(auto, from);
  }
  function resume() {
    if (!game) return;
    game.paused = false;
    game.last = performance.now();
  }
  function stop() {
    if (!game) return;
    cancelAnimationFrame(game.raf);
    clearInterval(game.timer);
    game.board.destroy();
    game = null;
  }
  /** 給自動化測試用：不畫畫面、直接快轉遊戲時間；human=true 時替玩家自動做「最該做的事」 */
  function fastForward(ms, human) {
    const g = game, R = root.Rules;
    if (!g || g.ended) return;
    const end = g.clock + ms;
    while (g.clock < end && g.state.phase !== 'over') {
      g.clock += 100;
      R.tick(g.state, g.clock);
      for (const a of g.driver.actions(g.state, g.clock)) R.act(g.state, a.id, a.action, g.clock, { ai: true });
      if (human && g.state.seats[g.state.turn].id === 'me') {
        const o = R.options(g.state, 'me');
        const a = o.roll ? 'roll' : o.buy ? 'buy' : g.state.phase === 'buy' || g.state.phase === 'build' ? 'decline' : o.settle ? 'settle' : o.endTurn ? 'endTurn' : o.bankrupt ? 'bankrupt' : null;
        if (a) R.act(g.state, 'me', { type: a }, g.clock);
      }
    }
    draw();
  }
  root.Solo = {
    fastForward, start, stop, pause, resume,
    primary() { return game && !game.paused ? game.board.primary() : false; },
    get active() { return !!game; },
    get paused() { return !!(game && game.paused); },
    restart() { if (game) { const c = game.cfg; start(c); } },
    redraw() { if (game) draw(true); },
    get board() { return game && game.board; },
    /* 給自動化測試用：直接拿到規則狀態 */
    get _debug() { return game; }
  };
})(typeof self !== 'undefined' ? self : this);
