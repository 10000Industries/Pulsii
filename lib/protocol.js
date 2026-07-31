'use strict';

const PULSE_KEYS = new Set(['type', 'xNorm', 'yNorm', 'color']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isPlainRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
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

function serializePulse(pulse) {
  return JSON.stringify(pulse);
}

function serializePresence(count) {
  return JSON.stringify({ type: 'presence', count });
}

function serializeCongestion() {
  return JSON.stringify({ type: 'congestion' });
}

module.exports = {
  parsePulseMessage,
  serializeCongestion,
  serializePresence,
  serializePulse,
};
