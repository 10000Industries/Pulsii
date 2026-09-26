# Bounded review deployment

Current procedure, 25 September 2026. This supersedes operational instructions
in the historical August runbook. Source preservation and local tests are not
permission to resume hosting, deploy publicly, spend money or promote Pulsii.

## Proposed target

One separate Render Free Web Service, `pulsii-restoration-review`, Frankfurt,
Node 24.14.0, one process, auto-deploy off, no custom domains, disks, database or
shared environment groups. Existing services and domains are not part of this
review change. Use the exact reviewed branch commit, not an unverified latest
head. `render.yaml` describes the proposal; it is not a deployment record.

- Build: `npm ci && npm test && npm run check`; start: `npm start`.
- Health: `/healthz`; `PUBLIC_MODE=false`, `PUBLIC_ORIGIN` unset.
- Maximum 20 connections; 4-pulse client burst, 2/second refill.
- Global admission: 40-pulse burst, 20/second refill; explicit busy rejection.
- Upgrade admission: 40-attempt burst, 2/second refill.
- Candidate queue: 80 total, 4 per source, 80 per 50ms batch.
- Trial pulse reservation: 5 MiB. HTTP response reservation: 64 MiB (the
  existing Apple icon alone is approximately 1.4 MiB per cold browser).
- `TRIAL_BOOT_DEADLINE`: a fixed time just after the planned first startup,
  initially no more than five minutes after deployment begins.
- `TRIAL_ENDS_AT`: a fixed end no more than 30 minutes after planned startup.

The generated hostname is publicly reachable but unadvertised and noindex;
that is not access control or a private room. Its exact URL must be obtained
from Render after deployment, never guessed and presented as live.

## Before activating

1. Record approval for this exact review and the accepted residual usage risk.
2. Read actual shared Free hours, bandwidth, pipeline minutes and active plan.
   Leave sufficient reserve for other applications. Do not change workspace
   billing protections, payment methods or unrelated services.
3. Record commit, service configuration and fixed UTC timestamps. Missing or
   invalid trial bounds must fail startup. If build time misses the boot window,
   inspect the failed start before explicitly authorising a new window.
4. Record the exact dashboard stop action. On failure, unexpected restart or
   budget exhaustion, suspend this review service. Suspension is the rollback;
   do not roll back to unsafe/unbounded code or repeatedly rearm the budget.

Free compute has no base compute fee but consumes shared allowances. Render
can bill bandwidth overage when a payment method exists. Application response
budgets do not cover every platform-generated response or network attack, and
Render does not provide a separate hard bandwidth-spending cap for this trial.
No unattended monitoring or automatic suspension is implied by this procedure.

## Verification order

1. Verify deployed commit, Node version, region, noindex headers and allowlisted
   assets. Run the existing guarded `review-probe` on the real review URL.
2. Analyse actual frames from full/calm/reduced-motion profiles and the 2D
   fallback, including same-position overlap, tiled red/white input, network
   bursts and renderer restore. Verify brightness/red constraints and measure
   pause responsiveness. Do not use a human as the flashing stress test.
3. Bound synthetic checks to 20 connections, 40 contributions, 1 MiB received
   test budget; then a short ordinary-rate exchange and reconnect. Check each
   recipient, not just aggregate byte/receipt totals. Stop on failure.
4. Only after the visual check, give the owner the exact URL and a 5–10 minute
   physical iPad review: colour, corners/response rhythm, rotation, pause,
   reduced motion, background/return and terminal session state. Identify an
   assistant-operated connection as automation, not another human participant.
5. Record evidence, end time and allowances; suspend the review service.

Example (replace hostname with the actual verified review URL):

```sh
npm run review-probe -- https://pulsii-restoration-review-example.onrender.com
DEPLOYED_LOAD_MODE=all-client-burst DEPLOYED_LOAD_CLIENTS=20 \
DEPLOYED_LOAD_PULSES=1 DEPLOYED_LOAD_BYTE_BUDGET=1048576 \
npm run deployed-load-test -- https://pulsii-restoration-review-example.onrender.com
```

## Before university invitations

Close actual rendered/iPad findings; verify the public contact inbox in both
directions; finish the controller/privacy/legal disclosures and actual hosting
record; approve a small organiser recipient/message batch and coordinated
session times. No mass launch, sponsorship sale or capacity beyond the tested
limit follows from a passing review.
