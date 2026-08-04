'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_CALM_VISUALS,
  MAX_ACTIVE_PULSES,
  PULSE_LIFETIME_SECONDS,
  REDUCED_MAX_ACTIVE_PULSES,
  canonicalShareUrl,
  connectionLabel,
  hexToRgb,
  isTapGesture,
  normalizePulse,
  pulseAgeSeconds,
  pulseOpacity,
  reconnectDelay,
  shouldUseCalmVisuals,
} = require('../script');

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

test('bounds reconnect delay and active pulse capacity', () => {
  assert.equal(reconnectDelay(0, 0.5), 500);
  assert.equal(reconnectDelay(1, 0.5), 1000);
  assert.equal(reconnectDelay(20, 0.5), 8000);
  assert.equal(reconnectDelay(20, 0), 6400);
  assert.equal(reconnectDelay(20, 1), 8000);
  assert.equal(MAX_ACTIVE_PULSES, 180);
  assert.equal(REDUCED_MAX_ACTIVE_PULSES, 36);
  assert.equal(DEFAULT_CALM_VISUALS, true);
  assert.equal(shouldUseCalmVisuals(true, false), true);
  assert.equal(shouldUseCalmVisuals(false, true), true);
  assert.equal(shouldUseCalmVisuals(false, false), false);
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
