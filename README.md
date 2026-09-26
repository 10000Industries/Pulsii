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
`/healthz`, public metadata, and an initial 20-connection limit. Trial expiry
is disabled there. The $7/month compute price excludes any applicable tax and
usage overages; this is not a hard billing cap.

`render.yaml` remains the separate Free review configuration with
[trial controls](docs/trial-controls.md). Historical visual/readiness reports
about the rejected frontend are superseded. The original renderer is retained;
its animation can slow on severely throttled clients because elapsed time is
capped per frame. The owner's ordinary phone/iPad interaction passed; the cloud
browser's recording is not a representative smoothness benchmark.
