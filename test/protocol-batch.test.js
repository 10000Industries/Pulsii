'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BATCH_HEADER_BYTES,
  BATCH_PROTOCOL_VERSION,
  PULSE_RECORD_BYTES,
  decodePulseBatch,
  encodePulseBatch,
  excludePulseBatchIndexes,
  inspectPulseBatch,
  serializeBusy,
} = require('../lib/protocol');

test('encodes the versioned pulse batch wire format in network byte order', () => {
  const encoded = encodePulseBatch({
    processEpoch: 0x01020304,
    sequence: 0x05060708,
    serverTimeMs: 1_800_000_000_123,
    pulses: [
      { type: 'pulse', xNorm: 0, yNorm: 1, color: '#A1b2C3' },
      { type: 'pulse', xNorm: 0.5, yNorm: 0.25, color: '#00d4ff' },
    ],
  });

  assert.equal(
    encoded.length,
    BATCH_HEADER_BYTES + (2 * PULSE_RECORD_BYTES),
  );
  assert.equal(encoded.readUInt8(0), BATCH_PROTOCOL_VERSION);
  assert.equal(encoded.readUInt32BE(1), 0x01020304);
  assert.equal(encoded.readUInt32BE(5), 0x05060708);
  assert.equal(encoded.readBigUInt64BE(9), 1_800_000_000_123n);
  assert.equal(encoded.readUInt16BE(17), 2);
  assert.equal(encoded.readUInt16BE(19), 0);
  assert.equal(encoded.readUInt16BE(21), 0xffff);
  assert.deepEqual([...encoded.subarray(23, 26)], [0xa1, 0xb2, 0xc3]);

  assert.deepEqual(inspectPulseBatch(encoded), {
    version: BATCH_PROTOCOL_VERSION,
    processEpoch: 0x01020304,
    sequence: 0x05060708,
    serverTimeMs: 1_800_000_000_123,
    count: 2,
  });

  const decoded = decodePulseBatch(encoded);
  assert.equal(decoded.version, BATCH_PROTOCOL_VERSION);
  assert.equal(decoded.processEpoch, 0x01020304);
  assert.equal(decoded.sequence, 0x05060708);
  assert.equal(decoded.serverTimeMs, 1_800_000_000_123);
  assert.deepEqual(decoded.pulses[0], {
    type: 'pulse',
    xNorm: 0,
    yNorm: 1,
    color: '#a1b2c3',
  });
  assert.ok(Math.abs(decoded.pulses[1].xNorm - 0.5) <= 1 / 0xffff);
  assert.ok(Math.abs(decoded.pulses[1].yNorm - 0.25) <= 1 / 0xffff);
  assert.equal(decoded.pulses[1].color, '#00d4ff');
});

test('rejects malformed batches and invalid encoder inputs', () => {
  const canonical = encodePulseBatch({
    processEpoch: 1,
    sequence: 1,
    serverTimeMs: 1,
    pulses: [
      { type: 'pulse', xNorm: 0.5, yNorm: 0.5, color: '#123456' },
    ],
  });

  assert.equal(decodePulseBatch(canonical.subarray(0, -1)), null);
  assert.equal(inspectPulseBatch(canonical.subarray(0, -1)), null);
  const wrongVersion = Buffer.from(canonical);
  wrongVersion.writeUInt8(255, 0);
  assert.equal(decodePulseBatch(wrongVersion), null);
  const zeroRecords = Buffer.from(canonical.subarray(0, BATCH_HEADER_BYTES));
  zeroRecords.writeUInt16BE(0, 17);
  assert.equal(decodePulseBatch(zeroRecords), null);
  const zeroSequence = Buffer.from(canonical);
  zeroSequence.writeUInt32BE(0, 5);
  assert.equal(inspectPulseBatch(zeroSequence), null);
  assert.equal(decodePulseBatch('not binary'), null);

  assert.throws(
    () => encodePulseBatch({
      processEpoch: 1,
      sequence: 0,
      serverTimeMs: 1,
      pulses: [{ type: 'pulse', xNorm: 0, yNorm: 0, color: '#123456' }],
    }),
    /sequence/,
  );
  assert.throws(
    () => encodePulseBatch({
      processEpoch: -1,
      sequence: 1,
      serverTimeMs: 1,
      pulses: [{ type: 'pulse', xNorm: 0, yNorm: 0, color: '#123456' }],
    }),
    /processEpoch/,
  );
  assert.throws(
    () => encodePulseBatch({
      processEpoch: 1,
      sequence: 1,
      serverTimeMs: 1,
      pulses: [],
    }),
    /pulses must contain/,
  );
  assert.throws(
    () => encodePulseBatch({
      processEpoch: 1,
      sequence: 1,
      serverTimeMs: 1,
      pulses: [{ type: 'pulse', xNorm: 2, yNorm: 0, color: '#123456' }],
    }),
    /invalid pulse/,
  );
});

test('serializes an explicit positive retry notice', () => {
  assert.equal(
    serializeBusy(250),
    '{"type":"busy","retryAfterMs":250}',
  );
  assert.throws(() => serializeBusy(0), /positive integer/);
});

test('sender exclusion preserves exact peer bytes and immutable batch headers', () => {
  const pulses = Array.from({ length: 4 }, (_, i) => ({
    type: 'pulse', xNorm: i / 4, yNorm: 1 - i / 4, color: '#a1b2c' + i,
  }));
  const header = { processEpoch: 19, sequence: 42, serverTimeMs: 1800000000123 };
  const encoded = encodePulseBatch({ ...header, pulses });
  const original = Buffer.from(encoded);
  for (let mask = 0; mask < 16; mask++) {
    const indexes = [0, 1, 2, 3].filter(i => mask & (1 << i));
    const expected = pulses.filter((_, i) => !(mask & (1 << i)));
    const actual = excludePulseBatchIndexes(encoded, indexes);
    assert.deepEqual(actual, expected.length ? encodePulseBatch({ ...header, pulses: expected }) : null);
    assert.deepEqual(encoded, original);
  }
  assert.equal(excludePulseBatchIndexes(encoded, []), encoded);
  for (const indexes of [[-1], [4], [1, 1], [2, 1], [0.5]]) {
    assert.throws(() => excludePulseBatchIndexes(encoded, indexes), /ordered, unique/);
  }
  assert.throws(() => excludePulseBatchIndexes(Buffer.alloc(1), []), /Invalid batch/);
});
