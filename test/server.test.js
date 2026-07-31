'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const WebSocket = require('ws');
const {
  PUBLIC_ASSETS,
  createPulsiiServer,
  parsePort,
} = require('../server');

const EXPECTED_PUBLIC_ROUTES = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/favicon.ico',
  '/favicon.png',
  '/manifest.webmanifest',
  '/og-image.png',
  '/robots.txt',
];

async function startService(options = {}) {
  const service = createPulsiiServer(options);
  const address = await service.listen(0, '127.0.0.1');
  return {
    ...service,
    httpUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}`,
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
  socket.on('message', (data) => {
    messages.push(JSON.parse(data.toString()));
  });
  socket.on('error', () => {});
  await once(socket, 'open');
  return { messages, socket };
}

function messagesOfType(client, type) {
  return client.messages.filter((message) => message.type === type);
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

  assert.deepEqual(Object.keys(PUBLIC_ASSETS), EXPECTED_PUBLIC_ROUTES);

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

  for (const route of EXPECTED_PUBLIC_ROUTES) {
    const response = await request(`${service.httpUrl}${route}`);
    assert.equal(response.status, 200, `${route} should be public`);
  }

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

test('relays one canonical valid pulse to peers and never echoes it', async (t) => {
  const service = await startService();
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
    () => messagesOfType(peer, 'pulse').length === 1,
    'peer pulse',
  );
  await delay(30);

  assert.deepEqual(messagesOfType(peer, 'pulse'), [
    {
      type: 'pulse',
      xNorm: 0.25,
      yNorm: 0.75,
      color: '#a1b2c3',
    },
  ]);
  assert.deepEqual(messagesOfType(sender, 'pulse'), []);
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
  assert.deepEqual(messagesOfType(peer, 'pulse'), []);
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
    rateLimitMaxMessages: 2,
    rateLimitWindowMs: 60_000,
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
    () => messagesOfType(peer, 'pulse').length === 2,
    'two permitted peer pulses',
  );
  await delay(30);
  assert.equal(messagesOfType(peer, 'pulse').length, 2);
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

test('validates configured ports', () => {
  assert.equal(parsePort('0'), 0);
  assert.equal(parsePort('3000'), 3000);
  assert.throws(() => parsePort('not-a-port'), /Invalid PORT/);
  assert.throws(() => parsePort('65536'), /Invalid PORT/);
});
