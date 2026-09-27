'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scryptSync, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { Worker } = require('node:worker_threads');
const { FIELDS } = require('../lib/analytics-fields');
const WebSocket = require('ws');
const { createAnalytics } = require('../lib/analytics');
const { createPulsiiServer } = require('../server');

async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulsii-analytics-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'analytics.sqlite');
}
const hashPassword = (password) => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};

test('records aggregate overlap exactly across minutes and preserves it over restart', async (t) => {
  const filename = await directory(t);
  let clock = Date.parse('2026-09-27T10:00:00Z');
  let recorder = createAnalytics({ filename, now: () => clock, intervalMs: 100000 });
  recorder.add('pageLoads');
  recorder.add('redditPageLoads');
  recorder.add('connections');
  recorder.presence(1);
  clock += 30_000;
  recorder.presence(2);
  recorder.add('connections');
  recorder.add('pulses', 17);
  clock += 90_000;
  recorder.presence(0);
  recorder.add('closed', 2);
  recorder.add('activeClosed');
  recorder.add('durationMs', 210000);
  let data = await recorder.snapshot(24);
  assert.equal(data.totals.pulses, 17);
  assert.equal(data.totals.peak, 2);
  assert.equal(data.totals.observedMs, 120000);
  assert.equal(data.totals.connectionMs, 210000);
  assert.equal(data.totals.sharedMs, 90000);
  assert.equal(data.totals.sharedConnectionMs, 180000);
  assert.equal(data.totals.redditPageLoads, 1);
  assert.equal(data.totals.durationMs, 210000);
  assert.throws(() => recorder.add('ipAddress'), /Invalid/);
  await recorder.close();
  clock += 60_000;
  recorder = createAnalytics({ filename, now: () => clock, intervalMs: 100000 });
  t.after(() => recorder.close());
  recorder.add('pulses', 3);
  data = await recorder.snapshot(24);
  assert.equal(data.totals.pulses, 20);
  assert.equal(data.totals.observedMs, 120000, 'offline minute is not manufactured coverage');
  assert.equal(data.liveConnections, 0);
  assert.equal(data.startedAt, Date.parse('2026-09-27T10:00:00Z'));
  assert.doesNotMatch(JSON.stringify(data), /xNorm|yNorm|color|userAgent|ipAddress|password/i);
});

test('retention removes history beyond 90 days and aggregation stays bounded', async (t) => {
  const filename = await directory(t);
  let clock = Date.parse('2026-01-01T00:00:00Z');
  let recorder = createAnalytics({ filename, now: () => clock, intervalMs: 100000 });
  recorder.add('pulses', 99);
  await recorder.close();
  clock += 91 * 86400000;
  recorder = createAnalytics({ filename, now: () => clock, intervalMs: 100000 });
  t.after(() => recorder.close());
  recorder.add('pulses', 1);
  const data = await recorder.snapshot(2160);
  assert.equal(data.totals.pulses, 1);
  assert.ok(data.series.length <= 91);
});

test('a retried committed storage batch is not counted twice', async (t) => {
  const filename = await directory(t);
  const worker = new Worker(path.join(__dirname, '../lib/analytics-worker.js'), { workerData: { filename } });
  t.after(() => worker.terminate());
  let id = 0;
  async function rpc(method, payload) {
    const response = once(worker, 'message');
    worker.postMessage({ id: ++id, method, payload });
    const [result] = await response;
    assert.equal(result.error, undefined);
    return result.result;
  }
  const minute = Date.parse('2026-09-27T00:00:00Z');
  const row = Object.fromEntries(FIELDS.map((key) => [key, 0]));
  row.minute = minute; row.pulses = 7;
  const payload = { batchId: 'retry-proof', now: minute, startedAt: minute, rows: [row] };
  await rpc('write', payload);
  await rpc('write', payload);
  const data = await rpc('read', { from: minute, to: minute, resolutionMs: 3600000 });
  assert.equal(data.rows[0].pulses, 7);
});

test('private routes reject anonymous access, CSRF and wrong passwords; logout revokes the session', async (t) => {
  const filename = await directory(t);
  const password = randomBytes(24).toString('base64url');
  const origin = 'http://127.0.0.1:3000';
  const service = createPulsiiServer({ analyticsConfig: { filename, passwordHash: hashPassword(password), localOrigin: origin } });
  const address = await service.listen();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  const login = (value, site = origin) => fetch(`${base}/admin/login`, {
    method: 'POST', headers: { Origin: site, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: value }),
  });
  for (const route of ['/admin/api/stats', '/admin/export.csv', '/admin/dashboard.html']) {
    assert.equal((await fetch(base + route)).status, 401);
  }
  assert.equal((await fetch(`${base}/lib/analytics-worker.js`)).status, 404);
  const loginPage = await fetch(`${base}/admin`);
  assert.match(await loginPage.text(), /Owner password/);
  assert.match(loginPage.headers.get('cache-control'), /no-store/);
  assert.match(loginPage.headers.get('x-robots-tag'), /noindex/);
  assert.equal((await login(password, 'https://evil.example')).status, 403);
  assert.equal((await login('not-the-correct-password')).status, 401);
  const authenticated = await login(password);
  assert.equal(authenticated.status, 200);
  const setCookie = authenticated.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  const headers = { Cookie: cookie };
  assert.match(await (await fetch(`${base}/admin`, { headers })).text(), /Is the canvas alive/);
  await fetch(`${base}/?source=reddit-sideproject`);
  await fetch(`${base}/?source=private-personal-url`);
  await fetch(`${base}/`, { method: 'HEAD' });
  const sender = new WebSocket(`${base.replace('http', 'ws')}/live`);
  const peer = new WebSocket(`${base.replace('http', 'ws')}/live`);
  await Promise.all([once(sender, 'open'), once(peer, 'open')]);
  sender.send(JSON.stringify({ type: 'pulse', xNorm: .2, yNorm: .4, color: '#aa00ff' }));
  await new Promise((resolve) => setTimeout(resolve, 80));
  sender.close(); peer.close();
  await Promise.all([once(sender, 'close'), once(peer, 'close')]);
  const stats = await (await fetch(`${base}/admin/api/stats`, { headers })).json();
  assert.equal(stats.totals.pageLoads, 2);
  assert.equal(stats.totals.redditPageLoads, 1);
  assert.equal(stats.totals.pulses, 1);
  assert.equal(stats.totals.connections, 2);
  assert.equal(stats.totals.closed, 2);
  assert.equal(stats.totals.activeClosed, 1);
  assert.equal(stats.totals.peak, 2);
  assert.doesNotMatch(JSON.stringify(stats), /aa00ff|private-personal-url/);
  assert.equal((await fetch(`${base}/admin/api/stats?hours=999`, { headers })).status, 400);
  const exported = await fetch(`${base}/admin/export.csv`, { headers });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type'), /text\/csv/);
  assert.match(await exported.text(), /bucket_start_utc,pageLoads/);
  assert.equal((await fetch(`${base}/admin/logout`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}/admin/logout`, { method: 'POST', headers: { ...headers, Origin: origin } })).status, 200);
  assert.equal((await fetch(`${base}/admin/api/stats`, { headers })).status, 401);
  for (let attempt = 0; attempt < 5; attempt += 1) await login('not-the-correct-password');
  assert.equal((await login(password)).status, 429);
});

test('production sessions are secure, expire, and invalid configuration fails closed', async (t) => {
  const filename = await directory(t);
  const password = randomBytes(24).toString('base64url');
  const passwordHash = hashPassword(password);
  assert.throws(() => createPulsiiServer({ analyticsConfig: { filename, passwordHash: 'bad' } }), /scrypt/);
  assert.throws(() => createPulsiiServer({ publicMode: true, publicOrigin: 'http://example.com', analyticsConfig: { filename, passwordHash } }), /HTTPS/);
  let clock = Date.now();
  const service = createPulsiiServer({ publicMode: true, publicOrigin: 'https://www.pulsii.net', now: () => clock, analyticsConfig: { filename, passwordHash } });
  t.after(() => service.close());
  const { port } = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  const loggedIn = await fetch(`${base}/admin/login`, { method: 'POST', headers: { Origin: 'https://www.pulsii.net', 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const cookie = loggedIn.headers.get('set-cookie');
  assert.match(cookie, /; Secure/);
  clock += 7 * 86400000 + 1;
  assert.equal((await fetch(`${base}/admin/api/stats`, { headers: { Cookie: cookie.split(';')[0] } })).status, 401);
});

test('a storage failure is visible as unavailable, preserves the broken file, and leaves the canvas usable', async (t) => {
  const filename = await directory(t);
  await fs.writeFile(filename, 'not a sqlite database');
  const errors = [];
  const recorder = createAnalytics({ filename, logger: { error: (value) => errors.push(value) }, intervalMs: 100000 });
  t.after(() => recorder.close());
  recorder.add('pulses', 2);
  await assert.rejects(recorder.snapshot(), /unavailable/);
  assert.ok(errors.every((line) => !line.includes(filename)));
  assert.equal(await fs.readFile(filename, 'utf8'), 'not a sqlite database');
  const password = randomBytes(24).toString('base64url');
  const origin = 'http://127.0.0.1:3000';
  const service = createPulsiiServer({ analyticsConfig: { filename, passwordHash: hashPassword(password), localOrigin: origin } });
  t.after(() => service.close());
  const { port } = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  const loggedIn = await fetch(`${base}/admin/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const cookie = loggedIn.headers.get('set-cookie').split(';')[0];
  const stats = await fetch(`${base}/admin/api/stats`, { headers: { Cookie: cookie } });
  assert.equal(stats.status, 503);
  assert.match(await stats.text(), /not zero-usage/);
  assert.equal((await fetch(base)).status, 200);
  const sender = new WebSocket(`${base.replace('http', 'ws')}/live`);
  await once(sender, 'open');
  sender.send(JSON.stringify({ type: 'pulse', xNorm: .2, yNorm: .4, color: '#aa00ff' }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(service.getMetrics().pulsesAccepted, 1);
  sender.close(); await once(sender, 'close');
});
