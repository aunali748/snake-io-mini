// Snake.io Mini — multiplayer server (Node.js + WebSocket)
// Run:  npm install && node server.js   (or: PORT=3001 node server.js)

const WebSocket = require('ws');

const PORT = process.env.PORT || 3001;
const WORLD = 3000;
const TICK_MS = 1000 / 30;
const MAX_PLAYERS = 20;

const rand = (a, b) => a + Math.random() * (b - a);
const COLORS = ['#7CFC00', '#00e5ff', '#ff4d6d', '#ffd54a', '#c77dff', '#ff9f1c', '#ff6b6b', '#4ecdc4'];

let foods = [];
const players = new Map(); // id -> player
let nextId = 1;

function spawnFood(n) {
  for (let i = 0; i < n; i++) {
    foods.push({
      x: rand(0, WORLD), y: rand(0, WORLD),
      r: rand(3, 6), c: COLORS[(Math.random() * COLORS.length) | 0],
    });
  }
}
spawnFood(450);

function makePlayer(id, name) {
  const angle = rand(0, Math.PI * 2);
  const x = rand(300, WORLD - 300), y = rand(300, WORLD - 300);
  const p = {
    id, name: (name || 'Player').slice(0, 16),
    x, y, angle, speed: 2.6, radius: 10,
    segments: [], score: 0,
    color: COLORS[(Math.random() * COLORS.length) | 0],
    alive: true, boost: false, inputAngle: angle, inputBoost: false,
    ws: null, respawnAt: 0,
  };
  for (let i = 0; i < 12; i++) p.segments.push({ x: x - Math.cos(angle) * i * 10, y: y - Math.sin(angle) * i * 10 });
  return p;
}

function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

function killPlayer(p) {
  p.alive = false;
  for (let i = 0; i < p.segments.length; i += 3) {
    const s = p.segments[i];
    foods.push({ x: s.x + rand(-15, 15), y: s.y + rand(-15, 15), r: rand(4, 7), c: p.color });
  }
  if (foods.length > 1200) foods = foods.slice(-1200);
  p.respawnAt = Date.now() + 2000;
  try { p.ws.send(JSON.stringify({ type: 'dead', score: Math.round(p.score) })); } catch (e) {}
}

function respawn(p) {
  const angle = rand(0, Math.PI * 2);
  p.x = rand(300, WORLD - 300); p.y = rand(300, WORLD - 300);
  p.angle = angle; p.inputAngle = angle;
  p.score = 0; p.radius = 10; p.alive = true; p.boost = false;
  p.segments = [];
  for (let i = 0; i < 12; i++) p.segments.push({ x: p.x - Math.cos(angle) * i * 10, y: p.y - Math.sin(angle) * i * 10 });
  try { p.ws.send(JSON.stringify({ type: 'respawn' })); } catch (e) {}
}

function tick() {
  const now = Date.now();

  for (const p of players.values()) {
    if (!p.alive) { if (now >= p.respawnAt) respawn(p); continue; }

    // steer toward input angle (limited turn rate)
    let diff = p.inputAngle - p.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.angle += Math.max(-0.12, Math.min(0.12, diff));

    p.boost = p.inputBoost && p.segments.length > 10;
    const sp = p.boost ? p.speed * 1.7 : p.speed;
    p.x = Math.max(20, Math.min(WORLD - 20, p.x + Math.cos(p.angle) * sp));
    p.y = Math.max(20, Math.min(WORLD - 20, p.y + Math.sin(p.angle) * sp));

    p.segments.unshift({ x: p.x, y: p.y });
    const wantLen = 10 + p.score * 0.35;
    while (p.segments.length > wantLen) {
      const tail = p.segments.pop();
      if (p.boost && Math.random() < 0.25) foods.push({ x: tail.x, y: tail.y, r: 3, c: p.color });
    }
    if (p.boost && Math.random() < 0.08) p.score = Math.max(0, p.score - 1);

    // eat
    const head = p.segments[0];
    const eatR = p.radius + 9;
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      const dx = head.x - f.x, dy = head.y - f.y;
      if (dx * dx + dy * dy < eatR * eatR) { p.score += 2; foods.splice(i, 1); }
    }
    p.radius = 8 + Math.min(14, p.segments.length * 0.06);
  }

  // collisions: head vs other bodies
  const list = [...players.values()].filter(p => p.alive);
  for (const p of list) {
    const head = p.segments[0];
    for (const o of list) {
      if (o === p) continue;
      const rr = p.radius + o.radius * 0.7;
      for (let i = 2; i < o.segments.length; i += 2) {
        const s = o.segments[i];
        const dx = head.x - s.x, dy = head.y - s.y;
        if (dx * dx + dy * dy < rr * rr) { killPlayer(p); break; }
      }
      if (!p.alive) break;
    }
  }

  if (foods.length < 350) spawnFood(8);

  // leaderboard: top 10 by score
  const leaderboard = [...players.values()]
    .map(p => ({ id: p.id, name: p.name, score: Math.round(p.score), alive: p.alive }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // broadcast snapshot (thin segments to save bandwidth)
  const snapshot = {
    type: 'state',
    leaderboard,
    foods: foods.map(f => [Math.round(f.x), Math.round(f.y), Math.round(f.r), f.c]),
    players: list.map(p => ({
      id: p.id, name: p.name, color: p.color,
      score: Math.round(p.score), radius: Math.round(p.radius * 10) / 10,
      angle: Math.round(p.angle * 100) / 100,
      segs: p.segments.filter((_, i) => i % 2 === 0).map(s => [Math.round(s.x), Math.round(s.y)]),
    })),
  };
  const msg = JSON.stringify(snapshot);
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) { try { p.ws.send(msg); } catch (e) {} }
  }
}

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`🐍 Snake.io server listening on port ${PORT}`);
});

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) { ws.close(1013, 'server full'); return; }
  const id = nextId++;
  let player = null;

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'join') {
      player = makePlayer(id, m.name);
      player.ws = ws;
      players.set(id, player);
      ws.send(JSON.stringify({ type: 'welcome', id, world: WORLD }));
      console.log(`+ ${player.name} joined (id ${id}, ${players.size} online)`);
    } else if (m.type === 'input' && player) {
      player.inputAngle = m.angle;
      player.inputBoost = !!m.boost;
    }
  });

  ws.on('close', () => {
    if (player) { players.delete(id); console.log(`- ${player.name} left (${players.size} online)`); }
  });
});

setInterval(tick, TICK_MS);
