# Pulse

Minimal real-time canvas demo: click/tap to drop expanding colour pulses on a pure black stage. Pulses render additively and sync over WebSockets so anyone on the same server sees them. A small draggable circle opens the native colour picker; pulses use the selected colour.

## Install and run locally
- Requires Node.js.
- In the project folder:
  - `npm install`
  - `npm start` (uses `PORT` if set, default 8080; auto-falls back to 3001 if 8080 is busy; binds to `0.0.0.0` for LAN access)
- Open the app in a browser: `http://localhost:8080` (or `http://localhost:3001` if it fell back, or whichever `PORT` you set).

## Connect from another device on the same network
- Find your computer’s LAN IP (e.g., on Windows: `ipconfig` → IPv4 Address).
- On the other device, open: `http://<your-ip>:<port>` (example: `http://192.168.1.42:8080` or `:3001` if the fallback is in use).
- Make sure both devices share the same Wi‑Fi/LAN and allow the Node.js server through any firewall prompt.

## Notes
- The client auto-uses the page’s host/port for WebSockets; loading the page from your LAN IP makes syncing work across devices.
- A small colour circle sits near bottom-left; tap/click to change colour or drag to move it.
- Optional local test bot: set `BOT_ENABLED` in `script.js` to control periodic centre pulses (local-only by default).
