# Pulsii August 5 review and deployment runbook

This is a review-day sequence, not standing permission to deploy, spend, merge,
change DNS, or launch publicly.

## 1. Resolve the account gate

1. Open Render billing in the account owner's browser.
2. Identify the exact workspace, invoice, service, and billing plan involved.
3. Confirm there are no unwanted paid workspace seats, services, or automatic
   renewals.
4. Resolve only the intended account restriction after the account owner reviews
   the amount.
5. Check the workspace spend limit and included usage before creating anything.

Stop if the charge, workspace, or account status is not fully understood.

## 2. Freeze a reviewed release candidate

1. Confirm `main` still points to the preserved baseline unless a merge is
   separately approved.
2. Review draft PR #1 and record its exact branch-head commit.
3. Require a green GitHub validation workflow.
4. Run locally:

   ```sh
   npm ci
   npm test
   npm run check
   npm run load-test
   npm run load-test:fanout
   ```

5. Review the diff for secrets, external trackers, third-party scripts, and
   unrelated files.

## 3. Create an isolated free review service

Use the branch-specific [Deploy to Render
flow](https://render.com/deploy?repo=https://github.com/10000Industries/Pulsii/tree/agent/pulsii-restoration).
The repository's `render.yaml` requests:

- a new service named `pulsii-restoration-review`
- the restoration branch
- Frankfurt
- one free instance
- automatic deploys off
- the generated `onrender.com` hostname only
- `PUBLIC_MODE=false`
- no `PUBLIC_ORIGIN`
- a 45-connection application cap
- no database, secret, environment group, or custom domain

Before confirming creation, verify every displayed setting against that list.
Do not select an existing service or attach `pulsii.net`.

Free Render is appropriate only for review and a small coordinated test. It can
sleep after inactivity, has a platform WebSocket connection ceiling, and is not
the always-on launch configuration.

## 4. Verify the generated preview

Record:

| Field | Value |
|---|---|
| Preview URL | |
| Exact deployed commit | |
| Render service ID/name | |
| Region and plan | |
| Created at | |
| Existing production changed | No |

Run these checks:

- `/healthz` returns `status: ok`.
- The root, stylesheet, client script, icons, manifest, and social image load.
- Private source and package paths return 404.
- The root response includes `X-Robots-Tag: noindex, nofollow`.
- `robots.txt` disallows crawling.
- The HTML has no canonical or `og:url` pointing to suspended production; its
  social image is same-host.
- No third-party browser request occurs until someone deliberately follows an
  About link.
- Two separate browsers show the real connection count.
- One tap renders locally once and on the other browser once.
- Pause stops incoming and local visuals while taps can still be shared.
- Native invite/share works, with copy fallback where native sharing is absent.
- Offline, background/foreground, and reconnect states remain honest.
- Excess activity is bounded and a congested sender sees the crowded message.

From the reviewed branch, run the automated probe against the exact generated
review hostname:

```sh
npm run review-probe -- https://pulsii-restoration-review-example.onrender.com
```

Replace the example hostname with the created service URL. The probe refuses the
known production domains and arbitrary hosts. Record its warm-up time, 20-sample
p95 relay latency, exact-once result, and reconnect-delivery result in the PR.
It sends only temporary synthetic pulses and stores no identifiers or pulse
history.

## 5. Perform the iPad and motion-safety pass

Use a tester who can safely review animated output. The project owner should not
be required to perform high-intensity motion testing.

Check on iPad Safari:

- portrait and landscape, including rotation
- safe-area placement around device edges
- one pulse per touch
- colour picker tap and drag
- pinch zoom without accidental pulses
- native share sheet and copied-link fallback
- About dialog, pause/resume, keyboard focus, and VoiceOver labels
- backgrounding, loss of network, and reconnection
- reduced-motion rendering
- a controlled overlap test that never exceeds the agreed safe intensity

Keep the pause control continuously reachable. Stop immediately if output is
uncomfortable or unexpectedly flash-like.

## 6. Run a controlled beta, if separately approved

Invite 8–15 known participants into one named ten-minute window. Do not post the
URL publicly yet. Use the
[controlled-beta checklist](controlled-beta-checklist.md) and record aggregate
observations only.

The first session succeeds if the product is understood, remote pulses are
reliably shared, the invitation loop works, and no serious safety or mobile
failure occurs. Raw traffic is not the goal.

## 7. Decide the next hosting state

After the free review:

- Keep the free service for private review if cold starts are acceptable.
- For an always-on public beta, consider one Starter instance only after the
  owner reviews the current price, bandwidth allowance, spend limit, and likely
  concurrency.
- Keep one instance: multiple independent instances would split the single
  shared canvas without an added coordination layer.
- Set the application connection cap no higher than the selected instance's
  WebSocket ceiling.

Do not change `PUBLIC_MODE`, merge PR #1, replace the suspended service, add a
custom domain, or change DNS without a separate explicit decision.

## 8. Public-launch decision

Only after review, decide:

1. controlled beta or broad public opening
2. one global public canvas or development of rooms
3. Penrose icon or ring-based visual identity
4. general audience not directed at children
5. free canvas with quiet support plus paid event/private-room experiments
6. whether `pulsii.net` should be attached to the new service

Review the [preliminary name-clearance note](name-clearance.md) before deciding
on public identity, indexing, promotion, or final launch assets. The private
review can retain the repository name; broad promotion should not proceed until
the official register checks and name decision are complete.

If approval is given, create a new release checklist from the exact deployed
commit. Set `PUBLIC_ORIGIN` to the verified HTTPS origin before setting
`PUBLIC_MODE=true`; the server intentionally refuses public mode without it.
Never use this runbook as implied approval for those actions.
