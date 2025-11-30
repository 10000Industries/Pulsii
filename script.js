// Minimal, heavily commented Pulse client.
// Renders expanding circles with additive blending and syncs pulses via WebSocket.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Colour picker UI state (visual handle + hidden native input).
const colorPicker = {
  input: document.getElementById('color-picker'),
  radius: 20,
  margin: 24,
  x: null,
  y: null,
  isDragging: false,
  pointerId: null,
  isPointerCapture: false,
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
const WS_URL = `${WS_PROTOCOL}://${window.location.host}`;
let socket;

// Track CSS size and device pixel ratio so pointer math and drawing stay aligned.
let cssWidth = 0;
let cssHeight = 0;
let deviceRatio = window.devicePixelRatio || 1;

// Scale canvas to device pixels so circles stay sharp on HiDPI displays, while drawing in CSS units.
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  cssWidth = rect.width;
  cssHeight = rect.height;
  deviceRatio = window.devicePixelRatio || 1;

  canvas.width = Math.round(cssWidth * deviceRatio);
  canvas.height = Math.round(cssHeight * deviceRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  // Map drawing operations (in CSS pixels) to the backing store (device pixels).
  ctx.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);

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
  pulses.push({
    normX,
    normY,
    rgb,
    radius: 0,
    age: 0, // track lifetime for opacity shaping
  });
}

// Send a pulse to peers and create it locally immediately (no round-trip delay).
function sendPulse(normX, normY, colorHex) {
  spawnPulse(normX, normY, colorHex);

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'pulse', xNorm: normX, yNorm: normY, color: colorHex }));
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

// Pointer utilities for the colour picker control.
function isInsideColorPicker(localX, localY) {
  const dx = localX - colorPicker.x;
  const dy = localY - colorPicker.y;
  return Math.hypot(dx, dy) <= colorPicker.radius;
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

function handlePointerDown(event) {
  const { x, y, normX, normY } = getPointerPosition(event);

  if (isInsideColorPicker(x, y)) {
    colorPicker.isDragging = true;
    colorPicker.pointerId = event.pointerId;
    colorPicker.isPointerCapture = true;
    colorPicker.dragStartX = colorPicker.x;
    colorPicker.dragStartY = colorPicker.y;
    colorPicker.pointerStartX = x;
    colorPicker.pointerStartY = y;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (err) {
      // Safe to ignore capture failures.
    }
    event.preventDefault();
    return;
  }

  const colorHex = colorPicker.input.value;
  sendPulse(normX, normY, colorHex);
}

function handlePointerMove(event) {
  if (!colorPicker.isDragging || event.pointerId !== colorPicker.pointerId) return;

  const { x, y } = getPointerPosition(event);
  const deltaX = x - colorPicker.pointerStartX;
  const deltaY = y - colorPicker.pointerStartY;
  colorPicker.x = colorPicker.dragStartX + deltaX;
  colorPicker.y = colorPicker.dragStartY + deltaY;
  positionColorPicker();
}

function finishColorPickerDrag(event, shouldTriggerPicker) {
  if (!colorPicker.isDragging || event.pointerId !== colorPicker.pointerId) return;

  if (colorPicker.isPointerCapture) {
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (err) {
      // Ignored; not all environments support release.
    }
  }

  const moved = Math.hypot(colorPicker.x - colorPicker.dragStartX, colorPicker.y - colorPicker.dragStartY);
  colorPicker.isDragging = false;
  colorPicker.pointerId = null;
  colorPicker.isPointerCapture = false;

  if (shouldTriggerPicker && moved < 3) {
    openColorPicker();
  }
}

function handlePointerUp(event) {
  finishColorPickerDrag(event, true);
}

function handlePointerCancel(event) {
  finishColorPickerDrag(event, false);
}

// Touch event handlers mirror pointer logic; prevent default to avoid scroll/zoom on canvas.
function findTouchById(touchList, id) {
  for (let i = 0; i < touchList.length; i += 1) {
    if (touchList[i].identifier === id) return touchList[i];
  }
  return null;
}

function handleTouchStart(event) {
  if (event.touches.length === 0) return;
  const touch = event.touches[0];
  const { x, y, normX, normY } = getTouchPosition(touch);

  if (isInsideColorPicker(x, y)) {
    colorPicker.isDragging = true;
    colorPicker.pointerId = touch.identifier;
    colorPicker.isPointerCapture = false;
    colorPicker.dragStartX = colorPicker.x;
    colorPicker.dragStartY = colorPicker.y;
    colorPicker.pointerStartX = x;
    colorPicker.pointerStartY = y;
    event.preventDefault();
    return;
  }

  const colorHex = colorPicker.input.value;
  sendPulse(normX, normY, colorHex);
  event.preventDefault();
}

function handleTouchMove(event) {
  if (!colorPicker.isDragging) return;
  const touch = findTouchById(event.touches, colorPicker.pointerId);
  if (!touch) return;

  const { x, y } = getTouchPosition(touch);
  const deltaX = x - colorPicker.pointerStartX;
  const deltaY = y - colorPicker.pointerStartY;
  colorPicker.x = colorPicker.dragStartX + deltaX;
  colorPicker.y = colorPicker.dragStartY + deltaY;
  positionColorPicker();
  event.preventDefault();
}

function handleTouchEnd(event) {
  if (!colorPicker.isDragging) return;
  const touch = findTouchById(event.changedTouches, colorPicker.pointerId);
  if (!touch) return;

  // Fabricate a minimal event-like object to reuse the drag finish logic.
  const syntheticEvent = { pointerId: colorPicker.pointerId };
  finishColorPickerDrag(syntheticEvent, true);
  event.preventDefault();
}

function handleTouchCancel(event) {
  if (!colorPicker.isDragging) return;
  const touch = findTouchById(event.changedTouches, colorPicker.pointerId);
  if (!touch) return;

  const syntheticEvent = { pointerId: colorPicker.pointerId };
  finishColorPickerDrag(syntheticEvent, false);
}

// Attempt to open and maintain a WebSocket connection to sync pulses across users.
function connectWebSocket() {
  socket = new WebSocket(WS_URL);

  socket.addEventListener('open', () => {
    console.log('WebSocket connected');
  });

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      const { type, xNorm, yNorm, color } = data || {};

      if (type === 'pulse' && typeof xNorm === 'number' && typeof yNorm === 'number' && typeof color === 'string') {
        // Convert normalized coords back into canvas space before drawing.
        const clampedX = Math.max(0, Math.min(1, xNorm));
        const clampedY = Math.max(0, Math.min(1, yNorm));
        const pxX = clampedX * canvas.width;
        const pxY = clampedY * canvas.height;
        const normX = pxX / canvas.width; // stays normalized for spawnPulse
        const normY = pxY / canvas.height;
        spawnPulse(normX, normY, color);
      }
    } catch (err) {
      // Ignore malformed messages to keep the loop resilient.
      console.error('Ignoring bad message', err);
    }
  });

  socket.addEventListener('close', () => {
    console.log('WebSocket disconnected, retrying...');
    // Lightweight reconnect loop; keeps trying without overwhelming the server.
    setTimeout(connectWebSocket, 500);
  });

  socket.addEventListener('error', () => {
    // Errors are followed by close; allow the reconnect logic to run.
  });
}

// Main render loop: update physics, clear, then draw all pulses with additive blend.
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
  }

  // Draw the colour picker handle on top using normal compositing.
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = colorPicker.input.value || '#ffffff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(colorPicker.x, colorPicker.y, colorPicker.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  requestAnimationFrame(animate);
}

// Initialize everything once the document is ready.
function init() {
  // Ensure the colour handle starts with a random, visible hue on black.
  colorPicker.input.value = randomColor();

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  canvas.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerCancel);
  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  window.addEventListener('touchmove', handleTouchMove, { passive: false });
  window.addEventListener('touchend', handleTouchEnd, { passive: false });
  window.addEventListener('touchcancel', handleTouchCancel, { passive: false });
  connectWebSocket();

  // Toggle this flag above to true to enable the local test bot.
  if (BOT_ENABLED) {
    startBotPulse();
  }

  // Non-obtrusive support prompt: shows after a delay every page load.
  const coffeeCard = document.getElementById('coffee-card');
  const coffeeButton = document.getElementById('coffee-button');
  const coffeeClose = document.getElementById('coffee-close');
  const COFFEE_URL = 'https://buymeacoffee.com/yourname';
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
