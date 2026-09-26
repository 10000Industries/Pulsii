# Original Pulsii recovery — 26 September 2026

The owner rejected review `bc02b1e` as a broken remake. Passing its engineering
tests did not establish fidelity or acceptance. The recovery reference is
released main `a1a48deafc611f52af8810cf216dcd36d220b07f`, preserved unchanged.

Recovered directly from that revision: empty black fullscreen canvas; original
40 px draggable colour selector; original random colour selection; 420 px/s
radial expansion; 1.4 s sine-shaped lifetime; 0.22 pulse alpha; radial gradient
stops 0/0.4/1; frame-to-frame trailing fade; original delayed support prompt.
Original rendering uses source-over (despite additive wording in its comments
and brief). We preserve the shipped implementation, not an interpretation of it.

Narrow compatibility fixes: `/live` binary batch decoder; immediate local draw
with negotiated `pulsii-immediate-v1` so own events are not echoed twice;
native touchstart with changedTouches on touch devices, non-touch pointer input; bounded reconnect; terminal trial expiry;
clear stale canvas on hidden tabs; at most 1024 active pulses; minimal status
only for connection/rate problems; a privacy/contact link in the support card.
The browser has no tap-rate limit or cooldown. Every new contact draws locally
before attempting network sharing. Busy/disconnected/backpressured sharing
reports local-only feedback and never suppresses that local pulse. Server
traffic and finite trial budgets remain bounded. Terminal expiry stops input.
Local drawing is optimistic; it is not a delivery receipt.

Server source-file allowlist, strict input validation, dependencies, connection,
queue, rate, byte-budget and fixed-expiry protections are retained. Filtered
peer-only batches are no larger than the already reserved full broadcast.
No paid activation, production branch change, DNS or marketing authorization
is implied. The owner must judge the corrected experience before launch.

Old ring/luminance fixture results apply only to the rejected renderer. They
are not evidence about the restored glow renderer. No compliance certification
or device performance claim is made for this recovery.


Owner confirmed on 26 September that this version looks restored, then requested
much faster pulsing. That acceptance concerns the restored appearance, not the
old two-per-second restriction. Original visuals remain the reference.


## iPad missed-tap report

Owner reported alternating/missing quick taps after bb639d5. Logs during the
reported interval showed 49 received pulse candidates, all accepted, zero
busy rejections and zero rate disconnects. This does not establish which input
or rendering behavior caused missing local feedback on the physical device.

The touch-specific correction processes every changed contact via non-passive
touchstart, suppresses browser gesture defaults, and avoids a second draw from
compatibility pointer events. Mouse/trackpad uses pointerdown. Redundant viewport
resize no longer clears the canvas. Local drawing is independent of network
readiness, backpressure, busy notices and tap rate. Versioned asset URLs prevent
reuse of the old bundle on a fresh navigation. ?diagnostics=1 shows actual
input/local/painted/sent/received counts for a device recording if needed.
Apple touch guidance: https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html
Touch event specification: https://www.w3.org/TR/touch-events/

The iPad-specific cause and fix require owner verification. Desktop mouse tests
and mocked touch events are not a substitute for the physical device.
