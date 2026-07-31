# Pulsii

Pulsii is one live shared canvas. Choose a colour and tap: one expanding ring appears immediately for you and is relayed to everyone else currently connected. Pulses fade, and the canvas keeps no history.

This repository is intentionally small: a vanilla browser client, an Express static server, and an in-memory WebSocket relay. There are no accounts, names, messages, database, canvas history, cookies, or analytics in the application.

## Run locally

Pulsii requires a current Node.js LTS release.

```sh
npm ci
npm start
```

Open `http://localhost:3000`. Set `PORT` to use another port; the server binds to `0.0.0.0` so another device on the same network can open the host machine's LAN address.

Opening `index.html` directly is not supported because the shared experience requires the HTTP and WebSocket server.

## Validate

```sh
npm test
npm run check
```

The tests cover the public-file boundary, health endpoint, pulse validation, presence, rate limiting, and peer delivery without echoing a sender's locally drawn pulse.

## Product contract

- One server process represents one shared canvas.
- Pulse coordinates are normalized so the same event maps across screen sizes.
- The sender draws immediately; the server relays one canonical pulse to peers only.
- Pulse messages are strictly validated and rate-limited.
- Active rings are capped client-side to protect rendering under congestion, with a lower cap for reduced-motion users.
- The server does not persist pulse events or user profiles.
- A subtle presence indicator reports the real connection state; activity is never simulated.
- `prefers-reduced-motion` keeps pulses small, faint, and non-additive.

This is not a private room. A hosting provider may retain ordinary connection or HTTP access logs even though Pulsii itself has no event history. See [privacy and safety](docs/privacy-and-safety.md).

## Repository history

The original five-commit Git baseline is preserved on `main` at `a1a48deafc611f52af8810cf216dcd36d220b07f`. `instructions.txt` is retained as legacy product evidence and is not current operating documentation.

The restoration decision, verified history, and deployment boundary are recorded in [the restoration audit](docs/restoration-audit.md). Launch positioning and experiments are in [the launch package](docs/launch/launch-package.md).
