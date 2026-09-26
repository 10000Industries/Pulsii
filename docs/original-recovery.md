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
exclusive pointer/touch listeners; bounded reconnect; terminal trial expiry;
clear stale canvas on hidden tabs; at most 64 active pulses; minimal status
only for connection/rate problems; a privacy/contact link in the support card.
The isolated review allows one local pulse every 520 ms to fit its existing
2/s rate limit. Busy or disconnected states explicitly say sharing failed.
Local drawing is optimistic; it is not a delivery receipt.

Server source-file allowlist, strict input validation, dependencies, connection,
queue, rate, byte-budget and fixed-expiry protections are retained. Filtered
peer-only batches are no larger than the already reserved full broadcast.
No paid activation, production branch change, DNS or marketing authorization
is implied. The owner must judge the corrected experience before launch.

Old ring/luminance fixture results apply only to the rejected renderer. They
are not evidence about the restored glow renderer. No compliance certification
or device performance claim is made for this recovery.
