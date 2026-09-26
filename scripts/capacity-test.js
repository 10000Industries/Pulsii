'use strict';

// Bounded capacity check against localhost or the isolated review service only.
// Uses the browser's immediate protocol, checks unique delivery to EVERY peer,
// and never sends test pulses to the public production canvas.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const WebSocket = require('ws');
const { createPulsiiServer, runtimeOptionsFromEnv } = require('../server');
const { decodePulseBatch } = require('../lib/protocol');
const { validateTargetUrl } = require('./deployed-load-test');

async function main() {
  const clientsCount = Number(process.env.CAPACITY_CLIENTS || 1000);
  assert.ok(Number.isInteger(clientsCount) && clientsCount >= 2 && clientsCount <= 1000);
  const durationMs = 20_000;
  const sustainedRate = 400;
  const expectedSent = clientsCount + sustainedRate * durationMs / 1000;
  const byteLimit = 100_000_000;
  const sockets = [];
  const sentAt = new Float64Array(expectedSent);
  const latencyHistogram = new Uint32Array(10_001);
  let service;
  let failure;
  let finishing = false;
  let bytes = 0;
  let received = 0;
  let sent = 0;
  let busy = 0;
  let invalid = 0;
  let duplicates = 0;
  let unexpectedCloses = 0;
  let maximumLagMs = 0;
  const fail = error => { failure ||= error; };
  const check = () => { if (failure) throw failure; };
  const started = performance.now();
  let lagTick = performance.now();
  const lagTimer = setInterval(() => {
    const now = performance.now();
    maximumLagMs = Math.max(maximumLagMs, now - lagTick - 100);
    lagTick = now;
  }, 100);
  const deadline = setTimeout(() => {
    fail(new Error('Capacity check exceeded 150-second deadline'));
    for (const c of sockets) c.socket.terminate();
  }, 150_000);

  try {
    let target;
    if (!process.argv[2] || process.argv[2] === 'local') {
      const yaml = fs.readFileSync(path.join(__dirname, '../render.production.yaml'), 'utf8');
      const env = Object.fromEntries([...yaml.matchAll(/- key: (\w+)\s+value: "([^"]*)"/g)]
        .map(m => [m[1], m[2]]));
      service = createPulsiiServer(runtimeOptionsFromEnv({
        ...env, PUBLIC_MODE: 'false', PUBLIC_ORIGIN: '', TRIAL_MODE: 'false',
      }));
      const address = await service.listen(0, '127.0.0.1');
      target = new URL(`http://127.0.0.1:${address.port}`);
    } else target = validateTargetUrl(process.argv[2]);
    const wsUrl = new URL('/live', target);
    wsUrl.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    const localTarget = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
    const proxy = !localTarget && (process.env.HTTPS_PROXY || process.env.https_proxy);
    const agent = proxy ? new (require('https-proxy-agent').HttpsProxyAgent)(proxy) : undefined;

    async function connect(index) {
      const c = { sent: 0, received: 0, seen: new Uint8Array(expectedSent) };
      const socket = new WebSocket(wsUrl, 'pulsii-immediate-v1', {
        origin: target.origin, handshakeTimeout: 15_000, agent,
      });
      c.socket = socket;
      sockets.push(c);
      socket.on('error', fail);
      socket.on('close', () => { if (!finishing) unexpectedCloses++; });
      socket.on('message', (data, binary) => {
        if (failure) return;
        bytes += data.length;
        if (bytes > byteLimit) {
          fail(new Error('100 MB receive budget exceeded'));
          for (const peer of sockets) peer.socket.terminate();
          return;
        }
        if (!binary) {
          try { if (JSON.parse(data.toString()).type === 'busy') busy++; }
          catch { invalid++; }
          return;
        }
        const batch = decodePulseBatch(data);
        if (!batch) { invalid++; return; }
        const now = performance.now();
        for (const p of batch.pulses) {
          const id = parseInt(p.color.slice(1), 16) - 1;
          if (id < 0 || id >= sent || id % clientsCount === index) { invalid++; continue; }
          if (c.seen[id]) { duplicates++; continue; }
          c.seen[id] = 1;
          c.received++;
          received++;
          latencyHistogram[Math.min(10_000, Math.max(0, Math.floor(now - sentAt[id])))]++;
        }
      });
      await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
        socket.once('close', () => reject(new Error('Closed before handshake completed')));
      });
    }

    // 40 arrivals/second, beneath the proposed 50/s admission allowance.
    const handshakes = [];
    for (let i = 0; i < clientsCount; i++) {
      check();
      handshakes.push(connect(i).catch(fail));
      if ((i + 1) % 200 === 0) console.error(`Started ${i + 1} connections`);
      if (i + 1 < clientsCount) await delay(25);
    }
    await Promise.all(handshakes);
    check();
    assert.equal(sockets.filter(c => c.socket.readyState === WebSocket.OPEN).length, clientsCount);
    const connectedMs = performance.now() - started;
    const sendOne = () => {
      check();
      const c = sockets[sent % clientsCount];
      assert.equal(c.socket.readyState, WebSocket.OPEN);
      sentAt[sent] = performance.now();
      c.socket.send(JSON.stringify({ type: 'pulse', xNorm: 0.5, yNorm: 0.5,
        color: '#' + (sent + 1).toString(16).padStart(6, '0') }));
      c.sent++;
      sent++;
    };
    for (let i = 0; i < clientsCount; i++) sendOne();
    await delay(1000);
    // All clients take turns; 20 pulses every 50 ms = 400 aggregate taps/s.
    const trafficStart = performance.now();
    for (let tick = 0; tick < durationMs / 50; tick++) {
      for (let i = 0; i < 20; i++) sendOne();
      await delay(Math.max(1, trafficStart + (tick + 1) * 50 - performance.now()));
    }
    const trafficMs = performance.now() - trafficStart;
    const settleDeadline = performance.now() + 10_000;
    while (received < sent * (clientsCount - 1) && performance.now() < settleDeadline) {
      check();
      await delay(20);
    }
    check();
    const mismatches = sockets.filter(c => c.received !== sent - c.sent).length;
    function percentile(fraction) {
      const threshold = Math.ceil(received * fraction);
      let total = 0;
      for (let i = 0; i < latencyHistogram.length; i++) {
        total += latencyHistogram[i];
        if (total >= threshold) return i;
      }
      return null;
    }
    const report = {
      target: target.origin, clients: clientsCount, protocol: 'pulsii-immediate-v1',
      openedAndStillConnected: sockets.filter(c => c.socket.readyState === WebSocket.OPEN).length,
      connectedMs: Math.round(connectedMs), burstPulses: clientsCount,
      sustainedRate, trafficMs: Math.round(trafficMs), pulsesSent: sent,
      expectedDeliveries: sent * (clientsCount - 1), receivedDeliveries: received,
      recipientMismatches: mismatches, busy, invalid, duplicates, unexpectedCloses,
      relayP50Ms: percentile(0.5), relayP95Ms: percentile(0.95), relayP99Ms: percentile(0.99),
      receivedBytes: bytes, byteLimit, clientEventLoopMaxLagMs: Math.round(maximumLagMs),
      serverMetrics: service?.getMetrics(),
      passed: !mismatches && !busy && !invalid && !duplicates && !unexpectedCloses,
    };
    console.log(JSON.stringify(report, null, 2));
    assert.ok(report.passed, 'Capacity acceptance failed; inspect report');
  } finally {
    finishing = true;
    clearInterval(lagTimer);
    clearTimeout(deadline);
    for (const c of sockets) c.socket.terminate();
    if (service) await service.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
