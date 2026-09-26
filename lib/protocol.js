'use strict';

const PULSE_KEYS = new Set(['type', 'xNorm', 'yNorm', 'color']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const BATCH_PROTOCOL_VERSION = 1;
const BATCH_HEADER_BYTES = 19;
const PULSE_RECORD_BYTES = 7;
const MAX_BATCH_PULSES = 0xffff;

function isPlainRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function normalizePulseRecord(message) {
  if (!isPlainRecord(message)) return null;

  const keys = Object.keys(message);
  if (
    keys.length !== PULSE_KEYS.size ||
    keys.some((key) => !PULSE_KEYS.has(key))
  ) {
    return null;
  }

  const { type, xNorm, yNorm, color } = message;
  if (type !== 'pulse') return null;
  if (!Number.isFinite(xNorm) || xNorm < 0 || xNorm > 1) return null;
  if (!Number.isFinite(yNorm) || yNorm < 0 || yNorm > 1) return null;
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) return null;

  return {
    type: 'pulse',
    xNorm,
    yNorm,
    color: color.toLowerCase(),
  };
}

function parsePulseMessage(data) {
  let message;

  try {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : data;
    if (typeof text !== 'string') return null;
    message = JSON.parse(text);
  } catch {
    return null;
  }

  return normalizePulseRecord(message);
}

function serializePresence(count) {
  return JSON.stringify({ type: 'presence', count });
}

function serializeBusy(retryAfterMs) {
  if (!Number.isInteger(retryAfterMs) || retryAfterMs <= 0) {
    throw new Error('retryAfterMs must be a positive integer');
  }
  return JSON.stringify({ type: 'busy', retryAfterMs });
}

function validateBatchInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an integer from 0 to ${maximum}`);
  }
}

function encodePulseBatch({
  processEpoch,
  sequence,
  serverTimeMs,
  pulses,
}) {
  validateBatchInteger(processEpoch, 'processEpoch', 0xffffffff);
  validateBatchInteger(sequence, 'sequence', 0xffffffff);
  if (sequence === 0) {
    throw new Error('sequence must be an integer from 1 to 4294967295');
  }
  validateBatchInteger(serverTimeMs, 'serverTimeMs', Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(pulses)) {
    throw new Error('pulses must be an array');
  }
  if (pulses.length === 0 || pulses.length > MAX_BATCH_PULSES) {
    throw new Error(`pulses must contain from 1 to ${MAX_BATCH_PULSES} records`);
  }

  const output = Buffer.allocUnsafe(
    BATCH_HEADER_BYTES + (pulses.length * PULSE_RECORD_BYTES),
  );
  output.writeUInt8(BATCH_PROTOCOL_VERSION, 0);
  output.writeUInt32BE(processEpoch, 1);
  output.writeUInt32BE(sequence, 5);
  output.writeBigUInt64BE(BigInt(serverTimeMs), 9);
  output.writeUInt16BE(pulses.length, 17);

  let offset = BATCH_HEADER_BYTES;
  for (const candidate of pulses) {
    const pulse = normalizePulseRecord(candidate);
    if (!pulse) throw new Error('pulses contains an invalid pulse');
    const rgb = Number.parseInt(pulse.color.slice(1), 16);
    output.writeUInt16BE(Math.round(pulse.xNorm * 0xffff), offset);
    output.writeUInt16BE(Math.round(pulse.yNorm * 0xffff), offset + 2);
    output.writeUInt8((rgb >> 16) & 0xff, offset + 4);
    output.writeUInt8((rgb >> 8) & 0xff, offset + 5);
    output.writeUInt8(rgb & 0xff, offset + 6);
    offset += PULSE_RECORD_BYTES;
  }

  return output;
}

function pulseBatchBuffer(data) {
  const input = Buffer.isBuffer(data)
    ? data
    : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : ArrayBuffer.isView(data)
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : null;
  return input;
}

function inspectPulseBatch(data) {
  const input = pulseBatchBuffer(data);
  if (!input || input.length < BATCH_HEADER_BYTES) return null;
  if (input.readUInt8(0) !== BATCH_PROTOCOL_VERSION) return null;

  const count = input.readUInt16BE(17);
  const sequence = input.readUInt32BE(5);
  if (
    count === 0 ||
    sequence === 0 ||
    input.length !== BATCH_HEADER_BYTES + (count * PULSE_RECORD_BYTES)
  ) {
    return null;
  }

  const rawServerTimeMs = input.readBigUInt64BE(9);
  if (rawServerTimeMs > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  return {
    version: BATCH_PROTOCOL_VERSION,
    processEpoch: input.readUInt32BE(1),
    sequence,
    serverTimeMs: Number(rawServerTimeMs),
    count,
  };
}

function decodePulseBatch(data) {
  const input = pulseBatchBuffer(data);
  const header = inspectPulseBatch(input);
  if (!input || !header) return null;

  const pulses = [];
  let offset = BATCH_HEADER_BYTES;
  for (let index = 0; index < header.count; index += 1) {
    const red = input.readUInt8(offset + 4);
    const green = input.readUInt8(offset + 5);
    const blue = input.readUInt8(offset + 6);
    pulses.push({
      type: 'pulse',
      xNorm: input.readUInt16BE(offset) / 0xffff,
      yNorm: input.readUInt16BE(offset + 2) / 0xffff,
      color: `#${red.toString(16).padStart(2, '0')}${green
        .toString(16)
        .padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`,
    });
    offset += PULSE_RECORD_BYTES;
  }

  return {
    version: header.version,
    processEpoch: header.processEpoch,
    sequence: header.sequence,
    serverTimeMs: header.serverTimeMs,
    pulses,
  };
}

module.exports = {
  BATCH_HEADER_BYTES,
  BATCH_PROTOCOL_VERSION,
  MAX_BATCH_PULSES,
  PULSE_RECORD_BYTES,
  decodePulseBatch,
  encodePulseBatch,
  inspectPulseBatch,
  parsePulseMessage,
  serializeBusy,
  serializePresence,
};
