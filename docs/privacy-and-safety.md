# Privacy and safety notes

This document describes the restoration branch and the requirements for its
intended one-canvas launch. It does not describe unknown historical hosting
configuration and is not itself the finished public privacy notice.

## What the application does

- It accepts a colour and normalized canvas coordinate from a connected browser.
- It validates accepted candidates and relays compact batches to each current
  healthy connection that remains online through delivery, including the
  sender. It does not replay a batch after a connection drops.
- It broadcasts a current connection count.
- It keeps active WebSocket connections and rate-limit state only in server memory.
- It keeps visible rings only in browser memory until they fade.
- It emits one-minute aggregate operational counters for connections,
  candidates, accepted and busy-rejected pulses, socket-write attempts and
  completions, attempted and completed wire bytes, queue depth, duration,
  memory, and capacity.

## Current crowd protocol

Pulsii's public product has one permanent global canvas. Scheduled moments
concentrate people on that canvas; they do not create private rooms or separate
event canvases.

The single-process restoration now:

- renders live pulses only after the relay echoes an accepted batch; offline,
  connecting, and rejected candidates are not rendered as shared
- tell a sender plainly when a candidate is rejected and therefore not shared
- carry accepted pulses in compact short-lived batches, preserving each
  accepted pulse's colour and normalized position without creating history
- orders and deduplicates batches per process epoch and uint32 sequence
- reserves one candidate slot per connected socket before admitting extras and
  drains sources in one-per-source rounds
- adapt rendering to crowd density within a verified motion and flash-safety
  envelope without silently presenting rejected pulses as shared

This is a one-process design. Fairness is per connection rather than per human,
and multiple application instances would split the canvas without a shared
transient backplane. Those boundaries prevent an uncontrolled mass launch.

## What the application does not contain

- No account, profile, name, email, chat, feed, database, cookie, local storage,
  ad network, or user-level analytics code
- No stored canvas, pulse history, replay, export, coordinates, colours, user
  agent, application-level IP logging, stable identifier, or user-level metrics
- No third-party browser request during normal canvas use; the About dialog has
  deliberate external links to support and source/feedback

## Important limits on the claim

Pulsii is one shared public global canvas, not a private room. Anyone with the
URL can connect, and unrelated visitors can be present during a scheduled
moment.

The application does not deliberately log pulse coordinates or colours. The hosting platform, reverse proxy, or network provider may still retain ordinary operational data such as IP addresses, request timestamps, user agents, errors, or connection metadata. Therefore public copy should say:

> No accounts, names, messages, or canvas history.

It should not claim complete anonymity or that literally nothing is recorded without a separate review of the selected host's logs and retention settings.

The following facts are not yet recorded and must not be invented:

- the controller/operator identity to name in the public notice
- a private contact route for privacy, safety, accessibility, and abuse reports
- the selected production host's actual log categories and retention
- applicable processor, international-transfer, and subprocessor details
- the documented lawful basis and rights wording appropriate to the real
  deployment

A same-origin public privacy notice containing the reviewed facts is a launch
blocker. A GitHub technical note is not a substitute.

## Abuse and failure controls in this restoration

- Strict pulse type, coordinate, and colour validation
- Small WebSocket message limit
- Per-connection pulse rate limit
- Bounded global and per-connection candidate queues with an honest busy notice
- Concurrent-connection cap and slow-client backpressure cutoff
- Server heartbeat for dead connections
- Sender-inclusive relay so one accepted action renders exactly once per
  healthy canvas that remains connected through the batch
- No fixed client pulse cap; accepted pulses remain present for their visual
  lifetime, with one-call WebGL2 instancing and a Canvas2D fallback
- Close-code-aware exponential reconnect backoff with a readiness timeout and
  delayed reset after a stable connection
- Honest connection count and sharing status
- Always-available pause/resume control
- Calm visuals enabled by default: smaller, dimmer, non-additive rings; device
  reduced-motion settings keep expansion static
- A latched dense-crowd profile uses small static halos, adaptive intensity,
  and brightness-bounded compositing until the canvas becomes quiet
- Native invitation/share control with copy fallback
- Coalesced presence broadcasts to bound connection-churn work
- Reduced-motion rendering for people who request it
- Explicit public-file allowlist
- Security headers and a health endpoint
- Preview-safe crawler policy by default; public indexing requires
  `PUBLIC_MODE=true`
- Aggregate operational logs without pulse content or user identifiers
- Fixed runtime error codes rather than raw error objects or messages

These controls do not make the review build ready for an uncontrolled crowd.
Per-connection limiting and reserved queue slots can be multiplied by opening
many sockets, and Render provides no hard outbound-bandwidth spend cap.
Source-level abuse controls with a documented short lifetime, deployed
capacity evidence, durable aggregate monitoring, and alerting still require
implementation and review.

If source-level connection or abuse controls use an IP address or another
online identifier, document the purpose, scope, access, and lifetime before
deployment. Do not add a persistent participant identifier merely to simplify
rate limiting or marketing measurement.

## Crowd rendering and flash safety

The goal is to show every individually accepted pulse while allowing the
largest proven crowd the deployment can support. Compact batching is a
transport optimisation, not permission to combine accepted people into one
synthetic pulse.

Crowd-limited rendering must use density-adaptive brightness, line weight,
compositing, and timing so the total output remains inside a verified envelope.
Reduced-motion output should remove or minimise non-essential expansion, and
pause must remain continuously reachable and responsive under peak client
load.

Calm mode, bounded compositing, a warning, and pause are useful mitigations, but
none proves seizure safety or WCAG conformance. Full and reduced-motion modes
must be analysed using worst-case valid batches, repeated same-position input,
bright and alternating colours, reconnect bursts, and representative devices.
Use an appropriate frame-analysis process or qualified reviewer. The project
owner or another photosensitive person should not perform high-intensity
exposure testing.

## Privacy-safe measurement and revenue

Mass-crowd operation requires aggregate counts for candidates, accepted and
rejected pulses, fixed rejection reasons, batches, bytes, latency, gaps,
duplicates, backlog, connections, reconnects, slow clients, rendering
performance, and capacity. Keep these in coarse time buckets and do not retain
pulse coordinates, colours, stable identifiers, or per-person histories for
product analytics.

Live connection state may correlate an acknowledgement with its sender only as
long as needed to operate the protocol. Document and review any longer-lived
measurement before enabling it.

The aligned first revenue path is voluntary support plus clearly disclosed
sponsorship of scheduled moments on the same global canvas. A sponsor must not
receive participant data, control pulse admission, or weaken safety. Do not add
behavioural advertising, sponsor tracking, or third-party browser code without
a new privacy, consent, security, and public-notice review.

## Before public launch

- Review actual host logging and retention.
- Re-run exact-delivery batch tests against the release candidate.
- Verify compact batched delivery, per-connection fair admission, and explicit
  accepted/shared versus rejected/not-shared semantics on the deployed review.
- Run staged connection, burst, abuse, reconnect, soak, client-render, and
  bandwidth tests. Continue beyond 1,000 only while every prior gate passes;
  set the initial public admission limit below the last fully passing stage.
- Test flashing and motion risk with the maximum valid batch stream and
  repeated worst-case spatial input, not only ordinary human tapping.
- Treat calm mode as a mitigation, not proof of seizure safety or WCAG
  conformance. Have a suitable reviewer analyse full and worst-case output;
  warnings and a pause button are not substitutes for avoiding unsafe flashes.
  Follow the W3C's [three-flashes-or-below-threshold
  guidance](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold)
  and use an appropriate analysis tool or qualified review for the rendered
  output.
- Complete the controlled iPad, reduced-motion, and pause-control review.
- Verify pause responsiveness and honest capacity/retry states during a
  reconnect wave and peak render load.
- Record the real controller/operator identity and a private contact route;
  both are unresolved launch blockers and must not be guessed.
- Publish a same-origin privacy notice based on the deployed infrastructure,
  including reviewed host/processor facts, purposes, lawful basis, retention,
  recipients/transfers, rights, and complaint route.
- Review any source-level abuse control as personal-data processing before it
  is enabled.
- Keep sponsorship outside the pulse field, clearly disclose it, and confirm it
  has no access to participant data or admission controls.
- Decide whether public indexing should be enabled; keep it off for the isolated
  preview and controlled beta.
