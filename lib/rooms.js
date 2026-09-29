/* ===== lib/rooms.js — 房間、席位、觀戰、邀請、聊天、權威對局（純邏輯，不碰 socket） =====
 *
 * 伺服器持有一切：座位順序、骰子、機會命運牌堆、現金與地產、回合計時與勝負。
 * 用戶端只送「擲骰、買、蓋房……」這類意圖；輪不輪得到你、合不合法都由 Rules.act 判斷。
 * 送給用戶端的只有 Rules.publicView()：seed 與牌堆順序永遠不出伺服器。
 *
 * 時間一律由呼叫端帶 now 進來，測試可以用假時鐘把一整局快轉跑完。
 */
'use strict';

const crypto = require('crypto');
const Rules = require('../public/js/rules.js');
const AI = require('../public/js/ai.js');
const RNG = require('../public/js/rng.js');

const CONST = {
  MAX_SPECTATORS: 20,
  RECONNECT_MS: 30000,      /* 斷線保留席位多久 */
  OVER_HOLD_MS: 2500,       /* 對局結束後多久收回房間（讓大家看完最後的畫面） */
  CHAT_MAX: 60,
  CHAT_KEEP: 50,
  CHAT_GAP_MS: 600,
  KICK_BAN_MS: 5 * 60 * 1000,
  NAME_MAX: 10
};
const PACE_LIST = ['slow', 'normal', 'fast'];
const TURN_MS = { slow: 90000, normal: 60000, fast: 40000 };   /* 每一步的思考時間，超過就由電腦代打 */
const DIFFS = Rules.DIFFICULTY_LIST;
const CHARS = ['otter', 'bunny', 'capybara', 'penguin', 'shiba', 'turtle', 'koala', 'cat'];
const CHAR_NAMES = { otter: '水獺', bunny: '兔兔', capybara: '水豚', penguin: '企鵝', shiba: '柴柴', turtle: '海龜', koala: '無尾熊', cat: '貓咪' };

function token(n) { return crypto.randomBytes(n || 9).toString('base64url'); }
function roomCode(taken) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let s = '';
    for (let i = 0; i < 4; i++) s += A[crypto.randomInt(A.length)];
    if (!taken.has(s)) return s;
  }
}
function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, CONST.NAME_MAX);
}
function cleanChar(c) { return CHARS.includes(c) ? c : 'otter'; }

function createHub(opt) {
  opt = opt || {};
  const now0 = () => (opt.now ? opt.now() : Date.now());
  const rooms = new Map();
  /** personId → person（連線斷了也會暫留，給重連用） */
  const persons = new Map();
  /** key → personId（瀏覽器記住的身分鑰匙） */
  const byKey = new Map();

  /* ---------- 身分 ---------- */

  function identify(key, name, char) {
    let p = key && byKey.has(key) ? persons.get(byKey.get(key)) : null;
    if (!p) {
      p = { id: 'p' + token(6), key: key && String(key).length >= 8 ? String(key).slice(0, 64) : token(12),
        name: '', char: 'otter', roomId: null, online: true, offlineSince: 0, lastChat: 0 };
      persons.set(p.id, p);
      byKey.set(p.key, p.id);
    }
    p.online = true;
    p.offlineSince = 0;
    if (name != null) p.name = cleanName(name) || p.name || randomName();
    if (!p.name) p.name = randomName();
    if (char != null) p.char = cleanChar(char);
    const room = p.roomId ? rooms.get(p.roomId) : null;
    if (room) {
      const seat = room.seats.find(s => s.personId === p.id);
      if (seat && room.game) {
        const gs = room.game.state.seats.find(s => s.id === p.id);
        if (gs) gs.ai = null;          /* 回來了，拿回自己的位子（電腦代打結束） */
      }
      room.changed = true;
    } else p.roomId = null;
    return p;
  }

  function randomName() {
    const adj = ['開心', '快手', '小小', '圓滾滾', '愛笑', '勇敢', '機靈', '陽光', '悠哉', '閃亮'];
    const n = CHARS[crypto.randomInt(CHARS.length)];
    return adj[crypto.randomInt(adj.length)] + CHAR_NAMES[n];
  }

  function markOffline(personId) {
    const p = persons.get(personId);
    if (!p) return;
    p.online = false;
    p.offlineSince = now0();
    const room = p.roomId ? rooms.get(p.roomId) : null;
    if (room) {
      room.changed = true;
      sys(room, p.name + ' 斷線了，' + Math.round(CONST.RECONNECT_MS / 1000) + ' 秒內回來還能接著玩');
    }
  }

  /* ---------- 房間 ---------- */

  function err(text, code) { return { ok: false, error: text, code: code || 'bad' }; }

  function createRoom(p, o) {
    o = o || {};
    if (p.roomId) leave(p);
    const id = roomCode(new Set(rooms.keys()));
    const max = Math.min(Rules.MAX_PLAYERS, Math.max(Rules.MIN_PLAYERS, Number(o.max) || 4));
    const room = {
      id,
      name: cleanName(o.name) || (p.name + '的牌桌'),
      hostId: p.id,
      max,
      pace: PACE_LIST.includes(o.pace) ? o.pace : 'normal',
      aiDiff: DIFFS.includes(o.aiDiff) ? o.aiDiff : 'normal',
      roundLimit: Rules.ROUND_LIMITS.includes(Number(o.roundLimit)) ? Number(o.roundLimit) : 30,
      map: Rules.MAPS.has(o.map) ? o.map : Rules.MAPS.DEFAULT,
      seats: [],            /* [{ kind:'human', personId, ready } | { kind:'ai', id, name, char, diff }] */
      specs: [],            /* personId[] */
      invite: { token: token(9), active: true },
      chat: [],
      kicked: new Map(),
      game: null,
      lastGame: null,
      createdAt: now0(),
      changed: true,
      aiSeq: 0
    };
    rooms.set(id, room);
    seatHuman(room, p);
    sys(room, p.name + ' 開了這張牌桌');
    return { ok: true, room };
  }

  function seatHuman(room, p) {
    room.seats.push({ kind: 'human', personId: p.id, ready: false });
    p.roomId = room.id;
    room.changed = true;
  }

  function humanSeats(room) { return room.seats.filter(s => s.kind === 'human'); }
  function roleOf(room, pid) {
    if (room.seats.some(s => s.kind === 'human' && s.personId === pid)) return 'player';
    if (room.specs.includes(pid)) return 'spectator';
    return null;
  }

  /**
   * 加入房間。as：'player' 想上桌，'spectator' 觀戰。
   * 對局中或座位滿了，想上桌的人會轉成觀戰並清楚告知（不會默默被當成玩家）。
   */
  function join(p, roomId, as, inviteToken) {
    const room = rooms.get(String(roomId || '').toUpperCase());
    if (!room) return err('這個房間已經關閉了', 'gone');
    const ban = room.kicked.get(p.id);
    if (ban && ban > now0()) return err('你被房主請出這個房間，晚點再來吧', 'kicked');
    if (p.roomId === room.id) return { ok: true, room, role: roleOf(room, p.id), note: null };
    if (p.roomId) leave(p);

    let note = null;
    let role = as === 'spectator' ? 'spectator' : 'player';
    if (role === 'player' && room.game) { role = 'spectator'; note = '這桌正在對局中，先幫你安排觀戰，下一局可以換上桌'; }
    if (role === 'player' && room.seats.length >= room.max) { role = 'spectator'; note = '座位已經滿了，先幫你安排觀戰'; }
    if (role === 'spectator' && room.specs.length >= CONST.MAX_SPECTATORS) return err('觀戰席已滿', 'spec-full');

    if (role === 'player') seatHuman(room, p);
    else { room.specs.push(p.id); p.roomId = room.id; }
    room.changed = true;
    sys(room, p.name + (role === 'player' ? ' 上桌了' : ' 來觀戰') + (inviteToken ? '（邀請連結）' : ''));
    return { ok: true, room, role, note };
  }

  /** 用邀請連結加入：先驗證 token，再走一般加入流程 */
  function joinByInvite(p, tok, as) {
    const t = String(tok || '');
    for (const room of rooms.values()) {
      if (room.invite.token === t) {
        if (!room.invite.active) return err('這個邀請連結已經被房主撤銷了', 'revoked');
        return join(p, room.id, as, t);
      }
    }
    return err('邀請連結無效，或房間已經結束了', 'invalid');
  }

  function inviteInfo(tok) {
    for (const room of rooms.values()) {
      if (room.invite.token === String(tok || '')) {
        if (!room.invite.active) return err('這個邀請連結已經被房主撤銷了', 'revoked');
        return { ok: true, id: room.id, name: room.name, playing: !!room.game, seats: room.seats.length, max: room.max };
      }
    }
    return err('邀請連結無效，或房間已經結束了', 'invalid');
  }

  function leave(p, silent) {
    const room = p.roomId ? rooms.get(p.roomId) : null;
    p.roomId = null;
    if (!room) return { ok: true };
    const wasPlayer = room.seats.findIndex(s => s.kind === 'human' && s.personId === p.id);
    room.specs = room.specs.filter(id => id !== p.id);
    if (wasPlayer >= 0) {
      if (room.game) {
        /* 對局中離開：位子交給電腦代打，牌照樣在，這局照常進行 */
        const gs = room.game.state.seats.find(s => s.id === p.id);
        if (gs) gs.ai = 'normal';
        room.seats[wasPlayer].left = true;
      } else room.seats.splice(wasPlayer, 1);
    }
    if (!silent) sys(room, p.name + ' 離開了');
    if (room.hostId === p.id) pickHost(room);
    room.changed = true;
    closeIfEmpty(room, true);
    return { ok: true };
  }

  function pickHost(room) {
    const cand = humanSeats(room).filter(s => !s.left).map(s => persons.get(s.personId)).filter(x => x && x.online)
      .concat(room.specs.map(id => persons.get(id)).filter(x => x && x.online));
    room.hostId = cand.length ? cand[0].id : null;
    if (cand.length) sys(room, cand[0].name + ' 成為新房主');
  }

  function membersOf(room) {
    return humanSeats(room).filter(s => !s.left).map(s => s.personId).concat(room.specs);
  }

  function closeIfEmpty(room, immediate) {
    /* 只算實體玩家：AI 席位與觀戰者都不能讓房間繼續存在 */
    const ms = humanSeats(room).filter(s => !s.left).map(s => persons.get(s.personId)).filter(Boolean);
    const anyOnline = ms.some(m => m.online);
    const anyWaiting = ms.some(m => !m.online && now0() - m.offlineSince < CONST.RECONNECT_MS);
    if (!anyOnline && (immediate ? !anyWaiting : !anyWaiting)) {
      closeRoom(room);
      return true;
    }
    return false;
  }

  function closeRoom(room) {
    room.invite.active = false;     /* 邀請連結跟著房間一起失效 */
    rooms.delete(room.id);
    room.game = null;               /* 對局計時器與電腦不再運作 */
    const ids = membersOf(room).concat(room.specs);
    if (opt.onClosed) opt.onClosed(room, [...new Set(ids)]);
    for (const id of membersOf(room)) {
      const p = persons.get(id);
      if (p && p.roomId === room.id) p.roomId = null;
    }
    room.closed = true;
  }

  function isHost(room, p) { return room.hostId === p.id; }

  function setReady(p, ready) {
    const room = rooms.get(p.roomId);
    if (!room || room.game) return err('現在不能切換準備');
    const s = room.seats.find(x => x.kind === 'human' && x.personId === p.id);
    if (!s) return err('觀戰者不用準備');
    s.ready = !!ready;
    room.changed = true;
    return { ok: true };
  }

  function switchRole(p, to) {
    const room = rooms.get(p.roomId);
    if (!room) return err('你不在房間裡');
    if (room.game) return err('對局中不能換位子，等這局結束吧');
    const role = roleOf(room, p.id);
    if (to === role) return { ok: true };
    if (to === 'player') {
      if (room.seats.length >= room.max) return err('座位已經滿了');
      room.specs = room.specs.filter(id => id !== p.id);
      seatHuman(room, p);
      sys(room, p.name + ' 上桌了');
    } else {
      if (room.specs.length >= CONST.MAX_SPECTATORS) return err('觀戰席已滿');
      room.seats = room.seats.filter(s => !(s.kind === 'human' && s.personId === p.id));
      room.specs.push(p.id);
      sys(room, p.name + ' 改成觀戰');
    }
    room.changed = true;
    return { ok: true };
  }

  function settings(p, o) {
    const room = rooms.get(p.roomId);
    if (!room || !isHost(room, p)) return err('只有房主可以改房間設定');
    if (room.game) return err('對局中不能改設定');
    if (o.max != null) {
      const max = Math.min(Rules.MAX_PLAYERS, Math.max(Rules.MIN_PLAYERS, Number(o.max) || 4));
      if (max < room.seats.length) return err('桌上已經有 ' + room.seats.length + ' 人，先請人下桌或移除電腦');
      room.max = max;
    }
    if (o.pace && PACE_LIST.includes(o.pace)) room.pace = o.pace;
    if (o.aiDiff && DIFFS.includes(o.aiDiff)) room.aiDiff = o.aiDiff;
    if (o.roundLimit != null && Rules.ROUND_LIMITS.includes(Number(o.roundLimit))) {
      if (Number(o.roundLimit) !== room.roundLimit) sys(room, '房主把回合上限改成「' + (Number(o.roundLimit) ? Number(o.roundLimit) + ' 回合' : '沒有上限') + '」');
      room.roundLimit = Number(o.roundLimit);
    }
    if (o.map && Rules.MAPS.has(o.map) && o.map !== room.map) {
      room.map = o.map;
      sys(room, '房主把地圖換成「' + Rules.MAPS.get(o.map).name + '」（' + Rules.MAPS.get(o.map).size + ' 格）');
    }
    if (o.name != null) room.name = cleanName(o.name) || room.name;
    room.changed = true;
    return { ok: true };
  }

  function addAI(p, diff) {
    const room = rooms.get(p.roomId);
    if (!room || !isHost(room, p)) return err('只有房主可以加電腦');
    if (room.game) return err('對局中不能加電腦');
    if (room.seats.length >= room.max) return err('座位已經滿了');
    const used = new Set(room.seats.map(s => s.kind === 'ai' ? s.char : (persons.get(s.personId) || {}).char));
    const char = CHARS.find(c => !used.has(c)) || CHARS[crypto.randomInt(CHARS.length)];
    const d = DIFFS.includes(diff) ? diff : room.aiDiff;
    room.seats.push({ kind: 'ai', id: 'ai-' + (++room.aiSeq), name: '電腦' + CHAR_NAMES[char], char, diff: d });
    room.changed = true;
    return { ok: true };
  }

  /** 房主替某一個電腦換難度（每個電腦可以不一樣） */
  function setAIDiff(p, id, diff) {
    const room = rooms.get(p.roomId);
    if (!room || !isHost(room, p)) return err('只有房主可以調整電腦難度');
    if (room.game) return err('對局中不能調整電腦難度');
    if (!DIFFS.includes(diff)) return err('沒有這個難度');
    const s = room.seats.find(x => x.kind === 'ai' && x.id === id);
    if (!s) return err('找不到這個電腦');
    s.diff = diff;
    room.changed = true;
    return { ok: true };
  }

  function removeAI(p, id) {
    const room = rooms.get(p.roomId);
    if (!room || !isHost(room, p)) return err('只有房主可以移除電腦');
    if (room.game) return err('對局中不能移除電腦');
    room.seats = room.seats.filter(s => !(s.kind === 'ai' && s.id === id));
    room.changed = true;
    return { ok: true };
  }

  function kick(p, targetId) {
    const room = rooms.get(p.roomId);
    if (!room || !isHost(room, p)) return err('只有房主可以請人離開');
    if (targetId === p.id) return err('不能請自己離開');
    const t = persons.get(targetId);
    if (!t || t.roomId !== room.id) return err('這個人已經不在房間裡');
    room.kicked.set(t.id, now0() + CONST.KICK_BAN_MS);
    sys(room, t.name + ' 被房主請出房間');
    leave(t, true);
    return { ok: true, kicked: t.id };
  }

  function regenInvite(p, revokeOnly) {
    const room = rooms.get(p.roomId);
    if (!room || !isHost(room, p)) return err('只有房主可以管理邀請連結');
    if (revokeOnly) room.invite.active = false;
    else room.invite = { token: token(9), active: true };
    sys(room, revokeOnly ? '房主撤銷了邀請連結' : '房主重發了新的邀請連結（舊連結失效）');
    room.changed = true;
    return { ok: true };
  }

  function chat(p, text) {
    const room = rooms.get(p.roomId);
    if (!room) return err('你不在房間裡');
    const t = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, CONST.CHAT_MAX);
    if (!t) return err('訊息是空的');
    const now = now0();
    if (now - p.lastChat < CONST.CHAT_GAP_MS) return err('講太快了，喘口氣再說', 'rate');
    p.lastChat = now;
    const m = { id: token(4), name: p.name, char: p.char, text: t, spec: roleOf(room, p.id) === 'spectator', at: now };
    pushChat(room, m);
    return { ok: true, msg: m };
  }

  function sys(room, text) { pushChat(room, { id: token(4), system: true, text, at: now0() }); }
  function pushChat(room, m) {
    room.chat.push(m);
    if (room.chat.length > CONST.CHAT_KEEP) room.chat.shift();
    room.changed = true;
    room.chatSeq = (room.chatSeq || 0) + 1;
  }

  /* ---------- 對局 ---------- */

  function startGame(p) {
    const room = rooms.get(p.roomId);
    if (!room || !isHost(room, p)) return err('只有房主可以開局');
    if (room.game) return err('已經在對局中了');
    if (room.seats.length < Rules.MIN_PLAYERS) return err('至少要 2 個人（可以加電腦）才能開局');
    const notReady = humanSeats(room).filter(s => s.personId !== p.id && !s.ready)
      .map(s => (persons.get(s.personId) || {}).name);
    if (notReady.length) return err('還在等 ' + notReady.join('、') + ' 按準備好');
    const offline = humanSeats(room).map(s => persons.get(s.personId)).filter(x => !x || !x.online);
    if (offline.length) return err('有玩家斷線中，等他回來或請他離開');

    const players = room.seats.map(s => s.kind === 'ai'
      ? { id: s.id, name: s.name, char: s.char, ai: s.diff }
      : { id: s.personId, name: persons.get(s.personId).name, char: persons.get(s.personId).char });
    const seed = RNG.newSeed();
    const now = now0();
    const state = Rules.create(players, { seed, pace: room.pace, now, roundLimit: room.roundLimit, turnMs: TURN_MS[room.pace], map: room.map });
    room.game = { state, driver: AI.createDriver(seed + '-ai'), startedAt: now };
    room.lastGame = null;
    sys(room, '開局！系統排好順序，由 ' + state.seats[0].name + ' 先擲骰子');
    room.changed = true;
    return { ok: true };
  }

  /** 玩家在對局中的任何操作：擲骰、買、蓋房、抵押、收購、結束回合…… */
  function gameAct(p, action) {
    const room = rooms.get(p.roomId);
    if (!room || !room.game) return err('現在沒有對局', 'no-game');
    if (roleOf(room, p.id) !== 'player') return err('觀戰者不能操作', 'spectator');
    if (!action || typeof action.type !== 'string') return err('看不懂這個操作');
    const clean = { type: String(action.type).slice(0, 16) };
    if (action.tile != null) clean.tile = Number(action.tile) | 0;
    if (typeof action.item === 'string') clean.item = action.item.slice(0, 12);
    if (action.n != null) clean.n = Number(action.n) | 0;
    if (action.target != null) clean.target = Number(action.target) | 0;
    const r = Rules.act(room.game.state, p.id, clean, now0());
    if (r.ok) { room.changed = true; return { ok: true }; }
    const TEXT = { 'not-your-turn': '還沒輪到你', 'bad-phase': '現在不能做這件事', 'no-cash': '現金不夠', over: '這局已經結束了', illegal: r.text };
    return err(TEXT[r.reason] || '做不到', r.reason);
  }

  /** 每 30～50ms 呼叫一次：推進所有對局、電腦出手、清理斷線太久的人與空房 */
  function tick(now) {
    now = now == null ? now0() : now;
    for (const room of [...rooms.values()]) {
      const g = room.game;
      if (g) {
        /* 斷線超過保留時間 → 電腦代打（回來就還給他） */
        for (const s of g.state.seats) {
          const p = persons.get(s.id);
          if (p && !s.ai && !p.online && now - p.offlineSince >= CONST.RECONNECT_MS && !s.bankrupt) {
            s.ai = 'normal';
            sys(room, p.name + ' 斷線太久，先由電腦代打');
          }
        }
        let changed = Rules.tick(g.state, now);
        for (const a of g.driver.actions(g.state, now)) {
          const r = Rules.act(g.state, a.id, a.action, now, { ai: true });
          if (r.ok) changed = true;
        }
        if (changed) room.changed = true;
        if (g.state.phase === 'over' && !g.overAt) { g.overAt = now; room.changed = true; }
        if (g.overAt && now - g.overAt > CONST.OVER_HOLD_MS) endGame(room, now);
      }
      /* 斷線太久的人：等待中就讓出座位 */
      if (!room.game) {
        const before = room.seats.length + room.specs.length;
        room.seats = room.seats.filter(s => {
          if (s.kind !== 'human') return true;
          const p = persons.get(s.personId);
          const gone = !p || s.left || (!p.online && now - p.offlineSince >= CONST.RECONNECT_MS);
          if (gone && p && p.roomId === room.id) p.roomId = null;
          return !gone;
        });
        room.specs = room.specs.filter(id => {
          const p = persons.get(id);
          const gone = !p || (!p.online && now - p.offlineSince >= CONST.RECONNECT_MS);
          if (gone && p && p.roomId === room.id) p.roomId = null;
          return !gone;
        });
        if (room.seats.length + room.specs.length !== before) {
          room.changed = true;
          if (!membersOf(room).includes(room.hostId)) pickHost(room);
        }
      }
      const host = persons.get(room.hostId);
      if (!host || (!host.online && now - host.offlineSince >= CONST.RECONNECT_MS) || host.roomId !== room.id) pickHost(room);
      closeIfEmpty(room, false);
    }
    /* 斷線太久又不在任何房間的身分就丟掉 */
    for (const p of [...persons.values()]) {
      if (!p.online && !p.roomId && now - p.offlineSince > CONST.RECONNECT_MS * 2) {
        persons.delete(p.id);
        byKey.delete(p.key);
      }
    }
  }

  function endGame(room, now) {
    const g = room.game;
    const view = Rules.publicView(g.state, now);
    room.lastGame = view;
    const w = g.state.seats[g.state.winner];
    sys(room, w.name + ' 獲勝！按準備好可以再來一局');
    room.game = null;
    /* 中途離開的人這時才真的讓出座位；大家重新按準備 */
    room.seats = room.seats.filter(s => !s.left);
    for (const s of room.seats) if (s.kind === 'human') s.ready = false;
    room.changed = true;
  }

  /* ---------- 對外的畫面資料 ---------- */

  function listRooms() {
    return [...rooms.values()].map(r => ({
      id: r.id, name: r.name, players: r.seats.length, max: r.max,
      specs: r.specs.length, playing: !!r.game, pace: r.pace, roundLimit: r.roundLimit, map: r.map,
      host: (persons.get(r.hostId) || {}).name || ''
    })).sort((a, b) => (a.playing - b.playing) || (b.players - a.players));
  }

  /** 某個人看到的房間畫面；房主多拿邀請管理權，其他人只拿可分享的連結 */
  function roomView(room, pid, now) {
    now = now == null ? now0() : now;
    const role = roleOf(room, pid);
    const takeover = {};
    if (room.game) for (const s of room.game.state.seats) if (s.ai && persons.has(s.id)) takeover[s.id] = true;
    return {
      id: room.id, name: room.name, max: room.max, pace: room.pace, aiDiff: room.aiDiff, roundLimit: room.roundLimit, map: room.map,
      hostId: room.hostId, you: { id: pid, role, host: room.hostId === pid },
      seats: room.seats.map(s => {
        if (s.kind === 'ai') return { kind: 'ai', id: s.id, name: s.name, char: s.char, diff: s.diff };
        const p = persons.get(s.personId) || {};
        return { kind: 'human', id: s.personId, name: p.name, char: p.char, ready: s.ready, online: !!p.online, left: !!s.left, takeover: !!takeover[s.personId] };
      }),
      specs: room.specs.map(id => { const p = persons.get(id) || {}; return { id, name: p.name, char: p.char, online: !!p.online }; }),
      invite: room.invite.active ? { token: room.invite.token, active: true } : { token: null, active: false },
      game: room.game ? Rules.publicView(room.game.state, now) : null,
      lastGame: room.lastGame,
      chat: room.chat.slice(-CONST.CHAT_KEEP),
      chatSeq: room.chatSeq || 0
    };
  }

  return {
    CONST, rooms, persons, identify, markOffline, createRoom, join, joinByInvite, inviteInfo, leave,
    setReady, switchRole, settings, addAI, setAIDiff, removeAI, kick, regenInvite, chat, startGame, gameAct,
    tick, listRooms, roomView, membersOf, roleOf
  };
}

module.exports = { createHub, CONST, PACE_LIST, TURN_MS };
