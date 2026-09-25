# Optional bounded trial sessions

Set `TRIAL_MODE=true`, an absolute `TRIAL_ENDS_AT` timestamp (use UTC ISO 8601),
and a positive integer `TRIAL_MAX_PULSE_BYTES` before starting the server.
Missing or invalid bounds prevent startup. Trial mode is disabled by default.

Each accepted pulse reserves `(19 + 7) * MAX_CONNECTIONS` payload bytes:
one binary header plus one pulse record, for every possible recipient.
Batching can reduce the actual payload below this conservative reservation.
Budget exhaustion rejects the next candidate before acceptance. Deadline or
budget closure drains accepted pulses, then closes clients with code 4000.
The browser shows `session ended` and stops automatic retries, including after
offline/online transitions and cached page restoration. Refresh is explicit.

The timestamp remains expired after restarting. The payload counter resets
on process restart. This is a **per-process pulse-payload bound**, not a
provider spending cap. HTTP, assets, framing/TLS, presence/control traffic,
connection churn, other services and restarts are outside this counter.
HTTP remains available after the trial ends. A hosting plan needs separate
service-wide budget, abuse and restart controls before this is used publicly.

Validation: 50 tests passed on Node 24.14.0, including actual WebSocket
delivery when the budget closes, deadline draining and expired restart.
Syntax and whitespace checks passed. The attempted rendered browser probe
could not start because the environment lacks a browser executable; no
rendered/mobile, flash-safety, deployed-capacity or public-readiness claim
follows from the local tests.

Deployment settings and approvals in historical runbooks must be reverified
against the current owner's instructions. Local load measurements do not
establish any public concurrency capacity.
