# Pulsii restoration audit

Audit date: 31 July 2026

Repository: [`10000Industries/Pulsii`](https://github.com/10000Industries/Pulsii)

## Preserved baseline

The restoration branch was created from the unmodified live default branch:

| Record | Value |
|---|---|
| Default branch | `main` |
| Baseline commit | `a1a48deafc611f52af8810cf216dcd36d220b07f` |
| Baseline tree | `e56b58bf1e0b45974e4405a9c79fb477d195b5aa` |
| Baseline `git archive` SHA-256 | `43e5d286e802f7de70b5a085c8c80960f27f6931d228d4a8603fd88970c5fd6d` |
| Restoration branch | `agent/pulsii-restoration` |

At audit time the repository was public and had one branch, five commits, no tags, issues, pull requests, releases, Actions workflows, GitHub deployments, environments, or Pages site. Git object inspection in a complete local clone found no unreachable commits or deleted tracked files to recover.

## Reconstructed history

| Date (UTC) | Commit | Verified change | Interpretation |
|---|---|---|---|
| 30 Nov 2025 | `d9e6021` | Imported the complete client, relay server, README, lockfile, and retained generation brief | A cleaned local import; it is the earliest Git evidence, not necessarily the creative origin |
| 30 Nov 2025 | `18f1a59` | Reworked the colour selector for pointer/touch dragging and mobile viewport handling | Strong evidence that touch and iPad-style use mattered |
| 8 Dec 2025 | `998f223` | Changed the document title from Pulse to Pulsii | Called “release 1.0”, but no corresponding tag, release, test, or build record exists |
| 8 Dec 2025 | `a9399f7` | Added a 1024×1024 RGBA Penrose-triangle PNG favicon | The highest-resolution retained raster asset; Git does not establish it as a final brand master |
| 8 Dec 2025 | `a1a48de` | Added a 16/32/48px ICO and selected it in HTML | Live baseline |

The strongest repository evidence defines Pulsii as a deliberately minimal synchronous visual experiment: one black canvas, a colour selector, perfect expanding circles, additive overlap, real-time WebSocket sharing, and almost no interface.

## Historical deployment

Public evidence establishes an existing production boundary that this restoration must not touch:

| Evidence | Result | Reproduction record |
|---|---|---|
| Public DNS and HTTP routing | The apex has A record `216.24.57.1`; `www` has CNAME `pulsii.onrender.com.`; the apex HTTPS request redirects to `https://www.pulsii.net/` | [Google Admin Toolbox Dig](https://toolbox.googleapps.com/apps/dig/#A/pulsii.net) A and [CNAME](https://toolbox.googleapps.com/apps/dig/#CNAME/www.pulsii.net) results plus browser navigation, checked 31 July 2026 |
| Current Render response | `https://pulsii.onrender.com/` and the redirected `https://www.pulsii.net/` display the exact text “This service has been suspended.” | Direct browser navigation, checked 31 July 2026 |
| Archived frontend | The 8 January 2026 capture contains the Git baseline root frontend byte-for-byte | [Wayback snapshot](https://web.archive.org/web/20260108094134/https://www.pulsii.net/), retrieved 31 July 2026; archived body and `git show a1a48de:index.html` both SHA-256 `708a72a5f47afdf83764e2cda67d7d9b2b37b26c05ce69e8c26c600d42e9d2c8` |
| Deployment configuration | GitHub contains no Render manifest, deployment records, environment, or workflow that explains the service | Repository, branch, workflow, deployment, and environment inspection on 31 July 2026 |

The suspended Render service, `pulsii.net`, its DNS, email records, settings, secrets, and any associated account resources are existing production infrastructure. They are outside the restoration scope.

## What the baseline does

Verified working behavior:

- Serves the one-page canvas through Node and Express.
- Opens same-origin WebSocket connections.
- Draws local pulses immediately.
- Relays valid-looking JSON between two connected clients.
- Normalizes coordinates across viewport sizes.
- Allows the colour selector to be moved.
- Keeps all activity transient and in process memory; there is no database or account system.

## What is broken, unsafe, or missing

1. **One action can render more than once.** The client draws locally, while the server echoes the event back to the sender. Pointer and touch handlers are also both registered on modern touch browsers.
2. **The public protocol is unbounded.** Coordinates, colours, message length, frequency, active pulse count, and connection health are not adequately constrained. Malformed or flooded input can break rendering or exhaust resources.
3. **Private source is served.** The baseline exposes the repository root, including server code, package metadata, and installed dependency paths.
4. **Dependencies are vulnerable.** The baseline lockfile resolves packages with known high- and moderate-severity advisories.
5. **The implementation contradicts the retained product brief.** It uses ordinary source-over compositing and soft filled gradients rather than additive expanding rings.
6. **The core shared state is invisible.** A disconnected visitor still sees local effects and cannot tell that the social layer has failed.
7. **Accessibility is incomplete.** The visible colour control is not keyboard-operable, reconnection hammers every 500ms, and reduced-motion preferences are ignored.
8. **Documentation is stale.** Pulse/Pulsii naming is mixed, documented ports do not match code, raw-file use is claimed but cannot work, and “release 1.0” has no tests or release artifact.
9. **Deployment is undocumented.** There is no health endpoint, runtime pin, deployment manifest, CI, preview environment, or safe production boundary in the repository.
10. **Launch material is absent.** There is no positioning, privacy statement, product copy, screenshot set, social card, experiment plan, or name-risk assessment.

## Restoration decision

**Selective restoration is better than wholesale recreation.**

The core interaction, normalized-canvas approach, one-port WebSocket architecture, mobile intent, and retained visual asset are coherent and small enough to preserve. Recreating the product in a framework would add risk without improving the first useful experience.

The smallest restored product worth deploying is:

> One live shared black canvas. Choose a colour and tap; exactly one fading ring appears for you and is relayed to every other connection currently on the canvas. There are no accounts, names, messages, or canvas history.

The restoration therefore keeps vanilla browser rendering and a one-process relay while rebuilding validation, delivery semantics, static-file isolation, connection health, accessibility basics, tests, documentation, and preview safety.

## Deliberately deferred beyond the restored beta

- Accounts, profiles, chat, feeds, permanent artwork, rooms, moderation, and databases
- Programmatic advertising, paid acquisition, billing, subscriptions, and
  monetised product features; the current About dialog contains only a quiet
  external support link
- Third-party, persistent, referral, or user-level analytics; the restored
  server emits only privacy-reviewed process-lifetime aggregate operational
  counters
- Native App Store packaging
- Multiple server instances or cross-instance pub/sub
- Reusing or replacing the suspended production service
- DNS changes and public launch
- A final public product name or trademark decision
- A repository licence decision; npm metadata is deliberately marked `"private": true` and `"UNLICENSED"` until that decision is made
