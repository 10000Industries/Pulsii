# Pulsii

Start with the [bounded review procedure](docs/deployment-review.md) and
[trial controls](docs/trial-controls.md). Historical runbooks do not grant
current deployment authority or establish capacity.

Pulsii is one live public canvas. Choose a colour and tap: once the shared
relay accepts it, one pulse appears for you and everyone else currently
connected. Pulses fade, and the canvas keeps no history.

This repository is intentionally small: a vanilla browser client, an Express
static server, and an in-memory WebSocket relay. There are no accounts, names,
messages, database, canvas history, cookies, or user-level analytics in the
application.

## Run locally

Pulsii is pinned to Node.js 24.14.0.

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

The tests cover the public-file boundary, health endpoint, pulse validation,
presence, rate limiting, fair admission, binary batch encoding, sender echo,
restart draining, and exact-once delivery to each healthy test socket that
remains connected through the batch.

Two local load-test modes exercise the real WebSocket server:

```sh
LOAD_CLIENTS=20 LOAD_PULSES_PER_CLIENT=2 npm run load-test
```

The fanout command is retained as a compatibility alias. Environment variables such as `LOAD_CLIENTS`,
`LOAD_PULSES_PER_CLIENT`, and `LOAD_MAX_BATCH_PULSES` control the run. Every
accepted pulse contribution must reach every continuously connected client, and the harness reports
batch count, wire bytes, queue depth, and delivery time. These are reproducible
local checks, not a production capacity claim.

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
- A live sender waits for the relay's echo; accepted pulses therefore appear
  exactly once on each healthy canvas that remains connected through the
  batch, including the sender. Disconnected taps are labelled not shared and
  are not rendered. Pulsii has no replay history for a connection that drops.
- Incoming pulse candidates are strictly validated and rate-limited.
- A bounded, per-connection fair queue rejects overload before acceptance and
  tells the sender when a pulse was not shared. Accepted pulses are never
  silently discarded.
- The relay sends compact binary batches every 50 ms instead of one JSON frame
  per pulse per recipient.
- The client retains every accepted pulse for its visual lifetime and renders
  batches in one WebGL2 instanced draw call, with a Canvas2D fallback.
- Dense crowds automatically switch to small static halos. Brightness uses a
  non-additive ceiling in every visual profile, and reduced-motion remains
  static.
- The server does not persist pulse events or user profiles.
- A subtle presence indicator reports the real connection state; activity is
  never simulated, and a solo connection is labelled honestly.
- A native share control invites another person to the same public canvas.
- Pause remains available at all times; paused browsers hide pulses and stop
  sending taps until resumed.
- A small About dialog explains public scope, privacy limits, support, and
  feedback.
- `prefers-reduced-motion` keeps pulses small, faint, and static.
- One-minute operational counters record only aggregates such as connections,
  pulse candidates, accepted and busy-rejected pulses, socket-write attempts
  and completions, attempted and completed wire bytes, queue depth, memory,
  and duration. They do not
  include IP addresses, user agents, coordinates, colours, or stable
  identifiers.
- Preview crawling is disabled by default and its social metadata remains
  same-host. `PUBLIC_MODE=true` requires a validated `PUBLIC_ORIGIN`; both must
  be an intentional public-launch decision.

This is not a private room. A hosting provider may retain ordinary connection or HTTP access logs even though Pulsii itself has no event history. See [privacy and safety](docs/privacy-and-safety.md).

## Isolated Render review

The restoration branch contains a conservative `render.yaml`: one free
Frankfurt service, no database or secrets, automatic deploys off, crawling
disabled, a 20-connection application cap, and mandatory trial time/byte bounds.

[Review the current procedure](docs/deployment-review.md) before using the
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
