// Snake.io Mini — multiplayer server for Cloudflare Workers + Durable Objects
// FREE, no credit card required.
//
// Deploy:
//   1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up
//   2. Install Node.js 20+, then in this folder run:
//        npx wrangler login
//        npx wrangler deploy
//   3. Wrangler prints your URL, e.g. https://snake-io-mini.<you>.workers.dev
//   4. In the game, enter that URL (https://... or wss://...) as the server and hit Play Online.
//
// How it works: one Durable Object ("main-room") is the authoritative game room.
// It ticks at ~30fps via alarms (only while players are connected) and talks to
// browsers over WebSockets using the same protocol as server.js, so the game
// client works unchanged.

const WORLD = 3000;
const TICK_MS = 33; // ~30 ticks per second
const MAX_PLAYERS = 20;

const rand = (a, b) => a + Math.random() * (b - a);
const COLORS = ['#7CFC00', '#00e5ff', '#ff4d6d', '#ffd54a', '#c77dff', '#ff9f1c', '#ff6b6b', '#4ecdc4'];

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.players = new Map(); // id -> player
    this.foods = [];
    this.nextId = 1;
    this.ticking = false;
    this.tickN = 0;
    for (let i = 0; i < 450; i++) this.spawnFood();
  }

  spawnFood() {
    this.foods.push({
      x: rand(0, WORLD), y: rand(0, WORLD),
      r: rand(3, 6), c: COLORS[(Math.random() * COLORS.length) | 0],
    });
  }

  makePlayer(id, name) {
    const angle = rand(0, Math.PI * 2);
    const x = rand(300, WORLD - 300), y = rand(300, WORLD - 300);
    const p = {
      id, name: String(name || 'Player').slice(0, 16),
      x, y, angle, speed: 2.6, radius: 10,
      segments: [], score: 0,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      alive: true, boost: false, inputAngle: angle, inputBoost: false,
      ws: null, respawnAt: 0,
    };
    for (let i = 0; i < 12; i++) p.segments.push({ x: x - Math.cos(angle) * i * 10, y: y - Math.sin(angle) * i * 10 });
    return p;
  }

  // ---- HTTP/WebSocket entry ----
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Snake.io Mini server — connect with a WebSocket client (e.g. the game at /index.html).', {
        status: 200, headers: { 'Content-Type': 'text/plain' },
      });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'join') {
      if (this.players.size >= MAX_PLAYERS) { try { ws.close(1013, 'server full'); } catch {} return; }
      const id = this.nextId++;
      const p = this.makePlayer(id, m.name);
      p.ws = ws;
      this.players.set(id, p);
      try { ws.serializeAttachment({ playerId: id }); } catch {}
      this.send(ws, { type: 'welcome', id, world: WORLD });
      this.ensureTick();
    } else if (m.type === 'input') {
      let att = null;
      try { att = ws.deserializeAttachment(); } catch {}
      const p = att && this.players.get(att.playerId);
      if (p) {
        if (typeof m.angle === 'number' && isFinite(m.angle)) p.inputAngle = m.angle;
        p.inputBoost = !!m.boost;
        p.snapInput = !!m.snap;
      }
    }
  }

  async webSocketClose(ws) {
    try {
      const att = ws.deserializeAttachment();
      if (att && att.playerId) this.players.delete(att.playerId);
    } catch {}
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  // ---- game loop (alarm-driven; only runs while players are connected) ----
  ensureTick() {
    if (!this.ticking && this.players.size > 0) {
      this.ticking = true;
      this.state.storage.setAlarm(Date.now() + TICK_MS);
    }
  }

  async alarm() {
    this.doTick();
    if (this.players.size > 0) {
      this.state.storage.setAlarm(Date.now() + TICK_MS);
    } else {
      this.ticking = false;
    }
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }

  killPlayer(p) {
    p.alive = false;
    for (let i = 0; i < p.segments.length; i += 3) {
      const s = p.segments[i];
      this.foods.push({ x: s.x + rand(-15, 15), y: s.y + rand(-15, 15), r: rand(4, 7), c: p.color });
    }
    if (this.foods.length > 1200) this.foods = this.foods.slice(-1200);
    p.respawnAt = Date.now() + 2000;
    this.send(p.ws, { type: 'dead', score: Math.round(p.score) });
  }

  respawn(p) {
    const angle = rand(0, Math.PI * 2);
    p.x = rand(300, WORLD - 300); p.y = rand(300, WORLD - 300);
    p.angle = angle; p.inputAngle = angle;
    p.score = 0; p.radius = 10; p.alive = true; p.boost = false;
    p.segments = [];
    for (let i = 0; i < 12; i++) p.segments.push({ x: p.x - Math.cos(angle) * i * 10, y: p.y - Math.sin(angle) * i * 10 });
    this.send(p.ws, { type: 'respawn' });
  }

  doTick() {
    const now = Date.now();

    for (const p of this.players.values()) {
      if (!p.alive) { if (now >= p.respawnAt) this.respawn(p); continue; }

      let diff = p.inputAngle - p.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turnRate = p.snapInput ? 0.32 : 0.16; // keyboard snaps, mouse/stick stay smooth
      p.angle += Math.max(-turnRate, Math.min(turnRate, diff));

      p.boost = p.inputBoost && p.segments.length > 10;
      const sp = p.boost ? p.speed * 1.7 : p.speed;
      p.x = Math.max(20, Math.min(WORLD - 20, p.x + Math.cos(p.angle) * sp));
      p.y = Math.max(20, Math.min(WORLD - 20, p.y + Math.sin(p.angle) * sp));

      p.segments.unshift({ x: p.x, y: p.y });
      const wantLen = 10 + p.score * 0.35;
      while (p.segments.length > wantLen) {
        const tail = p.segments.pop();
        if (p.boost && Math.random() < 0.25) this.foods.push({ x: tail.x, y: tail.y, r: 3, c: p.color });
      }
      if (p.boost && Math.random() < 0.08) p.score = Math.max(0, p.score - 1);

      const head = p.segments[0];
      const eatR = p.radius + 9;
      for (let i = this.foods.length - 1; i >= 0; i--) {
        const f = this.foods[i];
        const dx = head.x - f.x, dy = head.y - f.y;
        if (dx * dx + dy * dy < eatR * eatR) { p.score += 2; this.foods.splice(i, 1); }
      }
      p.radius = 8 + Math.min(14, p.segments.length * 0.06);
    }

    // collisions: head vs other bodies
    const list = [...this.players.values()].filter(p => p.alive);
    for (const p of list) {
      const head = p.segments[0];
      for (const o of list) {
        if (o === p) continue;
        const rr = p.radius + o.radius * 0.7;
        for (let i = 2; i < o.segments.length; i += 2) {
          const s = o.segments[i];
          const dx = head.x - s.x, dy = head.y - s.y;
          if (dx * dx + dy * dy < rr * rr) { this.killPlayer(p); break; }
        }
        if (!p.alive) break;
      }
    }

    if (this.foods.length < 350) for (let i = 0; i < 8; i++) this.spawnFood();

    const leaderboard = [...this.players.values()]
      .map(p => ({ id: p.id, name: p.name, score: Math.round(p.score), alive: p.alive }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const msg = JSON.stringify((()=>{
      this.tickN++;
      const s = {
        type: 'state',
        leaderboard,
        players: list.map(p => ({
          id: p.id, name: p.name, color: p.color,
          score: Math.round(p.score), radius: Math.round(p.radius * 10) / 10,
          angle: Math.round(p.angle * 100) / 100,
          segs: p.segments.filter((_, i) => i % 2 === 0).map(s => [Math.round(s.x), Math.round(s.y)]),
        })),
      };
      if (this.tickN % 3 === 0) s.foods = this.foods.map(f => [Math.round(f.x), Math.round(f.y), Math.round(f.r), f.c]);
      return s;
    })());
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(msg); } catch {}
    }
  }
}

export default {
  async fetch(request, env) {
    const id = env.GAME_ROOM.idFromName('main-room');
    return env.GAME_ROOM.get(id).fetch(request);
  },
};
