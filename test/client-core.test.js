'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BATCH_HEADER_BYTES,
  BATCH_PROTOCOL_VERSION,
  CONNECTION_TIMEOUT_MS,
  CROWD_VISUAL_THRESHOLD,
  DEFAULT_CALM_VISUALS,
  MIN_LATE_VISIBILITY_SECONDS,
  PULSE_LIFETIME_SECONDS,
  PULSE_RECORD_BYTES,
  STABLE_CONNECTION_MS,
  canonicalShareUrl,
  connectionLabel,
  crowdIntensityScale,
  decodePulseBatch,
  hexToRgb,
  isNewBatchSequence,
  isTapGesture,
  normalizePulse,
  nextCrowdMode,
  pulseAgeSeconds,
  pulseCreatedAtForBatch,
  pulseOpacity,
  reconnectDelay,
  reconnectPolicy,
  shouldUseCalmVisuals,
} = require('../script');
const { encodePulseBatch } = require('../lib/protocol');

test('normalizes a canonical browser pulse', () => {
  assert.deepEqual(
    normalizePulse({
      type: 'pulse',
      xNorm: 0.25,
      yNorm: 0.75,
      color: '#A1B2C3',
    }),
    {
      type: 'pulse',
      xNorm: 0.25,
      yNorm: 0.75,
      color: '#a1b2c3',
    },
  );

  assert.deepEqual(hexToRgb('#a1b2c3'), { r: 161, g: 178, b: 195 });
});

test('rejects malformed browser pulses', () => {
  for (const value of [
    null,
    [],
    { type: 'presence', count: 2 },
    { type: 'pulse', xNorm: Number.NaN, yNorm: 0.5, color: '#112233' },
    { type: 'pulse', xNorm: -0.01, yNorm: 0.5, color: '#112233' },
    { type: 'pulse', xNorm: 0.5, yNorm: 1.01, color: '#112233' },
    { type: 'pulse', xNorm: 0.5, yNorm: 0.5, color: '#fff' },
    {
      type: 'pulse',
      xNorm: 0.5,
      yNorm: 0.5,
      color: '#112233',
      extra: true,
    },
  ]) {
    assert.equal(normalizePulse(value), null);
  }

  assert.equal(hexToRgb('red'), null);
});

test('uses a monotonic exponential pulse fade', () => {
  const start = pulseOpacity(0);
  const quarter = pulseOpacity(PULSE_LIFETIME_SECONDS * 0.25);
  const halfway = pulseOpacity(PULSE_LIFETIME_SECONDS * 0.5);
  const end = pulseOpacity(PULSE_LIFETIME_SECONDS);

  assert.ok(start > quarter);
  assert.ok(quarter > halfway);
  assert.ok(halfway > end);
  assert.ok(end > 0);
});

test('uses wall-clock pulse age so suspended tabs cannot replay stale pulses', () => {
  assert.equal(pulseAgeSeconds(1_000, 1_000), 0);
  assert.equal(pulseAgeSeconds(1_000, 3_350), 2.35);
  assert.equal(pulseAgeSeconds(5_000, 4_000), 0);
  assert.equal(pulseAgeSeconds(Number.NaN, 4_000), 0);
});

test('uses server time for a shared phase while preserving a late visible tail', () => {
  assert.equal(
    pulseCreatedAtForBatch(10_000, 10_050, 500),
    450,
  );
  assert.equal(
    pulseCreatedAtForBatch(10_000, 10_900, 8_000),
    7_100,
  );
  assert.equal(
    pulseCreatedAtForBatch(10_000, 20_000, 30_000),
    30_000 - ((PULSE_LIFETIME_SECONDS - MIN_LATE_VISIBILITY_SECONDS) * 1000),
  );
  assert.equal(
    pulseCreatedAtForBatch(11_000, 10_000, 500),
    500,
  );
});

test('bounds reconnect delay and selects explicit close-code policies', () => {
  assert.equal(reconnectDelay(0, 0.5), 500);
  assert.equal(reconnectDelay(1, 0.5), 1000);
  assert.equal(reconnectDelay(20, 0.5), 8000);
  assert.equal(reconnectDelay(20, 0), 6000);
  assert.equal(reconnectDelay(20, 1), 8000);
  assert.deepEqual(reconnectPolicy(1008, 0, 0.5), {
    delayMs: 10_000,
    state: 'limited',
    text: 'paused · too many pulses',
  });
  assert.deepEqual(reconnectPolicy(1013, 0, 0.5), {
    delayMs: 15_000,
    state: 'full',
    text: 'canvas full · retrying',
  });
  assert.equal(CONNECTION_TIMEOUT_MS, 12_000);
  assert.equal(STABLE_CONNECTION_MS, 30_000);
  assert.equal(DEFAULT_CALM_VISUALS, true);
  assert.equal(shouldUseCalmVisuals(true, false), true);
  assert.equal(shouldUseCalmVisuals(false, true), true);
  assert.equal(shouldUseCalmVisuals(false, false), false);
  assert.equal(
    shouldUseCalmVisuals(false, false, CROWD_VISUAL_THRESHOLD),
    true,
  );
  assert.equal(crowdIntensityScale(180), 1);
  assert.ok(crowdIntensityScale(10_000) >= 0.08);
  assert.ok(crowdIntensityScale(10_000) < 0.2);
  assert.equal(nextCrowdMode(false, CROWD_VISUAL_THRESHOLD - 1), false);
  assert.equal(nextCrowdMode(false, CROWD_VISUAL_THRESHOLD), true);
  assert.equal(nextCrowdMode(true, CROWD_VISUAL_THRESHOLD - 1), true);
  assert.equal(nextCrowdMode(true, 1), true);
  assert.equal(nextCrowdMode(true, 0), false);
});

test('decodes compact server pulse batches for the browser', () => {
  const encoded = encodePulseBatch({
    processEpoch: 123,
    sequence: 7,
    serverTimeMs: 1_786_140_000_000,
    pulses: [
      { type: 'pulse', xNorm: 0, yNorm: 1, color: '#A1B2C3' },
      { type: 'pulse', xNorm: 0.25, yNorm: 0.75, color: '#00d4ff' },
    ],
  });
  const decoded = decodePulseBatch(encoded);

  assert.equal(BATCH_PROTOCOL_VERSION, 1);
  assert.equal(BATCH_HEADER_BYTES, 19);
  assert.equal(PULSE_RECORD_BYTES, 7);
  assert.equal(decoded.processEpoch, 123);
  assert.equal(decoded.sequence, 7);
  assert.equal(decoded.serverTimeMs, 1_786_140_000_000);
  assert.equal(decoded.count, 2);
  assert.deepEqual(decoded.pulses[0], {
    type: 'pulse',
    xNorm: 0,
    yNorm: 1,
    color: '#a1b2c3',
  });
  assert.ok(Math.abs(decoded.pulses[1].xNorm - 0.25) < 0.00002);
  assert.ok(Math.abs(decoded.pulses[1].yNorm - 0.75) < 0.00002);
  assert.equal(decoded.pulses[1].color, '#00d4ff');
  assert.equal(decodePulseBatch(encoded.subarray(0, encoded.length - 1)), null);
  const zeroSequence = Buffer.from(encoded);
  zeroSequence.writeUInt32BE(0, 5);
  assert.equal(decodePulseBatch(zeroSequence), null);
});

test('accepts only forward batch sequences, including the uint32 wrap', () => {
  assert.equal(isNewBatchSequence(0, 1), true);
  assert.equal(isNewBatchSequence(7, 8), true);
  assert.equal(isNewBatchSequence(7, 7), false);
  assert.equal(isNewBatchSequence(8, 7), false);
  assert.equal(isNewBatchSequence(0xffff_ffff, 1), true);
  assert.equal(isNewBatchSequence(0xffff_ff00, 1), true);
  assert.equal(isNewBatchSequence(1, 0xffff_ffff), false);
  assert.equal(isNewBatchSequence(1, 0), false);
});

test('uses honest presence labels and a canonical invitation URL', () => {
  assert.equal(connectionLabel(null), 'live');
  assert.equal(connectionLabel(1), 'live · just you here');
  assert.equal(connectionLabel(2), 'live · 2 connections');
  assert.equal(
    canonicalShareUrl('https://pulsii.net/?utm_source=test#moment'),
    'https://pulsii.net/',
  );
  assert.equal(canonicalShareUrl('not a url'), 'not a url');
});

test('accepts a single touch tap but rejects drags and multi-touch gestures', () => {
  assert.equal(isTapGesture(10, 10, 16, 17, false), true);
  assert.equal(isTapGesture(10, 10, 40, 10, false), false);
  assert.equal(isTapGesture(10, 10, 10, 10, true), false);
  assert.equal(isTapGesture(10, 10, Number.NaN, 10, false), false);
});
