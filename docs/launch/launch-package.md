# Pulsii launch package

Prepared for the restored product on `agent/pulsii-restoration`. Nothing in this package authorises a public launch.

## Strategic judgment

Launch Pulsii first as a **live web experiment**, not a social network, drawing tool, or wellbeing product.

Pulsii has one permanent global canvas. Scheduled moments are a way to
concentrate people on that same canvas, not separate rooms or temporary copies.
The main early product risk is still an empty canvas, so distribution should
concentrate small groups into named windows before sending dispersed traffic.

## Positioning

| Element | Recommendation |
|---|---|
| Category | Live shared web toy |
| Headline | **One shared moment.** |
| Brand thought | Presence without performance. |
| One line | Tap anywhere to send a fading coloured pulse across the one live global canvas—without profiles, text, a feed, or permanent artwork. |
| Honest privacy shorthand | No accounts, names, messages, or canvas history. |

Pulsii's distinctive territory is not collaborative drawing. It is synchronous presence with almost no means of performance.

## Authoritative global-canvas contract

The public product has one permanent shared canvas for everyone. Rooms, private
canvases, organiser-owned copies, and separate event canvases are not assumed
parts of this launch.

For a large crowd, the launch target is:

- A tap creates a pulse candidate. While connected, the client renders only
  the relay's accepted echo; disconnected and rejected candidates do not
  create a private visual copy.
- The relay explicitly accepts or rejects each candidate. **Accepted** means
  the pulse has entered the global delivery stream for currently connected,
  healthy clients that remain online through the batch. Pulsii has no replay
  history after a connection drops. **Rejected** means it was not shared and
  the sender is told plainly.
- Accepted pulses are carried in compact, bounded batches rather than one
  verbose network frame per pulse per recipient. Batching reduces protocol and
  fanout overhead; it must not silently merge distinct accepted pulses or erase
  their individual colour and position.
- Continuously connected clients deduplicate and process the same ordered batch
  stream. An accepted pulse must not render twice, and a rejected pulse must
  not be presented as a shared pulse.
- Admission is fair among current connections under load. A fast connection
  cannot consume slots reserved for other current connections. Multiple
  sockets from one actor remain a separate abuse-control problem.
- Rendering adapts brightness, line weight, compositing, and timing to crowd
  density while preserving individual accepted pulses. The rendered result
  must remain inside a verified motion and flash-safety envelope.
- There is no pulse or canvas history. Batching is short-lived transport, not
  storage or replay.

The restoration candidate now implements the one-process delivery portion of
this contract: fair bounded admission, 50 ms compact binary batches, sender
echo, explicit busy rejection, epoch/sequence ordering, and no fixed client
pulse cap. It is still a controlled-review candidate because source-level
abuse control, multi-instance global fanout, deployed capacity, final privacy
facts, and objective motion/flash analysis remain unresolved.

## Name warning

“Pulsii” is a working restoration name, not a cleared public brand.

- [`pulsii.com`](https://pulsii.com/) is used by an apparel/music brand.
- [`pulsii.com.sg`](https://pulsii.com.sg/) is an active Singapore restaurant whose language also centres on pulse, rhythm, sharing, and connection.

The preliminary name screen was expanded on 2 August 2026. The exact-name
restaurant also uses pulse, rhythm, connection, and sharing as its brand
territory, so the discoverability and confusion risk is now assessed as
medium–high; UK legal conflict remains unknown. Keep the repository name for
restoration, but do not invest in public promotion or a final identity until the
official registers have been checked manually and the user decides whether to
keep or rename it. See the [name-clearance note](name-clearance.md). Do not buy
anything yet.

## First audiences

| Priority | Audience | Why now | Important caveat |
|---|---|---|---|
| 1 | Small coordinated groups | Guarantees simultaneous presence and tests the real product | They share the permanent global canvas; unrelated visitors can also be present |
| 1 | Web-toy and interactive-art explorers | They understand playful, non-utilitarian websites | Novelty may produce short visits |
| 1 | Creative coders and web builders | Useful latency, accessibility, and implementation feedback | Feedback may skew technical |
| 2 | Long-distance friends or partners | “Open this with me for one minute” is a natural invitation | Do not imply privacy |
| 2 | Slow-web and ambient-computing audiences | The restraint may appeal | Avoid unsupported wellbeing claims |
| Later | Streamers, events, installations, classrooms | Can create concentrated spectacle on the global canvas | Needs proven capacity, verified visual safety, operational monitoring, and clear sponsorship rules |

Do not initially target productivity users, professional drawing users, or children.

## Current product surface

The restored build opens directly on the canvas. Its implemented onboarding is:

> **Pulsii**
>
> tap anywhere.
>
> accepted pulses cross the live canvas.
>
> one public canvas, shared live.
>
> pulses fade. the canvas keeps no history.

There is no entry gate or fake occupancy. The status reports WebSocket
connections rather than people and says when only one connection is present.
The canvas now includes:

- native invite/share with copied-link fallback
- an always-available pause/resume control
- calm visuals enabled by default, with smaller, dimmer, non-additive pulses
- a small About/privacy panel with support and source/feedback links
- an honest crowded notice when the bounded queue rejects a candidate
- reduced-motion rendering and safe-area-aware mobile controls

The UI renders accepted echoes only, identifies a rejected pulse directly, and
uses explicit busy, capacity, deploy, offline, and reconnect states. Browser
verification on the deployed review remains required.

## Proposed landing-page copy

This remains possible wrapper copy, not a requirement for the direct canvas:

> **One shared moment.**
>
> Tap anywhere. Once Pulsii accepts the pulse, it appears live across the shared canvas, then fades.
>
> No account. No name. No message. Just the moment.
>
> **Enter the canvas**
>
> *3 live connections*

Proposed About copy:

> Most social spaces ask you to build a profile and leave something behind. Pulsii is a tiny live experiment: accepted pulses cross one global canvas in the moment, then fade.

Proposed empty-room copy:

> You're here. Bring someone into the moment.

Never simulate visitors or fake activity. A future wrapper should keep the canvas primary rather than burying it beneath a conventional marketing site.

## Draft launch copy

The following is prepared copy only. It must not be sent or published without separate approval.

Proposed direct invitation:

> Open this with me for one minute: [URL]

Short social post:

> I restored a tiny shared web experiment. Pulsii is one black canvas shared live by whoever is there. Tap and an accepted coloured pulse crosses the canvas, then fades. No accounts, names, chat, or feed. It works best when people arrive together: [URL]

Show HN title:

> Show HN: Pulsii – an ephemeral shared canvas with no accounts or text

Show HN first comment:

> Pulsii is a small experiment in social presence without profiles or text. It has one permanent global canvas: accepted taps become coloured rings for the connected crowd, then fade rather than becoming posts or a drawing. I restored it from a five-commit Git baseline and would particularly value feedback on latency, accessibility, crowd safety, and whether it feels different with 20, 200, or 2,000 connections.

Reddit title:

> A silent black canvas where accepted taps appear across the live crowd

Product Hunt tagline:

> A silent shared canvas for fleeting pulses

The Useless Web submission:

> A black canvas shared live by whoever is there. Tap to leave a pulse that vanishes.

## Launch assets

Included in this branch:

| Asset | Path | Use |
|---|---|---|
| Open Graph image | `og-image.png` | 1200×630 illustrative launch concept; not a product capture |
| Open Graph source | `assets/launch/og-image.svg` | Editable illustrative source |
| Square image | `assets/launch/pulsii-square-1080.png` | 1080×1080 illustrative launch concept; not a product capture |
| Square source | `assets/launch/square-image.svg` | Editable illustrative source |
| Legacy high-resolution icon | `favicon.png` | Retained 1024×1024 RGBA Penrose raster |
| Browser icon | `favicon.ico` | 16/32/48px favicon |

The Penrose favicon and ring-based launch concepts are not yet a unified
identity. Resolve that mismatch before public launch. The Open Graph PNG was
regenerated from its SVG with Sharp/libvips and DejaVu Sans; the square source
still uses a system-font stack, so reproduction can vary by machine. Document
the final export environment or replace the type with outlines before final
production use.

Capture from the verified deployment before launch:

- 10–12 second vertical video showing two devices receiving the same pulse; show synchronisation in the first two seconds
- Six-second seamless loop
- Three real screenshots: quiet canvas, one shared pulse, and controlled overlap
- Reduced-motion comparison

Use the product itself for imagery; stock visuals would weaken the proof.

## Proposed distribution sequence

No invitation, submission, message, or announcement in this section is authorised before review.

1. **Synthetic staged capacity tests:** Exercise compact batching, fair
   admission, accepted/rejected acknowledgements, rendering, reconnects, and
   bandwidth without exposing people to unreviewed worst-case visuals.
2. **Controlled live session:** Invite 8–15 known testers into one ten-minute
   window on the permanent global canvas after explicit approval.
3. **Larger controlled moments:** Progress to 25–40 and then 50–100 people only
   after the preceding technical and human gates pass.
4. **Scheduled public moment:** Promote one short named time window on the same
   global canvas and retain rollback capacity.
5. **Show HN:** Use the playable URL, verified restoration story, and a specific feedback request after deployed capacity testing.
6. **r/InternetIsBeautiful:** Only if the posting account genuinely meets its self-promotion rules.
7. **The Useless Web:** Submit after the empty-room experience and invitation mechanism are honest.
8. **Short-form video:** Test three organic clips on an existing suitable account; do not create many empty brand accounts.
9. **Product Hunt:** Later, after evidence that people understand and share it.
10. **itch.io or OpenProcessing:** Secondary channels if a creative-coding presentation fits naturally.

Use one public channel at a time so outcomes remain attributable. Do not start with paid advertising: dispersed clicks work against simultaneous presence.

## Proposed measurement design

The restored application contains no third-party analytics, event identifiers,
referral tracking, or user identifier. It does contain a share control and
one-minute process-lifetime aggregate operational counters. The counters can
report page loads, connections, first-pulse activation, candidates,
accepted/shared and busy-rejected pulses, socket-write attempts and
completions, attempted and completed wire bytes, queue depth, average duration,
peak concurrency, and memory. They
cannot identify reciprocity or a referred visitor.

Proposed north-star event:

> **Reciprocal shared moment:** one browser connection receives a pulse from another connection and responds within ten seconds.

Current aggregate measures:

- Connections activated by at least one accepted pulse
- Peak concurrent connections
- Accepted and shared pulses
- Capacity rejects, per-client limits, busy rejections, slow clients, and
  batch/pulse socket-write attempts and completions
- Average closed-connection duration
- Page loads, uptime, deployed commit, memory, and approximate event-loop lag

Required crowd-delivery measures before broad promotion:

- Candidates received, accepted, and rejected, with a small fixed set of
  aggregate rejection reasons
- Accepted pulses placed into batches, batch count and encoded bytes, batch
  delivery latency, duplicates, gaps, and out-of-order processing
- Fairness across simulated senders without storing a user-level history
- Client render frame time, dropped frames, active-pulse count, and pause
  response under the verified safety envelope
- Reconnect attempts, successful recovery, capacity waits, and slow-client
  removal
- Outbound bytes per active connection and per accepted pulse

Still proposed, not currently measured:

- first-pulse activation within ten seconds
- reciprocal response within ten seconds
- percentage active for at least one minute
- invite/share rate and referred-visitor activation
- remote-event latency and client reconnect success

Prefer aggregate counters and time buckets. Do not store pulse coordinates, colours, stable identifiers, or user-level histories merely for marketing. Until instrumentation is approved, a controlled session can use facilitator observation plus timestamped snapshots of the instantaneous `/healthz` connection count.

An accepted/rejected acknowledgement may be correlated with one live
connection only for the time needed to operate the protocol. It must not become
a persistent participant profile. Any source-level abuse control requires its
own privacy review and short, documented lifetime.

## Staged capacity validation

Capacity is an observed envelope for an exact commit, deployment size,
configuration, browser mix, and pulse pattern. It is not a permanent claim.

Local synthetic evidence on 8 August 2026, with the generator and server
sharing one host process, delivered one simultaneous accepted pulse per client
to every client as follows:

| Connections | Contributions verified | Delivery after acceptance |
|---:|---:|---:|
| 1,000 | 1,000,000 | 77–134 ms across repeat runs |
| 3,000 | 9,000,000 | 453 ms |
| 5,000 | 25,000,000 | 4.38 s |
| 6,000 | 36,000,000 | 20.19 s |
| 7,500 | 56,250,000 expected | Incomplete after 60 s |

The 1,000-client burst used about 7.019 MB of encoded pulse payload. If 1,000
viewers each sustained one pulse per second, compact pulse records alone would
still approach 25 GB/hour before transport overhead. These measurements show
the architecture improvement and its performance knee; they do not establish
Render capacity or authorize a public cap above 1,000. Raise that claim only
after the paid-service and representative mobile gates pass.

1. Verify two-client exact-once behaviour and accepted/rejected semantics.
2. Run headless ramps at 20, 100, 250, 500, and 1,000 simultaneous
   connections. If all gates pass, continue by measured increments until the
   first constraint appears; do not select an arbitrary marketing number in
   advance.
3. At every stage, test quiet viewing, ordinary tapping, a coordinated burst,
   a reconnect wave, slow receivers, and multiple abusive senders.
4. Soak the intended launch level long enough to expose memory growth,
   bandwidth cost, batch backlog, event-loop lag, and connection churn.
5. Separately replay the maximum admitted batch stream through representative
   low-end mobile and desktop renderers. Synthetic server success does not
   establish client rendering or flash safety.
6. Record the first failed gate and set the initial admission limit below the
   last fully passing stage. Repeat after changes to protocol, renderer,
   instance size, proxy, or region.

At each stage require: no silent rejection; no duplicate accepted pulse; no
unexplained batch gap; fair admission; bounded memory and backlog; an agreed
p95 delivery target; honest capacity status; successful recovery; acceptable
outbound cost; responsive pause; and a separately verified flash- and
motion-safety result.

## First experiments

These thresholds are proposed decision rules, not industry benchmarks. Run them only after explicit approval; use facilitator observation for the first controlled session or implement the privacy-reviewed aggregate events described above.

| Experiment | Hypothesis | Success signal |
|---|---|---|
| 12-person concurrent test | Interaction is self-explanatory | At least 80% tap within 10s; at least 70% receive a remote pulse within 30s |
| Reciprocity test | Remote presence changes behaviour | At least 40% respond within 10s |
| Scheduled vs anytime link | Concentrated arrival creates a better experience | Scheduled window doubles shared-moment rate |
| Copy test | Emotional framing beats technical explanation | “One shared moment” improves entry-to-tap rate |
| Invitation loop | A solo visitor will bring someone into the canvas | At least three testers say they would invite someone |
| Social-value test | The live layer is the product | Shared sessions last at least twice as long as solo sessions |
| Acceptance clarity | People understand whether a pulse was shared | No participant mistakes an explicitly rejected pulse for a shared one |
| Scheduled global moment | Concentrated arrival improves the permanent canvas | The named window improves reciprocal moments without a safety or reliability regression |
| Support intent | A minority value the experiment enough to support it | At least one credible support action or explanation of what would earn one |
| Disclosed sponsor tolerance | Sponsorship can fund the canvas without corrupting it | Participants accept restrained, clearly labelled attribution outside the pulse field |

Initial technical gate: sample p95 remote-pulse latency below roughly 500ms, no
silent disconnects, and no critical mobile-browser failure. The branch now
includes `npm run review-probe -- <isolated-review-origin>`: a guarded,
identifier-free harness that checks review-mode HTTP protections, exact-once
relay across 20 synthetic pulses, sample p95 relay latency, and delivery after a
receiver reconnect. It refuses the known production domains and arbitrary
hosts. The browser-level iPad and background/foreground checks remain manual.

## Public-launch gates

- User review and explicit approval
- Draft PR reviewed and intentionally merged
- Public name decision and formal clearance appropriate to the intended use
- Production hosting decision; do not silently reuse the suspended service
- Host logging and retention reviewed before making privacy claims
- A same-origin public privacy notice naming the real controller/operator and a
  private contact route; both details are currently unresolved launch blockers
- Compact batched delivery and explicit accepted/rejected semantics verified on
  the deployed candidate
- Staged load, reconnect, fairness, soak, client-render, and bandwidth testing
  beyond the initial admission limit
- Worst-case motion/flashing analysis of the actual crowd renderer, plus a
  continuously reachable pause/exit mechanism; calm mode alone is not proof
- Mobile Safari/iPad interaction pass
- Repository licence decision using the
  [prepared decision note](licence-decision.md); the isolated review remains
  `UNLICENSED`
- Set a verified `PUBLIC_ORIGIN`, then intentionally set `PUBLIC_MODE=true` only
  when indexing is approved; verify the response header and `robots.txt`
- Verify the generated absolute Open Graph, Twitter, and canonical URLs only
  after that origin actually points to the reviewed deployment
- No DNS, domain, payment, tester invitation, contact, channel submission, announcement, private marketing, or public message without separate approval

## Revenue path

The permanent global canvas remains free. The aligned first revenue path is:

1. a quiet voluntary support link;
2. after engagement evidence, clearly disclosed sponsorship of named scheduled
   moments on the same global canvas; and
3. later direct sponsorship only if attribution can remain restrained and does
   not change pulse fairness, visual safety, privacy, or participant access.

Do not assume private rooms, sell separate canvases, or add behavioural
advertising to justify the first launch. A sponsor must not receive participant
data or control admission. Sponsor attribution should sit outside the pulse
field, be recognisable as sponsorship, and receive a fresh privacy and legal
review before publication.

The remaining product question is whether the permanent canvas works best as
an ambient always-open place, through scheduled communal peaks, or through a
mixture of both. These are usage patterns on one canvas, not alternative room
architectures.

The detailed review-day sequence is in [the August 5
runbook](august-5-runbook.md); the observation sheet is the
[controlled-beta checklist](controlled-beta-checklist.md).
