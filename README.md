# Pulsii

Pulsii is one live public canvas. Choose a colour and tap: one expanding ring
appears immediately for you and is relayed to everyone else currently
connected. Pulses fade, and the canvas keeps no history.

This repository is intentionally small: a vanilla browser client, an Express
static server, and an in-memory WebSocket relay. There are no accounts, names,
messages, database, canvas history, cookies, or user-level analytics in the
application.

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

Two local load-test modes exercise the real WebSocket server:

```sh
npm run load-test
npm run load-test:fanout
```

The default mode verifies that aggregate overload is safely bounded. The fanout
mode deliberately relaxes that guard to verify exact peer-frame delivery. These
are reproducible local checks, not a production capacity claim.

After an isolated review service exists, run the guarded release probe against
its exact generated hostname:

```sh
npm run review-probe -- https://pulsii-restoration-review-example.onrender.com
```

The probe verifies review-mode headers and assets, confirms private source stays
unserved, checks exact-once peer delivery across 20 synthetic pulses, reports a
sample p95 relay latency, and proves delivery after a receiver reconnects. It
refuses `pulsii.net`, `www.pulsii.net`, `pulsii.onrender.com`, and hosts outside
the isolated `pulsii-restoration-review*.onrender.com` pattern.

## Product contract

- One server process represents one shared canvas.
- Pulse coordinates are normalized so the same event maps across screen sizes.
- The sender draws immediately; the server relays one canonical pulse to peers only.
- Pulse messages are strictly validated and rate-limited.
- A server-wide token bucket bounds total accepted pulse traffic and fanout.
- Active rings are capped client-side to protect rendering under congestion, with a lower cap for reduced-motion users.
- The server does not persist pulse events or user profiles.
- A subtle presence indicator reports the real connection state; activity is
  never simulated, and a solo connection is labelled honestly.
- A native share control invites another person to the same public canvas.
- Pause remains available at all times; paused browsers share taps without
  displaying local or remote pulse visuals.
- A small About dialog explains public scope, privacy limits, support, and
  feedback.
- `prefers-reduced-motion` keeps pulses small, faint, and non-additive.
- One-minute operational counters record only aggregates such as connections,
  accepted pulses, overload drops, fanout, memory, and duration. They do not
  include IP addresses, user agents, coordinates, colours, or stable
  identifiers.
- Preview crawling is disabled by default and its social metadata remains
  same-host. `PUBLIC_MODE=true` requires a validated `PUBLIC_ORIGIN`; both must
  be an intentional public-launch decision.

This is not a private room. A hosting provider may retain ordinary connection or HTTP access logs even though Pulsii itself has no event history. See [privacy and safety](docs/privacy-and-safety.md).

## Isolated Render review

The restoration branch contains a conservative `render.yaml`: one free
Frankfurt service, no database or secrets, automatic deploys off, crawling
disabled, and a 45-connection application cap.

[Review the August 5 runbook](docs/launch/august-5-runbook.md) before using the
[branch-specific Deploy to Render
flow](https://render.com/deploy?repo=https://github.com/10000Industries/Pulsii/tree/agent/pulsii-restoration).

That link creates a new service in the signed-in Render account. It must not be
used to select, resume, replace, or attach the existing `pulsii` service or
`pulsii.net`.

## Repository history

The original five-commit Git baseline is preserved on `main` at `a1a48deafc611f52af8810cf216dcd36d220b07f`. `instructions.txt` is retained as legacy product evidence and is not current operating documentation.

The restoration decision, verified history, and deployment boundary are
recorded in [the restoration audit](docs/restoration-audit.md). Launch
positioning and experiments are in [the launch
package](docs/launch/launch-package.md).
