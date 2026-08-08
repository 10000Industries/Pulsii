# Isolated review deployment

## Current production boundary

Paying the overdue Render balance resumed the existing paid production service.
It currently serves the preserved `main` build at `www.pulsii.net`. Keep that
service and its domains online while the restoration is reviewed.

The isolated review must not reuse or modify:

- `pulsii.net` or `www.pulsii.net`
- `pulsii.onrender.com`
- the existing Render production service
- production DNS, domains, environment groups, or deployment settings

The account owner has approved creation and testing of the isolated review and,
after the recorded gates pass, promotion of the reviewed build through the
existing production service. A different paid service, domain migration, DNS
change, or public announcement still needs to be recorded explicitly before it
is performed.

## Review contract

Create a new one-process Render Web Service from an exact commit on
`agent/pulsii-restoration`. The root `render.yaml` is deliberately a review
blueprint, not the production service definition.

| Setting | Value |
|---|---|
| Service | New Web Service |
| Name | `pulsii-restoration-review` |
| Source | `10000Industries/Pulsii` |
| Branch | `agent/pulsii-restoration` |
| Node | `24.14.0` |
| Build | `npm ci && npm test && npm run check` |
| Start | `npm start` |
| Health check | `/healthz` |
| Instances | One |
| Auto-deploy trigger | Off |
| Plan | Free review instance |
| Region | Frankfurt |
| Application connection cap | 45 |
| Public mode | False |
| Domain | Generated preview hostname only |
| Environment groups/secrets | None |

The review environment is intentionally bounded:

```text
PUBLIC_MODE=false
PUBLIC_ORIGIN unset
MAX_CONNECTIONS=45
CLIENT_RATE_BURST=10
CLIENT_RATE_PER_SECOND=5
BATCH_INTERVAL_MS=50
MAX_GLOBAL_CANDIDATES=512
MAX_CLIENT_CANDIDATES=8
MAX_BATCH_PULSES=512
BUSY_RETRY_MS=100
```

The preview must send `X-Robots-Tag: noindex, nofollow`, serve `robots.txt`
with `Disallow: /`, use no custom domain, and keep `PUBLIC_ORIGIN` unset. Its
generated hostname is unadvertised but not private or access-controlled.

## Deployment record

Complete this record from the created service:

| Record | Value |
|---|---|
| Provider | Render |
| Review URL | Pending deployment |
| Render service ID/name | Pending deployment |
| Exact commit | Pending deployment |
| Resolved Node version | Pending deployment |
| Region and plan | Frankfurt / Free |
| Created | Pending deployment |
| Existing production changed | No |

## Functional review

- `/healthz` returns `status: ok`.
- `/`, styles, scripts, privacy page, icons, manifest, and social image load.
- Review HTML has no canonical or `og:url` claiming `pulsii.net`.
- Private source, package, dependency, and documentation paths return 404.
- The root sends `X-Robots-Tag: noindex, nofollow`; `robots.txt` disallows all.
- Two browsers show the real connection count.
- A pulse is delivered in a binary batch exactly once to each healthy test
  client that remains connected through delivery; dropped connections have no
  replay history.
- Malformed messages are ignored; rate abuse is bounded without harming peers.
- A full queue returns a bounded `busy` response with a retry delay.
- Reconnection state is visible and delivery resumes after reconnect.
- Touch creation, colour selection, pause/resume, sharing, About, and privacy
  interactions work at an iPad viewport.
- Calm mode starts enabled; device reduced-motion settings keep it enabled.
- Ordinary canvas use makes no third-party browser request.
- Aggregate logs contain no pulse content, address, user agent, or identifier.

Warm the Free service before running:

```sh
npm run review-probe -- https://pulsii-restoration-review-example.onrender.com
```

Record warm-up time, p95 relay latency, exact-once delivery, and reconnect
delivery. Free service cold starts can take longer than the probe timeout.

## Guarded deployed load tests

The deployed harness refuses the known production domains and every remote host
outside `pulsii-restoration-review*.onrender.com`. Every invocation requires an
explicit received-byte budget.

Example connection-only check:

```sh
DEPLOYED_LOAD_MODE=connection \
DEPLOYED_LOAD_CLIENTS=40 \
DEPLOYED_LOAD_BYTE_BUDGET=1000000 \
npm run deployed-load-test -- https://pulsii-restoration-review-example.onrender.com
```

Supported modes are `connection`, `one-sender`, `all-client-burst`,
`sustained`, `reconnect`, and `soak`. Configure bounded pulses, duration,
interval, settlement, and handshake time with:

```text
DEPLOYED_LOAD_PULSES
DEPLOYED_LOAD_DURATION_MS
DEPLOYED_LOAD_INTERVAL_MS
DEPLOYED_LOAD_SETTLE_MS
DEPLOYED_LOAD_TIMEOUT_MS
```

The report includes handshake latency and failures, relay latency, exact
per-recipient contribution bounds and mismatches, disconnects, busy notices,
socket errors, and received bytes. A pulse-bearing run fails on any busy notice
or if even one action recipient misses or duplicates a pulse. The harness
terminates its sockets and fails when the caller's byte budget would be
exceeded.

Free is suitable for the 45-client review, not a production-capacity claim. Run
larger representative tests only on an isolated service temporarily using the
same instance type and settings proposed for production. Record a fixed egress
budget before each stage.

## Promotion boundary

Use the existing paid production service and attached domains to avoid a DNS
cutover. Before deploying, complete the exact sequence and rollback record in
[the launch runbook](launch/august-5-runbook.md). Do not attach production
domains to the review service. The first safety promotion keeps
`PUBLIC_MODE=false` and `PUBLIC_ORIGIN` unset; public crawling and canonical
metadata remain blocked until the final privacy and launch gates pass.

Render keeps HTTP available during a successful deploy, but WebSockets on the
old instance close and reconnect. A shared transient broker is required before
multiple instances or overlapping deploy instances can provide a strictly
single uninterrupted canvas.
