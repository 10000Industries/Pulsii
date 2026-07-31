(function pulsiiModule(root) {
  'use strict';

  const PULSE_LIFETIME_SECONDS = 2.35;
  const MAX_PULSE_ALPHA = 0.72;
  const MAX_ACTIVE_PULSES = 180;
  const REDUCED_MAX_ACTIVE_PULSES = 36;
  const RECONNECT_BASE_MS = 500;
  const RECONNECT_MAX_MS = 8000;
  const TAP_MAX_TRAVEL_PX = 12;
  const HEX_COLOR = /^#[0-9a-f]{6}$/i;
  const PULSE_KEYS = new Set(['type', 'xNorm', 'yNorm', 'color']);

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizePulse(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.type !== 'pulse'
    ) {
      return null;
    }
    const keys = Object.keys(value);
    if (keys.length !== PULSE_KEYS.size || keys.some((key) => !PULSE_KEYS.has(key))) return null;
    if (!Number.isFinite(value.xNorm) || !Number.isFinite(value.yNorm)) return null;
    if (value.xNorm < 0 || value.xNorm > 1 || value.yNorm < 0 || value.yNorm > 1) return null;
    if (typeof value.color !== 'string' || !HEX_COLOR.test(value.color)) return null;

    return {
      type: 'pulse',
      xNorm: value.xNorm,
      yNorm: value.yNorm,
      color: value.color.toLowerCase(),
    };
  }

  function hexToRgb(hex) {
    if (typeof hex !== 'string' || !HEX_COLOR.test(hex)) return null;
    const value = Number.parseInt(hex.slice(1), 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255,
    };
  }

  function pulseOpacity(ageSeconds, lifetimeSeconds = PULSE_LIFETIME_SECONDS) {
    const progress = clamp(ageSeconds / lifetimeSeconds, 0, 1);
    return MAX_PULSE_ALPHA * Math.exp(-4.2 * progress);
  }

  function pulseAgeSeconds(createdAt, now) {
    if (!Number.isFinite(createdAt) || !Number.isFinite(now)) return 0;
    return Math.max(0, (now - createdAt) / 1000);
  }

  function reconnectDelay(attempt, randomValue = Math.random()) {
    const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.max(0, attempt)));
    const jitter = 0.8 + (clamp(randomValue, 0, 1) * 0.4);
    return Math.min(RECONNECT_MAX_MS, Math.round(exponential * jitter));
  }

  function connectionLabel(count) {
    if (count === 1) return 'live · just you here';
    if (Number.isInteger(count) && count > 1) {
      return `live · ${count} connections`;
    }
    return 'live';
  }

  function canonicalShareUrl(locationHref) {
    try {
      const url = new URL(locationHref);
      url.hash = '';
      url.search = '';
      return url.toString();
    } catch (error) {
      return locationHref;
    }
  }

  function isTapGesture(startX, startY, endX, endY, hadMultiplePointers = false) {
    if (hadMultiplePointers) return false;
    if (![startX, startY, endX, endY].every(Number.isFinite)) return false;
    return Math.hypot(endX - startX, endY - startY) <= TAP_MAX_TRAVEL_PX;
  }

  const core = Object.freeze({
    HEX_COLOR,
    MAX_ACTIVE_PULSES,
    PULSE_LIFETIME_SECONDS,
    REDUCED_MAX_ACTIVE_PULSES,
    canonicalShareUrl,
    connectionLabel,
    hexToRgb,
    isTapGesture,
    normalizePulse,
    pulseAgeSeconds,
    pulseOpacity,
    reconnectDelay,
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
  }

  if (!root.document) return;

  const document = root.document;
  const canvas = document.getElementById('canvas');
  const stage = document.getElementById('stage');
  const context = canvas && canvas.getContext('2d');
  const intro = document.getElementById('intro');
  const status = document.getElementById('connection-status');
  const statusText = document.getElementById('status-text');
  const colorInput = document.getElementById('color-picker');
  const colorHandle = document.getElementById('color-handle');
  const pauseButton = document.getElementById('pause-button');
  const inviteButton = document.getElementById('invite-button');
  const aboutButton = document.getElementById('about-button');
  const aboutDialog = document.getElementById('about-dialog');
  const aboutClose = document.getElementById('about-close');
  const actionFeedback = document.getElementById('action-feedback');

  if (
    !canvas ||
    !stage ||
    !context ||
    !status ||
    !statusText ||
    !colorInput ||
    !colorHandle ||
    !pauseButton ||
    !inviteButton ||
    !aboutButton ||
    !aboutDialog ||
    !aboutClose ||
    !actionFeedback
  ) {
    return;
  }

  const brightPalette = ['#00d4ff', '#ff4d8d', '#ffd166', '#7cff6b', '#b388ff', '#ff7a45'];
  const reducedMotion = root.matchMedia('(prefers-reduced-motion: reduce)');
  const pulses = [];

  let cssWidth = 0;
  let cssHeight = 0;
  let deviceRatio = 1;
  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let presenceCount = null;
  let connectionStopped = false;
  let resizeFrame = null;
  let animationFrame = null;
  let visualsPaused = false;
  let feedbackTimer = null;
  let crowdedStatusTimer = null;
  const canvasPointers = new Map();
  let canvasGestureHadMultiplePointers = false;

  const picker = {
    radius: 24,
    margin: 18,
    x: null,
    y: null,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    pointerStartX: 0,
    pointerStartY: 0,
    maxTravel: 0,
  };

  function setStatus(state, text) {
    status.dataset.state = state;
    statusText.textContent = text;
    inviteButton.disabled = state !== 'live' && state !== 'crowded';
  }

  function showLiveStatus() {
    if (crowdedStatusTimer !== null) {
      root.clearTimeout(crowdedStatusTimer);
      crowdedStatusTimer = null;
    }
    setStatus('live', connectionLabel(presenceCount));
    inviteButton.textContent = presenceCount === 1 ? 'invite' : 'share';
  }

  function safeAreaInset(name) {
    const rawValue = root.getComputedStyle(stage)
      .getPropertyValue(`--safe-${name}`)
      .trim();
    const value = Number.parseFloat(rawValue);
    return Number.isFinite(value) ? value : 0;
  }

  function syncPickerPosition() {
    const safeLeft = safeAreaInset('left');
    const safeRight = safeAreaInset('right');
    const safeTop = safeAreaInset('top');
    const safeBottom = safeAreaInset('bottom');
    const minimumX = safeLeft + picker.margin + picker.radius;
    const maximumX = Math.max(
      minimumX,
      cssWidth - safeRight - picker.margin - picker.radius,
    );
    const minimumY = safeTop + picker.margin + picker.radius;
    const maximumY = Math.max(
      minimumY,
      cssHeight - safeBottom - picker.margin - picker.radius,
    );

    if (picker.x === null || picker.y === null) {
      picker.x = minimumX;
      picker.y = maximumY;
    }

    picker.x = clamp(picker.x, minimumX, maximumX);
    picker.y = clamp(picker.y, minimumY, maximumY);

    const color = colorInput.value.toLowerCase();
    colorHandle.style.left = `${picker.x - picker.radius}px`;
    colorHandle.style.top = `${picker.y - picker.radius}px`;
    colorHandle.style.backgroundColor = color;
    colorHandle.style.color = color;
    colorHandle.style.setProperty('--pulse-color', color);
    colorHandle.setAttribute('aria-label', `Choose pulse colour. Current colour ${color}`);

    colorInput.style.left = `${picker.x - picker.radius}px`;
    colorInput.style.top = `${picker.y - picker.radius}px`;
    colorInput.style.width = `${picker.radius * 2}px`;
    colorInput.style.height = `${picker.radius * 2}px`;
  }

  function resizeCanvas() {
    cssWidth = Math.max(1, root.innerWidth);
    cssHeight = Math.max(1, root.innerHeight);
    deviceRatio = Math.min(2, root.devicePixelRatio || 1);

    canvas.width = Math.round(cssWidth * deviceRatio);
    canvas.height = Math.round(cssHeight * deviceRatio);
    context.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
    context.fillStyle = '#000';
    context.fillRect(0, 0, cssWidth, cssHeight);
    syncPickerPosition();
    if (pulses.length > 0) startAnimation();
  }

  function scheduleResize() {
    if (resizeFrame !== null) return;
    resizeFrame = root.requestAnimationFrame(() => {
      resizeFrame = null;
      resizeCanvas();
    });
  }

  function addPulse(pulse) {
    const normalized = normalizePulse(pulse);
    if (!normalized) return false;
    if (visualsPaused) return true;
    const rgb = hexToRgb(normalized.color);
    if (!rgb) return false;

    const pulseLimit = reducedMotion.matches
      ? REDUCED_MAX_ACTIVE_PULSES
      : MAX_ACTIVE_PULSES;
    if (pulses.length >= pulseLimit) {
      pulses.splice(0, pulses.length - pulseLimit + 1);
    }

    pulses.push({
      xNorm: normalized.xNorm,
      yNorm: normalized.yNorm,
      color: normalized.color,
      rgb,
      createdAt: root.performance.now(),
    });
    startAnimation();
    return true;
  }

  function sendPulse(xNorm, yNorm) {
    const pulse = normalizePulse({
      type: 'pulse',
      xNorm,
      yNorm,
      color: colorInput.value,
    });

    if (!pulse) return;
    addPulse(pulse);

    if (
      socket?.readyState === root.WebSocket.OPEN &&
      Number.isInteger(presenceCount)
    ) {
      socket.send(JSON.stringify(pulse));
      intro?.classList.add('dismissed');
      return;
    }

    if (!root.navigator.onLine) {
      setStatus('offline', 'not shared · offline');
    } else {
      setStatus(
        'connecting',
        reconnectAttempt > 0
          ? 'not shared · reconnecting'
          : 'not shared · connecting',
      );
    }
  }

  function pointerPosition(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      xNorm: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      yNorm: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
  }

  function handleCanvasPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType === 'mouse') {
      const { xNorm, yNorm } = pointerPosition(event);
      sendPulse(xNorm, yNorm);
      return;
    }

    canvasPointers.set(event.pointerId, {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      maxTravel: 0,
    });
    if (canvasPointers.size > 1) {
      canvasGestureHadMultiplePointers = true;
    }
  }

  function handleCanvasPointerMove(event) {
    const pointer = canvasPointers.get(event.pointerId);
    if (!pointer) return;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    pointer.maxTravel = Math.max(
      pointer.maxTravel,
      Math.hypot(
        pointer.lastX - pointer.startX,
        pointer.lastY - pointer.startY,
      ),
    );
  }

  function detectAdditionalTouch(event) {
    if (
      event.pointerType !== 'mouse' &&
      canvasPointers.size > 0 &&
      !canvasPointers.has(event.pointerId)
    ) {
      canvasGestureHadMultiplePointers = true;
    }
  }

  function finishCanvasPointer(event, cancelled = false) {
    const pointer = canvasPointers.get(event.pointerId);
    if (!pointer) return;
    canvasPointers.delete(event.pointerId);

    const shouldSend =
      !cancelled &&
      isTapGesture(
        pointer.startX,
        pointer.startY,
        event.clientX,
        event.clientY,
        canvasGestureHadMultiplePointers ||
          pointer.maxTravel > TAP_MAX_TRAVEL_PX,
      );

    if (canvasPointers.size === 0) {
      canvasGestureHadMultiplePointers = false;
    }
    if (!shouldSend) return;

    const { xNorm, yNorm } = pointerPosition(event);
    sendPulse(xNorm, yNorm);
  }

  function handleCanvasKeyDown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    sendPulse(0.5, 0.5);
  }

  function openColorPicker() {
    colorInput.style.pointerEvents = 'auto';
    try {
      colorInput.focus({ preventScroll: true });
      if (typeof colorInput.showPicker === 'function') {
        colorInput.showPicker();
      } else {
        colorInput.click();
      }
    } catch (error) {
      try {
        colorInput.click();
      } catch (fallbackError) {
        // The pulse canvas remains usable if a browser blocks its native picker.
      }
    }
    root.setTimeout(() => {
      colorInput.style.pointerEvents = 'none';
    }, 200);
  }

  function startPickerDrag(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    picker.dragging = true;
    picker.pointerId = event.pointerId;
    picker.startX = picker.x;
    picker.startY = picker.y;
    picker.pointerStartX = event.clientX;
    picker.pointerStartY = event.clientY;
    picker.maxTravel = 0;
    try {
      colorHandle.setPointerCapture(event.pointerId);
    } catch (error) {
      // Window-level pointer listeners below provide the fallback.
    }
    event.stopPropagation();
    event.preventDefault();
  }

  function movePicker(event) {
    if (!picker.dragging || event.pointerId !== picker.pointerId) return;
    const deltaX = event.clientX - picker.pointerStartX;
    const deltaY = event.clientY - picker.pointerStartY;
    picker.maxTravel = Math.max(picker.maxTravel, Math.hypot(deltaX, deltaY));
    picker.x = picker.startX + deltaX;
    picker.y = picker.startY + deltaY;
    syncPickerPosition();
    event.stopPropagation();
    event.preventDefault();
  }

  function finishPickerDrag(event, shouldOpen) {
    if (!picker.dragging || event.pointerId !== picker.pointerId) return;
    const finalTravel = Math.hypot(
      event.clientX - picker.pointerStartX,
      event.clientY - picker.pointerStartY,
    );
    picker.maxTravel = Math.max(picker.maxTravel, finalTravel);

    if (
      typeof colorHandle.hasPointerCapture === 'function' &&
      colorHandle.hasPointerCapture(event.pointerId)
    ) {
      try {
        colorHandle.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Ignore capture cleanup failures from interrupted touch gestures.
      }
    }

    picker.dragging = false;
    picker.pointerId = null;
    event.stopPropagation();
    event.preventDefault();

    if (shouldOpen && picker.maxTravel < 5) openColorPicker();
  }

  function handleMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    if (message?.type === 'presence' && Number.isInteger(message.count) && message.count >= 0) {
      presenceCount = message.count;
      reconnectAttempt = 0;
      showLiveStatus();
      return;
    }

    if (message?.type === 'congestion') {
      setStatus('crowded', 'live · crowded · some pulses not shared');
      if (crowdedStatusTimer !== null) {
        root.clearTimeout(crowdedStatusTimer);
      }
      crowdedStatusTimer = root.setTimeout(() => {
        crowdedStatusTimer = null;
        if (Number.isInteger(presenceCount)) showLiveStatus();
      }, 2500);
      return;
    }

    addPulse(message);
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      root.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (connectionStopped || reconnectTimer !== null || !root.navigator.onLine) return;
    const delay = reconnectDelay(reconnectAttempt);
    reconnectAttempt += 1;
    setStatus('connecting', 'reconnecting');
    reconnectTimer = root.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (connectionStopped) return;
    if (
      socket &&
      (socket.readyState === root.WebSocket.CONNECTING ||
        socket.readyState === root.WebSocket.OPEN)
    ) {
      return;
    }
    if (!/^https?:$/.test(root.location.protocol)) {
      setStatus('offline', 'local only');
      return;
    }
    if (!root.navigator.onLine) {
      setStatus('offline', 'offline · local only');
      return;
    }

    clearReconnectTimer();
    presenceCount = null;
    setStatus('connecting', reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    const protocol = root.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let nextSocket;
    try {
      nextSocket = new root.WebSocket(`${protocol}//${root.location.host}`);
    } catch (error) {
      scheduleReconnect();
      return;
    }
    socket = nextSocket;

    nextSocket.addEventListener('open', () => {
      if (socket !== nextSocket) return;
      setStatus('connecting', reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    });

    nextSocket.addEventListener('message', (event) => {
      if (socket === nextSocket) handleMessage(event);
    });

    nextSocket.addEventListener('close', () => {
      if (socket !== nextSocket) return;
      socket = null;
      presenceCount = null;
      scheduleReconnect();
    });

    nextSocket.addEventListener('error', () => {
      if (socket !== nextSocket) return;
      try {
        nextSocket.close();
      } catch (error) {
        socket = null;
        scheduleReconnect();
      }
    });
  }

  function stopConnection() {
    connectionStopped = true;
    clearReconnectTimer();
    if (socket) {
      const activeSocket = socket;
      socket = null;
      activeSocket.close();
    }
  }

  function startAnimation() {
    if (visualsPaused) return;
    if (animationFrame !== null) return;
    animationFrame = root.requestAnimationFrame(animate);
  }

  function animate(now) {
    animationFrame = null;

    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.fillStyle = '#000';
    context.fillRect(0, 0, cssWidth, cssHeight);
    if (visualsPaused) return;

    const isReduced = reducedMotion.matches;
    const radialSpeed = Math.max(250, Math.hypot(cssWidth, cssHeight) * 0.34);

    context.globalCompositeOperation = isReduced ? 'source-over' : 'lighter';
    context.lineCap = 'round';

    for (let index = pulses.length - 1; index >= 0; index -= 1) {
      const pulse = pulses[index];
      const age = pulseAgeSeconds(pulse.createdAt, now);

      if (age >= PULSE_LIFETIME_SECONDS) {
        pulses.splice(index, 1);
        continue;
      }

      const progress = age / PULSE_LIFETIME_SECONDS;
      const radius = isReduced ? 18 + (progress * 8) : age * radialSpeed;
      const alpha = pulseOpacity(age) * (isReduced ? 0.28 : 1);
      const x = pulse.xNorm * cssWidth;
      const y = pulse.yNorm * cssHeight;

      context.globalAlpha = alpha;
      context.strokeStyle = `rgb(${pulse.rgb.r} ${pulse.rgb.g} ${pulse.rgb.b})`;
      context.lineWidth = isReduced ? 2 : Math.max(1.25, 3.75 - (progress * 2.25));
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.stroke();
    }

    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    if (pulses.length > 0) startAnimation();
  }

  function showActionFeedback(message) {
    actionFeedback.textContent = message;
    actionFeedback.classList.add('visible');
    if (feedbackTimer !== null) root.clearTimeout(feedbackTimer);
    feedbackTimer = root.setTimeout(() => {
      feedbackTimer = null;
      actionFeedback.classList.remove('visible');
    }, 2400);
  }

  function setVisualsPaused(paused) {
    visualsPaused = Boolean(paused);
    pauseButton.setAttribute('aria-pressed', String(visualsPaused));
    pauseButton.textContent = visualsPaused ? 'resume' : 'pause';
    pauseButton.setAttribute(
      'aria-label',
      visualsPaused ? 'Resume pulse visuals' : 'Pause pulse visuals',
    );
    if (visualsPaused) {
      pulses.length = 0;
      if (animationFrame !== null) {
        root.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = '#000';
      context.fillRect(0, 0, cssWidth, cssHeight);
      showActionFeedback('pulse visuals paused');
    } else {
      showActionFeedback('pulse visuals resumed');
    }
  }

  function copyShareUrl(url) {
    if (root.navigator.clipboard?.writeText) {
      return root.navigator.clipboard.writeText(url);
    }

    return new Promise((resolve, reject) => {
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      textArea.setSelectionRange(0, textArea.value.length);
      const copied = document.execCommand('copy');
      textArea.remove();
      if (copied) resolve();
      else reject(new Error('Copy failed'));
    });
  }

  async function shareCanvas() {
    const url = canonicalShareUrl(root.location.href);
    const shareData = {
      title: 'Pulsii',
      text: 'Open this public shared canvas with me for one minute.',
      url,
    };

    if (typeof root.navigator.share === 'function') {
      try {
        await root.navigator.share(shareData);
        showActionFeedback('invitation opened');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    try {
      await copyShareUrl(url);
      showActionFeedback('link copied · send it while you stay here');
    } catch (error) {
      showActionFeedback('copy the page address to invite someone');
    }
  }

  function openAboutDialog() {
    if (typeof aboutDialog.showModal === 'function') {
      aboutDialog.showModal();
    } else {
      aboutDialog.setAttribute('open', '');
    }
  }

  function closeAboutDialog() {
    if (typeof aboutDialog.close === 'function') aboutDialog.close();
    else aboutDialog.removeAttribute('open');
  }

  function initialize() {
    colorInput.value = brightPalette[Math.floor(Math.random() * brightPalette.length)];
    colorInput.addEventListener('input', syncPickerPosition);
    colorInput.addEventListener('change', syncPickerPosition);

    resizeCanvas();
    root.addEventListener('resize', scheduleResize, { passive: true });
    root.visualViewport?.addEventListener('resize', scheduleResize, { passive: true });

    canvas.addEventListener('pointerdown', handleCanvasPointerDown);
    root.addEventListener('pointerdown', detectAdditionalTouch, { capture: true });
    root.addEventListener('pointermove', handleCanvasPointerMove, { passive: true });
    root.addEventListener('pointerup', (event) => finishCanvasPointer(event));
    root.addEventListener('pointercancel', (event) => finishCanvasPointer(event, true));
    canvas.addEventListener('keydown', handleCanvasKeyDown);
    colorHandle.addEventListener('pointerdown', startPickerDrag);
    root.addEventListener('pointermove', movePicker, { passive: false });
    root.addEventListener('pointerup', (event) => finishPickerDrag(event, true));
    root.addEventListener('pointercancel', (event) => finishPickerDrag(event, false));
    colorHandle.addEventListener('click', (event) => {
      if (event.detail === 0) openColorPicker();
    });
    pauseButton.addEventListener('click', () => {
      setVisualsPaused(!visualsPaused);
    });
    inviteButton.addEventListener('click', shareCanvas);
    aboutButton.addEventListener('click', openAboutDialog);
    aboutClose.addEventListener('click', closeAboutDialog);
    aboutDialog.addEventListener('click', (event) => {
      if (event.target === aboutDialog) closeAboutDialog();
    });

    root.addEventListener('offline', () => {
      stopConnection();
      setStatus('offline', 'offline · local only');
    });

    root.addEventListener('online', () => {
      connectionStopped = false;
      reconnectAttempt = 0;
      connect();
    });

    root.addEventListener('pagehide', stopConnection);
    root.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      connectionStopped = false;
      connect();
    });

    connect();
  }

  initialize();
}(typeof globalThis !== 'undefined' ? globalThis : this));
