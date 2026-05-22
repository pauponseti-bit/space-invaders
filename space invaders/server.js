/**
 * SPACE RAIDERS - Servidor de Señalización WebRTC
 * ================================================
 * Listo para Railway, Render, Fly.io (gratuitos)
 * 
 * Deploy en Railway:
 *   1. Sube esta carpeta a GitHub
 *   2. Ve a railway.app → New Project → Deploy from GitHub
 *   3. Selecciona el repo → Railway detecta Node automáticamente
 *   4. En Settings → Variables: PORT lo pone Railway solo
 *   5. Copia la URL pública (ej: space-raiders.up.railway.app)
 *   6. En el juego usa esa URL (sin http://, solo el dominio)
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Railway/Render ponen el puerto en process.env.PORT
const PORT = process.env.PORT || 3000;

// ── HTTP: sirve el game.html ──────────────────────────
const httpServer = http.createServer((req, res) => {
  // CORS headers (necesario si el cliente está en otro dominio)
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/' || req.url === '/game.html' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'game.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="background:#000;color:#0ff;font-family:monospace;padding:40px">
          <h1>🚀 SPACE RAIDERS SERVER</h1>
          <p>Servidor online. game.html no encontrado en esta carpeta.</p>
          <p>Sube game.html junto a server.js y redeploya.</p>
          </body></html>
        `);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else if (req.url === '/health') {
    // Health check para Railway/Render
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', players: players.length }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ── WebSocket ─────────────────────────────────────────
// En Railway/Render el SSL lo termina el proxy → aquí usamos ws:// normal
const wss = new WebSocket.Server({ server: httpServer });

const MAX_PLAYERS = 3;
let players = [];
let nextId = 0;
// Permite múltiples salas en el futuro (por ahora una sola)
let gameStarted = false;

function broadcast(data, excludeId = null) {
  const msg = JSON.stringify(data);
  players.forEach(p => {
    if (p.id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msg);
    }
  });
}

function sendTo(id, data) {
  const player = players.find(p => p.id === id);
  if (player && player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws, req) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // Sala llena
  if (players.length >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: 'error', message: 'Sala llena (máx 3 jugadores). Espera a que termine la partida.' }));
    ws.close();
    return;
  }

  const id = nextId++;
  const playerNum = players.length + 1;
  players.push({ ws, id, name: `Jugador ${playerNum}`, playerNum });

  console.log(`[+] J${playerNum} (id:${id}) desde ${clientIp}. Total: ${players.length}/${MAX_PLAYERS}`);

  ws.send(JSON.stringify({
    type: 'welcome',
    id,
    playerNum,
    totalPlayers: players.length,
    maxPlayers: MAX_PLAYERS
  }));

  broadcast({ type: 'player_joined', id, playerNum, totalPlayers: players.length }, id);

  if (players.length === MAX_PLAYERS) {
    console.log('[*] ¡3 jugadores! Iniciando señalización P2P...');
    gameStarted = true;
    const allPlayers = players.map((p, i) => ({ id: p.id, playerNum: i + 1 }));
    broadcast({ type: 'start_signaling', players: allPlayers });
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'offer':
      case 'answer':
      case 'ice_candidate':
        if (msg.to !== undefined) {
          sendTo(msg.to, { ...msg, from: id });
        }
        break;

      case 'set_name':
        const player = players.find(p => p.id === id);
        if (player) {
          player.name = msg.name.substring(0, 20); // sanitize
          console.log(`[~] J${player.playerNum} se llama: ${player.name}`);
        }
        break;
    }
  });

  ws.on('close', () => {
    players = players.filter(p => p.id !== id);
    gameStarted = false;
    console.log(`[-] J${id} desconectado. Total: ${players.length}/${MAX_PLAYERS}`);
    broadcast({ type: 'player_left', id, totalPlayers: players.length });
  });

  ws.on('error', (err) => {
    console.error(`[!] Error J${id}:`, err.message);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     SPACE RAIDERS - Servidor Online      ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Puerto local: ${String(PORT).padEnd(26)}║`);
  console.log('║  En Railway: usa la URL pública          ║');
  console.log('║  /health → estado del servidor           ║');
  console.log('╚══════════════════════════════════════════╝\n');
});