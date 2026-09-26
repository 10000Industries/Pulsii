'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const WebSocket = require('ws');
const { decodePulseBatch } = require('../lib/protocol');
const { WEBSOCKET_PATH } = require('../server');

const DEFAULT_SAMPLE_COUNT = 20;
// Stay within the review service's two-pulse/second per-client refill.
const DEFAULT_SAMPLE_INTERVAL_MS = 550;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LATENCY_GATE_MS = 500;
const REVIEW_HOST = /^pulsii-restoration-review(?:-[a-z0-9-]+)?\.onrender\.com$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORBIDDEN_HOSTS = new Set([
  'pulsii.net',
  'www.pulsii.net',
  'pulsii.onrender.com',
]);

function validateTargetUrl(rawTarget) {
  if (!rawTarget) {
    throw new Error('Pass the isolated review URL as the only argument');
  }

  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new Error(`Invalid review URL: ${rawTarget}`);
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('Review URL must use http or https');
  }
  if (
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search ||
    target.hash
  ) {
    throw new Error('Review URL must be a bare origin with no credentials, path, query, or fragment');
  }

  const hostname = target.hostname.toLowerCase();
  if (FORBIDDEN_HOSTS.has(hostname)) {
    throw new Error(`Refusing to probe existing Pulsii production: ${hostname}`);
  }
  if (!LOCAL_HOSTS.has(hostname) && !REVIEW_HOST.test(hostname)) {
    throw new Error('Target must be localhost or the isolated pulsii-restoration-review Render hostname');
  }
  if (!LOCAL_HOSTS.has(hostname) && target.protocol !== 'https:') {
    throw new Error('Remote review URLs must use https');
  }

  return target;
}

function percentile95(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('At least one latency sample is required');
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}

async function fetchResponse(url, timeoutMs) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    body: await response.text(),
    headers: response.headers,
    status: response.status,
  };
}

async function verifyHttpSurface(target, timeoutMs) {
  const warmupStartedAt = performance.now();
  const health = await fetchResponse(new URL('/healthz', target), timeoutMs);
  const warmupMs = performance.now() - warmupStartedAt;
  assert.equal(health.status, 200, '/healthz must return 200');
  const healthBody = JSON.parse(health.body);
  assert.equal(healthBody.status, 'ok', '/healthz must report ok');
  assert.ok(
    Number.isInteger(healthBody.connections) && healthBody.connections >= 0,
    '/healthz must expose a non-negative connection count',
  );

  const [
    root,
    robots,
    script,
    style,
    privacy,
    privacyStyle,
    manifest,
    socialImage,
    privateSource,
  ] =
    await Promise.all([
      fetchResponse(new URL('/', target), timeoutMs),
      fetchResponse(new URL('/robots.txt', target), timeoutMs),
      fetchResponse(new URL('/script.js', target), timeoutMs),
      fetchResponse(new URL('/style.css', target), timeoutMs),
      fetchResponse(new URL('/privacy', target), timeoutMs),
      fetchResponse(new URL('/privacy.css', target), timeoutMs),
      fetchResponse(new URL('/manifest.webmanifest', target), timeoutMs),
      fetchResponse(new URL('/og-image.png', target), timeoutMs),
      fetchResponse(new URL('/server.js', target), timeoutMs),
    ]);

  for (const [name, response] of [
    ['/', root],
    ['/robots.txt', robots],
    ['/script.js', script],
    ['/style.css', style],
    ['/privacy', privacy],
    ['/privacy.css', privacyStyle],
    ['/manifest.webmanifest', manifest],
    ['/og-image.png', socialImage],
  ]) {
    assert.equal(response.status, 200, `${name} must return 200`);
  }

  assert.equal(
    root.headers.get('x-robots-tag'),
    'noindex, nofollow',
    'review root must remain unindexed',
  );
  assert.match(
    root.headers.get('content-security-policy') || '',
    /default-src 'self'/,
    'review root must include the expected content security policy',
  );
  assert.doesNotMatch(root.body, /rel="canonical"/i);
  assert.doesNotMatch(root.body, /property="og:url"/i);
  assert.equal(robots.body, 'User-agent: *\nDisallow: /\n');
  assert.equal(privateSource.status, 404, '/server.js must remain private');

  return {
    baselineConnections: healthBody.connections,
    warmupMs,
  };
}

async function connectObserved(websocketUrl, origin, timeoutMs) {
  const socket = new WebSocket(websocketUrl, { origin });
  const messages = [];
  socket.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        const batch = decodePulseBatch(data);
        if (!batch) {
          messages.push(null);
          return;
        }
        messages.push(...batch.pulses);
        return;
      }
      messages.push(JSON.parse(data.toString()));
    } catch {
      messages.push(null);
    }
  });
  socket.on('error', () => {});

  await Promise.race([
    once(socket, 'open'),
    delay(timeoutMs).then(() => {
      throw new Error(`Timed out opening WebSocket to ${origin}`);
    }),
  ]);
  return { messages, socket };
}

async function waitForMessage(client, predicate, description, options = {}) {
  const {
    startIndex = 0,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    for (let index = startIndex; index < client.messages.length; index += 1) {
      const message = client.messages[index];
      if (message && predicate(message)) return message;
    }
    await delay(5);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function closeObserved(client, timeoutMs = 1000) {
  if (!client || client.socket.readyState === WebSocket.CLOSED) return;
  if (client.socket.readyState !== WebSocket.OPEN) {
    client.socket.terminate();
    return;
  }
  const closed = once(client.socket, 'close');
  client.socket.close(1000, 'Review probe complete');
  await Promise.race([
    closed,
    delay(timeoutMs).then(() => client.socket.terminate()),
  ]);
}

function matchingPulse(message, pulse) {
  return (
    message?.type === 'pulse' &&
    Math.abs(message.xNorm - pulse.xNorm) <= (1 / 0xffff) &&
    Math.abs(message.yNorm - pulse.yNorm) <= (1 / 0xffff) &&
    message.color === pulse.color
  );
}

async function runReviewProbe(rawTarget, options = {}) {
  const target = validateTargetUrl(rawTarget);
  const sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;
  const sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const latencyGateMs = options.latencyGateMs ?? DEFAULT_LATENCY_GATE_MS;
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 50) {
    throw new Error('sampleCount must be an integer from 2 to 50');
  }
  if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs < 0) {
    throw new Error('sampleIntervalMs must be a non-negative number');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive number');
  }
  if (!Number.isFinite(latencyGateMs) || latencyGateMs <= 0) {
    throw new Error('latencyGateMs must be a positive number');
  }

  const httpResult = await verifyHttpSurface(target, timeoutMs);
  const websocketUrl = new URL(target);
  websocketUrl.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  websocketUrl.pathname = WEBSOCKET_PATH;
  const clients = [];
  const latencies = [];
  const samplePulses = [];

  try {
    const sender = await connectObserved(websocketUrl, target.origin, timeoutMs);
    clients.push(sender);
    await waitForMessage(
      sender,
      (message) =>
        message.type === 'presence' &&
        message.count === httpResult.baselineConnections + 1,
      'sender presence',
      { timeoutMs },
    );

    const receiver = await connectObserved(websocketUrl, target.origin, timeoutMs);
    clients.push(receiver);
    const expectedTogether = httpResult.baselineConnections + 2;
    await Promise.all([
      waitForMessage(
        sender,
        (message) => message.type === 'presence' && message.count === expectedTogether,
        'sender shared presence',
        { timeoutMs },
      ),
      waitForMessage(
        receiver,
        (message) => message.type === 'presence' && message.count === expectedTogether,
        'receiver shared presence',
        { timeoutMs },
      ),
    ]);

    for (let index = 0; index < sampleCount; index += 1) {
      const pulse = {
        type: 'pulse',
        xNorm: Number((0.1 + (index / 1000)).toFixed(3)),
        yNorm: 0.51,
        color: `#00${index.toString(16).padStart(4, '0')}`,
      };
      samplePulses.push(pulse);
      const receiverStart = receiver.messages.length;
      const startedAt = performance.now();
      sender.socket.send(JSON.stringify(pulse));
      await waitForMessage(
        receiver,
        (message) => matchingPulse(message, pulse),
        `relay sample ${index + 1}`,
        { startIndex: receiverStart, timeoutMs },
      );
      latencies.push(performance.now() - startedAt);
      if (sampleIntervalMs > 0) await delay(sampleIntervalMs);
    }

    await delay(50);
    for (const pulse of samplePulses) {
      assert.equal(
        receiver.messages.filter((message) => matchingPulse(message, pulse)).length,
        1,
        'each sample must reach the peer exactly once',
      );
      assert.equal(
        sender.messages.filter((message) => matchingPulse(message, pulse)).length,
        1,
        'each accepted sample must echo exactly once to its sender',
      );
    }

    const senderPresenceStart = sender.messages.length;
    await closeObserved(receiver);
    await waitForMessage(
      sender,
      (message) =>
        message.type === 'presence' &&
        message.count === httpResult.baselineConnections + 1,
      'presence after receiver disconnect',
      { startIndex: senderPresenceStart, timeoutMs },
    );

    const replacement = await connectObserved(websocketUrl, target.origin, timeoutMs);
    clients.push(replacement);
    await waitForMessage(
      replacement,
      (message) => message.type === 'presence' && message.count === expectedTogether,
      'replacement presence',
      { timeoutMs },
    );

    const reconnectPulse = {
      type: 'pulse',
      xNorm: 0.91,
      yNorm: 0.91,
      color: '#7cff6b',
    };
    const replacementStart = replacement.messages.length;
    const reconnectStartedAt = performance.now();
    sender.socket.send(JSON.stringify(reconnectPulse));
    await waitForMessage(
      replacement,
      (message) => matchingPulse(message, reconnectPulse),
      'pulse after receiver reconnect',
      { startIndex: replacementStart, timeoutMs },
    );
    const reconnectLatencyMs = performance.now() - reconnectStartedAt;

    const p95LatencyMs = percentile95(latencies);
    return {
      target: target.origin,
      baselineConnections: httpResult.baselineConnections,
      warmupMs: rounded(httpResult.warmupMs),
      pulseSamples: sampleCount,
      minLatencyMs: rounded(Math.min(...latencies)),
      medianLatencyMs: rounded(
        [...latencies].sort((left, right) => left - right)[
          Math.floor(latencies.length / 2)
        ],
      ),
      p95LatencyMs: rounded(p95LatencyMs),
      maxLatencyMs: rounded(Math.max(...latencies)),
      reconnectLatencyMs: rounded(reconnectLatencyMs),
      exactOnce: true,
      reconnectDelivery: true,
      latencyGateMs,
      passed: p95LatencyMs < latencyGateMs,
    };
  } finally {
    await Promise.all(clients.map((client) => closeObserved(client)));
  }
}

async function main() {
  const result = await runReviewProbe(process.argv[2]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  percentile95,
  runReviewProbe,
  validateTargetUrl,
};
