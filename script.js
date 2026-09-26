// Minimal, heavily commented Pulse client.
// Original released radial-glow renderer; bounded live transport is adapted below.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Colour picker UI state (DOM handle + hidden native input).
const colorPicker = {
  input: document.getElementById('color-picker'),
  handle: document.getElementById('color-handle'),
  radius: 20,
  margin: 24,
  x: null,
  y: null,
  isDraggingPicker: false,
  pointerId: null,
  dragStartX: 0,
  dragStartY: 0,
  pointerStartX: 0,
  pointerStartY: 0,
};

// Track all active pulses. Each pulse grows outward and fades until alpha hits zero.
const pulses = [];

// Animation parameters chosen for a crisp, smooth feel.
const MAX_PULSE_ALPHA = 0.22; // peak opacity per pulse (handled via globalAlpha)
const GROWTH_RATE = 420;      // pixels per second the radius expands
const PULSE_LIFETIME = 1.4;   // seconds a pulse lives

// Optional local bot to emit test pulses for visual verification.
const BOT_ENABLED = false;
const BOT_COLOR = '#3399ff'; // distinct blue tone for easy spotting
const BOT_INTERVAL_MS = 1500;
let botTimer = null;

// WebSocket endpoint for multi-user sync (uses current host/port for deploy friendliness).
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
const WS_URL = `${WS_PROTOCOL}://${window.location.host}/live`;
let socket;
let reconnectTimer = null;
let reconnectAttempt = 0;
let trialEnded = false;
const CLIENT_BUILD = 'touch-20260926-1';
const USE_NATIVE_TOUCH = 'ontouchstart' in window;
const MAX_ACTIVE_PULSES = 1024;
let inputCount = 0;
let localCount = 0;
let paintedCount = 0;
let diagnosticsLastPaint = 0;
let busyUntil = 0;
let statusTimer = null;
let sentCount = 0;
let receivedCount = 0;
const diagnostics = /pulsii-restoration-review/.test(window.location.hostname) &&
  new URLSearchParams(window.location.search).get('diagnostics') === '1';

function showConnectionStatus(text) {
  const status = document.getElementById('connection-status');
  status.textContent = text;
  status.hidden = !text;
}

function temporaryStatus(text) {
  clearTimeout(statusTimer);
  showConnectionStatus(text);
  statusTimer = setTimeout(() => {
    if (socket?.readyState === WebSocket.OPEN) showConnectionStatus('');
  }, 1800);
}

function reportDiagnostics() {
  if (!diagnostics) return;
  canvas.dataset.build = CLIENT_BUILD;
  canvas.dataset.inputMode = USE_NATIVE_TOUCH ? 'touchstart' : 'pointerdown';
  canvas.dataset.inputs = String(inputCount);
  canvas.dataset.local = String(localCount);
  canvas.dataset.painted = String(paintedCount);
  canvas.dataset.sent = String(sentCount);
  canvas.dataset.received = String(receivedCount);
  canvas.dataset.activePulses = String(pulses.length);
  const readout = document.getElementById('input-diagnostics');
  if (readout) {
    readout.hidden = false;
    readout.textContent = `${CLIENT_BUILD} · ${USE_NATIVE_TOUCH ? 'touch' : 'pointer'} · input ${inputCount} · local ${localCount} · painted ${paintedCount} · sent ${sentCount} · received ${receivedCount}`;
  }
}

const BATCH_HEADER_BYTES = 19;
const BATCH_PROTOCOL_VERSION = 1;
const PULSE_RECORD_BYTES = 7;
  function decodePulseBatch(data) {
    let view;
    if (data instanceof ArrayBuffer) {
      view = new DataView(data);
    } else if (ArrayBuffer.isView(data)) {
      view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    } else {
      return null;
    }
    if (view.byteLength < BATCH_HEADER_BYTES) return null;
    if (view.getUint8(0) !== BATCH_PROTOCOL_VERSION) return null;

    const count = view.getUint16(17, false);
    const sequence = view.getUint32(5, false);
    if (
      count === 0 ||
      sequence === 0 ||
      view.byteLength !==
      BATCH_HEADER_BYTES + (count * PULSE_RECORD_BYTES)
    ) {
      return null;
    }

    const pulses = new Array(count);
    for (let index = 0; index < count; index += 1) {
      const offset = BATCH_HEADER_BYTES + (index * PULSE_RECORD_BYTES);
      const red = view.getUint8(offset + 4);
      const green = view.getUint8(offset + 5);
      const blue = view.getUint8(offset + 6);
      pulses[index] = {
        type: 'pulse',
        xNorm: view.getUint16(offset, false) / 65_535,
        yNorm: view.getUint16(offset + 2, false) / 65_535,
        color: `#${red.toString(16).padStart(2, '0')}${green
          .toString(16)
          .padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`,
      };
    }

    const serverTimeMs =
      (view.getUint32(9, false) * 4_294_967_296) +
      view.getUint32(13, false);
    if (!Number.isSafeInteger(serverTimeMs)) return null;

    return {
      count,
      processEpoch: view.getUint32(1, false),
      pulses,
      sequence,
      serverTimeMs,
    };
  }



// Track CSS size and device pixel ratio so pointer math and drawing stay aligned.
let cssWidth = 0;
let cssHeight = 0;
let deviceRatio = window.devicePixelRatio || 1;

// Scale canvas to device pixels so circles stay sharp on HiDPI displays, while drawing in CSS units.
function resizeCanvas() {
  const viewport = window.visualViewport;
  const nextWidth = viewport ? viewport.width : window.innerWidth;
  const nextHeight = viewport ? viewport.height : window.innerHeight;
  const nextRatio = window.devicePixelRatio || 1;
  if (cssWidth === nextWidth && cssHeight === nextHeight && deviceRatio === nextRatio) return;
  cssWidth = nextWidth;
  cssHeight = nextHeight;
  deviceRatio = nextRatio;

  canvas.width = Math.round(cssWidth * deviceRatio);
  canvas.height = Math.round(cssHeight * deviceRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  // Map drawing operations (in CSS pixels) to the backing store (device pixels).
  ctx.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Keep the colour picker visible and within bounds after resizes.
  positionColorPicker();
}

// Clamp helper to keep the colour picker on screen.
function positionColorPicker() {
  if (colorPicker.x === null || colorPicker.y === null) {
    colorPicker.x = colorPicker.margin + colorPicker.radius;
    colorPicker.y = cssHeight - (colorPicker.margin + colorPicker.radius);
  }

  colorPicker.x = Math.min(Math.max(colorPicker.radius, colorPicker.x), Math.max(colorPicker.radius, cssWidth - colorPicker.radius));
  colorPicker.y = Math.min(Math.max(colorPicker.radius, colorPicker.y), Math.max(colorPicker.radius, cssHeight - colorPicker.radius));

  syncColorInputPosition();
}

// Keep the hidden input inside the viewport (helps mobile browsers allow the picker to open).
function syncColorInputPosition() {
  const x = colorPicker.x ?? colorPicker.radius;
  const y = colorPicker.y ?? colorPicker.radius;
  const size = colorPicker.radius * 2;
  colorPicker.input.style.left = `${x - colorPicker.radius}px`;
  colorPicker.input.style.top = `${y - colorPicker.radius}px`;
  colorPicker.input.style.width = `${size}px`;
  colorPicker.input.style.height = `${size}px`;
  colorPicker.handle.style.left = `${x - colorPicker.radius}px`;
  colorPicker.handle.style.top = `${y - colorPicker.radius}px`;
  colorPicker.handle.style.background = colorPicker.input.value || '#ffffff';
}

// Convert #RRGGBB to an object so we can easily inject alpha later.
function hexToRgb(hex) {
  const cleaned = hex.replace('#', '');
  const int = parseInt(cleaned, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

// Generate a random bright-ish colour to avoid black defaults.
function randomColor() {
  const channel = () => Math.floor(Math.random() * 200) + 30; // keep within 30-229 to avoid extremes
  const r = channel().toString(16).padStart(2, '0');
  const g = channel().toString(16).padStart(2, '0');
  const b = channel().toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

// Create a new pulse at normalized coordinates (0-1) so it maps across screen sizes.
function spawnPulse(normX, normY, colorHex) {
  const rgb = hexToRgb(colorHex);
  if (pulses.length >= MAX_ACTIVE_PULSES) pulses.shift();
  pulses.push({
    normX,
    normY,
    rgb,
    radius: 0,
    age: 0, // track lifetime for opacity shaping
  });
}

// Preserve immediate local drawing. The negotiated protocol sends only peers'
// contributions back, so the original server-echo duplication cannot occur.
function sendPulse(normX, normY, colorHex) {
  if (trialEnded) {
    showConnectionStatus('review ended');
    return;
  }
  // The local interaction never waits on a timer, token bucket or network.
  spawnPulse(normX, normY, colorHex);
  localCount += 1;
  reportDiagnostics();
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showConnectionStatus('local only — reconnecting');
    return;
  }
  if (performance.now() < busyUntil || socket.bufferedAmount > 64 * 1024) {
    temporaryStatus('local only — sharing busy');
    return;
  }
  try {
    socket.send(JSON.stringify({ type: 'pulse', xNorm: normX, yNorm: normY, color: colorHex }));
    sentCount += 1;
    reportDiagnostics();
  } catch {
    showConnectionStatus('local only — reconnecting');
  }
}

// Local bot pulse generator for testing overlaps/timing (does not broadcast by default).
function startBotPulse() {
  if (botTimer) return;
  botTimer = setInterval(() => {
    // Use spawnPulse for local-only; swap to sendPulse(...) to broadcast to peers.
    spawnPulse(0.5, 0.5, BOT_COLOR);
  }, BOT_INTERVAL_MS);
}

function stopBotPulse() {
  if (!botTimer) return;
  clearInterval(botTimer);
  botTimer = null;
}

function getPointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  // Normalize against the backing store to keep pulses consistent across devices.
  return {
    x,
    y,
    normX: (x * deviceRatio) / canvas.width,
    normY: (y * deviceRatio) / canvas.height,
  };
}

function getTouchPosition(touch) {
  const rect = canvas.getBoundingClientRect();
  const x = touch.clientX - rect.left;
  const y = touch.clientY - rect.top;
  return {
    x,
    y,
    normX: (x * deviceRatio) / canvas.width,
    normY: (y * deviceRatio) / canvas.height,
  };
}

function openColorPicker() {
  // Temporarily enable pointer events so mobile browsers allow the picker to open.
  colorPicker.input.style.pointerEvents = 'auto';
  colorPicker.input.focus({ preventScroll: true });

  // Use the modern API if available; otherwise fall back to click().
  if (typeof colorPicker.input.showPicker === 'function') {
    colorPicker.input.showPicker();
  } else {
    colorPicker.input.click();
  }

  // Turn pointer events back off shortly after to keep canvas interactions clean.
  setTimeout(() => {
    colorPicker.input.style.pointerEvents = 'none';
  }, 200);
}

function handleCanvasPointerDown(event) {
  if (event.target !== canvas) return;
  // On touch browsers, native touchstart owns finger/Pencil input. Pointer
  // events remain for mouse/trackpad; this prevents duplicate compatibility input.
  if (USE_NATIVE_TOUCH && (event.pointerType === 'touch' || event.pointerType === 'pen')) return;
  if (event.button !== undefined && event.button !== 0) return;
  if (event.cancelable) event.preventDefault();
  const { normX, normY } = getPointerPosition(event);
  inputCount += 1;
  sendPulse(normX, normY, colorPicker.input.value);
}

function handleCanvasTouchStart(event) {
  if (event.target !== canvas) return;
  // Handle raw contacts before browser tap/double-tap gesture interpretation.
  // changedTouches identifies NEW fingers, rather than repeating touches[0].
  if (event.cancelable) event.preventDefault();
  for (const touch of event.changedTouches) {
    if (touch.target && touch.target !== canvas) continue;
    const { normX, normY } = getTouchPosition(touch);
    inputCount += 1;
    sendPulse(normX, normY, colorPicker.input.value);
  }
}

// Colour picker drag handlers (separate from canvas pulses).
function startPickerDrag(x, y, id) {
  colorPicker.isDraggingPicker = true;
  colorPicker.pointerId = id;
  colorPicker.dragStartX = colorPicker.x;
  colorPicker.dragStartY = colorPicker.y;
  colorPicker.pointerStartX = x;
  colorPicker.pointerStartY = y;
}

function movePickerDrag(x, y) {
  if (!colorPicker.isDraggingPicker) return;
  const deltaX = x - colorPicker.pointerStartX;
  const deltaY = y - colorPicker.pointerStartY;
  colorPicker.x = colorPicker.dragStartX + deltaX;
  colorPicker.y = colorPicker.dragStartY + deltaY;
  positionColorPicker();
}

function endPickerDrag(triggerPicker) {
  if (!colorPicker.isDraggingPicker) return;
  const moved = Math.hypot(colorPicker.x - colorPicker.dragStartX, colorPicker.y - colorPicker.dragStartY);
  colorPicker.isDraggingPicker = false;
  colorPicker.pointerId = null;
  if (triggerPicker && moved < 3) {
    openColorPicker();
  }
}

function handlePickerPointerDown(event) {
  const { x, y } = getPointerPosition(event);
  startPickerDrag(x, y, event.pointerId);
  try {
    colorPicker.handle.setPointerCapture(event.pointerId);
  } catch (err) {
    // Ignore capture errors.
  }
  event.stopPropagation();
  event.preventDefault();
}

function handlePickerPointerMove(event) {
  if (!colorPicker.isDraggingPicker || event.pointerId !== colorPicker.pointerId) return;
  const { x, y } = getPointerPosition(event);
  movePickerDrag(x, y);
  event.stopPropagation();
  event.preventDefault();
}

function handlePickerPointerUp(event) {
  if (!colorPicker.isDraggingPicker || event.pointerId !== colorPicker.pointerId) return;
  try {
    colorPicker.handle.releasePointerCapture(event.pointerId);
  } catch (err) {
    // Ignore release errors.
  }
  endPickerDrag(true);
  event.stopPropagation();
  event.preventDefault();
}

function handlePickerPointerCancel(event) {
  if (!colorPicker.isDraggingPicker || event.pointerId !== colorPicker.pointerId) return;
  endPickerDrag(false);
  event.stopPropagation();
  event.preventDefault();
}

// Touch event handlers mirror pointer logic; prevent default to avoid scroll/zoom on canvas.
function findTouchById(touchList, id) {
  for (let i = 0; i < touchList.length; i += 1) {
    if (touchList[i].identifier === id) return touchList[i];
  }
  return null;
}

function handlePickerTouchStart(event) {
  if (event.touches.length === 0) return;
  const touch = event.touches[0];
  const { x, y } = getTouchPosition(touch);
  startPickerDrag(x, y, touch.identifier);
  event.stopPropagation();
  event.preventDefault();
}

function handlePickerTouchMove(event) {
  if (!colorPicker.isDraggingPicker) return;
  const touch = findTouchById(event.touches, colorPicker.pointerId);
  if (!touch) return;
  const { x, y } = getTouchPosition(touch);
  movePickerDrag(x, y);
  event.stopPropagation();
  event.preventDefault();
}

function handlePickerTouchEnd(event) {
  if (!colorPicker.isDraggingPicker) return;
  const touch = findTouchById(event.changedTouches, colorPicker.pointerId);
  if (!touch) return;
  endPickerDrag(true);
  event.stopPropagation();
  event.preventDefault();
}

function handlePickerTouchCancel(event) {
  if (!colorPicker.isDraggingPicker) return;
  endPickerDrag(false);
  event.stopPropagation();
  event.preventDefault();
}

// Reconnect with bounded backoff, and stop after the review expires.
function connectWebSocket() {
  if (trialEnded || (socket && socket.readyState <= WebSocket.OPEN)) return;
  const nextSocket = new WebSocket(WS_URL, 'pulsii-immediate-v1');
  socket = nextSocket;
  nextSocket.binaryType = 'arraybuffer';
  showConnectionStatus('connecting');
  const connectionTimeout = setTimeout(() => nextSocket.close(), 12000);
  let stableTimer;

  nextSocket.addEventListener('open', () => {
    clearTimeout(connectionTimeout);
    showConnectionStatus('');
    stableTimer = setTimeout(() => { reconnectAttempt = 0; }, 30000);
  });
  nextSocket.addEventListener('message', (event) => {
    if (socket !== nextSocket) return;
    if (typeof event.data !== 'string') {
      const batch = decodePulseBatch(event.data);
      if (!batch || document.hidden) return;
      for (const pulse of batch.pulses) {
        spawnPulse(pulse.xNorm, pulse.yNorm, pulse.color);
        receivedCount += 1;
      }
      reportDiagnostics();
      return;
    }
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'busy') {
        busyUntil = performance.now() + Math.min(15000, Math.max(100, message.retryAfterMs || 1000));
        temporaryStatus('canvas busy — that pulse was not shared');
      }
    } catch { /* Ignore unknown or malformed control frames. */ }
  });
  nextSocket.addEventListener('close', (event) => {
    clearTimeout(connectionTimeout);
    clearTimeout(stableTimer);
    if (socket !== nextSocket) return;
    if (event.code === 4000) {
      trialEnded = true;
      showConnectionStatus('review ended');
      return;
    }
    const wait = event.code === 1013 ? 15000 : event.code === 1008 ? 10000 :
      Math.min(8000, 500 * 2 ** Math.min(reconnectAttempt++, 5)) * (0.75 + Math.random() * 0.25);
    showConnectionStatus(event.code === 1013 ? 'canvas full — retrying' : 'reconnecting — not sharing');
    reconnectTimer = setTimeout(connectWebSocket, wait);
  });
  nextSocket.addEventListener('error', () => {});
}

// Original released render loop: expanding radial gradients and trailing fade.
let lastTime = performance.now();
function animate(now) {
  const deltaSec = Math.min((now - lastTime) / 1000, 0.05); // cap delta to avoid jumps
  lastTime = now;

  // Gentle trailing fade so bright spots decay over time.
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.restore();

  // Update and draw each pulse.
  for (let i = pulses.length - 1; i >= 0; i -= 1) {
    const pulse = pulses[i];
    pulse.age += deltaSec;
    pulse.radius += GROWTH_RATE * deltaSec;

    const lifeT = Math.min(1, pulse.age / PULSE_LIFETIME); // 0..1
    const bell = Math.sin(Math.PI * lifeT); // peaks mid-life, 0 at start/end
    const alpha = MAX_PULSE_ALPHA * bell;

    if (lifeT >= 1) {
      pulses.splice(i, 1);
      continue;
    }

    const x = pulse.normX * cssWidth;
    const y = pulse.normY * cssHeight;

    // Soft radial glow: brightest near center, fades to transparent at edge.
    const grad = ctx.createRadialGradient(x, y, 0, x, y, pulse.radius);
    grad.addColorStop(0, `rgba(${pulse.rgb.r}, ${pulse.rgb.g}, ${pulse.rgb.b}, 0.9)`);
    grad.addColorStop(0.4, `rgba(${pulse.rgb.r}, ${pulse.rgb.g}, ${pulse.rgb.b}, 0.5)`);
    grad.addColorStop(1, `rgba(${pulse.rgb.r}, ${pulse.rgb.g}, ${pulse.rgb.b}, 0)`);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, pulse.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (diagnostics && !pulse.painted) {
      pulse.painted = true;
      paintedCount += 1;
    }
  }

  if (diagnostics && now - diagnosticsLastPaint >= 250) {
    diagnosticsLastPaint = now;
    reportDiagnostics();
  }
  requestAnimationFrame(animate);
}

// Initialize everything once the document is ready.
function init() {
  // Ensure the colour handle starts with a random, visible hue on black.
  colorPicker.input.value = randomColor();
  colorPicker.input.addEventListener('input', syncColorInputPosition);

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', handleCanvasPointerDown);
    colorPicker.handle.addEventListener('pointerdown', handlePickerPointerDown);
    colorPicker.handle.addEventListener('pointermove', handlePickerPointerMove);
    colorPicker.handle.addEventListener('pointerup', handlePickerPointerUp);
    colorPicker.handle.addEventListener('pointercancel', handlePickerPointerCancel);
  } else {
    colorPicker.handle.addEventListener('touchstart', handlePickerTouchStart, { passive: false });
    colorPicker.handle.addEventListener('touchmove', handlePickerTouchMove, { passive: false });
    colorPicker.handle.addEventListener('touchend', handlePickerTouchEnd, { passive: false });
    colorPicker.handle.addEventListener('touchcancel', handlePickerTouchCancel, { passive: false });
  }
  if (USE_NATIVE_TOUCH || !window.PointerEvent) {
    canvas.addEventListener('touchstart', handleCanvasTouchStart, { passive: false });
    canvas.addEventListener('touchmove', (event) => { if (event.cancelable) event.preventDefault(); }, { passive: false });
  }
  if (!window.PointerEvent) canvas.addEventListener('mousedown', handleCanvasPointerDown);
  colorPicker.handle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openColorPicker(); }
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resizeCanvas);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pulses.length = 0;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cssWidth, cssHeight);
      reportDiagnostics();
    }
    lastTime = performance.now();
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(reconnectTimer);
    const oldSocket = socket;
    socket = null;
    oldSocket?.close();
  });
  window.addEventListener('pageshow', connectWebSocket);
  connectWebSocket();
  reportDiagnostics();

  // Toggle this flag above to true to enable the local test bot.
  if (BOT_ENABLED) {
    startBotPulse();
  }

  // Non-obtrusive support prompt: shows after a delay every page load.
  const coffeeCard = document.getElementById('coffee-card');
  const coffeeButton = document.getElementById('coffee-button');
  const coffeeClose = document.getElementById('coffee-close');
  const COFFEE_URL = 'https://buymeacoffee.com/10000industries';
  const COFFEE_DELAY_MS = 2 * 60 * 1000; // 2 minutes

  setTimeout(() => {
    coffeeCard.classList.add('visible');
  }, COFFEE_DELAY_MS);

  coffeeButton.addEventListener('click', () => {
    window.open(COFFEE_URL, '_blank', 'noopener,noreferrer');
  });

  coffeeClose.addEventListener('click', () => {
    coffeeCard.classList.remove('visible');
  });

  requestAnimationFrame(animate);
}

init();
