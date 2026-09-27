'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { FIELDS, MINUTE, RETENTION_DAYS } = require('./analytics-fields');
const empty = (minute) => Object.fromEntries([['minute', minute], ...FIELDS.map((key) => [key, 0])]);

function createAnalytics({ filename, now = Date.now, intervalMs = 10_000, logger = null }) {
  const worker = new Worker(path.join(__dirname, 'analytics-worker.js'), { workerData: { filename } });
  let nextId = 0;
  const requests = new Map();
  let dead = false;
  let errorReported = false;
  let lastSavedAt = null;
  let lostMinutes = 0;
  let pending = new Map();
  let retryBatch = null;
  let flushing = null;
  let count = 0;
  const startedAt = now();
  let lastAt = startedAt;

  worker.on('message', ({ id, result, error }) => {
    const request = requests.get(id);
    if (!request) return;
    requests.delete(id);
    clearTimeout(request.timer);
    if (error) request.reject(new Error(error));
    else request.resolve(result);
  });
  const fail = () => {
    dead = true;
    for (const request of requests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Analytics storage unavailable'));
    }
    requests.clear();
  };
  worker.on('error', fail);
  worker.on('exit', fail);

  function rpc(method, payload = {}) {
    if (dead) return Promise.reject(new Error('Analytics storage unavailable'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(new Error('Analytics storage timeout'));
      }, 5000);
      requests.set(id, { resolve, reject, timer });
      worker.postMessage({ id, method, payload });
    });
  }

  function bucket(at = now()) {
    const minute = Math.floor(at / MINUTE) * MINUTE;
    if (!pending.has(minute)) {
      // Bounded fail-open collection if storage fails: one hour, not an
      // unbounded history in the pulse relay's memory.
      if (pending.size >= 60) {
        pending.delete(pending.keys().next().value);
        lostMinutes += 1;
      }
      pending.set(minute, empty(minute));
    }
    return pending.get(minute);
  }

  function advance(at = now()) {
    // Ignore backwards clock movement. Do not manufacture coverage before boot.
    at = Math.max(lastAt, at);
    if (at - lastAt > 3_600_000) {
      lostMinutes += Math.floor((at - lastAt - 3_600_000) / MINUTE);
      lastAt = at - 3_600_000;
    }
    while (lastAt < at) {
      const row = bucket(lastAt);
      const end = Math.min(at, row.minute + MINUTE);
      const elapsed = end - lastAt;
      row.observedMs += elapsed;
      row.connectionMs += elapsed * count;
      if (count >= 2) {
        row.sharedMs += elapsed;
        row.sharedConnectionMs += elapsed * count;
      }
      row.peak = Math.max(row.peak, count);
      lastAt = end;
    }
  }

  function add(key, value = 1) {
    if (!FIELDS.includes(key) || key === 'peak' || !Number.isFinite(value) || value < 0) {
      throw new Error('Invalid analytics counter');
    }
    bucket()[key] += value;
  }

  function presence(next) {
    advance();
    count = next;
    bucket().peak = Math.max(bucket().peak, next);
  }

  function flush() {
    if (flushing) return flushing;
    advance();
    if (!retryBatch) {
      retryBatch = { batchId: randomUUID(), now: now(), startedAt, rows: [...pending.values()] };
      pending = new Map();
    }
    // The persistent batch ID makes a retry safe even if a write committed
    // just before a worker response timed out.
    flushing = rpc('write', retryBatch).then((result) => {
      retryBatch = null;
      lastSavedAt = result.savedAt;
      errorReported = false;
      return result;
    }).catch((error) => {
      if (!errorReported) logger?.error?.(JSON.stringify({ event: 'pulsii_analytics_error', code: 'storage_unavailable' }));
      errorReported = true;
      throw error;
    }).finally(() => { flushing = null; });
    return flushing;
  }

  const timer = setInterval(() => { flush().catch(() => {}); }, intervalMs);
  timer.unref();

  async function snapshot(hours = 24) {
    if (![24, 168, 720, 2160].includes(hours)) throw new Error('Invalid range');
    await flush();
    // A successful retry may leave a newer batch waiting. Include it now.
    if (pending.size) await flush();
    const to = now();
    const from = Math.floor((to - hours * 3_600_000) / MINUTE) * MINUTE;
    const resolutionMs = hours <= 24 ? 3_600_000 : 86_400_000;
    const { rows, startedAt: firstAt } = await rpc('read', { from, to, resolutionMs });
    const totals = empty(0);
    const points = new Map();
    for (const row of rows) {
      const time = Math.floor(row.minute / resolutionMs) * resolutionMs;
      if (!points.has(time)) points.set(time, empty(time));
      for (const key of FIELDS) {
        if (key === 'peak') {
          totals[key] = Math.max(totals[key], row[key]);
          points.get(time)[key] = Math.max(points.get(time)[key], row[key]);
        } else {
          totals[key] += row[key];
          points.get(time)[key] += row[key];
        }
      }
    }
    return {
      from, to, startedAt: firstAt, retentionDays: RETENTION_DAYS,
      liveConnections: count, lastSavedAt, lostMinutes,
      totals, resolutionMs, series: [...points.values()],
    };
  }

  async function close() {
    clearInterval(timer);
    try {
      await flush();
      if (pending.size) await flush();
      await rpc('close');
    } catch { /* A storage failure must not block relay shutdown. */ }
    finally { await worker.terminate(); }
  }

  return { add, presence, flush, snapshot, close };
}

module.exports = { createAnalytics };
