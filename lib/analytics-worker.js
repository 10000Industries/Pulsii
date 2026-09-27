'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { FIELDS, MINUTE, RETENTION_DAYS } = require('./analytics-fields');

fs.mkdirSync(path.dirname(workerData.filename), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(workerData.filename);
fs.chmodSync(workerData.filename, 0o600);
db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
  CREATE TABLE IF NOT EXISTS minutes (
    minute INTEGER PRIMARY KEY,
    ${FIELDS.map((key) => `${key} REAL NOT NULL DEFAULT 0`).join(',')}
  );
  CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, savedAt INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
`);
const write = db.prepare(`INSERT INTO minutes (minute, ${FIELDS.join(',')})
  VALUES (${Array(FIELDS.length + 1).fill('?').join(',')})
  ON CONFLICT(minute) DO UPDATE SET ${FIELDS.map((key) =>
    `${key} = ${key === 'peak' ? `MAX(minutes.${key}, excluded.${key})` : `minutes.${key} + excluded.${key}`}`,
  ).join(',')}`);
const hasBatch = db.prepare('SELECT id FROM batches WHERE id = ?');
const addBatch = db.prepare('INSERT INTO batches VALUES (?, ?)');
const read = db.prepare(`SELECT (minute / ?) * ? AS minute,
  ${FIELDS.map((key) => `${key === 'peak' ? 'MAX' : 'SUM'}(${key}) AS ${key}`).join(',')}
  FROM minutes WHERE minute >= ? AND minute <= ? GROUP BY 1 ORDER BY 1`);
const first = db.prepare("SELECT value FROM metadata WHERE key = 'startedAt'");
const start = db.prepare("INSERT OR IGNORE INTO metadata VALUES ('startedAt', ?)");
let lastPruned = 0;

parentPort.on('message', ({ id, method, payload }) => {
  try {
    let result;
    if (method === 'write') {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!hasBatch.get(payload.batchId)) {
          for (const row of payload.rows) {
            if (!Number.isSafeInteger(row.minute) || row.minute % MINUTE ||
                !FIELDS.every((key) => Number.isFinite(row[key]) && row[key] >= 0)) {
              throw new Error('Invalid aggregate');
            }
            write.run(row.minute, ...FIELDS.map((key) => row[key]));
          }
          addBatch.run(payload.batchId, payload.now);
          start.run(payload.startedAt);
        }
        if (payload.now - lastPruned > 3_600_000) {
          const cutoff = payload.now - RETENTION_DAYS * 86_400_000;
          db.prepare('DELETE FROM minutes WHERE minute < ?').run(cutoff);
          db.prepare('DELETE FROM batches WHERE savedAt < ?').run(cutoff);
          lastPruned = payload.now;
        }
        db.exec('COMMIT');
        result = { savedAt: payload.now };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } else if (method === 'read') {
      result = { rows: read.all(payload.resolutionMs, payload.resolutionMs, payload.from, payload.to), startedAt: first.get()?.value ?? null };
    } else if (method === 'close') {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
      result = true;
    } else if (method === 'ready') {
      result = true;
    } else {
      throw new Error('Unknown operation');
    }
    parentPort.postMessage({ id, result });
  } catch {
    // Do not send database paths or raw errors to the HTTP layer or logs.
    parentPort.postMessage({ id, error: 'Analytics storage unavailable' });
  }
});
