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

Global pulse admission defaults to burst 800, refill 500/second; env keys are
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


## Fast-tap review configuration (26 September 2026)

The browser has no fixed per-tap cooldown. It admits a burst of 20 pulses and
refills 20 tokens/second, so rapid and simultaneous multi-finger taps draw
immediately. The server allows burst 40/refill 25 per second per connection
for delivery jitter; global burst 800/refill 500 covers the 20-browser review.
Queues allow 32 per source, 640 globally and 640 per 50ms batch. The browser
retains at most 1024 active pulses, replacing the previous 64-pulse truncation.
The original glow renderer is unchanged; these are admission bounds, not a
claim of smooth 20-browser rendering on every device.

The same 3 MiB pulse reservation budget, 40 MiB HTTP budget and fixed end time
still terminate the review. Faster use consumes the existing budget faster;
no paid plan or larger spending allowance is implied.


## No browser tap throttle / native-touch correction

The later touch correction supersedes the browser token bucket above: local
pulses draw without any per-second gate. Network flood protection is burst 256,
refill 120 per connection, 128 queued candidates per source; global, HTTP,
connection, payload and finite byte-budget controls are retained. Busy/offline
sharing does not discard local input, and is labelled local only. Server
protections are not a promise of unlimited network or rendering capacity.
