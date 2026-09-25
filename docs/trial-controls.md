# Bounded trial controls

For an env-configured trial set `TRIAL_MODE=true`, `TRIAL_ENDS_AT`,
`TRIAL_BOOT_DEADLINE`, `TRIAL_MAX_PULSE_BYTES` and `TRIAL_MAX_HTTP_BYTES`.
Use absolute UTC ISO timestamps. Missing/invalid bounds prevent startup.
Boot deadline must be in the future and before the session end. A later restart
fails rather than automatically resetting a new budget. A restart inside the
initial boot window can still reset counters: stop and review before rearming.
Trial mode is disabled for ordinary local development unless explicitly set.

An accepted pulse reserves `(19 + 7) * MAX_CONNECTIONS` bytes; batching reduces
actual payload. Exhaustion rejects before acceptance. Expiry/budget closure
flushes accepted work, closes with code 4000, and ends browser retries. A tap
cannot turn that state back into connecting. A readiness timeout uses a separate
4001 code and may retry. After the absolute end, HTTP pages return a small 410
response; `/healthz` remains available within the HTTP budget.

HTTP reserves the complete allowlisted asset size plus 4096 bytes for headers,
or 5120 bytes for small/non-asset responses. Exhausted/rate-rejected requests
are disconnected without an application response. Default HTTP admission is a
200-request burst and 20/second refill. Connection upgrades have their own
40-attempt burst and 2/second refill. Pings share the client input limit, avoiding
an unlimited automatic-pong response path. HTTP header/request timeouts are
10 seconds; idle keepalive is five seconds, with 100 requests per socket.

Global pulse admission defaults to burst 40, refill 20/second; env keys are
`GLOBAL_RATE_BURST` and `GLOBAL_RATE_PER_SECOND`. Upgrade keys are
`UPGRADE_RATE_BURST` and `UPGRADE_RATE_PER_SECOND`. These are process-wide,
not per IP, and keep no additional visitor identifier. They bound legitimate
and abusive traffic together; a determined client can still deny service to
others. Use the operator's service suspension control for a disrupted trial.

These are **application limits, not a hosting bill cap**. They do not account
for all TLS/framing, provider-generated responses, control traffic or restarts.
The single process does not coordinate with overlapping deploy instances. Never
rearm during a live gathering, and never infer public capacity from local load
measurements. See the [review procedure](deployment-review.md).
