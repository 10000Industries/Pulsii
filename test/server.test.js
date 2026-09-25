'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const WebSocket = require('ws');
const { decodePulseBatch } = require('../lib/protocol');
const {
  PUBLIC_ASSETS,
  WEBSOCKET_PATH,
  createTokenBucket,
  createPulsiiServer,
  parseBooleanFlag,
  parsePort,
  parsePublicOrigin,
  runtimeOptionsFromEnv,
} = require('../server');

const EXPECTED_ASSET_ROUTES = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/favicon.ico',
  '/favicon.png',
  '/manifest.webmanifest',
  '/og-image.png',
  '/privacy',
  '/privacy.html',
  '/privacy.css',
];

const EXPECTED_PUBLIC_ROUTES = [
  ...EXPECTED_ASSET_ROUTES,
  '/robots.txt',
];

async function startService(options = {}) {
  const service = createPulsiiServer(options);
  const address = await service.listen(0, '127.0.0.1');
  return {
    ...service,
    httpUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}${WEBSOCKET_PATH}`,
  };
}

function request(url) {
  return new Promise((resolve, reject) => {
    const outgoing = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          headers: response.headers,
          status: response.statusCode,
        });
      });
    });
    outgoing.on('error', reject);
  });
}

async function connectClient(url, options) {
  const socket = new WebSocket(url, options);
  const messages = [];
  const batches = [];
  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      const batch = decodePulseBatch(data);
      assert.ok(batch, 'server binary frames must be canonical pulse batches');
      batches.push(batch);
      return;
    }
    messages.push(JSON.parse(data.toString()));
  });
  socket.on('error', () => {});
  await once(socket, 'open');
  return { batches, messages, socket };
}

function messagesOfType(client, type) {
  return client.messages.filter((message) => message.type === type);
}

function batchPulses(client) {
  return client.batches.flatMap((batch) => batch.pulses);
}

async function waitFor(predicate, description, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function closeClient(client) {
  if (client.socket.readyState === WebSocket.CLOSED) return;
  const closed = once(client.socket, 'close');
  client.socket.close();
  await closed;
}

test('serves only the explicit public surface with security headers', async (t) => {
  const service = await startService();
  t.after(() => service.close());

  assert.deepEqual(Object.keys(PUBLIC_ASSETS), EXPECTED_ASSET_ROUTES);

  const health = await request(`${service.httpUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), {
    status: 'ok',
    connections: 0,
  });
  assert.equal(health.headers['cache-control'], 'no-store');
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  assert.equal(health.headers['x-frame-options'], 'DENY');
  assert.equal(health.headers['x-robots-tag'], 'noindex, nofollow');
  assert.match(health.headers['content-security-policy'], /default-src 'self'/);
  assert.match(health.headers['content-security-policy'], /connect-src .*ws:/);

  const root = await request(`${service.httpUrl}/`);
  assert.equal(root.status, 200);
  assert.match(root.body, /<title>Pulsii\b/);
  assert.equal(
    root.headers['cache-control'],
    'public, max-age=0, must-revalidate',
  );
  assert.doesNotMatch(root.body, /rel="canonical"/);
  assert.doesNotMatch(root.body, /property="og:url"/);
  assert.match(root.body, /property="og:image" content="\/og-image\.png"/);
  assert.match(
    root.body,
    /id="calm-button"[^>]+aria-pressed="true"[^>]*>calm<\/button>/,
  );

  for (const route of EXPECTED_PUBLIC_ROUTES) {
    const response = await request(`${service.httpUrl}${route}`);
    assert.equal(response.status, 200, `${route} should be public`);
  }
  const script = await request(`${service.httpUrl}/script.js`);
  assert.equal(script.headers['cache-control'], 'public, max-age=0');
  const style = await request(`${service.httpUrl}/style.css`);
  assert.equal(style.headers['cache-control'], 'public, max-age=0');
  const privacyStyle = await request(`${service.httpUrl}/privacy.css`);
  assert.equal(privacyStyle.headers['cache-control'], 'public, max-age=0');
  const robots = await request(`${service.httpUrl}/robots.txt`);
  assert.equal(robots.body, 'User-agent: *\nDisallow: /\n');

  for (const route of [
    '/server.js',
    '/package.json',
    '/package-lock.json',
    '/README.md',
    '/instructions.txt',
    '/node_modules/ws/package.json',
  ]) {
    const response = await request(`${service.httpUrl}${route}`);
    assert.equal(response.status, 404, `${route} should remain private`);
    assert.equal(response.body, 'Not found');
  }
});

test('enables crawling and absolute metadata only in explicit public mode', async (t) => {
  const service = await startService({
    publicMode: true,
    publicOrigin: 'https://pulsii.net',
  });
  t.after(() => service.close());

  const root = await request(`${service.httpUrl}/`);
  assert.equal(root.headers['x-robots-tag'], undefined);
  assert.match(root.body, /rel="canonical" href="https:\/\/pulsii\.net\/"/);
  assert.match(
    root.body,
    /property="og:url" content="https:\/\/pulsii\.net\/"/,
  );
  assert.match(
    root.body,
    /property="og:image" content="https:\/\/pulsii\.net\/og-image\.png"/,
  );

  const robots = await request(`${service.httpUrl}/robots.txt`);
  assert.equal(robots.body, 'User-agent: *\nAllow: /\n');
});

test('batches one canonical pulse and echoes it exactly once to every client', async (t) => {
  const service = await startService({ batchIntervalMs: 15, processEpoch: 42 });
  t.after(() => service.close());

  const sender = await connectClient(service.wsUrl, { origin: service.httpUrl });
  const peer = await connectClient(service.wsUrl, { origin: service.httpUrl });

  sender.socket.send(
    JSON.stringify({
      type: 'pulse',
      xNorm: 0.25,
      yNorm: 0.75,
      color: '#A1B2C3',
    }),
  );

  await waitFor(
    () => batchPulses(peer).length === 1 && batchPulses(sender).length === 1,
    'echoed pulse batch',
  );
  await delay(30);

  assert.equal(peer.batches.length, 1);
  assert.equal(sender.batches.length, 1);
  assert.equal(peer.batches[0].processEpoch, 42);
  assert.equal(peer.batches[0].sequence, 1);
  assert.deepEqual(peer.batches[0], sender.batches[0]);
  assert.equal(batchPulses(peer)[0].color, '#a1b2c3');
  assert.ok(Math.abs(batchPulses(peer)[0].xNorm - 0.25) <= 1 / 0xffff);
  assert.ok(Math.abs(batchPulses(peer)[0].yNorm - 0.75) <= 1 / 0xffff);
});

test('drains queued candidates in fair one-per-source rounds', async (t) => {
  const service = await startService({
    batchIntervalMs: 1000,
    maxBatchPulses: 3,
    maxClientCandidates: 4,
    maxGlobalCandidates: 12,
    maxConnections: 12,
  });
  t.after(() => service.close());

  const first = await connectClient(service.wsUrl);
  const second = await connectClient(service.wsUrl);
  const third = await connectClient(service.wsUrl);
  const pulse = (xNorm) => JSON.stringify({
    type: 'pulse',
    xNorm,
    yNorm: 0.5,
    color: '#123456',
  });

  for (const xNorm of [0.11, 0.12, 0.13]) first.socket.send(pulse(xNorm));
  for (const xNorm of [0.21, 0.22]) second.socket.send(pulse(xNorm));
  third.socket.send(pulse(0.31));

  await waitFor(
    () => service.getMetrics().pulsesAccepted === 6,
    'six accepted candidates',
  );
  service.flushPulseBatch();
  await waitFor(() => first.batches.length === 1, 'first fair batch');

  const roundedFirst = first.batches[0].pulses.map(
    ({ xNorm }) => Math.round(xNorm * 100),
  );
  assert.deepEqual(roundedFirst, [11, 21, 31]);
  assert.equal(service.getMetrics().candidateQueueDepth, 3);

  service.flushPulseBatch();
  await waitFor(() => first.batches.length === 2, 'second fair batch');
  const roundedSecond = first.batches[1].pulses.map(
    ({ xNorm }) => Math.round(xNorm * 100),
  );
  assert.deepEqual(roundedSecond, [12, 22, 13]);
  assert.equal(service.getMetrics().candidateQueueDepth, 0);
  assert.equal(service.getMetrics().candidateQueuePeak, 6);
});

test('reserves one candidate slot per connected source before extras', async (t) => {
  const service = await startService({
    batchIntervalMs: 1000,
    maxBatchPulses: 3,
    maxClientCandidates: 3,
    maxGlobalCandidates: 3,
    maxConnections: 3,
  });
  t.after(() => service.close());
  const clients = await Promise.all([
    connectClient(service.wsUrl),
    connectClient(service.wsUrl),
    connectClient(service.wsUrl),
  ]);
  const pulse = (xNorm) => JSON.stringify({
    type: 'pulse',
    xNorm,
    yNorm: 0.5,
    color: '#123456',
  });

  for (const xNorm of [0.11, 0.12, 0.13]) {
    clients[0].socket.send(pulse(xNorm));
  }
  await waitFor(
    () => service.getMetrics().pulseCandidates === 3,
    'first source candidates',
  );
  clients[1].socket.send(pulse(0.21));
  clients[2].socket.send(pulse(0.31));

  await waitFor(
    () => service.getMetrics().pulseCandidates === 5,
    'all source candidates',
  );
  assert.equal(service.getMetrics().pulsesAccepted, 3);
  assert.equal(service.getMetrics().pulsesRejectedBusy, 2);

  service.flushPulseBatch();
  await waitFor(
    () => clients.every((client) => batchPulses(client).length === 3),
    'one accepted pulse per connected source',
  );
  assert.deepEqual(
    clients[0].batches[0].pulses.map(
      ({ xNorm }) => Math.round(xNorm * 100),
    ),
    [11, 21, 31],
  );
});

test('delivers identical one-per-source pulses across multiple batches', async (t) => {
  const service = await startService({
    batchIntervalMs: 1000,
    maxBatchPulses: 2,
    maxClientCandidates: 1,
    maxGlobalCandidates: 5,
    maxConnections: 5,
  });
  t.after(() => service.close());
  const clients = await Promise.all(
    Array.from({ length: 5 }, () => connectClient(service.wsUrl)),
  );
  const identicalPulse = JSON.stringify({
    type: 'pulse',
    xNorm: 0.5,
    yNorm: 0.5,
    color: '#abcdef',
  });

  for (const client of clients) client.socket.send(identicalPulse);
  await waitFor(
    () => service.getMetrics().pulsesAccepted === 5,
    'five simultaneous accepted candidates',
  );
  service.flushPulseBatch();
  service.flushPulseBatch();
  service.flushPulseBatch();
  await waitFor(
    () => clients.every((client) => batchPulses(client).length === 5),
    'five contributions on every client',
  );

  assert.equal(service.getMetrics().batchesShared, 3);
  assert.equal(service.getMetrics().pulseDeliveries, 25);
  for (const client of clients) {
    assert.deepEqual(
      batchPulses(client).map(({ color }) => color),
      Array(5).fill('#abcdef'),
    );
  }
});

test('keeps an accepted pulse after its sender disconnects before flush', async (t) => {
  const service = await startService({ batchIntervalMs: 1000 });
  t.after(() => service.close());
  const sender = await connectClient(service.wsUrl);
  const peer = await connectClient(service.wsUrl);

  sender.socket.send(JSON.stringify({
    type: 'pulse',
    xNorm: 0.25,
    yNorm: 0.75,
    color: '#fedcba',
  }));
  await waitFor(
    () => service.getMetrics().pulsesAccepted === 1,
    'accepted candidate before sender disconnect',
  );
  await closeClient(sender);
  service.flushPulseBatch();
  await waitFor(
    () => batchPulses(peer).length === 1,
    'accepted disconnected-sender pulse',
  );
  assert.equal(batchPulses(peer)[0].color, '#fedcba');
  assert.equal(service.getMetrics().pulsesAccepted, 1);
});

test('rejects malformed, unsafe, binary, and non-canonical pulse frames', async (t) => {
  const service = await startService();
  t.after(() => service.close());

  const sender = await connectClient(service.wsUrl);
  const peer = await connectClient(service.wsUrl);

  const invalidFrames = [
    '{',
    '{"type":"pulse","xNorm":1e999,"yNorm":0.5,"color":"#112233"}',
    JSON.stringify({
      type: 'pulse',
      xNorm: -0.01,
      yNorm: 0.5,
      color: '#112233',
    }),
    JSON.stringify({
      type: 'pulse',
      xNorm: 0.5,
      yNorm: 1.01,
      color: '#112233',
    }),
    JSON.stringify({
      type: 'pulse',
      xNorm: 0.5,
      yNorm: 0.5,
      color: '#fff',
    }),
    JSON.stringify({
      type: 'pulse',
      xNorm: 0.5,
      yNorm: 0.5,
      color: '#112233',
      extra: true,
    }),
  ];

  for (const frame of invalidFrames) {
    sender.socket.send(frame);
  }
  sender.socket.send(
    Buffer.from(
      JSON.stringify({
        type: 'pulse',
        xNorm: 0.5,
        yNorm: 0.5,
        color: '#112233',
      }),
    ),
  );

  await delay(75);
  assert.deepEqual(batchPulses(peer), []);
});

test('broadcasts presence changes and exposes the live count', async (t) => {
  const service = await startService();
  t.after(() => service.close());

  const first = await connectClient(service.wsUrl);
  await waitFor(
    () =>
      messagesOfType(first, 'presence').some((message) => message.count === 1),
    'presence count 1',
  );

  const second = await connectClient(service.wsUrl);
  await waitFor(
    () =>
      messagesOfType(first, 'presence').some((message) => message.count === 2) &&
      messagesOfType(second, 'presence').some((message) => message.count === 2),
    'presence count 2',
  );
  assert.equal(service.getPresenceCount(), 2);

  await closeClient(second);
  await waitFor(
    () => messagesOfType(first, 'presence').at(-1)?.count === 1,
    'presence count after disconnect',
  );

  const health = await request(`${service.httpUrl}/healthz`);
  assert.deepEqual(JSON.parse(health.body), {
    status: 'ok',
    connections: 1,
  });
});

test('closes a client that exceeds its message rate without over-broadcasting', async (t) => {
  const service = await startService({
    clientRateBurst: 2,
    clientRatePerSecond: 0.001,
  });
  t.after(() => service.close());

  const sender = await connectClient(service.wsUrl);
  const peer = await connectClient(service.wsUrl);
  const closed = once(sender.socket, 'close');

  for (const xNorm of [0.1, 0.2, 0.3]) {
    sender.socket.send(
      JSON.stringify({
        type: 'pulse',
        xNorm,
        yNorm: 0.5,
        color: '#123456',
      }),
    );
  }

  const [code, reason] = await closed;
  assert.equal(code, 1008);
  assert.equal(reason.toString(), 'Rate limit exceeded');

  await waitFor(
    () => batchPulses(peer).length === 2,
    'two permitted peer pulses',
  );
  await delay(30);
  assert.equal(batchPulses(peer).length, 2);
});

test('rejects a candidate before acceptance when a source queue is busy', async (t) => {
  const service = await startService({
    batchIntervalMs: 1000,
    busyRetryMs: 250,
    maxClientCandidates: 1,
    maxGlobalCandidates: 8,
    maxConnections: 8,
  });
  t.after(() => service.close());

  const sender = await connectClient(service.wsUrl);
  const peer = await connectClient(service.wsUrl);

  for (const xNorm of [0.1, 0.2]) {
    sender.socket.send(
      JSON.stringify({
        type: 'pulse',
        xNorm,
        yNorm: 0.5,
        color: '#123456',
      }),
    );
  }

  await waitFor(
    () => messagesOfType(sender, 'busy').length === 1,
    'sender busy notice',
  );
  service.flushPulseBatch();
  await waitFor(
    () => batchPulses(sender).length === 1 && batchPulses(peer).length === 1,
    'accepted pulse delivery',
  );

  assert.equal(messagesOfType(sender, 'busy')[0].retryAfterMs, 1000);
  assert.equal(service.getMetrics().pulseCandidates, 2);
  assert.equal(service.getMetrics().pulsesAccepted, 1);
  assert.equal(service.getMetrics().pulsesRejectedBusy, 1);
  assert.equal(service.getMetrics().pulseDeliveries, 2);
});

test('bounds the global candidate queue with an explicit busy rejection', async (t) => {
  const service = await startService({
    batchIntervalMs: 1000,
    maxClientCandidates: 2,
    maxGlobalCandidates: 2,
    maxConnections: 2,
  });
  t.after(() => service.close());
  const clients = await Promise.all([
    connectClient(service.wsUrl),
    connectClient(service.wsUrl),
  ]);

  for (let index = 0; index < clients.length; index += 1) {
    clients[index].socket.send(JSON.stringify({
      type: 'pulse',
      xNorm: (index + 1) / 4,
      yNorm: 0.5,
      color: '#123456',
    }));
  }

  await waitFor(
    () => service.getMetrics().pulsesAccepted === 2,
    'one reserved candidate per source',
  );
  clients[0].socket.send(JSON.stringify({
    type: 'pulse',
    xNorm: 0.75,
    yNorm: 0.5,
    color: '#123456',
  }));

  await waitFor(
    () => service.getMetrics().pulseCandidates === 3,
    'three global candidates',
  );
  await waitFor(
    () => clients.reduce(
      (total, client) => total + messagesOfType(client, 'busy').length,
      0,
    ) === 1,
    'one global busy rejection',
  );
  assert.equal(service.getMetrics().pulsesAccepted, 2);
  assert.equal(service.getMetrics().pulsesRejectedBusy, 1);
  assert.equal(service.getMetrics().candidateQueuePeak, 2);

  service.flushPulseBatch();
  await waitFor(
    () => clients.every((client) => batchPulses(client).length === 2),
    'globally accepted pulses',
  );
  assert.equal(service.getMetrics().pulseDeliveries, 4);
});

test('flushes every accepted candidate before a graceful restart close', async () => {
  const service = await startService({
    batchIntervalMs: 1000,
    maxBatchPulses: 1,
    shutdownDrainMs: 500,
  });
  const sender = await connectClient(service.wsUrl);
  const peer = await connectClient(service.wsUrl);

  for (const xNorm of [0.2, 0.8]) {
    sender.socket.send(JSON.stringify({
      type: 'pulse',
      xNorm,
      yNorm: 0.5,
      color: '#abcdef',
    }));
  }
  await waitFor(
    () => service.getMetrics().pulsesAccepted === 2,
    'accepted shutdown candidates',
  );

  const senderClosed = once(sender.socket, 'close');
  const peerClosed = once(peer.socket, 'close');
  await service.close();
  const [senderClose, peerClose] = await Promise.all([
    senderClosed,
    peerClosed,
  ]);

  assert.deepEqual(batchPulses(peer).map(({ color }) => color), [
    '#abcdef',
    '#abcdef',
  ]);
  assert.deepEqual(batchPulses(sender), batchPulses(peer));
  assert.equal(senderClose[0], 1012);
  assert.equal(senderClose[1].toString(), 'Service restarting');
  assert.equal(peerClose[0], 1012);
  assert.equal(service.getMetrics().candidateQueueDepth, 0);
  assert.equal(service.getMetrics().batchesShared, 2);
});

test('enforces the configured WebSocket payload ceiling', async (t) => {
  const service = await startService({ maxPayloadBytes: 128 });
  t.after(() => service.close());

  const sender = await connectClient(service.wsUrl);
  const closed = once(sender.socket, 'close');
  sender.socket.send('x'.repeat(1024));

  const [code] = await closed;
  assert.equal(code, 1009);
});

test('rejects cross-origin browser WebSocket handshakes', async (t) => {
  const service = await startService();
  t.after(() => service.close());

  const socket = new WebSocket(service.wsUrl, {
    origin: 'https://example.invalid',
  });
  socket.on('error', () => {});

  const [, response] = await once(socket, 'unexpected-response');
  assert.equal(response.statusCode, 401);
  response.resume();
});

test('serves WebSockets only at the explicit live endpoint', async (t) => {
  const service = await startService();
  t.after(() => service.close());

  const rootSocket = new WebSocket(service.wsUrl.replace(WEBSOCKET_PATH, '/'));
  rootSocket.on('error', () => {});
  const [, response] = await once(rootSocket, 'unexpected-response');
  assert.equal(response.statusCode, 400);
  response.resume();

  const live = await connectClient(service.wsUrl);
  assert.equal(live.socket.readyState, WebSocket.OPEN);
});

test('requires an Origin header for public-mode WebSockets', async (t) => {
  const service = await startService({
    publicMode: true,
    publicOrigin: 'https://pulsii.net',
  });
  t.after(() => service.close());

  const socket = new WebSocket(service.wsUrl);
  socket.on('error', () => {});
  const [, response] = await once(socket, 'unexpected-response');
  assert.equal(response.statusCode, 401);
  response.resume();

  const browser = await connectClient(service.wsUrl, {
    origin: service.httpUrl,
  });
  assert.equal(browser.socket.readyState, WebSocket.OPEN);
});

test('rejects a same-host browser handshake with the wrong scheme', async (t) => {
  const service = await startService();
  t.after(() => service.close());

  const socket = new WebSocket(service.wsUrl, {
    origin: service.httpUrl.replace('http:', 'https:'),
  });
  socket.on('error', () => {});

  const [, response] = await once(socket, 'unexpected-response');
  assert.equal(response.statusCode, 401);
  response.resume();
});

test('caps concurrent connections', async (t) => {
  const service = await startService({ maxConnections: 1 });
  t.after(() => service.close());

  const first = await connectClient(service.wsUrl);
  const secondSocket = new WebSocket(service.wsUrl);
  const secondMessages = [];
  secondSocket.on('message', (data) => secondMessages.push(data.toString()));
  secondSocket.on('error', () => {});
  const closed = once(secondSocket, 'close');

  const [code, reason] = await closed;
  assert.equal(code, 1013);
  assert.equal(reason.toString(), 'Server at capacity');
  assert.equal(service.getPresenceCount(), 1);
  assert.deepEqual(secondMessages, []);

  await closeClient(first);
});

test('trial budget rejects before acceptance and drains every accepted pulse', async (t) => {
  const service = await startService({
    maxConnections: 2,
    batchIntervalMs: 60_000,
    trial: { endsAt: Date.now() + 60_000, maxPulseBytes: 104 },
  });
  t.after(() => service.close());
  const sender = await connectClient(service.wsUrl);
  const peer = await connectClient(service.wsUrl);
  const senderClosed = once(sender.socket, 'close');
  const peerClosed = once(peer.socket, 'close');
  for (let i = 0; i < 3; i += 1) {
    sender.socket.send(JSON.stringify({
      type: 'pulse', xNorm: i / 3, yNorm: 0.5, color: '#00d4ff',
    }));
  }
  const [[senderCode], [peerCode]] = await Promise.all([senderClosed, peerClosed]);
  assert.equal(senderCode, 4000);
  assert.equal(peerCode, 4000);
  assert.equal(batchPulses(sender).length, 2);
  assert.deepEqual(batchPulses(sender), batchPulses(peer));
  const metrics = service.getMetrics();
  assert.equal(metrics.pulsesAccepted, 2);
  assert.equal(metrics.trialBytesReserved, 104);
  assert.equal(metrics.trialStopped, true);
  assert.ok(metrics.pulseWireBytes <= 104);
  const later = new WebSocket(service.wsUrl);
  later.on('error', () => {});
  const [laterCode] = await once(later, 'close');
  assert.equal(laterCode, 4000);
  assert.equal(service.getPresenceCount(), 0);
});

test('trial deadline drains pending pulses and stays expired across restart', async (t) => {
  let currentTime = Date.now();
  const trial = { endsAt: currentTime + 5000, maxPulseBytes: 10000 };
  const service = await startService({
    maxConnections: 2, batchIntervalMs: 60_000, trial, now: () => currentTime,
  });
  t.after(() => service.close());
  const sender = await connectClient(service.wsUrl);
  sender.socket.send(JSON.stringify({
    type: 'pulse', xNorm: 0.5, yNorm: 0.5, color: '#00d4ff',
  }));
  await waitFor(() => service.getMetrics().pulsesAccepted === 1, 'accepted pulse');
  const closed = once(sender.socket, 'close');
  currentTime = trial.endsAt;
  const [code] = await closed;
  assert.equal(code, 4000);
  assert.equal(batchPulses(sender).length, 1);
  await service.close();
  const restarted = await startService({ maxConnections: 2, trial, now: () => currentTime });
  t.after(() => restarted.close());
  const socket = new WebSocket(restarted.wsUrl);
  socket.on('error', () => {});
  const [restartedCode] = await once(socket, 'close');
  assert.equal(restartedCode, 4000);
  assert.equal(restarted.getMetrics().pulsesAccepted, 0);
});

test('trial mode refuses incomplete or insufficient bounds', () => {
  assert.throws(() => createPulsiiServer({
    ...runtimeOptionsFromEnv({ TRIAL_MODE: 'true' }),
  }), /Trial requires/);
  assert.throws(() => createPulsiiServer({
    maxConnections: 20, trial: { endsAt: Date.now() + 1000, maxPulseBytes: 1 },
  }), /Trial requires/);
  assert.deepEqual(runtimeOptionsFromEnv({
    TRIAL_MODE: 'true', TRIAL_ENDS_AT: '2026-12-01T19:15:00Z',
    TRIAL_MAX_PULSE_BYTES: '8388608',
    TRIAL_MAX_HTTP_BYTES: '10485760', TRIAL_BOOT_DEADLINE: '2026-12-01T19:00:30Z',
  }).trial, { endsAt: Date.parse('2026-12-01T19:15:00Z'), maxPulseBytes: 8388608,
    maxHttpBytes: 10485760, bootDeadline: Date.parse('2026-12-01T19:00:30Z') });
});

test('aggregate admission rejects bursts before acceptance and recovers', async (t) => {
  let clock = 1000;
  const service = await startService({ globalRateBurst: 2, globalRatePerSecond: 2,
    now: () => clock, batchIntervalMs: 10 });
  t.after(() => service.close());
  const a = await connectClient(service.wsUrl, { origin: service.httpUrl });
  const b = await connectClient(service.wsUrl, { origin: service.httpUrl });
  const pulse = JSON.stringify({ type: 'pulse', xNorm: 0.5, yNorm: 0.5, color: '#ff0000' });
  a.socket.send(pulse); b.socket.send(pulse); a.socket.send(pulse);
  await waitFor(() => service.getMetrics().pulsesRejectedBusy === 1, 'global rejection');
  await waitFor(() => batchPulses(a).length === 2 && batchPulses(b).length === 2, 'identical accepted batch');
  assert.equal(service.getMetrics().pulsesAccepted, 2);
  clock += 500;
  b.socket.send(pulse);
  await waitFor(() => batchPulses(a).length === 3 && batchPulses(b).length === 3, 'refilled global admission');
});

test('ping frames cannot bypass the per-connection outgoing-response limit', async (t) => {
  const service = await startService({ clientRateBurst: 2, clientRatePerSecond: 0.01 });
  t.after(() => service.close());
  const client = await connectClient(service.wsUrl, { origin: service.httpUrl });
  let pongs = 0;
  client.socket.on('pong', () => pongs++);
  const closed = once(client.socket, 'close');
  client.socket.ping('a'); client.socket.ping('b'); client.socket.ping('c');
  assert.equal((await closed)[0], 1008);
  assert.equal(pongs, 2);
});

test('connection-attempt limit covers repeated upgrades and recovers', async (t) => {
  let clock = 1000;
  const service = await startService({ upgradeRateBurst: 1, upgradeRatePerSecond: 1, now: () => clock });
  t.after(() => service.close());
  const first = await connectClient(service.wsUrl, { origin: service.httpUrl });
  await closeClient(first);
  await assert.rejects(connectClient(service.wsUrl, { origin: service.httpUrl }));
  assert.equal(service.getMetrics().upgradesRejected, 1);
  clock += 1000;
  const recovered = await connectClient(service.wsUrl, { origin: service.httpUrl });
  await closeClient(recovered);
});

test('HTTP response budget stops repeated asset requests without a rejection body', async (t) => {
  const service = await startService({ trial: { endsAt: Date.now() + 60000,
    maxPulseBytes: 100000, maxHttpBytes: 11000 } });
  t.after(() => service.close());
  assert.equal((await request(`${service.httpUrl}/healthz`)).status, 200);
  assert.equal((await request(`${service.httpUrl}/healthz`)).status, 200);
  await assert.rejects(request(`${service.httpUrl}/healthz`));
  assert.equal(service.getMetrics().httpRequestsRejected, 1);
  assert.equal(service.getMetrics().httpBytesReserved, 10240);
  assert.equal(service.getMetrics().trialStopped, true);
});

test('HTTP rate limit covers every path and expires without retaining visitor identifiers', async (t) => {
  let clock = 1000;
  const service = await startService({ httpRateBurst: 1, httpRatePerSecond: 1, now: () => clock });
  t.after(() => service.close());
  assert.equal((await request(`${service.httpUrl}/healthz`)).status, 200);
  await assert.rejects(request(`${service.httpUrl}/not-an-asset`));
  clock += 1000;
  assert.equal((await request(`${service.httpUrl}/robots.txt`)).status, 200);
});

test('boot deadline prevents a later restart and expired pages clearly end the session', async (t) => {
  const clock = Date.now();
  assert.throws(() => createPulsiiServer({ trial: { endsAt: clock + 60000,
    maxPulseBytes: 100000, maxHttpBytes: 10000, bootDeadline: clock - 1 } }), /boot deadline/);
  const service = await startService({ trial: { endsAt: clock - 1, maxPulseBytes: 100000 } });
  t.after(() => service.close());
  const ended = await request(service.httpUrl);
  assert.equal(ended.status, 410);
  assert.match(ended.body, /session has ended/);
});

test('keeps aggregate operational metrics without pulse content or identifiers', async (t) => {
  const service = await startService({ deployedCommit: 'abc123' });
  t.after(() => service.close());

  await request(`${service.httpUrl}/`);
  const sender = await connectClient(service.wsUrl);
  const peer = await connectClient(service.wsUrl);

  sender.socket.send(
    JSON.stringify({
      type: 'pulse',
      xNorm: 0.25,
      yNorm: 0.75,
      color: '#A1B2C3',
    }),
  );
  await waitFor(
    () => batchPulses(peer).length === 1,
    'metrics test peer pulse',
  );
  await closeClient(sender);

  const snapshot = service.getMetrics();
  assert.equal(snapshot.deployedCommit, 'abc123');
  assert.equal(snapshot.pageLoads, 1);
  assert.equal(snapshot.connectionsAccepted, 2);
  assert.equal(snapshot.connectionsActivated, 1);
  assert.equal(snapshot.connectionsClosed, 1);
  assert.equal(snapshot.pulseCandidates, 1);
  assert.equal(snapshot.pulsesAccepted, 1);
  assert.equal(snapshot.pulsesRejectedBusy, 0);
  assert.equal(snapshot.batchesShared, 1);
  assert.equal(snapshot.batchDeliveryAttempts, 2);
  assert.equal(snapshot.batchDeliveries, 2);
  assert.equal(snapshot.pulseDeliveryAttempts, 2);
  assert.equal(snapshot.pulseDeliveries, 2);
  assert.ok(snapshot.pulseWireBytesAttempted > 0);
  assert.ok(snapshot.pulseWireBytes > 0);
  assert.equal(snapshot.candidateQueueDepth, 0);
  assert.equal(snapshot.candidateQueuePeak, 1);
  assert.equal(snapshot.currentConnections, 1);
  assert.equal(snapshot.peakConnections, 2);

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /xNorm|yNorm|A1B2C3|ip|userAgent/i);
});

test('logs fixed runtime error codes without raw messages', async (t) => {
  const errors = [];
  const service = await startService({
    logger: {
      error(message) {
        errors.push(JSON.parse(message));
      },
      info() {},
    },
  });
  t.after(() => service.close());

  service.wss.emit('error', {
    code: 'ECONNRESET',
    message: 'sensitive address 192.0.2.1',
  });
  service.wss.emit('error', {
    code: 'invalid code with spaces',
    message: 'another sensitive detail',
  });

  assert.deepEqual(errors, [
    { event: 'pulsii_runtime_error', code: 'ECONNRESET' },
    { event: 'pulsii_runtime_error', code: 'UNKNOWN' },
  ]);
  assert.doesNotMatch(JSON.stringify(errors), /192\.0\.2\.1|sensitive/);
});

test('uses refillable token buckets instead of fixed-window bursts', () => {
  let currentTime = 0;
  const take = createTokenBucket(2, 2, () => currentTime);

  assert.equal(take(), true);
  assert.equal(take(), true);
  assert.equal(take(), false);

  currentTime = 500;
  assert.equal(take(), true);
  assert.equal(take(), false);

  currentTime = 1500;
  assert.equal(take(), true);
  assert.equal(take(), true);
  assert.equal(take(), false);
});

test('validates public and runtime configuration flags', () => {
  assert.equal(parseBooleanFlag(undefined, false), false);
  assert.equal(parseBooleanFlag('true'), true);
  assert.equal(parseBooleanFlag('0'), false);
  assert.throws(() => parseBooleanFlag('perhaps'), /Invalid boolean flag/);

  assert.deepEqual(
    runtimeOptionsFromEnv({
      PUBLIC_MODE: '1',
      PUBLIC_ORIGIN: 'https://pulsii.net',
      MAX_CONNECTIONS: '80',
      CLIENT_RATE_BURST: '8',
      CLIENT_RATE_PER_SECOND: '4',
      GLOBAL_RATE_BURST: '30',
      GLOBAL_RATE_PER_SECOND: '20',
      BATCH_INTERVAL_MS: '40',
      MAX_GLOBAL_CANDIDATES: '9000',
      MAX_CLIENT_CANDIDATES: '6',
      MAX_BATCH_PULSES: '3000',
      BUSY_RETRY_MS: '120',
      SHUTDOWN_DRAIN_MS: '400',
      METRICS_INTERVAL_MS: '30000',
      RENDER_GIT_COMMIT: 'deadbeef',
    }),
    {
      publicMode: true,
      publicOrigin: 'https://pulsii.net',
      maxConnections: 80,
      clientRateBurst: 8,
      clientRatePerSecond: 4,
      globalRateBurst: 30,
      globalRatePerSecond: 20,
      upgradeRateBurst: 40,
      upgradeRatePerSecond: 2,
      batchIntervalMs: 40,
      maxGlobalCandidates: 9000,
      maxClientCandidates: 6,
      maxBatchPulses: 3000,
      busyRetryMs: 120,
      shutdownDrainMs: 400,
      metricsIntervalMs: 30000,
      deployedCommit: 'deadbeef',
    },
  );
  assert.throws(
    () => runtimeOptionsFromEnv({ MAX_CONNECTIONS: '1.5' }),
    /Invalid MAX_CONNECTIONS/,
  );
  assert.throws(
    () => runtimeOptionsFromEnv({ MAX_BATCH_PULSES: '65536' }),
    /Invalid MAX_BATCH_PULSES/,
  );
  assert.equal(parsePublicOrigin('https://pulsii.net/'), 'https://pulsii.net');
  assert.throws(
    () => parsePublicOrigin('javascript:alert(1)'),
    /Invalid PUBLIC_ORIGIN/,
  );
  assert.throws(
    () => runtimeOptionsFromEnv({ PUBLIC_MODE: 'true' }),
    /PUBLIC_ORIGIN is required/,
  );
  assert.throws(
    () => runtimeOptionsFromEnv({ PUBLIC_ORIGIN: 'https://pulsii.net' }),
    /PUBLIC_MODE must be true/,
  );
  assert.throws(
    () => createPulsiiServer({ publicMode: true }),
    /must be configured together/,
  );
  assert.throws(
    () => createPulsiiServer({
      maxConnections: 3,
      maxGlobalCandidates: 2,
    }),
    /at least maxConnections/,
  );
  assert.throws(
    () => createPulsiiServer({ publicOrigin: 'https://pulsii.net' }),
    /must be configured together/,
  );
});

test('validates configured ports', () => {
  assert.equal(parsePort('0'), 0);
  assert.equal(parsePort('3000'), 3000);
  assert.throws(() => parsePort('not-a-port'), /Invalid PORT/);
  assert.throws(() => parsePort('65536'), /Invalid PORT/);
});
