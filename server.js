'use strict';

const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const express = require('express');
const { WebSocket, WebSocketServer } = require('ws');
const {
  parsePulseMessage,
  serializeCongestion,
  serializePresence,
  serializePulse,
} = require('./lib/protocol');

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 3000;
const DEFAULT_MAX_PAYLOAD_BYTES = 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 64 * 1024;
const DEFAULT_MAX_CONNECTIONS = 200;
const DEFAULT_CLIENT_RATE_BURST = 10;
const DEFAULT_CLIENT_RATE_PER_SECOND = 5;
const DEFAULT_GLOBAL_RATE_BURST = 36;
const DEFAULT_GLOBAL_RATE_PER_SECOND = 24;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_PRESENCE_BROADCAST_DELAY_MS = 100;
const DEFAULT_METRICS_INTERVAL_MS = 60_000;
const CONGESTION_NOTICE_INTERVAL_MS = 1000;

const PUBLIC_ASSETS = Object.freeze({
  '/': 'index.html',
  '/index.html': 'index.html',
  '/style.css': 'style.css',
  '/script.js': 'script.js',
  '/favicon.ico': 'favicon.ico',
  '/favicon.png': 'favicon.png',
  '/manifest.webmanifest': 'manifest.webmanifest',
  '/og-image.png': 'og-image.png',
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

function createTokenBucket(capacity, refillPerSecond, now = Date.now) {
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new Error('Token bucket capacity must be positive');
  }
  if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) {
    throw new Error('Token bucket refill rate must be positive');
  }

  let tokens = capacity;
  let lastRefillAt = now();

  return function take() {
    const currentTime = now();
    const elapsedMs = Math.max(0, currentTime - lastRefillAt);
    if (elapsedMs > 0) {
      tokens = Math.min(
        capacity,
        tokens + ((elapsedMs / 1000) * refillPerSecond),
      );
      lastRefillAt = currentTime;
    }

    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

function parseBooleanFlag(rawValue, fallback = false) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean flag: ${rawValue}`);
}

function parsePositiveNumber(rawValue, name, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: ${rawValue}`);
  }
  return value;
}

function parsePositiveInteger(rawValue, name, fallback) {
  const value = parsePositiveNumber(rawValue, name, fallback);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid ${name}: ${rawValue}`);
  }
  return value;
}

function parsePublicOrigin(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return null;
  }

  try {
    const url = new URL(String(rawValue));
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error(`Invalid PUBLIC_ORIGIN: ${rawValue}`);
  }
}

function renderIndexHtml(template, publicOrigin) {
  const marker = '<!-- PULSII_PUBLIC_META -->';
  if (!publicOrigin) return template.replace(marker, '');

  const metadata = [
    `<meta property="og:url" content="${publicOrigin}/">`,
    `<link rel="canonical" href="${publicOrigin}/">`,
  ].join('\n  ');

  return template
    .replace(marker, metadata)
    .replaceAll('content="/og-image.png"', `content="${publicOrigin}/og-image.png"`);
}

function runtimeOptionsFromEnv(environment = process.env) {
  const publicMode = parseBooleanFlag(environment.PUBLIC_MODE, false);
  const publicOrigin = parsePublicOrigin(environment.PUBLIC_ORIGIN);
  if (publicMode && !publicOrigin) {
    throw new Error('PUBLIC_ORIGIN is required when PUBLIC_MODE is true');
  }
  if (!publicMode && publicOrigin) {
    throw new Error('PUBLIC_MODE must be true when PUBLIC_ORIGIN is set');
  }

  return {
    publicMode,
    publicOrigin,
    maxConnections: parsePositiveInteger(
      environment.MAX_CONNECTIONS,
      'MAX_CONNECTIONS',
      DEFAULT_MAX_CONNECTIONS,
    ),
    clientRateBurst: parsePositiveInteger(
      environment.CLIENT_RATE_BURST,
      'CLIENT_RATE_BURST',
      DEFAULT_CLIENT_RATE_BURST,
    ),
    clientRatePerSecond: parsePositiveNumber(
      environment.CLIENT_RATE_PER_SECOND,
      'CLIENT_RATE_PER_SECOND',
      DEFAULT_CLIENT_RATE_PER_SECOND,
    ),
    globalRateBurst: parsePositiveInteger(
      environment.GLOBAL_RATE_BURST,
      'GLOBAL_RATE_BURST',
      DEFAULT_GLOBAL_RATE_BURST,
    ),
    globalRatePerSecond: parsePositiveNumber(
      environment.GLOBAL_RATE_PER_SECOND,
      'GLOBAL_RATE_PER_SECOND',
      DEFAULT_GLOBAL_RATE_PER_SECOND,
    ),
    metricsIntervalMs: parsePositiveInteger(
      environment.METRICS_INTERVAL_MS,
      'METRICS_INTERVAL_MS',
      DEFAULT_METRICS_INTERVAL_MS,
    ),
    deployedCommit:
      environment.RENDER_GIT_COMMIT ||
      environment.GIT_COMMIT ||
      'unknown',
  };
}

function createPulsiiServer(options = {}) {
  const {
    publicDir = __dirname,
    maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
    maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES,
    maxConnections = DEFAULT_MAX_CONNECTIONS,
    clientRateBurst = DEFAULT_CLIENT_RATE_BURST,
    clientRatePerSecond = DEFAULT_CLIENT_RATE_PER_SECOND,
    globalRateBurst = DEFAULT_GLOBAL_RATE_BURST,
    globalRatePerSecond = DEFAULT_GLOBAL_RATE_PER_SECOND,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    presenceBroadcastDelayMs = DEFAULT_PRESENCE_BROADCAST_DELAY_MS,
    metricsIntervalMs = DEFAULT_METRICS_INTERVAL_MS,
    publicMode = false,
    publicOrigin = null,
    deployedCommit = 'unknown',
    logger = null,
    now = Date.now,
  } = options;

  const app = express();
  app.disable('x-powered-by');
  const normalizedPublicOrigin = parsePublicOrigin(publicOrigin);
  if (Boolean(publicMode) !== Boolean(normalizedPublicOrigin)) {
    throw new Error('PUBLIC_MODE and PUBLIC_ORIGIN must be configured together');
  }
  const indexHtml = renderIndexHtml(
    fs.readFileSync(path.resolve(publicDir, 'index.html'), 'utf8'),
    normalizedPublicOrigin,
  );

  app.use((request, response, next) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.setHeader(name, value);
    }
    if (!publicMode) {
      response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  });

  let presenceCount = 0;
  const startedAt = now();
  const metrics = {
    pageLoads: 0,
    connectionsAccepted: 0,
    connectionsActivated: 0,
    connectionsClosed: 0,
    capacityRejected: 0,
    pulsesAccepted: 0,
    pulsesShared: 0,
    invalidMessages: 0,
    clientRateLimited: 0,
    globalRateDropped: 0,
    slowClientTerminations: 0,
    fanoutDeliveries: 0,
    peakConnections: 0,
    totalConnectionMs: 0,
  };
  const takeGlobalRateToken = createTokenBucket(
    globalRateBurst,
    globalRatePerSecond,
    now,
  );

  function metricsSnapshot() {
    const memory = process.memoryUsage();
    return {
      deployedCommit: String(deployedCommit).slice(0, 64),
      uptimeSeconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
      currentConnections: presenceCount,
      peakConnections: metrics.peakConnections,
      pageLoads: metrics.pageLoads,
      connectionsAccepted: metrics.connectionsAccepted,
      connectionsActivated: metrics.connectionsActivated,
      connectionsClosed: metrics.connectionsClosed,
      capacityRejected: metrics.capacityRejected,
      pulsesAccepted: metrics.pulsesAccepted,
      pulsesShared: metrics.pulsesShared,
      invalidMessages: metrics.invalidMessages,
      clientRateLimited: metrics.clientRateLimited,
      globalRateDropped: metrics.globalRateDropped,
      slowClientTerminations: metrics.slowClientTerminations,
      fanoutDeliveries: metrics.fanoutDeliveries,
      averageConnectionSeconds:
        metrics.connectionsClosed === 0
          ? 0
          : Math.round(
            metrics.totalConnectionMs /
            metrics.connectionsClosed /
            1000,
          ),
      memoryRssMb: Math.round(memory.rss / 1024 / 1024),
    };
  }

  app.get('/healthz', (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json({ status: 'ok', connections: presenceCount });
  });

  app.get('/robots.txt', (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.type('text/plain').send(
      publicMode
        ? 'User-agent: *\nAllow: /\n'
        : 'User-agent: *\nDisallow: /\n',
    );
  });

  for (const [route, filename] of Object.entries(PUBLIC_ASSETS)) {
    app.get(route, (request, response, next) => {
      if (route === '/' || route === '/index.html') {
        metrics.pageLoads += 1;
        response.setHeader(
          'Cache-Control',
          'public, max-age=0, must-revalidate',
        );
        response.type('html').send(indexHtml);
        return;
      }

      const maxAge =
        filename === 'manifest.webmanifest' ||
        filename === 'script.js' ||
        filename === 'style.css'
          ? 0
          : 60 * 60 * 1000;
      response.sendFile(
        path.resolve(publicDir, filename),
        { maxAge },
        (error) => {
          if (error) next();
        },
      );
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
    if (client.readyState !== WebSocket.OPEN) return false;
    if (client.bufferedAmount > maxBufferedBytes) {
      metrics.slowClientTerminations += 1;
      client.terminate();
      return false;
    }

    try {
      client.send(payload, (error) => {
        if (!error) return;
        reportError(error);
        client.terminate();
      });
      return true;
    } catch (error) {
      reportError(error);
      client.terminate();
      return false;
    }
  }

  function broadcast(payload, excludedClient = null) {
    let deliveries = 0;
    for (const client of wss.clients) {
      if (client === excludedClient || client.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (send(client, payload)) deliveries += 1;
    }
    return deliveries;
  }

  let presenceBroadcastTimer = null;
  function broadcastPresence() {
    broadcast(serializePresence(presenceCount));
  }

  function schedulePresenceBroadcast() {
    if (presenceBroadcastTimer !== null) return;
    presenceBroadcastTimer = setTimeout(() => {
      presenceBroadcastTimer = null;
      broadcastPresence();
    }, presenceBroadcastDelayMs);
    presenceBroadcastTimer.unref?.();
  }

  wss.on('connection', (socket) => {
    if (presenceCount >= maxConnections) {
      metrics.capacityRejected += 1;
      socket.close(1013, 'Server at capacity');
      return;
    }

    presenceCount += 1;
    metrics.connectionsAccepted += 1;
    metrics.peakConnections = Math.max(
      metrics.peakConnections,
      presenceCount,
    );
    socket.isAlive = true;
    socket.connectedAt = now();
    socket.activated = false;
    socket.lastCongestionNoticeAt = 0;
    const takeClientRateToken = createTokenBucket(
      clientRateBurst,
      clientRatePerSecond,
      now,
    );

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (data, isBinary) => {
      if (!takeClientRateToken()) {
        metrics.clientRateLimited += 1;
        socket.close(1008, 'Rate limit exceeded');
        return;
      }

      if (isBinary) {
        metrics.invalidMessages += 1;
        return;
      }
      const pulse = parsePulseMessage(data);
      if (!pulse) {
        metrics.invalidMessages += 1;
        return;
      }

      if (!takeGlobalRateToken()) {
        metrics.globalRateDropped += 1;
        const currentTime = now();
        if (
          currentTime - socket.lastCongestionNoticeAt >=
          CONGESTION_NOTICE_INTERVAL_MS
        ) {
          socket.lastCongestionNoticeAt = currentTime;
          send(socket, serializeCongestion());
        }
        return;
      }

      metrics.pulsesAccepted += 1;
      if (!socket.activated) {
        socket.activated = true;
        metrics.connectionsActivated += 1;
      }

      // The sender renders immediately; only peers need the relayed event.
      const deliveries = broadcast(serializePulse(pulse), socket);
      metrics.fanoutDeliveries += deliveries;
      if (deliveries > 0) metrics.pulsesShared += 1;
    });

    socket.on('error', reportError);

    let connectionClosed = false;
    socket.on('close', () => {
      if (connectionClosed) return;
      connectionClosed = true;
      presenceCount = Math.max(0, presenceCount - 1);
      metrics.connectionsClosed += 1;
      metrics.totalConnectionMs += Math.max(0, now() - socket.connectedAt);
      schedulePresenceBroadcast();
    });

    // Give the new browser an immediately usable presence state, then coalesce
    // the all-peer update so connection churn cannot create an O(n²) storm.
    send(socket, serializePresence(presenceCount));
    schedulePresenceBroadcast();
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

  let nextMetricsReportAt = now() + metricsIntervalMs;
  const metricsTimer =
    logger && typeof logger.info === 'function'
      ? setInterval(() => {
        const currentTime = now();
        const eventLoopLagMs = Math.max(
          0,
          currentTime - nextMetricsReportAt,
        );
        nextMetricsReportAt = currentTime + metricsIntervalMs;
        logger.info(JSON.stringify({
          event: 'pulsii_metrics',
          eventLoopLagMs,
          ...metricsSnapshot(),
        }));
      }, metricsIntervalMs)
      : null;
  metricsTimer?.unref();

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
    if (metricsTimer) clearInterval(metricsTimer);
    if (presenceBroadcastTimer !== null) {
      clearTimeout(presenceBroadcastTimer);
      presenceBroadcastTimer = null;
    }

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
    getMetrics: metricsSnapshot,
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
  const service = createPulsiiServer({
    ...runtimeOptionsFromEnv(process.env),
    logger: console,
  });

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
  createTokenBucket,
  createPulsiiServer,
  parseBooleanFlag,
  parsePort,
  parsePublicOrigin,
  renderIndexHtml,
  runtimeOptionsFromEnv,
};
