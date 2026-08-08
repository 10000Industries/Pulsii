# Controlled beta checklist

Use this for staged coordinated sessions on Pulsii's one permanent global
canvas. It records aggregate observations, not names, IP addresses, pulse
locations, colours, or individual histories.

Progress in order:

1. 8–15 participants for first-use comprehension and exact-once behaviour
2. 25–40 participants for ordinary crowd interaction
3. 50–100 participants for a larger controlled moment
4. a short scheduled public moment only after all public-launch gates pass

These human stages do not replace synthetic ramp, burst, reconnect, soak,
abuse, bandwidth, client-rendering, or flash-safety tests. Do not expose people
to an unreviewed worst-case visual load.

## Session record

| Field | Value |
|---|---|
| Date and time | |
| Exact deployed commit | |
| Deployment URL | |
| Planned duration | 10 minutes |
| Human stage | 8–15 / 25–40 / 50–100 / scheduled public |
| Invitations sent | |
| Peak connections | |
| Pulse candidates | |
| Pulses accepted | |
| Pulses rejected | |
| Rejection reasons | |
| Batches delivered | |
| Batch gaps / duplicates | |
| Facilitator | |

## Before the session

- Confirm the exact reviewed deployment and commit. Do not accidentally test
  the obsolete production build.
- Confirm `/healthz` responds and the operational observer can see connection,
  accepted/rejected, batching, backlog, latency, memory, and bandwidth signals.
- For controlled stages, confirm crawling remains disabled. For a separately
  approved public stage, confirm the intended crawler setting explicitly.
- Open one iPad Safari client and one second-browser client.
- Confirm calm mode starts enabled; then confirm pause, device reduced motion,
  share/copy, About, and reconnect behaviour.
- Confirm compact batches preserve distinct accepted pulse colours and
  positions, process once, and resume in order without replay after a
  reconnect.
- Confirm a normal pulse receives an accepted/shared result. Confirm the
  rejected/not-shared state using a controlled synthetic check before people
  arrive; do not create an unsafe human-visible flood to force it.
- Confirm the tested load is below the last fully passing synthetic capacity
  stage and that rollback is ready.
- Tell invitees this is the one permanent public global canvas, not a private
  or session-specific room; unrelated visitors may appear.
- Tell invitees that pulses are visual, fade, and have no canvas history.
- Tell invitees that a pulse appears only after acceptance; a rejected or
  disconnected tap is labelled not shared and does not create a private copy.
- Provide a stop time and a route for private feedback.
- Do not invite anyone who has not agreed to view animated output.
- Keep calm mode on for the first group session. Do not use full visuals in a
  group until a separate qualified motion/flashing review passes.
- Do not ask a photosensitive person or the project owner to perform the
  high-intensity safety exposure.
- Confirm the actual hosting logs and retention have been reviewed. Before any
  public stage, publish a same-origin privacy notice with the real
  controller/operator and private contact route; those details must not be
  invented.

## Facilitator observations

Count only what can be observed safely during the session:

| Measure | Result |
|---|---|
| Opened the link | |
| Sent a first pulse without help | |
| Received at least one remote pulse | |
| Used invite/share | |
| Correctly understood accepted/shared | |
| Correctly understood rejected/not shared | |
| Reported a duplicate pulse | |
| Reported a missing accepted pulse or batch gap | |
| Reported an out-of-order visual burst | |
| Reported a disconnect or failed reconnect | |
| Reported a capacity or retry state as unclear | |
| Reported a mobile interaction failure | |
| Reported discomfort or motion concern | |
| Peak connections | |
| Accepted / rejected pulse counts | |
| Admission fairness concern | |
| Batch p95 delivery latency | |
| Batch backlog peak | |
| Client dropped frames / pause delay | |
| Slow-client terminations | |
| Outbound bytes during session | |

## Questions after the session

1. What did you think Pulsii was within the first ten seconds?
2. Could you tell when another connection was present?
3. Did receiving a pulse make you respond?
4. Was anything confusing, inaccessible, uncomfortable, or too intense?
5. Would you invite one person into it for a minute?
6. Does the permanent global canvas feel better as an always-open place, during
   a scheduled communal moment, or through a mixture of both?
7. Was it clear whether your pulse had been accepted and shared or rejected?
8. Would you voluntarily support Pulsii if it remained free? What would make
   that feel worthwhile?
9. Would restrained, clearly labelled sponsorship of a scheduled global moment
   be acceptable if it did not affect pulses, privacy, or access?

## Decision thresholds

These are product hypotheses, not industry benchmarks:

- At least 80% send a first pulse within ten seconds.
- At least 70% receive a remote pulse within 30 seconds.
- At least 40% visibly reciprocate within ten seconds.
- Every accepted synthetic test pulse reaches every healthy instrumented test
  receiver exactly once; no rejected pulse is presented as shared.
- No unexplained batch gap, duplicate, critical reconnect, serious iPad
  failure, or silent capacity failure.
- Simulated ordinary participants receive a fair opportunity to have a pulse
  accepted during contention; one sender cannot monopolise the session.
- No safety complaint or unexpectedly flash-like output.
- Pause remains continuously reachable and responsive at peak observed load.
- Operational memory, backlog, latency, render frame time, and outbound usage
  remain inside the pre-agreed envelope.
- At least three participants say they would invite someone or return for a
  scheduled global moment.

If safety, accepted/rejected honesty, exact-once delivery, batch integrity,
fairness, pause, or reconnect fails, stop distribution and fix it. Do not
progress merely because the server retained open connections.

If comprehension succeeds but overlap is weak, test another scheduled moment
on the same global canvas before adding features. If nobody wants to invite,
return, support, or tolerate restrained sponsorship, do not buy traffic or
build commercial infrastructure.
