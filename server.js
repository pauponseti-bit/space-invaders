/**
 * SPACE RAIDERS — Servidor de Señalización WebRTC
 * ================================================
 * Compatible con Railway, Render, Fly.io
 *
 * Deploy en Railway:
 *   1. Sube esta carpeta (server.js + game.html + package.json) a GitHub
 *   2. railway.app → New Project → Deploy from GitHub
 *   3. Railway detecta Node automáticamente
 *   4. Copia la URL pública (ej: space-raiders.up.railway.app)
 *   5. Úsala en el campo "Servidor" del juego
 *
 * LOCAL (misma WiFi):
 *   npm install && node server.js
 *   → Abre http://<tu-IP>:3000 en cada móvil
 */

const WebSocket = require('ws');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');

const PORT = process.env.PORT || 3000;

// ── HTTP: sirve game.html ───────────────────────────────
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/' || req.url === '/game.html' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'game.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body style="background:#000;color:#0ff;font-family:monospace;padding:40px">
          <h1>🚀 SPACE RAIDERS SERVER ONLINE</h1>
          <p>game.html no encontrado. Sube game.html junto a server.js.</p>
          </body></html>`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', players: players.length, gameStarted }));
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

// ── WebSocket ──────────────────────────────────────────
const wss = new WebSocket.Server({ server: httpServer });

const MAX_PLAYERS = 3;
let players     = [];   // { ws, id, playerNum, name }
let nextId      = 0;
let gameStarted = false;

function broadcast(data, excludeId = null) {
  const msg = JSON.stringify(data);
  players.forEach(p => {
    if (p.id !== excludeId && p.ws.readyState === WebSocket.OPEN)
      p.ws.send(msg);
  });
}

function sendTo(id, data) {
  const p = players.find(p => p.id === id);
  if (p && p.ws.readyState === WebSocket.OPEN)
    p.ws.send(JSON.stringify(data));
}

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (players.length >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type:'error', message:'Sala llena (máx 3 jugadores).' }));
    ws.close(); return;
  }

  const id        = nextId++;
  const playerNum = players.length + 1;
  players.push({ ws, id, playerNum, name: `Jugador ${playerNum}` });
  console.log(`[+] J${playerNum} (id:${id}) desde ${ip}. Total: ${players.length}/${MAX_PLAYERS}`);

  // Bienvenida
  ws.send(JSON.stringify({
    type: 'welcome', id, playerNum,
    totalPlayers: players.length, maxPlayers: MAX_PLAYERS,
    isHost: (playerNum === 1)
  }));

  // Notificar a los demás
  broadcast({ type:'player_joined', id, playerNum, totalPlayers: players.length }, id);

  // Si llegan los 3, iniciar señalización P2P inmediatamente
  if (players.length === MAX_PLAYERS) {
    console.log('[*] Sala completa → señalización P2P');
    const all = players.map((p, i) => ({ id: p.id, playerNum: i+1 }));
    broadcast({ type:'start_signaling', players: all });
  }

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      // ── Señalización WebRTC ──
      case 'offer':
      case 'answer':
      case 'ice_candidate':
        if (msg.to !== undefined) sendTo(msg.to, { ...msg, from: id });
        break;

      // ── Nombre ──
      case 'set_name': {
        const p = players.find(p => p.id === id);
        if (p) {
          p.name = String(msg.name).substring(0, 20);
          console.log(`[~] J${p.playerNum} = "${p.name}"`);
          // Broadcast nombre a todos para actualizar slots
          broadcast({ type:'player_name', playerNum: p.playerNum, name: p.name });
        }
        break;
      }

      // ── Host arranca la partida (retransmitir a todos) ──
      // Este mensaje no necesita relay especial: el host lo manda
      // directamente por P2P una vez establecidos los canales.
      // El server solo lo necesita si algún cliente aún no tiene canal.
      case 'host_start':
        gameStarted = true;
        broadcast({ type:'host_start' }, id);
        break;
    }
  });

  ws.on('close', () => {
    players = players.filter(p => p.id !== id);
    gameStarted = false;
    console.log(`[-] id:${id} desconectado. Total: ${players.length}/${MAX_PLAYERS}`);
    broadcast({ type:'player_left', id, totalPlayers: players.length });
  });

  ws.on('error', err => console.error(`[!] id:${id}:`, err.message));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const ips  = [];
  for (const ifaces of Object.values(nets))
    for (const n of ifaces)
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     SPACE RAIDERS — Servidor listo       ║');
  console.log('╠══════════════════════════════════════════╣');
  ips.forEach(ip => console.log(`║  → http://${ip}:${PORT}`.padEnd(44) + '║'));
  console.log('║  /health → estado JSON                   ║');
  console.log('╚══════════════════════════════════════════╝\n');
});
