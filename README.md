# Pulsii

The frontend is recovered from released main `a1a48de` following the owner's
rejection of the redesigned review on 26 September 2026. See
[original recovery](docs/original-recovery.md) for the exact fidelity boundary.

A black shared canvas, a draggable colour picker, and broad expanding glows.
Your tap draws immediately; the bounded relay sends it to connected peers.
No accounts, messages, database, saved canvas or analytics identifiers.

Use Node 24.14.0, then `npm ci`, `npm test`, `npm run check`, and `npm start`.
Open `http://localhost:3000`. The WebSocket endpoint is `/live`.

The owner accepted the restored interaction after a simultaneous phone/iPad
check on 26 September 2026 and authorised permanent Starter hosting.
`render.production.yaml` records the configuration for the existing production
service at https://www.pulsii.net: one Starter instance, manual deploys, health
`/healthz`, public metadata, and a 1,000-connection ceiling. Trial expiry
is disabled there. The $7/month compute price excludes any applicable tax and
usage overages; this is not a hard billing cap.

`render.yaml` remains the separate Free review configuration with
[trial controls](docs/trial-controls.md). Historical visual/readiness reports
about the rejected frontend are superseded. The original renderer is retained;
its animation can slow on severely throttled clients because elapsed time is
capped per frame. The owner's ordinary phone/iPad interaction passed; the cloud
browser's recording is not a representative smoothness benchmark.

Capacity configuration is separate from compute size: the service stays on one
$7/month instance. Admission allows a burst of 200 joins, then 50 joins/second;
HTTP allows a burst of 3,000 requests, then 500 requests/second. The relay accepts
500 pulses/second across the canvas, with a 1,500-pulse burst allowance. These
are bounded overload controls, not a promise that 1,000 people can all tap at
maximum speed simultaneously. Each browser/device renders the incoming canvas.

Run `npm run capacity-test` for a local check using production settings, or pass
the isolated review origin after `--`. It refuses production targets, uses the
browser immediate protocol, opens up to 1,000 clients at 40 joins/second, sends
one pulse from everyone, then 400 aggregate pulses/second for 20 seconds. Every
peer checks unique pulse receipt and excludes its own echo. Bounds: 150 seconds
and 100 MB received. It does not measure browser painting or long-term capacity.
