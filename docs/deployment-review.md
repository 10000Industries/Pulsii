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

Recommended isolated settings:

| Setting | Value |
|---|---|
| Service | New Web Service |
| Name | `pulsii-restoration-review-<short-sha>` |
| Source | `10000Industries/Pulsii` |
| Branch | `agent/pulsii-restoration` |
| Build | `npm ci` |
| Start | `npm start` |
| Health check | `/healthz` |
| Instances | One |
| Auto-deploy | Off for review |
| Plan | Free only; do not add a payment method |
| Domain | Generated preview hostname only |
| Environment groups/secrets | None |

The preview must send `X-Robots-Tag: noindex, nofollow`, serve `robots.txt` with `Disallow: /`, use no custom domain, and remain separate from production.

The generated hostname is intentionally unadvertised, but it is not private or access-controlled. Anyone who obtains the URL can enter the same canvas.

## Deployment record

Complete this record from the created review service:

| Record | Value |
|---|---|
| Provider | Render |
| Preview URL | Pending deployment |
| Exact commit | Pending branch publication |
| Created | Pending deployment |
| Existing Pulsii production changed | No |

## Review checks

- `/healthz` is healthy.
- `/`, `/style.css`, `/script.js`, icons, manifest, and social image load.
- `/server.js`, `/package.json`, and dependency paths return 404.
- Two browsers report the real connection count.
- A pulse from one browser appears exactly once in both browsers.
- Malformed messages are ignored. An excessive sender is disconnected with policy code `1008` and should reconnect with backoff; peers remain healthy.
- Reconnection state is visible and recovers.
- Touch creation and colour selection work at an iPad viewport.
- Reduced-motion mode produces a small, faint response rather than a large expanding ring.
- No third-party request occurs during ordinary canvas use.

## Stop line

Preview verification does not authorise merging, unsuspending or replacing production, changing DNS, adding a custom domain, paying for hosting, increasing access, inviting testers, contacting anyone, submitting the product to a channel, sending private or public marketing, or announcing the URL.
