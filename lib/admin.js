'use strict';

const path = require('node:path');
const { randomBytes, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const express = require('express');
const derive = promisify(scrypt);
const SESSION_MS = 7 * 86_400_000;

function parsePasswordHash(value) {
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(value || '')) {
    throw new Error('ADMIN_PASSWORD_HASH must be a valid scrypt hash');
  }
  const [, salt, hash] = value.split(':');
  return { salt, hash: Buffer.from(hash, 'hex') };
}

function installAdmin(app, { analytics, passwordHash, origin, publicDir, now = Date.now }) {
  const password = parsePasswordHash(passwordHash);
  const secure = new URL(origin).protocol === 'https:';
  const sessions = new Map();
  let tokens = 6;
  let lastRefill = now();
  let verifications = 0;
  const router = express.Router();
  const sendFile = (response, file) => response.sendFile(path.join(publicDir, 'admin', file));
  const cookie = (token, age = SESSION_MS / 1000) =>
    `pulsii_admin=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const tokenHash = (value) => createHash('sha256').update(value).digest('hex');
  const readSession = (request) => {
    const token = (request.headers.cookie || '').match(/(?:^|;\s*)pulsii_admin=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (!token) return null;
    const hash = tokenHash(token);
    const expires = sessions.get(hash);
    if (!expires || expires <= now()) { sessions.delete(hash); return null; }
    return hash;
  };
  const sameOrigin = (request) => request.headers.origin === origin &&
    (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin');

  router.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.setHeader('Vary', 'Cookie');
    next();
  });
  router.get('/admin.css', (request, response) => sendFile(response, 'admin.css'));
  router.get('/login.js', (request, response) => sendFile(response, 'login.js'));
  router.get('/dashboard.js', (request, response) => sendFile(response, 'dashboard.js'));
  router.get('/', (request, response) => sendFile(response, readSession(request) ? 'dashboard.html' : 'login.html'));

  router.post('/login', (request, response, next) => {
    if (!sameOrigin(request)) return response.status(403).json({ error: 'Use the Pulsii login page.' });
    if (!request.is('application/json')) return response.status(415).json({ error: 'Invalid request.' });
    const at = now();
    tokens = Math.min(6, tokens + Math.max(0, at - lastRefill) / 10_000);
    lastRefill = at;
    if (tokens < 1 || verifications >= 2) {
      response.setHeader('Retry-After', '60');
      return response.status(429).json({ error: 'Too many login attempts. Wait a minute and try again.' });
    }
    tokens -= 1;
    next();
  }, express.json({ limit: '2kb', strict: true }), async (request, response) => {
    const value = request.body?.password;
    if (typeof value !== 'string' || value.length < 16 || value.length > 256) {
      return response.status(401).json({ error: 'Password not recognised.' });
    }
    verifications += 1;
    try {
      const hash = await derive(value, password.salt, 64);
      if (!timingSafeEqual(hash, password.hash)) {
        return response.status(401).json({ error: 'Password not recognised.' });
      }
      for (const [key, expiry] of sessions) if (expiry <= now()) sessions.delete(key);
      if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('hex');
      sessions.set(tokenHash(token), now() + SESSION_MS);
      response.setHeader('Set-Cookie', cookie(token));
      response.json({ ok: true });
    } catch {
      response.status(503).json({ error: 'Login is temporarily unavailable.' });
    } finally { verifications -= 1; }
  });
  router.use((request, response, next) => {
    const session = readSession(request);
    if (!session) return response.status(401).json({ error: 'Please sign in.' });
    request.adminSession = session;
    next();
  });
  router.post('/logout', (request, response) => {
    if (!sameOrigin(request)) return response.status(403).json({ error: 'Invalid origin.' });
    sessions.delete(request.adminSession);
    response.setHeader('Set-Cookie', cookie('', 0));
    response.json({ ok: true });
  });

  const stats = async (request, response, csv = false) => {
    const parameters = new URL(request.originalUrl, origin).searchParams;
    const hours = Number(parameters.get('hours') || 24);
    if (![24, 168, 720, 2160].includes(hours)) return response.status(400).json({ error: 'Invalid date range.' });
    try {
      const data = await analytics.snapshot(hours);
      if (!csv) return response.json(data);
      const keys = ['minute', 'pageLoads', 'redditPageLoads', 'connections', 'closed', 'activeClosed',
        'durationMs', 'pulses', 'busy', 'capacity', 'peak', 'observedMs', 'connectionMs', 'sharedMs', 'sharedConnectionMs'];
      response.setHeader('Content-Disposition', 'attachment; filename="pulsii-analytics.csv"');
      response.type('text/csv').send([
        ['bucket_start_utc', ...keys.slice(1)].join(','),
        ...data.series.map((row) => [new Date(row.minute).toISOString(), ...keys.slice(1).map((key) => row[key])].join(',')),
      ].join('\r\n'));
    } catch {
      response.status(503).json({ error: 'Analytics storage is unavailable. These are not zero-usage results. The canvas can still operate.' });
    }
  };
  router.get('/api/stats', (request, response) => stats(request, response));
  router.get('/export.csv', (request, response) => stats(request, response, true));
  router.use((request, response) => response.status(404).json({ error: 'Not found.' }));
  app.use('/admin', router);
}

module.exports = { installAdmin, parsePasswordHash };
