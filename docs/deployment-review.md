# Isolated preview deployment

## Existing production boundary

Do not reuse, wake, edit, or attach anything to:

- `pulsii.net`
- `www.pulsii.net`
- `pulsii.onrender.com`
- the existing Render service named `pulsii`
- their DNS, domains, environment groups, secrets, email records, or deployment settings

That route is suspended, but it remains existing Pulsii production infrastructure.

## Preview contract

The review deployment must be a wholly new one-process Render Web Service built from an exact commit on `agent/pulsii-restoration`.

The committed `render.yaml` requests these isolated settings:

| Setting | Value |
|---|---|
| Service | New Web Service |
| Name | `pulsii-restoration-review` |
| Source | `10000Industries/Pulsii` |
| Branch | `agent/pulsii-restoration` |
| Build | `npm ci && npm test && npm run check` |
| Start | `npm start` |
| Health check | `/healthz` |
| Instances | One |
| Auto-deploy trigger | Off |
| Plan | Free review instance |
| Region | Frankfurt |
| Application connection cap | 45 |
| Public mode | False |
| Domain | Generated preview hostname only |
| Environment groups/secrets | None |

The preview must send `X-Robots-Tag: noindex, nofollow`, serve `robots.txt` with `Disallow: /`, use no custom domain, and remain separate from production.
`PUBLIC_ORIGIN` must remain unset, so preview metadata does not advertise the
suspended production hostname.

The generated hostname is intentionally unadvertised, but it is not private or access-controlled. Anyone who obtains the URL can enter the same canvas.

## Deployment record

Complete this record from the created review service:

| Record | Value |
|---|---|
| Provider | Render |
| Preview URL | Pending deployment |
| Exact commit | Record from the reviewed deployment |
| Created | Pending deployment |
| Existing Pulsii production changed | No |

## Review checks

- `/healthz` is healthy.
- `/`, `/style.css`, `/script.js`, icons, manifest, and social image load.
- Preview HTML has same-host image metadata and no canonical or `og:url`
  claiming `pulsii.net`.
- `/server.js`, `/package.json`, and dependency paths return 404.
- Two browsers report the real connection count.
- A pulse from one browser appears exactly once in both browsers.
- Malformed messages are ignored. An excessive sender is disconnected with policy code `1008` and should reconnect with backoff; peers remain healthy.
- Reconnection state is visible and recovers.
- Touch creation and colour selection work at an iPad viewport.
- Pause/resume, native share, copied-link fallback, and the About dialog work.
- Calm mode starts enabled and produces a small, faint, non-additive response
  rather than a large expanding ring; device reduced-motion settings keep calm
  mode active.
- No third-party request occurs during ordinary canvas use.
- Operational log events contain only aggregate counters and no pulse content,
  IP address, user agent, or identifier.

Use [the August 5 runbook](launch/august-5-runbook.md) for the complete
account, deployment, iPad, safety, and controlled-beta sequence.

## Stop line

Preview verification does not authorise merging, unsuspending or replacing production, changing DNS, adding a custom domain, paying for hosting, increasing access, inviting testers, contacting anyone, submitting the product to a channel, sending private or public marketing, or announcing the URL.
