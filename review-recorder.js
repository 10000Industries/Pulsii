// Optional capture of the real canvas, available only on the temporary review.
(() => {
  if (location.hostname !== 'pulsii-restoration-review.onrender.com' ||
      new URLSearchParams(location.search).get('record') !== '1') return;

  const source = document.getElementById('canvas');
  const panel = document.createElement('aside');
  panel.id = 'review-recorder';
  panel.setAttribute('aria-label', 'Review recording');
  const status = document.createElement('output');
  status.textContent = 'Canvas recording ready · no audio · 5 minute maximum';
  const start = document.createElement('button');
  start.textContent = 'Start recording';
  const stop = document.createElement('button');
  stop.textContent = 'Stop recording';
  stop.disabled = true;
  const save = document.createElement('a');
  save.textContent = 'Download recording';
  save.hidden = true;
  panel.append(status, start, stop, save);
  document.body.append(panel);

  if (!source.captureStream || typeof MediaRecorder === 'undefined') {
    status.textContent = 'Canvas recording is unavailable in this browser.';
    start.disabled = true;
    return;
  }

  let recorder;
  let stream;
  let timer;
  let startedAt;
  let chunks = [];
  let byteCount = 0;
  let downloadUrl;
  const elapsed = () => Math.floor((Date.now() - startedAt) / 1000);
  const finish = () => {
    if (recorder && recorder.state !== 'inactive') {
      stop.disabled = true;
      recorder.stop();
    }
  };
  stop.addEventListener('click', finish);
  start.addEventListener('click', () => {
    try {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      save.hidden = true;
      chunks = [];
      byteCount = 0;
      stream = source.captureStream(30);
      const mimeType = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']
        .find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1500000,
      });
      recorder.addEventListener('dataavailable', event => {
        if (event.data.size) {
          chunks.push(event.data);
          byteCount += event.data.size;
        }
      });
      recorder.addEventListener('stop', () => {
        clearInterval(timer);
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType });
        chunks = [];
        start.disabled = false;
        stop.disabled = true;
        if (!blob.size) {
          status.textContent = 'No video was captured. Please try again.';
          return;
        }
        downloadUrl = URL.createObjectURL(blob);
        save.href = downloadUrl;
        const extension = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
        save.download = `Pulsii-canvas-${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}.${extension}`;
        save.hidden = false;
        status.textContent = `Recording stopped · ${elapsed()} seconds · ${(blob.size / 1024).toFixed(0)} KB · download before leaving`;
      });
      recorder.addEventListener('error', () => {
        finish();
        status.textContent = 'Recording error. Save any available video and retry.';
      });
      startedAt = Date.now();
      panel.dataset.startedAt = new Date(startedAt).toISOString();
      recorder.start(1000);
      start.disabled = true;
      stop.disabled = false;
      status.textContent = 'Recording · 0 seconds';
      timer = setInterval(() => {
        status.textContent = `Recording · ${elapsed()} seconds · ${(byteCount / 1024).toFixed(0)} KB`;
        if (elapsed() >= 300 || byteCount >= 64 * 1024 * 1024) finish();
      }, 1000);
    } catch (error) {
      clearInterval(timer);
      if (stream) stream.getTracks().forEach(track => track.stop());
      start.disabled = false;
      stop.disabled = true;
      status.textContent = `Unable to record: ${error.message}`;
    }
  });
  window.addEventListener('pagehide', finish);
})();
