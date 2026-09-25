(function pulsiiModule(root) {
  'use strict';

  const PULSE_LIFETIME_SECONDS = 2.35;
  const MIN_LATE_VISIBILITY_SECONDS = 0.4;
  // This bounds each sRGB channel even when many pulses overlap. The MAX /
  // lighten compositors below must not be changed to additive blending.
  const MAX_PULSE_ALPHA = 0.30;
  const PULSE_ATTACK_SECONDS = 0.18;
  const DEFAULT_CALM_VISUALS = true;
  const RECONNECT_BASE_MS = 500;
  const RECONNECT_MAX_MS = 8000;
  const CAPACITY_RECONNECT_BASE_MS = 15_000;
  const CAPACITY_RECONNECT_MAX_MS = 60_000;
  const RATE_LIMIT_RECONNECT_BASE_MS = 10_000;
  const RATE_LIMIT_RECONNECT_MAX_MS = 30_000;
  const CONNECTION_TIMEOUT_MS = 12_000;
  const STABLE_CONNECTION_MS = 30_000;
  const CROWD_VISUAL_THRESHOLD = 240;
  const CROWD_INTENSITY_REFERENCE = 180;
  const BATCH_PROTOCOL_VERSION = 1;
  const BATCH_HEADER_BYTES = 19;
  const PULSE_RECORD_BYTES = 7;
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
    const attack = clamp(ageSeconds / PULSE_ATTACK_SECONDS, 0, 1);
    return MAX_PULSE_ALPHA * attack * Math.exp(-4.2 * progress);
  }

  function displayPulseRgb(rgb) {
    // Preserve hue selection while moving saturated reds toward a softer pink.
    // Applied before both renderers. Quantised edge pixels are checked in the
    // visual review; this helper alone is not a flash-conformance claim.
    return { r: rgb.r, g: Math.max(rgb.g, Math.ceil(rgb.r * 0.65)),
      b: Math.max(rgb.b, Math.ceil(rgb.r * 0.65)) };
  }

  function limitCanvasRedPixels(pixels) {
    // Canvas2D antialiasing can round tiny pink edge pixels to pure red.
    // Correct the final 8-bit pixels, matching the fragment shader's rule.
    // Blue/green are only raised as far as red, so the brightness ceiling holds.
    for (let i = 0; i < pixels.length; i += 4) {
      const floor = Math.ceil(pixels[i] * 0.65);
      if (pixels[i + 1] < floor) pixels[i + 1] = floor;
      if (pixels[i + 2] < floor) pixels[i + 2] = floor;
    }
    return pixels;
  }

  function pulseAgeSeconds(createdAt, now) {
    if (!Number.isFinite(createdAt) || !Number.isFinite(now)) return 0;
    return Math.max(0, (now - createdAt) / 1000);
  }

  function pulseCreatedAtForBatch(serverTimeMs, wallNowMs, performanceNowMs) {
    if (
      !Number.isFinite(serverTimeMs) ||
      !Number.isFinite(wallNowMs) ||
      !Number.isFinite(performanceNowMs)
    ) {
      return performanceNowMs;
    }
    const lifetimeMs = PULSE_LIFETIME_SECONDS * 1000;
    const latestVisibleAgeMs = Math.max(
      0,
      lifetimeMs - (MIN_LATE_VISIBILITY_SECONDS * 1000),
    );
    const ageAtReceiptMs = clamp(
      wallNowMs - serverTimeMs,
      0,
      latestVisibleAgeMs,
    );
    return performanceNowMs - ageAtReceiptMs;
  }

  function shouldUseCalmVisuals(
    manualCalm,
    prefersReducedMotion,
    activePulseCount = 0,
    crowdMode = activePulseCount >= CROWD_VISUAL_THRESHOLD,
  ) {
    return Boolean(
      manualCalm ||
      prefersReducedMotion ||
      crowdMode
    );
  }

  function nextCrowdMode(active, activePulseCount) {
    if (!Number.isFinite(activePulseCount) || activePulseCount < 0) {
      return Boolean(active);
    }
    // Once a dense moment begins, keep its bounded visual profile until the
    // canvas becomes quiet. This avoids a visible 239/240 mode oscillation.
    if (active) return activePulseCount > 0;
    return activePulseCount >= CROWD_VISUAL_THRESHOLD;
  }

  function jitteredBackoff(
    attempt,
    randomValue,
    baseMs,
    maximumMs,
  ) {
    const exponential = Math.min(
      maximumMs,
      baseMs * (2 ** Math.max(0, attempt)),
    );
    const jitter = 0.75 + (clamp(randomValue, 0, 1) * 0.5);
    return Math.min(maximumMs, Math.round(exponential * jitter));
  }

  function reconnectPolicy(code, attempt, randomValue = Math.random()) {
    if (code === 4000) {
      return { delayMs: null, state: 'ended', text: 'session ended' };
    }
    if (code === 1008) {
      return {
        delayMs: jitteredBackoff(
          attempt,
          randomValue,
          RATE_LIMIT_RECONNECT_BASE_MS,
          RATE_LIMIT_RECONNECT_MAX_MS,
        ),
        state: 'limited',
        text: 'paused · too many pulses',
      };
    }
    if (code === 1013) {
      return {
        delayMs: jitteredBackoff(
          attempt,
          randomValue,
          CAPACITY_RECONNECT_BASE_MS,
          CAPACITY_RECONNECT_MAX_MS,
        ),
        state: 'full',
        text: 'canvas full · retrying',
      };
    }
    if (code === 1012) {
      return {
        delayMs: jitteredBackoff(attempt, randomValue, 1_500, 12_000),
        state: 'connecting',
        text: 'canvas restarting',
      };
    }
    return {
      delayMs: jitteredBackoff(
        attempt,
        randomValue,
        RECONNECT_BASE_MS,
        RECONNECT_MAX_MS,
      ),
      state: 'connecting',
      text: 'reconnecting',
    };
  }

  function reconnectDelay(attempt, randomValue = Math.random()) {
    return reconnectPolicy(1006, attempt, randomValue).delayMs;
  }

  function crowdIntensityScale(activePulseCount) {
    if (
      !Number.isFinite(activePulseCount) ||
      activePulseCount <= CROWD_INTENSITY_REFERENCE
    ) {
      return 1;
    }
    return Math.max(
      0.08,
      Math.sqrt(CROWD_INTENSITY_REFERENCE / activePulseCount),
    );
  }

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

  function isNewBatchSequence(previousSequence, nextSequence) {
    if (
      !Number.isInteger(previousSequence) ||
      !Number.isInteger(nextSequence) ||
      previousSequence < 0 ||
      previousSequence > 0xffff_ffff ||
      nextSequence <= 0 ||
      nextSequence > 0xffff_ffff
    ) {
      return false;
    }
    if (previousSequence === 0) return true;
    const forwardDistance = (nextSequence - previousSequence) >>> 0;
    return forwardDistance > 0 && forwardDistance < 0x8000_0000;
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
    BATCH_HEADER_BYTES,
    BATCH_PROTOCOL_VERSION,
    CONNECTION_TIMEOUT_MS,
    CROWD_VISUAL_THRESHOLD,
    HEX_COLOR,
    MIN_LATE_VISIBILITY_SECONDS,
    DEFAULT_CALM_VISUALS,
    PULSE_LIFETIME_SECONDS,
    MAX_PULSE_ALPHA,
    PULSE_ATTACK_SECONDS,
    displayPulseRgb,
    limitCanvasRedPixels,
    canonicalShareUrl,
    connectionLabel,
    crowdIntensityScale,
    decodePulseBatch,
    hexToRgb,
    isTapGesture,
    isNewBatchSequence,
    normalizePulse,
    nextCrowdMode,
    PULSE_RECORD_BYTES,
    STABLE_CONNECTION_MS,
    pulseAgeSeconds,
    pulseCreatedAtForBatch,
    pulseOpacity,
    reconnectDelay,
    reconnectPolicy,
    shouldUseCalmVisuals,
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
  }

  if (!root.document) return;

  const document = root.document;
  // Opt-in inspection on the isolated review host only. No network, storage,
  // identifiers, or pulse content; ordinary product visits do not run this.
  const reviewHost = /^pulsii-restoration-review(?:-[a-z0-9-]+)?\.onrender\.com$/.test(root.location.hostname);
  const reviewParameters = new URLSearchParams(root.location.search);
  const reviewDiagnostics = reviewHost && reviewParameters.get('diagnostics') === '1';
  const frameReview = { frames: 0, maxChannel: 0, redViolations: 0, renderMs: 0 };
  function inspectReviewPixels(pixels) {
    for (let i = 0; i < pixels.length; i += 4) {
      frameReview.maxChannel = Math.max(frameReview.maxChannel, pixels[i], pixels[i + 1], pixels[i + 2]);
      if (pixels[i + 1] < Math.ceil(pixels[i] * 0.65) || pixels[i + 2] < Math.ceil(pixels[i] * 0.65)) frameReview.redViolations += 1;
    }
  }
  let canvas = document.getElementById('canvas');
  const stage = document.getElementById('stage');
  const intro = document.getElementById('intro');
  const status = document.getElementById('connection-status');
  const statusText = document.getElementById('status-text');
  const colorInput = document.getElementById('color-picker');
  const colorHandle = document.getElementById('color-handle');
  const calmButton = document.getElementById('calm-button');
  const pauseButton = document.getElementById('pause-button');
  const inviteButton = document.getElementById('invite-button');
  const aboutButton = document.getElementById('about-button');
  const aboutDialog = document.getElementById('about-dialog');
  const aboutClose = document.getElementById('about-close');
  const actionFeedback = document.getElementById('action-feedback');
  const connectionAnnouncer = document.getElementById('connection-announcer');
  const pulseActivity = document.getElementById('pulse-activity');
  const visualProfileStatus = document.getElementById('visual-profile-status');
  const colorHint = document.getElementById('color-hint');

  if (
    !canvas ||
    !stage ||
    !status ||
    !statusText ||
    !colorInput ||
    !colorHandle ||
    !calmButton ||
    !pauseButton ||
    !inviteButton ||
    !aboutButton ||
    !aboutDialog ||
    !aboutClose ||
    !actionFeedback ||
    !connectionAnnouncer ||
    !pulseActivity ||
    !visualProfileStatus ||
    !colorHint
  ) {
    return;
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to create pulse shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Pulse shader failed';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createWebGlPulseRenderer(targetCanvas) {
    const gl = targetCanvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      desynchronized: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      stencil: false,
    });
    if (!gl) return null;
    gl.disable(gl.DITHER);
    if ('drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = 'srgb';

    const vertexSource = `#version 300 es
      precision highp float;
      layout(location = 0) in vec2 aCorner;
      layout(location = 1) in vec2 aCenter;
      layout(location = 2) in vec3 aColor;
      layout(location = 3) in float aCreatedAt;
      uniform vec2 uViewport;
      uniform float uNow;
      uniform float uLifetime;
      uniform float uRadialSpeed;
      uniform float uCalm;
      uniform float uStatic;
      uniform float uIntensity;
      out vec2 vOffset;
      out vec3 vColor;
      out float vRadius;
      out float vLineWidth;
      out float vAlpha;
      out float vAlive;

      void main() {
        float age = max(0.0, uNow - aCreatedAt);
        float progress = clamp(age / uLifetime, 0.0, 1.0);
        float fullRadius = age * uRadialSpeed;
        float calmRadius = 18.0 + (progress * 8.0);
        float radius = mix(fullRadius, calmRadius, uCalm);
        radius = mix(radius, 22.0, uStatic);
        float fullLine = max(1.25, 3.75 - (progress * 2.25));
        float lineWidth = mix(fullLine, 2.0, uCalm);
        vec2 offset = aCorner * (radius + lineWidth + 2.0);
        vec2 position = (aCenter * uViewport) + offset;
        vec2 clip = ((position / uViewport) * 2.0) - 1.0;

        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        vOffset = offset;
        vColor = aColor;
        vRadius = radius;
        vLineWidth = lineWidth;
        float attack = clamp(age / ${PULSE_ATTACK_SECONDS}, 0.0, 1.0);
        vAlpha = ${MAX_PULSE_ALPHA} * attack * exp(-4.2 * progress) * mix(1.0, 0.65, uCalm) * uIntensity;
        vAlive = 1.0 - step(uLifetime, age);
      }
    `;
    const fragmentSource = `#version 300 es
      precision highp float;
      in vec2 vOffset;
      in vec3 vColor;
      in float vRadius;
      in float vLineWidth;
      in float vAlpha;
      in float vAlive;
      out vec4 outputColor;

      void main() {
        if (vAlive < 0.5) discard;
        float distanceFromRing = abs(length(vOffset) - vRadius);
        float innerEdge = max(0.0, (vLineWidth * 0.5) - 1.0);
        float outerEdge = (vLineWidth * 0.5) + 1.0;
        float coverage = 1.0 - smoothstep(innerEdge, outerEdge, distanceFromRing);
        if (coverage <= 0.0) discard;
        float alpha = vAlpha * coverage;
        vec3 display = floor(vColor * alpha * 255.0 + 0.5);
        display.gb = max(display.gb, ceil(display.r * 0.65));
        outputColor = vec4(display / 255.0, alpha);
      }
    `;

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error('Unable to create pulse program');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Pulse program failed');
    }

    const cornerBuffer = gl.createBuffer();
    const instanceBuffer = gl.createBuffer();
    if (!cornerBuffer || !instanceBuffer) {
      throw new Error('Unable to allocate pulse buffers');
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1,
      ]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const instanceStride = 6 * Float32Array.BYTES_PER_ELEMENT;
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    for (const [location, size, offset] of [
      [1, 2, 0],
      [2, 3, 2 * Float32Array.BYTES_PER_ELEMENT],
      [3, 1, 5 * Float32Array.BYTES_PER_ELEMENT],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(
        location,
        size,
        gl.FLOAT,
        false,
        instanceStride,
        offset,
      );
      gl.vertexAttribDivisor(location, 1);
    }

    const uniforms = Object.fromEntries(
      [
        'uViewport',
        'uNow',
        'uLifetime',
        'uRadialSpeed',
        'uCalm',
        'uStatic',
        'uIntensity',
      ].map((name) => [name, gl.getUniformLocation(program, name)]),
    );
    let uploadedRevision = -1;

    function upload(activePulses, revision) {
      if (revision === uploadedRevision) return;
      const data = new Float32Array(activePulses.length * 6);
      for (let index = 0; index < activePulses.length; index += 1) {
        const pulse = activePulses[index];
        const offset = index * 6;
        data[offset] = pulse.xNorm;
        data[offset + 1] = pulse.yNorm;
        data[offset + 2] = pulse.rgb.r / 255;
        data[offset + 3] = pulse.rgb.g / 255;
        data[offset + 4] = pulse.rgb.b / 255;
        data[offset + 5] = pulse.createdAt / 1000;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      uploadedRevision = revision;
    }

    return {
      kind: 'webgl2',
      clear() {
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      },
      resize() {
        gl.viewport(0, 0, targetCanvas.width, targetCanvas.height);
        this.clear();
      },
      render(activePulses, now, profile, revision, viewport) {
        upload(activePulses, revision);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (activePulses.length === 0) return;

        gl.useProgram(program);
        gl.enable(gl.BLEND);
        // Every fragment is premultiplied in the shader. MAX blending keeps
        // overlap brightness-bounded in both visual profiles: repeated pulses
        // at one coordinate cannot accumulate into an unbounded white flash.
        gl.blendEquation(gl.MAX);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.uniform2f(uniforms.uViewport, viewport.width, viewport.height);
        gl.uniform1f(uniforms.uNow, now / 1000);
        gl.uniform1f(uniforms.uLifetime, PULSE_LIFETIME_SECONDS);
        gl.uniform1f(
          uniforms.uRadialSpeed,
          Math.max(250, Math.hypot(viewport.width, viewport.height) * 0.34),
        );
        gl.uniform1f(uniforms.uCalm, profile.calm ? 1 : 0);
        gl.uniform1f(uniforms.uStatic, profile.static ? 1 : 0);
        gl.uniform1f(uniforms.uIntensity, profile.intensity);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, activePulses.length);
        if (reviewDiagnostics && frameReview.frames < 24) {
          const pixels = new Uint8Array(targetCanvas.width * targetCanvas.height * 4);
          gl.readPixels(0, 0, targetCanvas.width, targetCanvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          inspectReviewPixels(pixels);
          frameReview.glError = gl.getError();
        }
      },
    };
  }

  function createCanvasPulseRenderer(targetCanvas) {
    const context = targetCanvas.getContext('2d', { alpha: false, colorSpace: 'srgb', willReadFrequently: true });
    if (!context) return null;

    return {
      kind: 'canvas2d',
      clear() {
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = '#000';
        context.fillRect(0, 0, cssWidth, cssHeight);
      },
      resize(width, height, ratio) {
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.clear();
      },
      render(activePulses, now, profile, revision, viewport) {
        this.clear();
        if (activePulses.length === 0) return;
        // Match the GPU renderer's brightness ceiling. `lighten` selects the
        // brightest channel contribution instead of accumulating overlaps.
        context.globalCompositeOperation = 'lighten';
        context.lineCap = 'round';
        const radialSpeed = Math.max(
          250,
          Math.hypot(viewport.width, viewport.height) * 0.34,
        );

        for (const pulse of activePulses) {
          const age = pulseAgeSeconds(pulse.createdAt, now);
          const progress = age / PULSE_LIFETIME_SECONDS;
          const radius = profile.static
            ? 22
            : profile.calm
              ? 18 + (progress * 8)
              : age * radialSpeed;
          const alpha = pulseOpacity(age) *
            (profile.calm ? 0.65 : 1) *
            profile.intensity;

          // Pre-scale colour and draw opaquely so both profiles retain the
          // same overlap ceiling as WebGL's premultiplied MAX blend.
          context.globalAlpha = 1;
          context.strokeStyle = `rgb(${Math.round(pulse.rgb.r * alpha)} ${Math.round(
            pulse.rgb.g * alpha,
          )} ${Math.round(pulse.rgb.b * alpha)})`;
          context.lineWidth = profile.calm
            ? 2
            : Math.max(1.25, 3.75 - (progress * 2.25));
          context.beginPath();
          context.arc(
            pulse.xNorm * viewport.width,
            pulse.yNorm * viewport.height,
            radius,
            0,
            Math.PI * 2,
          );
          context.stroke();
        }
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        const frame = context.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
        limitCanvasRedPixels(frame.data);
        context.putImageData(frame, 0, 0);
        if (reviewDiagnostics && frameReview.frames < 24) inspectReviewPixels(frame.data);
      },
    };
  }

  let renderer;
  let webGlInitializationFailed = false;
  try {
    renderer = reviewDiagnostics && reviewParameters.get('renderer') === '2d'
      ? null : createWebGlPulseRenderer(canvas);
  } catch (error) {
    webGlInitializationFailed = true;
    renderer = null;
  }
  if (!renderer && webGlInitializationFailed) {
    // A canvas cannot switch context types after WebGL creation. Replace the
    // untouched element before asking for the 2D fallback.
    const replacementCanvas = canvas.cloneNode(false);
    canvas.replaceWith(replacementCanvas);
    canvas = replacementCanvas;
  }
  renderer ||= createCanvasPulseRenderer(canvas);
  if (!renderer) return;

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
  let sessionEnded = false;
  let connectionTimeoutTimer = null;
  let stableConnectionTimer = null;
  let resizeFrame = null;
  let animationFrame = null;
  let pulseRevision = 0;
  let rendererContextLost = false;
  let lastBatchEpoch = null;
  let lastBatchSequence = 0;
  let calmVisuals = DEFAULT_CALM_VISUALS;
  let crowdVisualsActive = false;
  let calmControlSignature = '';
  let visualsPaused = false;
  let feedbackTimer = null;
  let crowdedStatusTimer = null;
  let busyUntil = 0;
  let pulseActivityTimer = null;
  let unannouncedPulseCount = 0;
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

  function setStatus(state, text, announce = true) {
    const previousState = status.dataset.state;
    status.dataset.state = state;
    statusText.textContent = text;
    inviteButton.disabled = state !== 'live' && state !== 'crowded';
    if (previousState === state || !announce) return;
    const announcements = {
      connecting: 'Pulsii is connecting.',
      crowded: 'Pulsii is live, but the canvas is busy.',
      full: 'The Pulsii canvas is currently full.',
      limited: 'Pulsii paused this connection after too many pulses.',
      ended: 'This Pulsii session has ended. Pulses are not being shared.',
      live: 'Pulsii is connected and sharing live.',
      offline: 'Pulsii is offline. Pulses are not being shared.',
    };
    connectionAnnouncer.textContent = announcements[state] || text;
  }

  function announcePulseBatch(count) {
    if (!Number.isInteger(count) || count <= 0) return;
    unannouncedPulseCount += count;
    if (pulseActivityTimer !== null) return;
    pulseActivityTimer = root.setTimeout(() => {
      pulseActivityTimer = null;
      const total = unannouncedPulseCount;
      unannouncedPulseCount = 0;
      pulseActivity.textContent =
        total === 1 ? '1 shared pulse appeared.' : `${total} shared pulses appeared.`;
    }, 10_000);
  }

  function dismissColorHint() {
    colorHint.classList.add('dismissed');
  }

  function showLiveStatus(announce = true) {
    if (crowdedStatusTimer !== null) {
      root.clearTimeout(crowdedStatusTimer);
      crowdedStatusTimer = null;
    }
    setStatus('live', connectionLabel(presenceCount), announce);
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
    colorHint.style.left = `${picker.x + picker.radius + 10}px`;
    colorHint.style.top = `${picker.y}px`;
  }

  function resizeCanvas() {
    cssWidth = Math.max(1, root.innerWidth);
    cssHeight = Math.max(1, root.innerHeight);
    // Keep the software fallback's final-pixel correction bounded on high-DPI
    // devices. Physical iPad timing is a release check, not assumed here.
    deviceRatio = Math.min(renderer.kind === 'canvas2d' ? 1 : 2, root.devicePixelRatio || 1);

    canvas.width = Math.round(cssWidth * deviceRatio);
    canvas.height = Math.round(cssHeight * deviceRatio);
    renderer.resize(cssWidth, cssHeight, deviceRatio);
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

  function addPulse(pulse, createdAt = root.performance.now()) {
    const normalized = normalizePulse(pulse);
    if (!normalized) return false;
    if (visualsPaused) return true;
    const selectedRgb = hexToRgb(normalized.color);
    if (!selectedRgb) return false;
    const rgb = displayPulseRgb(selectedRgb);

    pulses.push({
      xNorm: normalized.xNorm,
      yNorm: normalized.yNorm,
      color: normalized.color,
      rgb,
      createdAt,
    });
    pulseRevision += 1;
    startAnimation();
    return true;
  }

  function addPulseBatch(batch) {
    if (!batch || batch.pulses.length === 0) return;
    if (document.hidden || visualsPaused) return;
    // The server timestamp keeps the same batch at the same logical phase on
    // clients with different network delays. A very late client still gets a
    // short visible tail instead of silently losing an accepted contribution.
    const createdAt = pulseCreatedAtForBatch(
      batch.serverTimeMs,
      Date.now(),
      root.performance.now(),
    );
    if (reviewDiagnostics) {
      frameReview.receiptAgeMs = Math.round(root.performance.now() - createdAt);
      frameReview.clockDifferenceMs = Date.now() - batch.serverTimeMs;
      frameReview.frames = 0;
      canvas.dataset.review = JSON.stringify(frameReview);
    }
    for (const pulse of batch.pulses) addPulse(pulse, createdAt);
    intro?.classList.add('dismissed');
    announcePulseBatch(batch.pulses.length);
  }

  function sendPulse(xNorm, yNorm) {
    if (sessionEnded) {
      setStatus('ended', 'session ended');
      showActionFeedback('session ended · pulses are not being shared');
      return;
    }
    if (visualsPaused) {
      showActionFeedback('resume to send and see pulses');
      return;
    }
    const pulse = normalizePulse({
      type: 'pulse',
      xNorm,
      yNorm,
      color: colorInput.value,
    });

    if (!pulse) return;
    dismissColorHint();
    if (
      socket?.readyState === root.WebSocket.OPEN &&
      Number.isInteger(presenceCount)
    ) {
      if (Date.now() < busyUntil) {
        showActionFeedback('canvas busy · try again shortly');
        return;
      }
      socket.send(JSON.stringify(pulse));
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
    dismissColorHint();
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
    dismissColorHint();
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
    if (typeof event.data !== 'string') {
      const batch = decodePulseBatch(event.data);
      if (!batch || batch.count === 0) return;

      if (lastBatchEpoch !== batch.processEpoch) {
        lastBatchEpoch = batch.processEpoch;
        lastBatchSequence = 0;
      }
      if (!isNewBatchSequence(lastBatchSequence, batch.sequence)) return;
      lastBatchSequence = batch.sequence;
      addPulseBatch(batch);
      return;
    }

    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    if (message?.type === 'presence' && Number.isInteger(message.count) && message.count >= 0) {
      presenceCount = message.count;
      showLiveStatus();
      return;
    }

    if (
      message?.type === 'busy' &&
      Number.isInteger(message.retryAfterMs) &&
      message.retryAfterMs > 0
    ) {
      busyUntil = Math.max(busyUntil, Date.now() + message.retryAfterMs);
      setStatus('crowded', 'live · busy · pulse not shared', false);
      showActionFeedback('that pulse was not accepted · try again shortly');
      if (crowdedStatusTimer !== null) {
        root.clearTimeout(crowdedStatusTimer);
      }
      crowdedStatusTimer = root.setTimeout(() => {
        crowdedStatusTimer = null;
        if (Number.isInteger(presenceCount)) showLiveStatus(false);
      }, Math.min(10_000, message.retryAfterMs));
      return;
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      root.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearConnectionTimeout() {
    if (connectionTimeoutTimer === null) return;
    root.clearTimeout(connectionTimeoutTimer);
    connectionTimeoutTimer = null;
  }

  function clearStableConnectionTimer() {
    if (stableConnectionTimer === null) return;
    root.clearTimeout(stableConnectionTimer);
    stableConnectionTimer = null;
  }

  function scheduleStableConnectionReset(activeSocket) {
    if (reconnectAttempt === 0 || stableConnectionTimer !== null) return;
    stableConnectionTimer = root.setTimeout(() => {
      stableConnectionTimer = null;
      if (
        socket === activeSocket &&
        activeSocket.readyState === root.WebSocket.OPEN &&
        Number.isInteger(presenceCount)
      ) {
        reconnectAttempt = 0;
      }
    }, STABLE_CONNECTION_MS);
  }

  function scheduleReconnect(closeCode = 1006) {
    const policy = reconnectPolicy(closeCode, reconnectAttempt);
    if (policy.delayMs === null) {
      sessionEnded = true;
      connectionStopped = true;
      clearReconnectTimer();
      setStatus(policy.state, policy.text);
      return;
    }
    if (connectionStopped || reconnectTimer !== null || !root.navigator.onLine) return;
    const delay = policy.delayMs;
    reconnectAttempt += 1;
    setStatus(policy.state, policy.text);
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
      setStatus('offline', 'not connected');
      return;
    }
    if (!root.navigator.onLine) {
      setStatus('offline', 'offline · not sharing');
      return;
    }

    clearReconnectTimer();
    presenceCount = null;
    setStatus('connecting', reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    const protocol = root.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let nextSocket;
    try {
      nextSocket = new root.WebSocket(`${protocol}//${root.location.host}/live`);
    } catch (error) {
      scheduleReconnect();
      return;
    }
    socket = nextSocket;
    nextSocket.binaryType = 'arraybuffer';
    clearConnectionTimeout();
    connectionTimeoutTimer = root.setTimeout(() => {
      connectionTimeoutTimer = null;
      if (socket !== nextSocket) return;
      try {
        nextSocket.close(4001, 'Ready timeout');
      } catch (error) {
        socket = null;
        scheduleReconnect();
      }
    }, CONNECTION_TIMEOUT_MS);

    nextSocket.addEventListener('open', () => {
      if (socket !== nextSocket) return;
      setStatus('connecting', reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    });

    nextSocket.addEventListener('message', (event) => {
      if (socket !== nextSocket) return;
      handleMessage(event);
      if (Number.isInteger(presenceCount)) {
        clearConnectionTimeout();
        scheduleStableConnectionReset(nextSocket);
      }
    });

    nextSocket.addEventListener('close', (event) => {
      if (socket !== nextSocket) return;
      clearConnectionTimeout();
      clearStableConnectionTimer();
      socket = null;
      presenceCount = null;
      scheduleReconnect(event.code);
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
    clearConnectionTimeout();
    clearStableConnectionTimer();
    if (socket) {
      const activeSocket = socket;
      socket = null;
      activeSocket.close();
    }
  }

  function startAnimation() {
    if (visualsPaused || rendererContextLost) return;
    if (animationFrame !== null) return;
    animationFrame = root.requestAnimationFrame(animate);
  }

  function animate(now) {
    animationFrame = null;
    if (visualsPaused) {
      renderer.clear();
      return;
    }

    let expiredCount = 0;
    while (
      expiredCount < pulses.length &&
      pulseAgeSeconds(pulses[expiredCount].createdAt, now) >=
        PULSE_LIFETIME_SECONDS
    ) {
      expiredCount += 1;
    }
    if (expiredCount > 0) {
      pulses.splice(0, expiredCount);
      pulseRevision += 1;
    }

    crowdVisualsActive = nextCrowdMode(crowdVisualsActive, pulses.length);
    const crowdMode = crowdVisualsActive;
    const profile = {
      calm: shouldUseCalmVisuals(
        calmVisuals,
        reducedMotion.matches,
        pulses.length,
        crowdMode,
      ),
      intensity: crowdIntensityScale(pulses.length),
      static: reducedMotion.matches || crowdMode,
    };
    const renderStarted = reviewDiagnostics ? root.performance.now() : 0;
    renderer.render(
      pulses,
      now,
      profile,
      pulseRevision,
      { width: cssWidth, height: cssHeight },
    );
    if (reviewDiagnostics) {
      frameReview.frames += 1;
      frameReview.renderer = renderer.kind;
      frameReview.active = pulses.length;
      frameReview.ageMs = pulses.length ? Math.round(now - pulses[0].createdAt) : null;
      frameReview.renderMs = Math.max(frameReview.renderMs, root.performance.now() - renderStarted);
      canvas.dataset.review = JSON.stringify(frameReview);
    }
    syncCalmControl(false, crowdMode);
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

  function clearPulseCanvas() {
    pulses.length = 0;
    crowdVisualsActive = false;
    pulseRevision += 1;
    if (animationFrame !== null) {
      root.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    renderer.clear();
  }

  function syncCalmControl(
    notify = false,
    crowdMode = crowdVisualsActive,
  ) {
    const signature = `${calmVisuals}:${crowdMode}:${reducedMotion.matches}`;
    if (!notify && signature === calmControlSignature) return;
    calmControlSignature = signature;
    calmButton.setAttribute('aria-pressed', String(calmVisuals));
    calmButton.textContent = calmVisuals ? 'calm' : 'full';
    calmButton.setAttribute('aria-label', 'Toggle calm pulse visuals');
    visualProfileStatus.textContent = crowdMode
      ? 'Dense-crowd visual limits are active until the canvas is quiet.'
      : reducedMotion.matches
        ? 'Static pulse visuals follow this device reduced-motion setting.'
        : calmVisuals
          ? 'Calm pulse visuals are on.'
          : 'Expanding pulse visuals are on.';
    if (pulses.length > 0) startAnimation();
    if (notify) {
      showActionFeedback(
        crowdMode
          ? 'crowd visual limits stay on until the canvas is quiet'
          : shouldUseCalmVisuals(calmVisuals, reducedMotion.matches)
            ? 'calm visuals on'
            : 'full visuals on',
      );
    }
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
      clearPulseCanvas();
      showActionFeedback('pulse visuals paused');
    } else {
      showActionFeedback('pulse visuals resumed');
    }
  }

  function handleRendererContextLost(event) {
    if (renderer.kind !== 'webgl2') return;
    event.preventDefault();
    rendererContextLost = true;
    if (animationFrame !== null) {
      root.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    showActionFeedback('pulse renderer paused · restoring');
  }

  function handleRendererContextRestored() {
    if (renderer.kind !== 'webgl2') return;
    try {
      const restoredRenderer = createWebGlPulseRenderer(canvas);
      if (!restoredRenderer) throw new Error('WebGL did not restore');
      renderer = restoredRenderer;
      rendererContextLost = false;
      pulseRevision += 1;
      resizeCanvas();
      startAnimation();
      showActionFeedback('pulse renderer restored');
    } catch (error) {
      rendererContextLost = true;
      showActionFeedback('pulse renderer unavailable · reload to retry');
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
    syncCalmControl();
    root.addEventListener('resize', scheduleResize, { passive: true });
    root.visualViewport?.addEventListener('resize', scheduleResize, { passive: true });

    canvas.addEventListener('pointerdown', handleCanvasPointerDown);
    root.addEventListener('pointerdown', detectAdditionalTouch, { capture: true });
    root.addEventListener('pointermove', handleCanvasPointerMove, { passive: true });
    root.addEventListener('pointerup', (event) => finishCanvasPointer(event));
    root.addEventListener('pointercancel', (event) => finishCanvasPointer(event, true));
    canvas.addEventListener('keydown', handleCanvasKeyDown);
    if (renderer.kind === 'webgl2') {
      canvas.addEventListener('webglcontextlost', handleRendererContextLost);
      canvas.addEventListener('webglcontextrestored', handleRendererContextRestored);
    }
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
    calmButton.addEventListener('click', () => {
      if (reducedMotion.matches) {
        showActionFeedback('calm visuals follow your device setting');
        return;
      }
      calmVisuals = !calmVisuals;
      syncCalmControl(true);
    });
    reducedMotion.addEventListener?.('change', () => syncCalmControl(true));
    inviteButton.addEventListener('click', shareCanvas);
    aboutButton.addEventListener('click', openAboutDialog);
    aboutClose.addEventListener('click', closeAboutDialog);
    aboutDialog.addEventListener('click', (event) => {
      if (event.target === aboutDialog) closeAboutDialog();
    });

    root.addEventListener('offline', () => {
      stopConnection();
      if (sessionEnded) return;
      setStatus('offline', 'offline · not sharing');
    });

    root.addEventListener('online', () => {
      if (sessionEnded) return;
      connectionStopped = false;
      reconnectAttempt = 0;
      connect();
    });

    root.addEventListener('pagehide', stopConnection);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearPulseCanvas();
    });
    root.addEventListener('pageshow', (event) => {
      if (!event.persisted || sessionEnded) return;
      connectionStopped = false;
      connect();
    });

    connect();
  }

  initialize();
}(typeof globalThis !== 'undefined' ? globalThis : this));
