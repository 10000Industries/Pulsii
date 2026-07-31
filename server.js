'use strict';

const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { WebSocket, WebSocketServer } = require('ws');
const {
  parsePulseMessage,
  serializePresence,
  serializePulse,
} = require('./lib/protocol');

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 3000;
const DEFAULT_MAX_PAYLOAD_BYTES = 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 64 * 1024;
const DEFAULT_MAX_CONNECTIONS = 500;
const DEFAULT_RATE_LIMIT_MAX_MESSAGES = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

const PUBLIC_ASSETS = Object.freeze({
  '/': 'index.html',
  '/index.html': 'index.html',
  '/style.css': 'style.css',
  '/script.js': 'script.js',
  '/favicon.ico': 'favicon.ico',
  '/favicon.png': 'favicon.png',
  '/manifest.webmanifest': 'manifest.webmanifest',
  '/og-image.png': 'og-image.png',
  '/robots.txt': 'robots.txt',
});

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self' ws: wss:",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
});

function isSameOriginWebSocket(info) {
  const origin = info.origin;
  if (!origin) return true;

  try {
    const forwardedProtocol = info.req.headers['x-forwarded-proto']
      ?.split(',')[0]
      .trim();
    const requestProtocol =
      forwardedProtocol || (info.req.socket.encrypted ? 'https' : 'http');
    return new URL(origin).origin === `${requestProtocol}://${info.req.headers.host}`;
  } catch {
    return false;
  }
}

function createRateLimiter(maxMessages, windowMs) {
  let windowStartedAt = Date.now();
  let messagesInWindow = 0;

  return function take() {
    const now = Date.now();
    if (now - windowStartedAt >= windowMs) {
      windowStartedAt = now;
      messagesInWindow = 0;
    }

    messagesInWindow += 1;
    return messagesInWindow <= maxMessages;
  };
}

function createPulsiiServer(options = {}) {
  const {
    publicDir = __dirname,
    maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
    maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES,
    maxConnections = DEFAULT_MAX_CONNECTIONS,
    rateLimitMaxMessages = DEFAULT_RATE_LIMIT_MAX_MESSAGES,
    rateLimitWindowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    logger = null,
  } = options;

  const app = express();
  app.disable('x-powered-by');

  app.use((request, response, next) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.setHeader(name, value);
    }
    next();
  });

  let presenceCount = 0;

  app.get('/healthz', (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json({ status: 'ok', connections: presenceCount });
  });

  for (const [route, filename] of Object.entries(PUBLIC_ASSETS)) {
    app.get(route, (request, response, next) => {
      response.sendFile(path.resolve(publicDir, filename), (error) => {
        if (error) next();
      });
    });
  }

  app.use((request, response) => {
    response.status(404).type('text/plain').send('Not found');
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({
    clientTracking: true,
    maxPayload: maxPayloadBytes,
    perMessageDeflate: false,
    server,
    verifyClient: isSameOriginWebSocket,
  });

  function reportError(error) {
    if (logger && typeof logger.error === 'function') {
      logger.error(error);
    }
  }

  function send(client, payload) {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > maxBufferedBytes) {
      client.terminate();
      return;
    }

    client.send(payload, (error) => {
      if (!error) return;
      reportError(error);
      client.terminate();
    });
  }

  function broadcast(payload, excludedClient = null) {
    for (const client of wss.clients) {
      if (client !== excludedClient) send(client, payload);
    }
  }

  function broadcastPresence() {
    broadcast(serializePresence(presenceCount));
  }

  wss.on('connection', (socket) => {
    if (presenceCount >= maxConnections) {
      socket.close(1013, 'Server at capacity');
      return;
    }

    presenceCount += 1;
    socket.isAlive = true;
    const takeRateLimitToken = createRateLimiter(
      rateLimitMaxMessages,
      rateLimitWindowMs,
    );

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (data, isBinary) => {
      if (!takeRateLimitToken()) {
        socket.close(1008, 'Rate limit exceeded');
        return;
      }

      if (isBinary) return;
      const pulse = parsePulseMessage(data);
      if (!pulse) return;

      // The sender renders immediately; only peers need the relayed event.
      broadcast(serializePulse(pulse), socket);
    });

    socket.on('error', reportError);

    let connectionClosed = false;
    socket.on('close', () => {
      if (connectionClosed) return;
      connectionClosed = true;
      presenceCount = Math.max(0, presenceCount - 1);
      broadcastPresence();
    });

    broadcastPresence();
  });

  wss.on('error', reportError);

  const heartbeatTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }

      client.isAlive = false;
      try {
        client.ping();
      } catch (error) {
        reportError(error);
        client.terminate();
      }
    }
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();

  let closePromise = null;

  function listen(port = 0, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
      const handleError = (error) => {
        server.off('listening', handleListening);
        reject(error);
      };
      const handleListening = () => {
        server.off('error', handleError);
        resolve(server.address());
      };

      server.once('error', handleError);
      server.once('listening', handleListening);
      server.listen(port, host);
    });
  }

  function close() {
    if (closePromise) return closePromise;

    clearInterval(heartbeatTimer);

    const webSocketClosed = new Promise((resolve) => {
      wss.close(resolve);
      for (const client of wss.clients) {
        client.terminate();
      }
    });

    const httpClosed = server.listening
      ? new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        })
      : Promise.resolve();

    closePromise = Promise.all([webSocketClosed, httpClosed]).then(
      () => undefined,
    );
    return closePromise;
  }

  return {
    app,
    close,
    getPresenceCount: () => presenceCount,
    listen,
    server,
    wss,
  };
}

function parsePort(rawPort) {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }
  return port;
}

if (require.main === module) {
  const port = parsePort(process.env.PORT || DEFAULT_PORT);
  const service = createPulsiiServer({ logger: console });

  service
    .listen(port, DEFAULT_HOST)
    .then((address) => {
      console.log(`Pulsii HTTP+WS server listening on port ${address.port}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });

  const shutdown = () => {
    service.close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

module.exports = {
  PUBLIC_ASSETS,
  SECURITY_HEADERS,
  createPulsiiServer,
  parsePort,
};
