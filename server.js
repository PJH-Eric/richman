/* ===== server.js — 靜態檔案 ＋ 房間伺服器（零依賴） =====
 *
 * 靜態檔案用 Node 內建 http，連線用自己寫的 lib/ws.js（原生 WebSocket），
 * 整個專案不需要 npm install：雙擊「啟動遊戲.bat」就能玩，丟到 Render 也一樣。
 *
 *   lib/rooms.js   房間、席位、觀戰、邀請、聊天、權威對局（純邏輯）
 *   這一支          HTTP、WebSocket、訊息分派與廣播
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ws = require('./lib/ws.js');
const Rules = require('./public/js/rules.js');
const { createHub } = require('./lib/rooms.js');

const PORT = Number(process.env.PORT) || 3100;
const ROOT = path.join(__dirname, 'public');
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const GAME_ID = 'richman';
const TICK_MS = 30;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function createServer(opt) {
  opt = opt || {};
  const hub = createHub({ now: opt.now });
  /** personId → socket */
  const sockets = new Map();
  /** 在大廳看列表的連線（還沒進房） */
  const lobby = new Set();

  function send(pid, msg) {
    const s = sockets.get(pid);
    if (s && s.alive) s.sendJSON(msg);
  }

  function counts() {
    let players = 0, spectators = 0;
    for (const r of hub.rooms.values()) {
      players += r.seats.filter(s => s.kind === 'human').length;
      spectators += r.specs.length;
    }
    return { players, spectators };
  }

  /* ---------- HTTP ---------- */

  const server = http.createServer((req, res) => {
    let url = '/';
    try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { url = '/'; }
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);

    if (url === '/health') {
      const c = counts();
      return json(res, 200, { ok: true, game: GAME_ID, rooms: hub.rooms.size, players: c.players, spectators: c.spectators,
        online: sockets.size, difficulties: Rules.DIFFICULTY_LIST, time: Date.now() });
    }
    if (url === '/api/presence') {
      const c = counts();
      return json(res, 200, { gameId: GAME_ID, online: sockets.size, players: c.players, spectators: c.spectators,
        lobby: lobby.size, rooms: hub.rooms.size, updatedAt: new Date().toISOString() });
    }
    if (url === '/api/rooms') return json(res, 200, { rooms: hub.listRooms() });

    if (url === '/') url = '/index.html';
    const file = path.join(ROOT, path.normalize(url).replace(/^([/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('找不到這個檔案'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  });

  /* ---------- 廣播 ---------- */

  let lobbyDirty = true;
  function flush() {
    const now = opt.now ? opt.now() : Date.now();
    for (const room of hub.rooms.values()) {
      if (!room.changed) continue;
      room.changed = false;
      lobbyDirty = true;
      for (const pid of hub.membersOf(room)) send(pid, { type: 'room', room: hub.roomView(room, pid, now) });
    }
    if (lobbyDirty) {
      lobbyDirty = false;
      const list = hub.listRooms();
      for (const pid of lobby) send(pid, { type: 'lobby', rooms: list });
    }
  }

  function pushRoomTo(p) {
    const room = p.roomId ? hub.rooms.get(p.roomId) : null;
    if (room) send(p.id, { type: 'room', room: hub.roomView(room, p.id) });
    else send(p.id, { type: 'room', room: null });
  }

  /* ---------- 訊息 ---------- */

  function handle(sock, msg) {
    if (!msg || typeof msg.type !== 'string') return;
    let p = sock.data.person;

    if (msg.type === 'hello') {
      p = hub.identify(msg.key, msg.name, msg.char);
      const old = sockets.get(p.id);
      if (old && old !== sock) { old.data.replaced = true; old.sendJSON({ type: 'replaced' }); old.close(); }
      sock.data.person = p;
      sockets.set(p.id, sock);
      if (!p.roomId) lobby.add(p.id); else lobby.delete(p.id);
      send(p.id, { type: 'welcome', personId: p.id, key: p.key, name: p.name, char: p.char, roomId: p.roomId });
      send(p.id, { type: 'lobby', rooms: hub.listRooms() });
      pushRoomTo(p);
      return;
    }
    if (!p) return;             /* 還沒 hello 就送其他訊息：忽略 */

    const reply = (r, okMsg) => {
      if (!r.ok) send(p.id, { type: 'error', text: r.error || '做不到', code: r.code, req: msg.type });
      else if (okMsg) send(p.id, okMsg);
    };
    const afterRoomChange = () => {
      if (p.roomId) lobby.delete(p.id); else lobby.add(p.id);
      pushRoomTo(p);
      lobbyDirty = true;
    };

    switch (msg.type) {
      case 'profile':
        hub.identify(p.key, msg.name, msg.char);
        send(p.id, { type: 'welcome', personId: p.id, key: p.key, name: p.name, char: p.char, roomId: p.roomId });
        break;
      case 'lobby':
        send(p.id, { type: 'lobby', rooms: hub.listRooms() });
        break;
      case 'create': {
        const r = hub.createRoom(p, msg);
        reply(r);
        afterRoomChange();
        break;
      }
      case 'join': {
        const r = msg.invite ? hub.joinByInvite(p, msg.invite, msg.as) : hub.join(p, msg.roomId, msg.as);
        reply(r);
        if (r.ok && r.note) send(p.id, { type: 'notice', text: r.note });
        afterRoomChange();
        break;
      }
      case 'quick': {
        /* 快速加入：找還有空位、沒在對局的房；沒有就自己開一間 */
        const cand = hub.listRooms().filter(r => !r.playing && r.players < r.max);
        let r = null;
        for (const c of cand) { r = hub.join(p, c.id, 'player'); if (r.ok) break; }
        if (!r || !r.ok) r = hub.createRoom(p, {});
        reply(r);
        afterRoomChange();
        break;
      }
      case 'inviteInfo':
        send(p.id, Object.assign({ type: 'inviteInfo' }, hub.inviteInfo(msg.invite)));
        break;
      case 'leave':
        hub.leave(p);
        afterRoomChange();
        break;
      case 'ready': reply(hub.setReady(p, msg.ready)); break;
      case 'switch': reply(hub.switchRole(p, msg.to)); break;
      case 'settings': reply(hub.settings(p, msg)); break;
      case 'addAI': reply(hub.addAI(p, msg.diff)); break;
      case 'removeAI': reply(hub.removeAI(p, msg.id)); break;
      case 'aiDiff': reply(hub.setAIDiff(p, msg.id, msg.diff)); break;
      case 'kick': {
        const r = hub.kick(p, msg.personId);
        reply(r);
        if (r.ok) {
          send(r.kicked, { type: 'kicked', text: '你被房主請出房間了' });
          lobby.add(r.kicked);
          send(r.kicked, { type: 'room', room: null });
        }
        break;
      }
      case 'invite': reply(hub.regenInvite(p, !!msg.revoke)); break;
      case 'chat': reply(hub.chat(p, msg.text)); break;
      case 'start': reply(hub.startGame(p)); break;
      case 'act': reply(hub.gameAct(p, msg.action)); break;
      case 'ping': send(p.id, { type: 'pong', t: msg.t }); break;
      default: break;
    }
    flush();
  }

  ws.attach(server, {
    path: '/ws',
    onConnection(sock) {
      sock.on('message', text => {
        if (text.length > 2000) return;
        let msg = null;
        try { msg = JSON.parse(text); } catch (e) { return; }
        try { handle(sock, msg); } catch (e) {
          console.error('[ws] ' + (msg && msg.type) + ' 出錯：', e && e.stack);
          sock.sendJSON({ type: 'error', text: '伺服器處理這個動作時出錯了' });
        }
      });
      sock.on('close', () => {
        const p = sock.data.person;
        if (!p || sock.data.replaced || sockets.get(p.id) !== sock) return;
        sockets.delete(p.id);
        lobby.delete(p.id);
        hub.markOffline(p.id);
        flush();
      });
    }
  });

  /* ---------- 權威迴圈 ---------- */

  let timer = null, pinger = null;
  function start() {
    timer = setInterval(() => { hub.tick(); flush(); }, TICK_MS);
    pinger = setInterval(() => { for (const s of sockets.values()) s.ping(); }, 5000);
  }
  function stop() { clearInterval(timer); clearInterval(pinger); }

  return { server, hub, start, stop, flush, sockets };
}

function localAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name in nets) for (const n of nets[name] || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}

if (require.main === module) {
  const app = createServer();
  app.start();
  app.server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error('埠號 ' + PORT + ' 已經被佔用了，請關掉另一個視窗，或用 PORT=其他數字 啟動。');
    else console.error('伺服器啟動失敗：', e.message);
    process.exit(1);
  });
  app.server.listen(PORT, () => {
    console.log('寶島大富翁 已啟動');
    console.log('  本機：http://localhost:' + PORT);
    for (const ip of localAddresses()) console.log('  同網路：http://' + ip + ':' + PORT);
    console.log('  健康檢查：http://localhost:' + PORT + '/health');
  });
}

module.exports = { createServer, PORT };
