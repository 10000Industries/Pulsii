'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const WebSocket = require('ws');
const { decodePulseBatch, inspectPulseBatch } = require('../lib/protocol');
const { WEBSOCKET_PATH, createPulsiiServer } = require('../server');

function positiveInteger(rawValue, fallback, name) {
  if (rawValue === undefined || rawValue === '') return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  const clientCount = positiveInteger(
    process.env.LOAD_CLIENTS,
    100,
    'LOAD_CLIENTS',
  );
  const pulsesPerClient = positiveInteger(
    process.env.LOAD_PULSES_PER_CLIENT,
    1,
    'LOAD_PULSES_PER_CLIENT',
  );
  const settleMs = positiveInteger(
    process.env.LOAD_SETTLE_MS,
    10_000,
    'LOAD_SETTLE_MS',
  );
  const connectTimeoutMs = positiveInteger(
    process.env.LOAD_CONNECT_TIMEOUT_MS,
    30_000,
    'LOAD_CONNECT_TIMEOUT_MS',
  );
  const maxBatchPulses = positiveInteger(
    process.env.LOAD_MAX_BATCH_PULSES,
    4096,
    'LOAD_MAX_BATCH_PULSES',
  );
  const requestedMode = process.env.LOAD_MODE || process.argv[2] || 'batched';
  if (!['batched', 'fanout', 'guarded'].includes(requestedMode)) {
    throw new Error('LOAD_MODE must be batched, fanout, or guarded');
  }

  const totalPulses = clientCount * pulsesPerClient;
  if (totalPulses > 0xffff) {
    throw new Error('A load-test burst cannot exceed 65535 pulses');
  }

  const service = createPulsiiServer({
    maxConnections: clientCount,
    clientRateBurst: pulsesPerClient + 2,
    clientRatePerSecond: pulsesPerClient + 2,
    batchIntervalMs: 50,
    maxClientCandidates: pulsesPerClient + 1,
    maxGlobalCandidates: totalPulses + 1,
    maxBatchPulses,
  });
  const address = await service.listen(0, '127.0.0.1');
  const websocketUrl = `ws://127.0.0.1:${address.port}${WEBSOCKET_PATH}`;
  const origin = `http://127.0.0.1:${address.port}`;
  const clients = [];
  let opened = 0;
  let receivedBatchFrames = 0;
  let receivedPulseContributions = 0;
  let busyNotices = 0;
  let fullyDecodedBatches = 0;
  let clientsClosed = 0;
  const closeCodes = new Map();
  const startedAt = Date.now();

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timed out opening ${clientCount} clients`)),
        connectTimeoutMs,
      );
      for (let index = 0; index < clientCount; index += 1) {
        const socket = new WebSocket(websocketUrl, { origin });
        clients.push(socket);

        socket.on('message', (data, isBinary) => {
          if (isBinary) {
            const header = inspectPulseBatch(data);
            assert.ok(header, 'load test received an invalid pulse batch');
            if (fullyDecodedBatches === 0) {
              const batch = decodePulseBatch(data);
              assert.ok(batch, 'load test could not fully decode a pulse batch');
              assert.equal(batch.pulses.length, header.count);
              fullyDecodedBatches += 1;
            }
            receivedBatchFrames += 1;
            receivedPulseContributions += header.count;
            return;
          }
          const message = JSON.parse(data.toString());
          if (message.type === 'busy') busyNotices += 1;
        });
        socket.on('error', reject);
        socket.on('close', (code) => {
          clientsClosed += 1;
          closeCodes.set(code, (closeCodes.get(code) || 0) + 1);
        });
        socket.on('open', () => {
          opened += 1;
          if (opened === clientCount) {
            clearTimeout(timeout);
            resolve();
          }
        });
      }
    });

    const connectedAt = Date.now();
    for (let clientIndex = 0; clientIndex < clients.length; clientIndex += 1) {
      for (let pulseIndex = 0; pulseIndex < pulsesPerClient; pulseIndex += 1) {
        clients[clientIndex].send(JSON.stringify({
          type: 'pulse',
          xNorm: (clientIndex + 0.5) / clientCount,
          yNorm: (pulseIndex + 0.5) / pulsesPerClient,
          color: '#00d4ff',
        }));
      }
    }

    await waitFor(
      () => service.getMetrics().pulsesAccepted === totalPulses,
      settleMs,
      `${totalPulses} accepted pulses`,
    );
    const acceptedAt = Date.now();
    const expectedContributions = totalPulses * clientCount;
    try {
      await waitFor(
        () => receivedPulseContributions === expectedContributions,
        settleMs,
        `${expectedContributions} client pulse contributions`,
      );
    } catch (error) {
      const metrics = service.getMetrics();
      throw new Error(`${error.message}; ${JSON.stringify({
        receivedBatchFrames,
        receivedPulseContributions,
        expectedContributions,
        clientsClosed,
        closeCodes: Object.fromEntries(closeCodes),
        currentConnections: metrics.currentConnections,
        slowClientTerminations: metrics.slowClientTerminations,
        batchesShared: metrics.batchesShared,
        batchDeliveryAttempts: metrics.batchDeliveryAttempts,
        batchDeliveries: metrics.batchDeliveries,
        pulseDeliveryAttempts: metrics.pulseDeliveryAttempts,
        pulseDeliveries: metrics.pulseDeliveries,
      })}`, { cause: error });
    }

    const metrics = service.getMetrics();
    assert.equal(metrics.connectionsAccepted, clientCount);
    assert.equal(metrics.pulseCandidates, totalPulses);
    assert.equal(metrics.pulsesAccepted, totalPulses);
    assert.equal(metrics.pulsesRejectedBusy, 0);
    assert.equal(busyNotices, 0);
    assert.equal(metrics.pulseDeliveries, expectedContributions);
    assert.equal(receivedPulseContributions, expectedContributions);
    assert.equal(receivedBatchFrames, metrics.batchDeliveries);
    assert.equal(fullyDecodedBatches, 1);

    process.stdout.write(`${JSON.stringify({
      mode: 'batched',
      requestedMode,
      clients: clientCount,
      pulsesSent: totalPulses,
      pulsesAccepted: metrics.pulsesAccepted,
      pulsesRejectedBusy: metrics.pulsesRejectedBusy,
      batchesShared: metrics.batchesShared,
      batchFrames: receivedBatchFrames,
      fullyDecodedBatches,
      pulseContributions: receivedPulseContributions,
      pulseDeliveryAttempts: metrics.pulseDeliveryAttempts,
      pulseWireBytes: metrics.pulseWireBytes,
      pulseWireBytesAttempted: metrics.pulseWireBytesAttempted,
      candidateQueuePeak: metrics.candidateQueuePeak,
      connectTimeoutMs,
      maxBatchPulses,
      clientsClosed,
      connectMs: connectedAt - startedAt,
      acceptMs: acceptedAt - connectedAt,
      deliveryMs: Date.now() - acceptedAt,
      totalMs: Date.now() - startedAt,
      memoryRssMb: metrics.memoryRssMb,
    })}\n`);
  } finally {
    for (const socket of clients) {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    }
    await service.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
