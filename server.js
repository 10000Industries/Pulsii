'use strict';

const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const express = require('express');
const { WebSocket, WebSocketServer } = require('ws');
const {
  BATCH_HEADER_BYTES,
  MAX_BATCH_PULSES,
  PULSE_RECORD_BYTES,
  encodePulseBatch,
  parsePulseMessage,
  serializeBusy,
  serializePresence,
} = require('./lib/protocol');

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 3000;
const DEFAULT_MAX_PAYLOAD_BYTES = 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 64 * 1024;
const DEFAULT_MAX_CONNECTIONS = 200;
const DEFAULT_CLIENT_RATE_BURST = 10;
const DEFAULT_CLIENT_RATE_PER_SECOND = 5;
const DEFAULT_BATCH_INTERVAL_MS = 50;
const DEFAULT_MAX_GLOBAL_CANDIDATES = 8192;
const DEFAULT_MAX_CLIENT_CANDIDATES = 8;
const DEFAULT_MAX_BATCH_PULSES = 4096;
const DEFAULT_BUSY_RETRY_MS = 100;
const DEFAULT_SHUTDOWN_DRAIN_MS = 250;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_PRESENCE_BROADCAST_DELAY_MS = 100;
const DEFAULT_METRICS_INTERVAL_MS = 60_000;
const WEBSOCKET_PATH = '/live';

const PUBLIC_ASSETS = Object.freeze({
  '/': 'index.html',
  '/index.html': 'index.html',
  '/style.css': 'style.css',
  '/script.js': 'script.js',
  '/favicon.ico': 'favicon.ico',
  '/favicon.png': 'favicon.png',
  '/manifest.webmanifest': 'manifest.webmanifest',
  '/og-image.png': 'og-image.png',
  '/privacy': 'privacy.html',
  '/privacy.html': 'privacy.html',
  '/privacy.css': 'privacy.css',
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

function isSameOriginWebSocket(info, requireOrigin = false) {
  const origin = info.origin;
  if (!origin) return !requireOrigin;

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

function parseBoundedPositiveInteger(rawValue, name, fallback, maximum) {
  const value = parsePositiveInteger(rawValue, name, fallback);
  if (value > maximum) {
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
    batchIntervalMs: parsePositiveInteger(
      environment.BATCH_INTERVAL_MS,
      'BATCH_INTERVAL_MS',
      DEFAULT_BATCH_INTERVAL_MS,
    ),
    maxGlobalCandidates: parsePositiveInteger(
      environment.MAX_GLOBAL_CANDIDATES,
      'MAX_GLOBAL_CANDIDATES',
      DEFAULT_MAX_GLOBAL_CANDIDATES,
    ),
    maxClientCandidates: parsePositiveInteger(
      environment.MAX_CLIENT_CANDIDATES,
      'MAX_CLIENT_CANDIDATES',
      DEFAULT_MAX_CLIENT_CANDIDATES,
    ),
    maxBatchPulses: parseBoundedPositiveInteger(
      environment.MAX_BATCH_PULSES,
      'MAX_BATCH_PULSES',
      DEFAULT_MAX_BATCH_PULSES,
      MAX_BATCH_PULSES,
    ),
    busyRetryMs: parsePositiveInteger(
      environment.BUSY_RETRY_MS,
      'BUSY_RETRY_MS',
      DEFAULT_BUSY_RETRY_MS,
    ),
    shutdownDrainMs: parsePositiveInteger(
      environment.SHUTDOWN_DRAIN_MS,
      'SHUTDOWN_DRAIN_MS',
      DEFAULT_SHUTDOWN_DRAIN_MS,
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
    batchIntervalMs = DEFAULT_BATCH_INTERVAL_MS,
    maxGlobalCandidates = DEFAULT_MAX_GLOBAL_CANDIDATES,
    maxClientCandidates = DEFAULT_MAX_CLIENT_CANDIDATES,
    maxBatchPulses = DEFAULT_MAX_BATCH_PULSES,
    busyRetryMs = DEFAULT_BUSY_RETRY_MS,
    shutdownDrainMs = DEFAULT_SHUTDOWN_DRAIN_MS,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    presenceBroadcastDelayMs = DEFAULT_PRESENCE_BROADCAST_DELAY_MS,
    metricsIntervalMs = DEFAULT_METRICS_INTERVAL_MS,
    publicMode = false,
    publicOrigin = null,
    deployedCommit = 'unknown',
    processEpoch = randomBytes(4).readUInt32BE(0),
    logger = null,
    now = Date.now,
  } = options;

  const app = express();
  app.disable('x-powered-by');
  const normalizedPublicOrigin = parsePublicOrigin(publicOrigin);
  if (Boolean(publicMode) !== Boolean(normalizedPublicOrigin)) {
    throw new Error('PUBLIC_MODE and PUBLIC_ORIGIN must be configured together');
  }
  for (const [name, value, maximum] of [
    ['maxConnections', maxConnections, Number.MAX_SAFE_INTEGER],
    ['batchIntervalMs', batchIntervalMs, Number.MAX_SAFE_INTEGER],
    ['maxGlobalCandidates', maxGlobalCandidates, Number.MAX_SAFE_INTEGER],
    ['maxClientCandidates', maxClientCandidates, Number.MAX_SAFE_INTEGER],
    ['maxBatchPulses', maxBatchPulses, MAX_BATCH_PULSES],
    ['busyRetryMs', busyRetryMs, Number.MAX_SAFE_INTEGER],
    ['shutdownDrainMs', shutdownDrainMs, Number.MAX_SAFE_INTEGER],
  ]) {
    if (!Number.isInteger(value) || value <= 0 || value > maximum) {
      throw new Error(`Invalid ${name}: ${value}`);
    }
  }
  if (maxGlobalCandidates < maxConnections) {
    throw new Error(
      'maxGlobalCandidates must be at least maxConnections for fair admission',
    );
  }
  if (
    !Number.isInteger(processEpoch) ||
    processEpoch < 0 ||
    processEpoch > 0xffffffff
  ) {
    throw new Error(`Invalid processEpoch: ${processEpoch}`);
  }
  if (
    BATCH_HEADER_BYTES + (maxBatchPulses * PULSE_RECORD_BYTES) >
    maxBufferedBytes
  ) {
    throw new Error('maxBatchPulses exceeds the per-client buffer ceiling');
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
    pulseCandidates: 0,
    pulsesAccepted: 0,
    pulsesRejectedBusy: 0,
    invalidMessages: 0,
    clientRateLimited: 0,
    slowClientTerminations: 0,
    batchesShared: 0,
    batchDeliveryAttempts: 0,
    batchDeliveries: 0,
    pulseDeliveryAttempts: 0,
    pulseDeliveries: 0,
    pulseWireBytesAttempted: 0,
    pulseWireBytes: 0,
    candidateQueuePeak: 0,
    peakConnections: 0,
    totalConnectionMs: 0,
  };
  let candidateQueueDepth = 0;
  let connectedSourcesWithCandidates = 0;
  let isShuttingDown = false;

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
      pulseCandidates: metrics.pulseCandidates,
      pulsesAccepted: metrics.pulsesAccepted,
      pulsesRejectedBusy: metrics.pulsesRejectedBusy,
      invalidMessages: metrics.invalidMessages,
      clientRateLimited: metrics.clientRateLimited,
      slowClientTerminations: metrics.slowClientTerminations,
      batchesShared: metrics.batchesShared,
      batchDeliveryAttempts: metrics.batchDeliveryAttempts,
      batchDeliveries: metrics.batchDeliveries,
      pulseDeliveryAttempts: metrics.pulseDeliveryAttempts,
      pulseDeliveries: metrics.pulseDeliveries,
      pulseWireBytesAttempted: metrics.pulseWireBytesAttempted,
      pulseWireBytes: metrics.pulseWireBytes,
      candidateQueueDepth,
      candidateQueuePeak: metrics.candidateQueuePeak,
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
        filename.endsWith('.css')
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
    path: WEBSOCKET_PATH,
    perMessageDeflate: false,
    server,
    verifyClient: (info) => isSameOriginWebSocket(info, publicMode),
  });

  function reportError(error) {
    if (logger && typeof logger.error === 'function') {
      const candidateCode =
        error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
      const code = /^[a-z0-9_-]{1,64}$/i.test(candidateCode)
        ? candidateCode
        : 'UNKNOWN';
      logger.error(JSON.stringify({
        event: 'pulsii_runtime_error',
        code,
      }));
    }
  }

  function send(
    client,
    payload,
    options = undefined,
    onDelivered = null,
  ) {
    if (client.readyState !== WebSocket.OPEN) return false;
    const payloadBytes = Buffer.byteLength(payload);
    if (client.bufferedAmount + payloadBytes > maxBufferedBytes) {
      metrics.slowClientTerminations += 1;
      client.terminate();
      return false;
    }

    try {
      client.send(payload, options, (error) => {
        if (!error) {
          onDelivered?.();
          return;
        }
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
      if (
        client === excludedClient ||
        client.readyState !== WebSocket.OPEN ||
        !client.pulsiiConnected
      ) {
        continue;
      }
      if (send(client, payload)) deliveries += 1;
    }
    return deliveries;
  }

  const readyCandidateSources = new Set();
  let batchSequence = 0;

  function nextBatchSequence() {
    batchSequence = batchSequence >= 0xffffffff ? 1 : batchSequence + 1;
    return batchSequence;
  }

  function takeFairPulseBatch() {
    const pulses = [];

    while (
      pulses.length < maxBatchPulses &&
      readyCandidateSources.size > 0
    ) {
      const roundSources = Array.from(readyCandidateSources);
      for (const source of roundSources) {
        if (pulses.length >= maxBatchPulses) break;
        readyCandidateSources.delete(source);

        const pulse = source.pulseCandidates.shift();
        if (!pulse) continue;
        candidateQueueDepth -= 1;
        pulses.push(pulse);

        if (source.pulseCandidates.length > 0) {
          readyCandidateSources.add(source);
        } else if (source.hasCandidateReservation) {
          source.hasCandidateReservation = false;
          connectedSourcesWithCandidates = Math.max(
            0,
            connectedSourcesWithCandidates - 1,
          );
        }
      }
    }

    return pulses;
  }

  function flushPulseBatch() {
    const pulses = takeFairPulseBatch();
    if (pulses.length === 0) return null;

    const payload = encodePulseBatch({
      processEpoch,
      sequence: nextBatchSequence(),
      serverTimeMs: Math.max(0, Math.trunc(now())),
      pulses,
    });
    let deliveryAttempts = 0;
    for (const client of wss.clients) {
      if (
        client.readyState !== WebSocket.OPEN ||
        !client.pulsiiConnected
      ) continue;
      if (!send(client, payload, { binary: true }, () => {
        metrics.batchDeliveries += 1;
        metrics.pulseDeliveries += pulses.length;
        metrics.pulseWireBytes += payload.length;
      })) continue;
      deliveryAttempts += 1;
      metrics.batchDeliveryAttempts += 1;
      metrics.pulseDeliveryAttempts += pulses.length;
      metrics.pulseWireBytesAttempted += payload.length;
    }

    metrics.batchesShared += 1;
    return { deliveryAttempts, payload, pulses };
  }

  const pulseBatchTimer = setInterval(flushPulseBatch, batchIntervalMs);
  pulseBatchTimer.unref();

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
      socket.pulsiiConnected = false;
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
    socket.hasCandidateReservation = false;
    socket.pulsiiConnected = true;
    socket.pulseCandidates = [];
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

      metrics.pulseCandidates += 1;
      const emptyConnectedSources = Math.max(
        0,
        presenceCount - connectedSourcesWithCandidates,
      );
      const reservedForOtherSources =
        maxGlobalCandidates >= presenceCount
          ? Math.max(
            0,
            emptyConnectedSources -
              (socket.hasCandidateReservation ? 0 : 1),
          )
          : 0;
      if (
        isShuttingDown ||
        socket.pulseCandidates.length >= maxClientCandidates ||
        candidateQueueDepth >=
          maxGlobalCandidates - reservedForOtherSources
      ) {
        metrics.pulsesRejectedBusy += 1;
        const queuedBatches = Math.max(
          1,
          Math.ceil(candidateQueueDepth / maxBatchPulses),
        );
        send(
          socket,
          serializeBusy(Math.max(
            busyRetryMs,
            queuedBatches * batchIntervalMs,
          )),
        );
        return;
      }

      metrics.pulsesAccepted += 1;
      socket.pulseCandidates.push(pulse);
      if (!socket.hasCandidateReservation) {
        socket.hasCandidateReservation = true;
        connectedSourcesWithCandidates += 1;
      }
      candidateQueueDepth += 1;
      metrics.candidateQueuePeak = Math.max(
        metrics.candidateQueuePeak,
        candidateQueueDepth,
      );
      readyCandidateSources.add(socket);
      if (!socket.activated) {
        socket.activated = true;
        metrics.connectionsActivated += 1;
      }
    });

    socket.on('error', reportError);

    let connectionClosed = false;
    socket.on('close', () => {
      if (connectionClosed) return;
      connectionClosed = true;
      socket.pulsiiConnected = false;
      if (socket.hasCandidateReservation) {
        socket.hasCandidateReservation = false;
        connectedSourcesWithCandidates = Math.max(
          0,
          connectedSourcesWithCandidates - 1,
        );
      }
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

    isShuttingDown = true;
    clearInterval(heartbeatTimer);
    clearInterval(pulseBatchTimer);
    if (metricsTimer) clearInterval(metricsTimer);
    if (presenceBroadcastTimer !== null) {
      clearTimeout(presenceBroadcastTimer);
      presenceBroadcastTimer = null;
    }

    const httpClosed = server.listening
      ? new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        })
      : Promise.resolve();

    closePromise = (async () => {
      const webSocketClosed = new Promise((resolve) => {
        wss.close(resolve);
      });

      // An accepted pulse is irrevocable. Queue every accepted candidate for
      // delivery before adding the restart close frame behind those batches.
      while (candidateQueueDepth > 0) flushPulseBatch();

      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1012, 'Service restarting');
        }
      }

      let drainTimer;
      const drainExpired = new Promise((resolve) => {
        drainTimer = setTimeout(resolve, shutdownDrainMs);
        drainTimer.unref?.();
      });
      await Promise.race([webSocketClosed, drainExpired]);
      clearTimeout(drainTimer);

      for (const client of wss.clients) {
        if (client.readyState !== WebSocket.CLOSED) client.terminate();
      }

      await Promise.all([webSocketClosed, httpClosed]);
    })();
    return closePromise;
  }

  return {
    app,
    close,
    flushPulseBatch,
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
  WEBSOCKET_PATH,
  createTokenBucket,
  createPulsiiServer,
  isSameOriginWebSocket,
  parseBooleanFlag,
  parseBoundedPositiveInteger,
  parsePort,
  parsePublicOrigin,
  renderIndexHtml,
  runtimeOptionsFromEnv,
};
