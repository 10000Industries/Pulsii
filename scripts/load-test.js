'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const WebSocket = require('ws');
const { createPulsiiServer } = require('../server');

function positiveInteger(rawValue, fallback, name) {
  if (rawValue === undefined || rawValue === '') return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
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
    2000,
    'LOAD_SETTLE_MS',
  );
  const mode = process.env.LOAD_MODE || process.argv[2] || 'guarded';
  if (!['guarded', 'fanout'].includes(mode)) {
    throw new Error('LOAD_MODE must be guarded or fanout');
  }

  const totalPulses = clientCount * pulsesPerClient;
  const serviceOptions =
    mode === 'fanout'
      ? {
        maxConnections: clientCount,
        clientRateBurst: pulsesPerClient + 2,
        clientRatePerSecond: pulsesPerClient + 2,
        globalRateBurst: totalPulses,
        globalRatePerSecond: totalPulses,
      }
      : {
        maxConnections: Math.max(200, clientCount),
        clientRateBurst: pulsesPerClient + 2,
        clientRatePerSecond: pulsesPerClient + 2,
      };

  const service = createPulsiiServer(serviceOptions);
  const address = await service.listen(0, '127.0.0.1');
  const websocketUrl = `ws://127.0.0.1:${address.port}`;
  const origin = `http://127.0.0.1:${address.port}`;
  const clients = [];
  let opened = 0;
  let receivedPulseFrames = 0;
  let congestionNotices = 0;
  const startedAt = Date.now();

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timed out opening ${clientCount} clients`)),
        15_000,
      );
      for (let index = 0; index < clientCount; index += 1) {
        const socket = new WebSocket(websocketUrl, { origin });
        clients.push(socket);

        socket.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'pulse') receivedPulseFrames += 1;
          if (message.type === 'congestion') congestionNotices += 1;
        });
        socket.on('error', reject);
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

    await delay(settleMs);
    const metrics = service.getMetrics();
    const expectedPeerFrames =
      metrics.pulsesAccepted * Math.max(0, clientCount - 1);

    assert.equal(metrics.connectionsAccepted, clientCount);
    assert.equal(metrics.fanoutDeliveries, expectedPeerFrames);
    assert.equal(receivedPulseFrames, expectedPeerFrames);
    if (mode === 'fanout') {
      assert.equal(metrics.pulsesAccepted, totalPulses);
      assert.equal(metrics.globalRateDropped, 0);
    } else {
      assert.ok(
        metrics.pulsesAccepted <= totalPulses,
        'guarded mode cannot accept more pulses than were sent',
      );
      assert.equal(
        metrics.pulsesAccepted + metrics.globalRateDropped,
        totalPulses,
      );
    }

    process.stdout.write(`${JSON.stringify({
      mode,
      clients: clientCount,
      pulsesSent: totalPulses,
      pulsesAccepted: metrics.pulsesAccepted,
      pulsesDroppedByGlobalLimit: metrics.globalRateDropped,
      congestionNotices,
      peerFrames: receivedPulseFrames,
      connectMs: connectedAt - startedAt,
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
