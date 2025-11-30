// Lightweight WebSocket relay + static file server.
// Serves the client and echoes any incoming pulse to every connected peer.

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const HOST = '0.0.0.0';
const HTTP_PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

const app = express();

// Serve the minimal client assets from the project root.
app.use(express.static(PUBLIC_DIR));

// Create a single HTTP server and share it with WebSocket for one-port deployments.
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Fan-out helper: forward data to all clients (including sender).
function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  });
}

wss.on('connection', (socket) => {
  console.log('client connected');

  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);
      const { type, xNorm, yNorm, color } = parsed || {};
      const isPulse = type === 'pulse' && typeof xNorm === 'number' && typeof yNorm === 'number' && typeof color === 'string';
      if (!isPulse) return;
      broadcast(JSON.stringify({ type, xNorm, yNorm, color }));
    } catch (err) {
      // Ignore malformed JSON safely.
    }
  });

  socket.on('close', () => {
    // Client disconnect handled gracefully.
  });
});

server.listen(HTTP_PORT, HOST, () => {
  console.log(`HTTP+WS server running at http://${HOST}:${HTTP_PORT}`);
});
