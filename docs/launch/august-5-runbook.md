# Pulsii review and production-promotion runbook

> Historical runbook: status and approvals below are not current evidence.
> Reverify the service state and current owner authority before applying it.
> No concurrency capacity claim follows from local benchmarks alone.

The filename records the original review date. This revision reflects the
current state: the overdue Render balance is resolved, the old `main` build is
live on the existing paid production service, and the account owner has
approved the isolated review plus promotion through that existing service after
the gates below pass.

This approval does not make an unbounded load test safe. Every deployed load
stage still requires an explicit target, connection count, duration, pulse
count, and received-byte budget.

## 1. Record the live boundary

Before changing anything, record from Render:

| Field | Value |
|---|---|
| Workspace and plan | |
| Existing production service ID/name | |
| Existing production region and instance type | |
| Live deploy ID and commit | |
| Linked branch | `main` |
| Auto-deploy setting | |
| Primary custom domain | |
| Root/`www` redirect direction | |
| Current environment keys | |
| Current month compute and outbound usage | |
| Rollback action available for live deploy | Yes / No |

The review service must remain separate from the existing service, domains,
DNS, and environment. Keep production online while review work proceeds.

Render has no fixed open-WebSocket ceiling. Capacity is determined by Pulsii's
queue and batch settings, the instance's CPU and memory, network throughput,
browser rendering, and the allowed outbound-bandwidth cost.

## 2. Freeze the exact review candidate

1. Confirm the restoration branch and remote point to the same commit.
2. Review draft PR #1 and record its exact head.
3. Require the `validate` workflow to pass on that head.
4. Run:

   ```sh
   npm ci
   npm test
   npm run check
   npm run load-test
   npm run load-test:fanout
   ```

5. Review the complete diff for secrets, third-party scripts, unrelated files,
   and accidental production configuration.
6. Confirm Node `24.14.0` is used locally, in CI, and in the Render build log.

## 3. Create the isolated Free review

Use the branch-specific [Deploy to Render
flow](https://render.com/deploy?repo=https://github.com/10000Industries/Pulsii/tree/agent/pulsii-restoration).
The root `render.yaml` deliberately defines only this review service:

- new service `pulsii-restoration-review`
- branch `agent/pulsii-restoration`
- Frankfurt, one Free instance
- automatic deploys off
- generated `onrender.com` hostname only
- no database, secret, environment group, or custom domain
- `/healthz`
- `PUBLIC_MODE=false` with no `PUBLIC_ORIGIN`
- 45 connections
- fair 50 ms binary pulse batches with bounded per-client and global queues

Verify the displayed configuration before selecting **Create Web Service**.
Do not select the existing production service or attach a Pulsii domain.

Record:

| Field | Value |
|---|---|
| Review URL | |
| Render service ID/name | |
| Exact deployed commit | |
| Resolved Node version | |
| Region and plan | Frankfurt / Free |
| Created at | |
| Existing production changed | No |

Free services can sleep after 15 minutes without inbound traffic and may take
about a minute to wake. They are appropriate for the 45-client review, not a
representative production-capacity claim.

## 4. Verify the review deployment

Warm the service until `/healthz` returns 200, then run:

```sh
npm run review-probe -- https://pulsii-restoration-review-example.onrender.com
```

Replace the example with the exact generated hostname. Record warm-up time,
20-sample p95 relay latency, exact-once batch delivery, and delivery after
reconnect.

Also verify:

- root, styles, scripts, privacy page, icons, manifest, and social image
- source, package, dependencies, and repository documents return 404
- security headers, `X-Robots-Tag: noindex, nofollow`, and disallowing
  `robots.txt`
- no production canonical URL or `og:url`
- no ordinary third-party browser request
- honest presence in two browsers
- fair binary batches reach every connection, including the sender, once
- malformed input is ignored and abuse is bounded
- a saturated queue returns `busy` with a retry delay
- offline, reconnect, and service-restart states recover
- aggregate logs contain no pulse content or user identifier

## 5. Run guarded deployed-load stages

The deployed harness accepts only localhost or
`pulsii-restoration-review*.onrender.com`. It refuses `pulsii.net`,
`www.pulsii.net`, `pulsii.onrender.com`, arbitrary hosts, non-HTTPS remote
targets, and URLs with paths or credentials.

Every run requires `DEPLOYED_LOAD_BYTE_BUDGET`. The harness stops its sockets
and fails as soon as the next received message would cross that budget. The
budget is a load-generator safety limit; separately inspect Render's outbound
usage because protocol, TLS, and platform overhead can be higher.

Connection-only example:

```sh
DEPLOYED_LOAD_MODE=connection \
DEPLOYED_LOAD_CLIENTS=40 \
DEPLOYED_LOAD_BYTE_BUDGET=1000000 \
npm run deployed-load-test -- https://pulsii-restoration-review-example.onrender.com
```

Controlled all-client pulse example:

```sh
DEPLOYED_LOAD_MODE=all-client-burst \
DEPLOYED_LOAD_CLIENTS=40 \
DEPLOYED_LOAD_PULSES=1 \
DEPLOYED_LOAD_SETTLE_MS=5000 \
DEPLOYED_LOAD_BYTE_BUDGET=2000000 \
npm run deployed-load-test -- https://pulsii-restoration-review-example.onrender.com
```

Modes:

| Mode | Purpose |
|---|---|
| `connection` | Open clients, observe presence, then settle |
| `one-sender` | Send a bounded pulse set from one client |
| `all-client-burst` | Send a bounded pulse set from every client together |
| `sustained` | Rotate a bounded pulse total across clients over time |
| `reconnect` | Replace one client and prove post-reconnect delivery |
| `soak` | Hold connection-only load for a bounded duration |

Optional controls are `DEPLOYED_LOAD_DURATION_MS`,
`DEPLOYED_LOAD_INTERVAL_MS`, `DEPLOYED_LOAD_SETTLE_MS`, and
`DEPLOYED_LOAD_TIMEOUT_MS`.

The report includes handshake failures and latency, relay latency, binary and
text frames, exact per-recipient pulse contribution bounds and mismatches, busy
notices, close codes, socket errors, reconnect success, and received bytes. A
pulse-bearing run fails on any busy notice or any recipient's missing or
duplicate contribution. It validates one complete sample batch globally, then
uses count-only batch inspection so the generator does not create an artificial
quadratic object workload.

For tests beyond the Free review cap, temporarily use an isolated service with
the same paid instance type and environment proposed for production. Never run
capacity or burst tests against a public production domain. Start with
connection-only ramps, then one-sender fanout, short all-client bursts, and a
bounded soak. Stop on:

- a health failure, restart, or unexpected close
- a handshake failure below the configured connection cap
- invalid or missing delivery
- unexpected `busy` responses below the declared queue envelope
- slow-client termination with healthy test clients
- relay p95 above 500 ms or p99 above 1 second
- sustained event-loop lag above 100 ms
- sustained CPU or memory above 70%
- the declared byte budget

Choose the public cap below the measured performance knee with at least 25%
headroom. Raising `MAX_CONNECTIONS` alone is not evidence of capacity.

## 6. Complete the iPad and motion-safety pass

Use a tester who can safely review animated output. The project owner should not
perform full-intensity or worst-case flashing exposure.

Check iPad Safari portrait, landscape, rotation, safe areas, one pulse per tap,
colour picker tap/drag, pinch zoom, native share and copy fallback, About,
privacy, keyboard focus, VoiceOver labels, background/foreground, offline and
reconnect, reduced motion, Calm mode, and a controlled overlap test.

Keep Pause continuously reachable. Calm mode is a mitigation, not a
seizure-safety certification.

## 7. Prepare the existing production service

Using the existing paid service avoids DNS propagation and certificate risk.
Do not attach the domains to the review service.

1. Confirm the service's region; Render cannot change an existing service's
   region in place.
2. Turn production auto-deploy off.
3. Record the current successful deploy ID and verify its Dashboard rollback
   action.
4. Verify the build command is `npm ci && npm test && npm run check`, start is
   `npm start`, and health path is `/healthz` for the new release.
5. Confirm the canonical HTTPS origin from the real root/`www` redirect.
6. In Render Environment, enter the reviewed production values and choose
   **Save only**, so the old build is not redeployed with new settings.

Production variables:

```text
PUBLIC_MODE=false
PUBLIC_ORIGIN unset
MAX_CONNECTIONS=<measured safe cap>
CLIENT_RATE_BURST=<reviewed value>
CLIENT_RATE_PER_SECOND=<reviewed value>
BATCH_INTERVAL_MS=<tested value>
MAX_GLOBAL_CANDIDATES=<tested value>
MAX_CLIENT_CANDIDATES=<tested value>
MAX_BATCH_PULSES=<tested value>
BUSY_RETRY_MS=<tested value>
METRICS_INTERVAL_MS=60000
```

The first safety promotion must remain unindexed while the privacy notice,
controller/contact, brand, licence, browser, and flash-safety gates are open.
Only after those gates pass should a separately recorded environment change set
`PUBLIC_MODE=true` and the verified canonical `PUBLIC_ORIGIN`.

Do not set Render-provided `PORT`, `NODE_ENV`, or `RENDER_GIT_COMMIT`.

The root `render.yaml` remains intentionally review-only even after merge. Do
not sync that Blueprint onto the existing production service.

## 8. Promote with minimal interruption

1. Merge the exact reviewed PR to `main` only after CI and the gates above pass.
2. Confirm the merge commit and its CI result.
3. Manually deploy that exact commit to the existing production service.
4. Watch build, test, syntax, startup, Node version, and health logs.
5. Render keeps the old instance serving until the new instance is healthy.
6. Verify production root/assets, review-stage noindex crawler policy, absence
   of public canonical metadata, privacy link, presence, pulse delivery,
   reconnect, and deployed commit immediately after traffic switches.
7. Keep auto-deploy off for the initial observation period. Later prefer
   **After CI checks pass** rather than **On commit**.

HTTP promotion is zero-downtime when the health gate passes. Existing
WebSockets still close and reconnect during instance replacement. Without a
shared transient bus, old and new overlapping instances can briefly represent
separate canvases; deploy in a quiet window or add that bus before claiming
strictly uninterrupted global sharing.

## 9. Roll back

Rollback immediately for broken assets or metadata, failed health, missing or
duplicate pulse delivery, failed reconnect, sustained saturation, unexpected
queue rejection below the declared envelope, or uncontrolled outbound use.

1. Open production **Events**.
2. Select the recorded previous successful deploy.
3. Choose **Rollback to this deploy** and confirm.
4. Verify the old root and WebSocket behaviour.
5. Keep auto-deploy disabled while the cause is corrected.

Dashboard rollback reuses the target build artifact, start command, health
path, environment, and instance count. It does not detach current custom
domains. Confirm rollback availability before promotion because Render retains
only a plan-dependent number of build artifacts.

## 10. Alerts, metrics, and cost guardrails

Enable Render email notifications for all production deploy and health events.
During review, promotion, and the first public sessions watch:

- `pulsii_metrics` JSON logs each minute
- current and peak connections
- candidate acceptance, busy rejection, queue peak, batches, socket-write
  attempts/completions, and attempted/completed pulse wire bytes
- event-loop lag and memory
- Render CPU, memory, health events, restarts, and HTTP status volume
- Render WebSocket outbound bandwidth and workspace Billing

On the current Hobby workspace, outbound allowance is 5 GB/month shared by all
services and excess use is billed at $0.15/GB. WebSocket responses count.
Render's bandwidth graph is hourly and appears after the measurement window, so
it is not an immediate kill switch.

Render provides a hard spend limit for extra build-pipeline minutes, not for
outbound bandwidth. A payment method permits bandwidth overage billing.
Therefore the application queue/batch bounds, caller byte budgets, staged
traffic, and active monitoring are the financial controls. Do not remove them
to pursue an undefined maximum concurrency.

Standard compute is currently $25/month and billed by the second while active.
Free review compute has no charge but shares the workspace's bandwidth, build
minutes, and 750 monthly Free instance hours.

## 11. Public opening

After production smoke and observation pass **and every public gate is closed**,
record the canonical origin, set `PUBLIC_MODE=true` with that exact
`PUBLIC_ORIGIN`, deploy the unchanged reviewed build, and verify `robots.txt`,
canonical/Open Graph metadata, and the final privacy notice. Then increase
traffic in recorded stages rather than all channels together. Pause promotion
if safety, delivery, capacity, or cost gates fail. Public opening does not
remove the need for the name-clearance, licence, privacy, and motion-safety
decisions recorded elsewhere in the repository.
