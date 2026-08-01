'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPulsiiServer } = require('../server');
const {
  percentile95,
  runReviewProbe,
  validateTargetUrl,
} = require('../scripts/review-probe');

test('allows only localhost and the isolated Render review hostname', () => {
  assert.equal(
    validateTargetUrl('http://127.0.0.1:3000').origin,
    'http://127.0.0.1:3000',
  );
  assert.equal(
    validateTargetUrl('https://pulsii-restoration-review.onrender.com').origin,
    'https://pulsii-restoration-review.onrender.com',
  );
  assert.equal(
    validateTargetUrl(
      'https://pulsii-restoration-review-abc123.onrender.com',
    ).origin,
    'https://pulsii-restoration-review-abc123.onrender.com',
  );

  for (const target of [
    'https://pulsii.net',
    'https://www.pulsii.net',
    'https://pulsii.onrender.com',
    'https://example.com',
    'http://pulsii-restoration-review.onrender.com',
    'https://pulsii-restoration-review.onrender.com/path',
  ]) {
    assert.throws(() => validateTargetUrl(target));
  }
});

test('calculates the nearest-rank p95 latency', () => {
  assert.equal(percentile95([1, 2, 3, 4, 5]), 5);
  assert.equal(percentile95(Array.from({ length: 20 }, (_, index) => index + 1)), 19);
  assert.throws(() => percentile95([]));
});

test('rejects unsafe probe settings before making a request', async () => {
  await assert.rejects(
    runReviewProbe('http://localhost', { sampleCount: 0 }),
    /sampleCount/,
  );
  await assert.rejects(
    runReviewProbe('http://localhost', { latencyGateMs: 0 }),
    /latencyGateMs/,
  );
});

test('probes preview headers, exact-once relay, latency, and reconnect locally', async (t) => {
  const service = createPulsiiServer();
  const address = await service.listen(0, '127.0.0.1');
  t.after(() => service.close());

  const result = await runReviewProbe(
    `http://127.0.0.1:${address.port}`,
    {
      sampleCount: 5,
      sampleIntervalMs: 5,
      timeoutMs: 3000,
      latencyGateMs: 1000,
    },
  );

  assert.equal(result.baselineConnections, 0);
  assert.equal(result.pulseSamples, 5);
  assert.equal(result.exactOnce, true);
  assert.equal(result.reconnectDelivery, true);
  assert.equal(result.passed, true);
  assert.ok(result.p95LatencyMs < 1000);
});
