# Snake.io Mini 🐍 — now with ONLINE multiplayer!

A slither.io-style game. Play **offline against bots**, or **online with real players** on a shared server. Built by SAITAMA.

## Play offline (no setup)

Just open `index.html` in your browser — no build step needed. Click **🤖 Play Offline (bots)**.

Or via GitHub Pages after pushing.

## Play online (multiplayer)

The game supports real-time multiplayer for up to 20 players, with a **live Top-10 leaderboard**.

### 1. Run the server

You need Node.js 18+.

```bash
npm install
node server.js
# server listens on port 3001 (or set PORT env var)
```

### 2. Connect the game

1. Open `index.html` (or your GitHub Pages link)
2. Enter your name and the server URL (default `ws://localhost:3001`)
3. Click **🌐 Play Online**

### 3. Host the server for free (so anyone can join)

**Option A — Cloudflare Workers (recommended: free, no credit card needed)**

1. Create a free account at https://dash.cloudflare.com/sign-up (no card asked)
2. Install Node.js 20+, then in the `cloudflare/` folder of this repo run:
   ```
   npx wrangler login
   npx wrangler deploy
   ```
3. Wrangler prints your URL, e.g. `https://snake-io-mini.<you>.workers.dev`
4. In the game, enter that URL as the server (it accepts `https://…` or `wss://…`) and hit **🌐 Play Online**

**Option B — Render (free, but asks for a credit card)**

1. Go to [render.com](https://render.com) → New → **Web Service** → connect your `snake-io-mini` repo
2. Settings: **Build Command** `npm install`, **Start Command** `node server.js`
3. Deploy — Render gives you a URL like `https://snake-io-mini.onrender.com`
4. In the game, enter server URL as `wss://snake-io-mini.onrender.com` (note `wss://`, no port)

Alternatives: Railway, Fly.io, or any VPS (`node server.js` behind a reverse proxy).

> The game page itself can stay on GitHub Pages — only the server needs Node hosting.

## Controls

- **Move:** mouse / arrow keys / WASD / touch-drag (virtual joystick — touch and drag anywhere to steer; lift your finger and the snake keeps going straight)
- **Boost:** hold click / space / ⚡ button (mobile)

## Features

- 🌐 Real-time multiplayer (WebSocket, server-authoritative)
- 🏆 Live Top-10 leaderboard
- 🤖 Offline mode with 7 AI bot snakes
- Smooth slither.io-style movement, glowing food orbs, boost mechanic
- World border, grid, player names + eyes

Enjoy! One punch, one snake. 👊
