# Pulsii

The frontend is recovered from released main `a1a48de` following the owner's
rejection of the redesigned review on 26 September 2026. See
[original recovery](docs/original-recovery.md) for the exact fidelity boundary.

A black shared canvas, a draggable colour picker, and broad expanding glows.
Your tap draws immediately; the bounded relay sends it to connected peers.
No accounts, messages, database, saved canvas or analytics identifiers.

Use Node 24.14.0, then `npm ci`, `npm test`, `npm run check`, and `npm start`.
Open `http://localhost:3000`. The WebSocket endpoint is `/live`.

Production remains separate and suspended; review is not approval to launch.
Existing [trial controls](docs/trial-controls.md) remain enforced. Historical
visual/readiness reports describe the rejected frontend and are superseded.
