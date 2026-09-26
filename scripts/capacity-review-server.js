'use strict';

// Temporary start command for the isolated, expiring review service only.
// Keep the normal HTTP service available while running the bounded test once.
const { spawn } = require('node:child_process');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const assert = require('node:assert/strict');
assert.equal(process.env.TRIAL_MODE, 'true', 'Review capacity runner requires trial bounds');
assert.notEqual(process.env.PUBLIC_MODE, 'true', 'Never run against the public canvas');
const server = spawn(process.execPath, ['server.js'], { stdio: 'inherit' });
let load;
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  stopping = true;
  load?.kill(signal);
  server.kill(signal);
});
server.once('exit', code => { load?.kill(); process.exitCode = code || 0; });

async function main() {
  const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const readyDeadline = Date.now() + 15_000;
  while (true) {
    const ready = await new Promise(resolve => {
      const req = http.get(origin + '/healthz', res => {
        res.resume(); resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
    if (ready) break;
    if (Date.now() >= readyDeadline || stopping) throw new Error('Review server did not become ready');
    await delay(100);
  }
  console.log(JSON.stringify({event: 'capacity_review_started', localOnly: true}));
  load = spawn(process.execPath, ['scripts/capacity-test.js', origin], { stdio: 'inherit' });
  const deadline = setTimeout(() => load.kill('SIGTERM'), 160_000);
  load.once('exit', (code, signal) => {
    clearTimeout(deadline);
    console.log(JSON.stringify({event: 'capacity_review_finished', code, signal}));
  });
}
main().catch(error => {
  console.error(error.message);
  server.kill('SIGTERM');
  process.exitCode = 1;
});
