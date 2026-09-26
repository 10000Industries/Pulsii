'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertEstimatedPulseBudget,
  busyNoticesAreAcceptable,
  createByteBudget,
  estimatePulseWireBytes,
  loadConfig,
  summarizeRecipientDelivery,
  validateTargetUrl,
} = require('../scripts/deployed-load-test');

test('allows only localhost and isolated Pulsii review targets', () => {
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
    'wss://pulsii-restoration-review.onrender.com',
  ]) {
    assert.throws(() => validateTargetUrl(target));
  }
});

test('requires an explicit byte budget and validates bounded load settings', () => {
  const base = {
    DEPLOYED_LOAD_TARGET: 'http://localhost:3000',
    DEPLOYED_LOAD_BYTE_BUDGET: '100000',
  };
  const config = loadConfig(base, ['node', 'deployed-load-test.js']);
  assert.equal(config.mode, 'connection');
  assert.equal(config.clients, 10);
  assert.equal(config.byteBudget, 100000);

  assert.throws(
    () => loadConfig(
      { DEPLOYED_LOAD_TARGET: base.DEPLOYED_LOAD_TARGET },
      ['node', 'deployed-load-test.js'],
    ),
    /DEPLOYED_LOAD_BYTE_BUDGET is required/,
  );
  assert.throws(
    () => loadConfig(
      { ...base, DEPLOYED_LOAD_MODE: 'production-meltdown' },
      ['node', 'deployed-load-test.js'],
    ),
    /DEPLOYED_LOAD_MODE/,
  );
  assert.throws(
    () => loadConfig(
      { ...base, DEPLOYED_LOAD_CLIENTS: '5001' },
      ['node', 'deployed-load-test.js'],
    ),
    /DEPLOYED_LOAD_CLIENTS/,
  );
  assert.throws(
    () => loadConfig(
      { ...base, DEPLOYED_LOAD_DURATION_MS: '3600001' },
      ['node', 'deployed-load-test.js'],
    ),
    /DEPLOYED_LOAD_DURATION_MS/,
  );
});

test('guards the minimum pulse payload against the caller byte budget', () => {
  assert.equal(estimatePulseWireBytes(0, 100), 0);
  assert.equal(estimatePulseWireBytes(10, 5), (19 + (10 * 7)) * 5);

  const config = {
    mode: 'all-client-burst',
    clients: 10,
    pulses: 2,
    byteBudget: 2_000,
  };
  assert.equal(assertEstimatedPulseBudget(config), (19 + (20 * 7)) * 10);
  assert.throws(
    () => assertEstimatedPulseBudget({ ...config, byteBudget: 1_590 }),
    /leaves no room/,
  );
  assert.throws(() => estimatePulseWireBytes(-1, 1), /pulseCount/);
});

test('stops accounting before accepting a message over the hard byte budget', () => {
  let observedError = null;
  const budget = createByteBudget(100, (error) => {
    observedError = error;
  });

  assert.equal(budget.account(60), true);
  assert.equal(budget.account(40), true);
  assert.equal(budget.account(1), false);
  assert.match(observedError.message, /budget exceeded/);
  assert.deepEqual(budget.snapshot(), {
    attemptedBytes: 101,
    exceeded: true,
    limit: 100,
    receivedBytes: 100,
  });
});

test('requires exact delivery to every recipient instead of an aggregate match', () => {
  const exact = summarizeRecipientDelivery([
    { beforePulses: 2, client: { batchPulses: 5 } },
    { beforePulses: 4, client: { batchPulses: 7 } },
  ], 3);
  assert.deepEqual(exact, {
    deliveryComplete: true,
    expectedPulseContributions: 6,
    expectedRecipients: 2,
    receivedPulseContributions: 6,
    recipientDeliveryMismatches: 0,
    recipientPulseMax: 3,
    recipientPulseMin: 3,
  });

  const maskedAggregate = summarizeRecipientDelivery([
    { beforePulses: 0, client: { batchPulses: 2 } },
    { beforePulses: 0, client: { batchPulses: 4 } },
  ], 3);
  assert.equal(maskedAggregate.expectedPulseContributions, 6);
  assert.equal(maskedAggregate.receivedPulseContributions, 6);
  assert.equal(maskedAggregate.deliveryComplete, false);
  assert.equal(maskedAggregate.recipientDeliveryMismatches, 2);
});

test('treats any busy notice as a failed pulse-bearing run', () => {
  assert.equal(busyNoticesAreAcceptable({ mode: 'connection' }, 4), true);
  assert.equal(busyNoticesAreAcceptable({ mode: 'soak' }, 4), true);
  for (const mode of [
    'one-sender',
    'all-client-burst',
    'sustained',
    'reconnect',
  ]) {
    const config = { clients: 2, mode, pulses: 1 };
    assert.equal(busyNoticesAreAcceptable(config, 0), true);
    assert.equal(busyNoticesAreAcceptable(config, 1), false);
  }
});
