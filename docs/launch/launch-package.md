# Pulsii launch package

Prepared for the restored product on `agent/pulsii-restoration`. Nothing in this package authorises a public launch.

## Strategic judgment

Launch Pulsii first as a **live web experiment**, not a social network, drawing tool, wellbeing product, or business.

The main risk is an empty canvas, not lack of reach. The social value only appears when people overlap in time, so early distribution should concentrate small groups into scheduled windows rather than scatter paid traffic across a day.

## Positioning

| Element | Recommendation |
|---|---|
| Category | Live shared web toy |
| Headline | **One shared moment.** |
| Brand thought | Presence without performance. |
| One line | Tap anywhere to send a fading coloured pulse to everyone currently on the canvas—without profiles, text, a feed, or permanent artwork. |
| Honest privacy shorthand | No accounts, names, messages, or canvas history. |

Pulsii's distinctive territory is not collaborative drawing. It is synchronous presence with almost no means of performance.

## Name warning

“Pulsii” is a working restoration name, not a cleared public brand.

- [`pulsii.com`](https://pulsii.com/) is used by an apparel/music brand.
- [`pulsii.com.sg`](https://pulsii.com.sg/) is an active Singapore restaurant whose language also centres on pulse, rhythm, sharing, and connection.

These checks were made on 31 July 2026 and are product-risk signals, not legal or trademark clearance. Keep the repository name for restoration. Before any public launch, conduct proper trademark, domain, and handle checks and decide whether to rename or qualify the product. Do not buy anything yet.

## First audiences

| Priority | Audience | Why now | Important caveat |
|---|---|---|---|
| 1 | Small coordinated groups | Guarantees simultaneous presence and tests the real product | The first build is one global canvas, not a private room |
| 1 | Web-toy and interactive-art explorers | They understand playful, non-utilitarian websites | Novelty may produce short visits |
| 1 | Creative coders and web builders | Useful latency, accessibility, and implementation feedback | Feedback may skew technical |
| 2 | Long-distance friends or partners | “Open this with me for one minute” is a natural invitation | Do not imply privacy |
| 2 | Slow-web and ambient-computing audiences | The restraint may appeal | Avoid unsupported wellbeing claims |
| Later | Streamers, events, installations, classrooms | Can create concentrated spectacle | Needs capacity, motion safety, moderation, and probably rooms |

Do not initially target productivity users, professional drawing users, or children.

## Current product surface

The restored build opens directly on the canvas. Its implemented onboarding is:

> **Pulsii**
>
> tap anywhere.
>
> everyone here sees the pulse.
>
> one public canvas, shared live.
>
> pulses fade. the canvas keeps no history.

There is no entry gate or fake occupancy. The status reports WebSocket
connections rather than people and says when only one connection is present.
The canvas now includes:

- native invite/share with copied-link fallback
- an always-available pause/resume control
- a small About/privacy panel with support and source/feedback links
- an honest crowded notice when aggregate protection drops a pulse
- reduced-motion rendering and safe-area-aware mobile controls

## Proposed landing-page copy

This remains possible wrapper copy, not a requirement for the direct canvas:

> **One shared moment.**
>
> Tap anywhere. A coloured pulse appears live for everyone here, then fades.
>
> No account. No name. No message. Just the moment.
>
> **Enter the canvas**
>
> *3 live connections*

Proposed About copy:

> Most social spaces ask you to build a profile and leave something behind. Pulsii is a tiny live experiment: everyone here sees the same pulses at the same time, and then they fade from the canvas.

Proposed empty-room copy:

> You're here. Bring someone into the moment.

Never simulate visitors or fake activity. A future wrapper should keep the canvas primary rather than burying it beneath a conventional marketing site.

## Draft launch copy

The following is prepared copy only. It must not be sent or published without separate approval.

Proposed direct invitation:

> Open this with me for one minute: [URL]

Short social post:

> I restored a tiny shared web experiment. Pulsii is one black canvas shared live by whoever is there. Tap and a coloured pulse appears for everyone, then fades. No accounts, names, chat, or feed. It works best opened with someone else: [URL]

Show HN title:

> Show HN: Pulsii – an ephemeral shared canvas with no accounts or text

Show HN first comment:

> Pulsii is a small experiment in social presence without profiles or text. A tap creates a coloured ring for everyone currently connected; it fades rather than becoming a post or drawing. I restored it from a five-commit Git baseline and would particularly value feedback on latency, accessibility, congestion, and whether it feels different with 2, 20, or 200 connections.

Reddit title:

> A silent black canvas where taps appear live for everyone currently there

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

1. **Controlled live session:** Invite 8–15 known testers into one ten-minute window after explicit approval.
2. **Scheduled moment:** Promote a second five-minute session at a named time.
3. **Show HN:** Use the playable URL, verified restoration story, and a specific feedback request after capacity testing.
4. **r/InternetIsBeautiful:** Only if the posting account genuinely meets its self-promotion rules.
5. **The Useless Web:** Submit after the empty-room experience and invitation mechanism are honest.
6. **Short-form video:** Test three organic clips on an existing suitable account; do not create many empty brand accounts.
7. **Product Hunt:** Later, after evidence that people understand and share it.
8. **itch.io or OpenProcessing:** Secondary channels if a creative-coding presentation fits naturally.

Use one public channel at a time so outcomes remain attributable. Do not start with paid advertising: dispersed clicks work against simultaneous presence.

## Proposed measurement design

The restored application contains no third-party analytics, event identifiers,
referral tracking, or user identifier. It does contain a share control and
one-minute process-lifetime aggregate operational counters. The counters can
report page loads, connections, first-pulse activation, accepted/shared pulses,
congestion drops, fanout, average duration, peak concurrency, and memory. They
cannot identify reciprocity or a referred visitor.

Proposed north-star event:

> **Reciprocal shared moment:** one browser connection receives a pulse from another connection and responds within ten seconds.

Current aggregate measures:

- Connections activated by at least one accepted pulse
- Peak concurrent connections
- Accepted and shared pulses
- Capacity rejects, per-client limits, global drops, slow clients, and fanout
- Average closed-connection duration
- Page loads, uptime, deployed commit, memory, and approximate event-loop lag

Still proposed, not currently measured:

- first-pulse activation within ten seconds
- reciprocal response within ten seconds
- percentage active for at least one minute
- invite/share rate and referred-visitor activation
- remote-event latency and client reconnect success

Prefer aggregate counters and time buckets. Do not store pulse coordinates, colours, stable identifiers, or user-level histories merely for marketing. Until instrumentation is approved, a controlled session can use facilitator observation plus timestamped snapshots of the instantaneous `/healthz` connection count.

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

Initial technical gate: p95 remote-pulse latency below roughly 500ms, no silent disconnects, and no critical mobile-browser failure. Measuring latency requires an explicit test harness or privacy-reviewed ephemeral event timing; the restoration protocol does not calculate it.

## Public-launch gates

- User review and explicit approval
- Draft PR reviewed and intentionally merged
- Public name decision and formal clearance appropriate to the intended use
- Production hosting decision; do not silently reuse the suspended service
- Host logging and retention reviewed before making privacy claims
- Load and congestion testing above expected concurrency
- Motion/flashing safety review and a sufficient pause/exit mechanism
- Mobile Safari/iPad interaction pass
- Repository licence decision
- Set a verified `PUBLIC_ORIGIN`, then intentionally set `PUBLIC_MODE=true` only
  when indexing is approved; verify the response header and `robots.txt`
- Verify the generated absolute Open Graph, Twitter, and canonical URLs only
  after that origin actually points to the reviewed deployment
- No DNS, domain, payment, tester invitation, contact, channel submission, announcement, private marketing, or public message without separate approval

The decisive product question is whether Pulsii works as an always-open place or as a recurring scheduled communal moment. If scheduled sessions work and ambient traffic does not, that is a coherent product result rather than a failure.

The detailed review-day sequence is in [the August 5
runbook](august-5-runbook.md); the observation sheet is the
[controlled-beta checklist](controlled-beta-checklist.md).
