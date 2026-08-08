'use strict';

const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const WebSocket = require('ws');
const {
  BATCH_HEADER_BYTES,
  PULSE_RECORD_BYTES,
  decodePulseBatch,
  inspectPulseBatch,
} = require('../lib/protocol');
const { WEBSOCKET_PATH } = require('../server');

const MODES = new Set([
  'connection',
  'one-sender',
  'all-client-burst',
  'sustained',
  'reconnect',
  'soak',
]);
const REVIEW_HOST = /^pulsii-restoration-review(?:-[a-z0-9-]+)?\.onrender\.com$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PRODUCTION_HOSTS = new Set([
  'pulsii.net',
  'www.pulsii.net',
  'pulsii.onrender.com',
]);
const LIMITS = Object.freeze({
  byteBudget: 5_000_000_000,
  clients: 5_000,
  durationMs: 3_600_000,
  intervalMs: 60_000,
  pulses: 65_535,
  settleMs: 120_000,
  timeoutMs: 120_000,
});

function positiveInteger(rawValue, name, options = {}) {
  const { fallback, maximum = Number.MAX_SAFE_INTEGER, minimum = 1 } = options;
  const selected = rawValue === undefined || rawValue === '' ? fallback : rawValue;
  if (selected === undefined) {
    throw new Error(`${name} is required`);
  }
  const value = Number(selected);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function validateTargetUrl(rawTarget) {
  if (!rawTarget) {
    throw new Error('Pass the isolated review origin as the first argument');
  }

  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new Error(`Invalid deployed-load target: ${rawTarget}`);
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('The deployed-load target must use http or https');
  }
  if (
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search ||
    target.hash
  ) {
    throw new Error('The deployed-load target must be a bare origin');
  }

  const hostname = target.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.has(hostname)) {
    throw new Error(`Refusing to load-test Pulsii production: ${hostname}`);
  }
  if (!LOCAL_HOSTS.has(hostname) && !REVIEW_HOST.test(hostname)) {
    throw new Error('Target must be localhost or pulsii-restoration-review*.onrender.com');
  }
  if (!LOCAL_HOSTS.has(hostname) && target.protocol !== 'https:') {
    throw new Error('Remote review targets must use https');
  }

  return target;
}

function estimatePulseWireBytes(pulseCount, recipientCount) {
  if (!Number.isSafeInteger(pulseCount) || pulseCount < 0) {
    throw new Error('pulseCount must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(recipientCount) || recipientCount < 0) {
    throw new Error('recipientCount must be a non-negative safe integer');
  }
  if (pulseCount === 0 || recipientCount === 0) return 0;
  return (BATCH_HEADER_BYTES + (pulseCount * PULSE_RECORD_BYTES)) * recipientCount;
}

function expectedSentPulses(config) {
  if (config.mode === 'one-sender') return config.pulses;
  if (config.mode === 'all-client-burst') {
    return config.clients * config.pulses;
  }
  if (config.mode === 'sustained') return config.pulses;
  if (config.mode === 'reconnect') return 1;
  return 0;
}

function busyNoticesAreAcceptable(config, busyNotices) {
  return expectedSentPulses(config) === 0 || busyNotices === 0;
}

function assertEstimatedPulseBudget(config) {
  const minimumPulseBytes = estimatePulseWireBytes(
    expectedSentPulses(config),
    config.clients,
  );
  if (minimumPulseBytes >= config.byteBudget) {
    throw new Error(
      `Estimated pulse payload ${minimumPulseBytes} bytes leaves no room within ` +
      `DEPLOYED_LOAD_BYTE_BUDGET=${config.byteBudget}`,
    );
  }
  return minimumPulseBytes;
}

function loadConfig(environment = process.env, argv = process.argv) {
  const target = validateTargetUrl(environment.DEPLOYED_LOAD_TARGET || argv[2]);
  const mode = environment.DEPLOYED_LOAD_MODE || argv[3] || 'connection';
  if (!MODES.has(mode)) {
    throw new Error(`DEPLOYED_LOAD_MODE must be one of ${Array.from(MODES).join(', ')}`);
  }

  const config = {
    target,
    mode,
    clients: positiveInteger(environment.DEPLOYED_LOAD_CLIENTS, 'DEPLOYED_LOAD_CLIENTS', {
      fallback: 10,
      maximum: LIMITS.clients,
    }),
    pulses: positiveInteger(environment.DEPLOYED_LOAD_PULSES, 'DEPLOYED_LOAD_PULSES', {
      fallback: mode === 'sustained' ? 10 : 1,
      maximum: LIMITS.pulses,
    }),
    durationMs: positiveInteger(
      environment.DEPLOYED_LOAD_DURATION_MS,
      'DEPLOYED_LOAD_DURATION_MS',
      {
        fallback: mode === 'soak' || mode === 'sustained' ? 10_000 : 1_000,
        maximum: LIMITS.durationMs,
      },
    ),
    intervalMs: positiveInteger(
      environment.DEPLOYED_LOAD_INTERVAL_MS,
      'DEPLOYED_LOAD_INTERVAL_MS',
      { fallback: 1_000, maximum: LIMITS.intervalMs, minimum: 10 },
    ),
    settleMs: positiveInteger(environment.DEPLOYED_LOAD_SETTLE_MS, 'DEPLOYED_LOAD_SETTLE_MS', {
      fallback: 5_000,
      maximum: LIMITS.settleMs,
      minimum: 50,
    }),
    timeoutMs: positiveInteger(environment.DEPLOYED_LOAD_TIMEOUT_MS, 'DEPLOYED_LOAD_TIMEOUT_MS', {
      fallback: 15_000,
      maximum: LIMITS.timeoutMs,
      minimum: 1_000,
    }),
    byteBudget: positiveInteger(
      environment.DEPLOYED_LOAD_BYTE_BUDGET,
      'DEPLOYED_LOAD_BYTE_BUDGET',
      { maximum: LIMITS.byteBudget, minimum: 1_024 },
    ),
  };
  config.estimatedPulseBytes = assertEstimatedPulseBudget(config);
  return config;
}

function createByteBudget(limit, onExceeded = () => {}) {
  positiveInteger(limit, 'byte budget', { maximum: LIMITS.byteBudget, minimum: 1 });
  let receivedBytes = 0;
  let attemptedBytes = 0;
  let exceeded = false;

  return {
    account(byteLength) {
      positiveInteger(byteLength, 'received message byte length', {
        maximum: Number.MAX_SAFE_INTEGER,
      });
      if (exceeded) return false;
      attemptedBytes = receivedBytes + byteLength;
      if (attemptedBytes > limit) {
        exceeded = true;
        onExceeded(new Error(
          `Received-byte budget exceeded: next total ${attemptedBytes} > ${limit}`,
        ));
        return false;
      }
      receivedBytes = attemptedBytes;
      return true;
    },
    snapshot() {
      return { attemptedBytes, exceeded, limit, receivedBytes };
    },
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function rounded(value) {
  return value === null ? null : Math.round(value * 10) / 10;
}

function messageByteLength(data) {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Buffer.isBuffer(data)) return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return Buffer.byteLength(String(data));
}

function createPulse(index, total) {
  return {
    type: 'pulse',
    xNorm: Number((((index % Math.max(1, total)) + 0.5) / Math.max(1, total)).toFixed(6)),
    yNorm: Number((0.2 + ((index % 7) * 0.1)).toFixed(3)),
    color: `#00${(index % 0xffff).toString(16).padStart(4, '0')}`,
  };
}

function deferredFailure() {
  let reject;
  const promise = new Promise((resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  promise.catch(() => {});
  return { promise, reject };
}

async function controlledDelay(state, milliseconds) {
  await Promise.race([delay(milliseconds), state.failure.promise]);
}

function terminateAll(state) {
  for (const client of state.clients) {
    if (
      client.socket.readyState === WebSocket.OPEN ||
      client.socket.readyState === WebSocket.CONNECTING
    ) {
      client.socket.terminate();
    }
  }
}

function observeClient(state, index) {
  const socket = new WebSocket(state.websocketUrl, {
    handshakeTimeout: state.config.timeoutMs,
    origin: state.config.target.origin,
  });
  const client = {
    index,
    socket,
    openedAt: null,
    handshakeMs: null,
    closedAt: null,
    closeCode: null,
    closeReason: null,
    errors: [],
    receivedBytes: 0,
    binaryFrames: 0,
    textFrames: 0,
    batchPulses: 0,
    presenceFrames: 0,
    busyNotices: 0,
    invalidFrames: 0,
    firstActionFrameAt: null,
  };
  const attemptedAt = performance.now();
  state.clients.push(client);

  socket.on('message', (data, isBinary) => {
    const byteLength = messageByteLength(data);
    if (!state.byteBudget.account(byteLength)) return;
    client.receivedBytes += byteLength;

    if (isBinary) {
      client.binaryFrames += 1;
      const header = inspectPulseBatch(data);
      if (!header) {
        client.invalidFrames += 1;
        return;
      }
      client.batchPulses += header.count;
      if (!state.sampleBatchValidated) {
        const sample = decodePulseBatch(data);
        if (!sample) {
          client.invalidFrames += 1;
          return;
        }
        state.sampleBatchValidated = true;
        state.sampleBatchPulseCount = sample.pulses.length;
      }
      if (state.actionStartedAt !== null && client.firstActionFrameAt === null) {
        client.firstActionFrameAt = performance.now();
      }
      return;
    }

    client.textFrames += 1;
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'presence') client.presenceFrames += 1;
      if (message.type === 'busy') client.busyNotices += 1;
    } catch {
      client.invalidFrames += 1;
    }
  });
  socket.on('error', (error) => {
    client.errors.push(error.message);
  });
  socket.on('close', (code, reason) => {
    client.closedAt = performance.now();
    client.closeCode = code;
    client.closeReason = reason.toString();
  });

  const opened = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Client ${index} handshake timed out`));
      socket.terminate();
    }, state.config.timeoutMs);
    timeout.unref?.();

    socket.once('open', () => {
      clearTimeout(timeout);
      client.openedAt = performance.now();
      client.handshakeMs = client.openedAt - attemptedAt;
      resolve(client);
    });
    socket.once('error', (error) => {
      if (client.openedAt !== null) return;
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('close', (code, reason) => {
      if (client.openedAt !== null) return;
      clearTimeout(timeout);
      reject(new Error(
        `Client ${index} closed during handshake (${code} ${reason.toString()})`,
      ));
    });
  });

  return Promise.race([opened, state.failure.promise]);
}

async function closeClient(client, state, expected = true) {
  if (expected) state.expectedCloseIndexes.add(client.index);
  if (client.socket.readyState === WebSocket.CLOSED) return;
  if (client.socket.readyState !== WebSocket.OPEN) {
    client.socket.terminate();
    return;
  }
  client.socket.close(1000, 'Deployed load test complete');
  const deadline = Date.now() + 1_000;
  while (client.socket.readyState !== WebSocket.CLOSED && Date.now() < deadline) {
    await delay(10);
  }
  if (client.socket.readyState !== WebSocket.CLOSED) client.socket.terminate();
}

function sendPulse(client, pulse, state) {
  if (client.socket.readyState !== WebSocket.OPEN) return false;
  client.socket.send(JSON.stringify(pulse));
  state.pulsesSent += 1;
  return true;
}

function beginAction(state, recipients) {
  state.actionStartedAt = performance.now();
  state.actionPulsesSentBefore = state.pulsesSent;
  state.actionRecipients = recipients.map((client) => ({
    beforePulses: client.batchPulses,
    client,
  }));
  for (const client of recipients) client.firstActionFrameAt = null;
}

function summarizeRecipientDelivery(actionRecipients, expectedPerRecipient) {
  const contributions = actionRecipients.map(({ beforePulses, client }) =>
    client.batchPulses - beforePulses,
  );
  const recipientDeliveryMismatches = contributions.filter(
    (received) => received !== expectedPerRecipient,
  ).length;

  return {
    deliveryComplete: recipientDeliveryMismatches === 0,
    expectedPulseContributions: expectedPerRecipient * actionRecipients.length,
    expectedRecipients: actionRecipients.length,
    receivedPulseContributions: contributions.reduce(
      (total, received) => total + received,
      0,
    ),
    recipientDeliveryMismatches,
    recipientPulseMax: contributions.length ? Math.max(...contributions) : null,
    recipientPulseMin: contributions.length ? Math.min(...contributions) : null,
  };
}

async function runMode(state) {
  const openClients = () => state.clients.filter(
    (client) => client.socket.readyState === WebSocket.OPEN,
  );
  const config = state.config;

  if (config.mode === 'connection') {
    await controlledDelay(state, config.settleMs);
    return;
  }
  if (config.mode === 'soak') {
    await controlledDelay(state, config.durationMs);
    return;
  }

  if (config.mode === 'reconnect') {
    const active = openClients();
    if (active.length < 2) throw new Error('Reconnect mode requires at least two open clients');
    const removed = active.at(-1);
    await closeClient(removed, state);
    const replacement = await observeClient(state, state.nextClientIndex++);
    await controlledDelay(state, 150);
    beginAction(state, openClients());
    sendPulse(active[0], createPulse(0, 1), state);
    await controlledDelay(state, config.settleMs);
    const replacementAction = state.actionRecipients.find(
      ({ client }) => client === replacement,
    );
    state.reconnectSucceeded = Boolean(
      replacementAction &&
      replacement.batchPulses - replacementAction.beforePulses ===
        state.pulsesSent - state.actionPulsesSentBefore,
    );
    return;
  }

  beginAction(state, openClients());

  if (config.mode === 'one-sender') {
    const sender = openClients()[0];
    for (let index = 0; index < config.pulses; index += 1) {
      sendPulse(sender, createPulse(index, config.pulses), state);
    }
  } else if (config.mode === 'all-client-burst') {
    const active = openClients();
    for (const client of active) {
      for (let index = 0; index < config.pulses; index += 1) {
        sendPulse(client, createPulse((client.index * config.pulses) + index, active.length * config.pulses), state);
      }
    }
  } else if (config.mode === 'sustained') {
    const active = openClients();
    const deadline = performance.now() + config.durationMs;
    for (let index = 0; index < config.pulses; index += 1) {
      if (performance.now() >= deadline) break;
      sendPulse(active[index % active.length], createPulse(index, config.pulses), state);
      if (index + 1 < config.pulses) {
        await controlledDelay(
          state,
          Math.min(config.intervalMs, Math.max(1, deadline - performance.now())),
        );
      }
    }
  }

  await controlledDelay(state, config.settleMs);
}

function summarize(state, startedAt, runError = null) {
  const handshakes = state.clients
    .map((client) => client.handshakeMs)
    .filter((value) => value !== null);
  const relayLatencies = state.actionRecipients
    .map(({ client }) => client)
    .filter((client) => client.firstActionFrameAt !== null)
    .map((client) => client.firstActionFrameAt - state.actionStartedAt);
  const closeCodes = {};
  for (const client of state.clients) {
    if (client.closeCode === null) continue;
    closeCodes[client.closeCode] = (closeCodes[client.closeCode] || 0) + 1;
  }
  const openedClients = handshakes.length;
  const actionPulsesSent = state.pulsesSent - state.actionPulsesSentBefore;
  const recipientDelivery = summarizeRecipientDelivery(
    state.actionRecipients,
    actionPulsesSent,
  );
  const budget = state.byteBudget.snapshot();
  const invalidFrames = state.clients.reduce(
    (total, client) => total + client.invalidFrames,
    0,
  );
  const socketErrors = state.clients.reduce(
    (total, client) => total + client.errors.length,
    0,
  );
  const unexpectedCloses = state.clients.filter(
    (client) =>
      client.closedAt !== null &&
      !state.expectedCloseIndexes.has(client.index) &&
      client.closeCode !== 1000,
  ).length;
  const busyNotices = state.clients.reduce(
    (total, client) => total + client.busyNotices,
    0,
  );
  const busyNoticesAccepted = busyNoticesAreAcceptable(
    state.config,
    busyNotices,
  );

  return {
    target: state.config.target.origin,
    mode: state.config.mode,
    configuredClients: state.config.clients,
    connectionAttempts: state.clients.length,
    openedClients,
    handshakeFailures: state.handshakeFailures,
    handshakeP50Ms: rounded(percentile(handshakes, 0.5)),
    handshakeP95Ms: rounded(percentile(handshakes, 0.95)),
    handshakeMaxMs: rounded(handshakes.length ? Math.max(...handshakes) : null),
    pulsesSent: state.pulsesSent,
    expectedRecipients: recipientDelivery.expectedRecipients,
    expectedPulseContributions: recipientDelivery.expectedPulseContributions,
    receivedPulseContributions: recipientDelivery.receivedPulseContributions,
    recipientDeliveryMismatches: recipientDelivery.recipientDeliveryMismatches,
    recipientPulseMin: recipientDelivery.recipientPulseMin,
    recipientPulseMax: recipientDelivery.recipientPulseMax,
    deliveryRatio: recipientDelivery.expectedPulseContributions === 0
      ? null
      : rounded(
        recipientDelivery.receivedPulseContributions /
          recipientDelivery.expectedPulseContributions,
      ),
    binaryFrames: state.clients.reduce((total, client) => total + client.binaryFrames, 0),
    textFrames: state.clients.reduce((total, client) => total + client.textFrames, 0),
    presenceFrames: state.clients.reduce((total, client) => total + client.presenceFrames, 0),
    busyNotices,
    invalidFrames,
    relayP50Ms: rounded(percentile(relayLatencies, 0.5)),
    relayP95Ms: rounded(percentile(relayLatencies, 0.95)),
    relayMaxMs: rounded(relayLatencies.length ? Math.max(...relayLatencies) : null),
    reconnectSucceeded: state.reconnectSucceeded,
    sampleBatchValidated: state.sampleBatchValidated,
    sampleBatchPulseCount: state.sampleBatchPulseCount,
    closeCodes,
    unexpectedCloses,
    socketErrors,
    receivedBytes: budget.receivedBytes,
    attemptedBytes: budget.attemptedBytes,
    byteBudget: budget.limit,
    byteBudgetExceeded: budget.exceeded,
    estimatedPulseBytes: state.config.estimatedPulseBytes,
    elapsedMs: rounded(performance.now() - startedAt),
    passed:
      runError === null &&
      !budget.exceeded &&
      state.handshakeFailures === 0 &&
      unexpectedCloses === 0 &&
      socketErrors === 0 &&
      invalidFrames === 0 &&
      recipientDelivery.deliveryComplete &&
      busyNoticesAccepted &&
      (state.config.mode !== 'reconnect' || state.reconnectSucceeded === true),
    error: runError?.message || null,
  };
}

async function runDeployedLoadTest(config) {
  config.estimatedPulseBytes = assertEstimatedPulseBudget(config);
  const websocketUrl = new URL(WEBSOCKET_PATH, config.target);
  websocketUrl.protocol = config.target.protocol === 'https:' ? 'wss:' : 'ws:';
  const failure = deferredFailure();
  const state = {
    actionPulsesSentBefore: 0,
    actionRecipients: [],
    actionStartedAt: null,
    byteBudget: null,
    clients: [],
    config,
    expectedCloseIndexes: new Set(),
    failure,
    handshakeFailures: 0,
    nextClientIndex: config.clients,
    pulsesSent: 0,
    reconnectSucceeded: null,
    sampleBatchPulseCount: null,
    sampleBatchValidated: false,
    websocketUrl,
  };
  state.byteBudget = createByteBudget(config.byteBudget, (error) => {
    failure.reject(error);
    terminateAll(state);
  });
  const startedAt = performance.now();
  let runError = null;

  try {
    const handshakes = await Promise.allSettled(
      Array.from({ length: config.clients }, (_, index) => observeClient(state, index)),
    );
    state.handshakeFailures = handshakes.filter((result) => result.status === 'rejected').length;
    if (state.byteBudget.snapshot().exceeded) {
      await state.failure.promise;
    }
    if (handshakes.every((result) => result.status === 'rejected')) {
      throw new Error('No deployed-load clients completed the WebSocket handshake');
    }
    await controlledDelay(state, 150);
    await runMode(state);
  } catch (error) {
    runError = error;
  } finally {
    await Promise.all(state.clients.map((client) => closeClient(client, state)));
  }

  const report = summarize(state, startedAt, runError);
  if (runError) {
    runError.report = report;
    throw runError;
  }
  return report;
}

async function main() {
  const config = loadConfig();
  const report = await runDeployedLoadTest(config);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    if (error.report) process.stderr.write(`${JSON.stringify(error.report, null, 2)}\n`);
    else console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  LIMITS,
  MODES,
  assertEstimatedPulseBudget,
  busyNoticesAreAcceptable,
  createByteBudget,
  estimatePulseWireBytes,
  expectedSentPulses,
  loadConfig,
  runDeployedLoadTest,
  summarizeRecipientDelivery,
  validateTargetUrl,
};
