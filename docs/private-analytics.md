# Private aggregate analytics

Status: implemented for review, not activated in production. The owner's
approval is required for the new recurring $0.25/month Render disk.
Do not publish the Reddit launch until owner access has been verified.

## What the owner can see

`/admin` has password sign-in, 24-hour / 7-day / 30-day / 90-day summaries,
live connections, page requests, connections started, accepted pulses, peak
concurrency, closed-connection participation and mean duration, connected time
with company, time with two or more connections, overload counters, and CSV.
Charts use UTC. Date ranges are rolling windows with minute resolution at the
start boundary; charts group partial UTC hours/days at either end of a window.
The dashboard refreshes every 30 seconds while visible.

The Reddit link can use `https://www.pulsii.net/?source=reddit-sideproject`.
Only that exact source value gets a dedicated counter. No arbitrary URL,
referrer, IP, fingerprint, stable visitor ID, position or colour is stored.
There are no unique-visitor / return-rate claims. Tabs, devices, reconnects,
reloads, the owner's testing and bots can increase totals. Presence includes
idle tabs; overlap does not prove a social exchange occurred.

Closed-connection statistics are attributed to close time, including the full
duration of a connection started before the selected window. Abrupt process
failure can leave connections unclosed and exclude them from those statistics.
Accepted pulses are relay admissions, not proof every recipient painted them.

## Storage and operational limits

The relay updates in-memory counters only. A worker writes minute aggregates
to a WAL SQLite database every 10 seconds and at graceful shutdown. Queries
aggregate inside the worker, so 90-day views do not transfer a large raw history
through the relay. Exactly-once batch IDs prevent duplicate writes after an
ambiguous response/timeout. Retention is 90 days; owner CSV exports can be kept
longer. SQLite commits use synchronous FULL. The last uncommitted interval can
be lost on a sudden crash. No retroactive history before activation is claimed.

Storage errors do not stop the canvas. They produce a fixed log error and an
explicit dashboard error, not fabricated zero usage. The memory buffer is
bounded to one hour plus one outstanding batch; lost minutes are reported for
the current process. A broken storage worker needs a restart after its cause
is resolved. If the database is corrupt it is not replaced with an empty file.

Use a 1 GB persistent disk mounted at `/var/data`, not the ephemeral source
filesystem. At the verified Render rate this adds $0.25/month to the existing
$7/month single instance, before taxes/usage. The disk keeps the single-instance
restriction and causes a brief interruption on deployments. No instance-size
change or autoscaling is included. A later multi-instance design should use
external storage. CSV is a portable logical backup; Render advises against
relying on disk snapshots to recover custom databases.

## Authentication

Enable only with both `ANALYTICS_DB_PATH` (absolute disk path) and a valid
`ADMIN_PASSWORD_HASH`. Without analytics configuration, all `/admin` paths
remain 404. Public mode requires HTTPS. No admin credentials belong in Git,
page source, analytics records, logs or URLs.

The helper `node scripts/create-admin-access.js /private/path/access.txt
/private/path/environment.json` generates a 192-bit random owner password and
scrypt hash without printing the password. Deliver the private access file to
the owner; merge the environment entries into Render without printing them.
Do not replace existing service environment variables.

Login requires same-origin JSON, uses asynchronous scrypt, a global attempt
limit and a bounded verification concurrency. Sessions use random 256-bit
cookies with HttpOnly, Secure and SameSite=Strict, scoped to `/admin`. Session
tokens are hashed in memory, expire after seven days, and are invalidated by
logout or restart. All statistics and CSV endpoints require authentication,
send no-store/noindex headers, and reject invalid ranges. Browser assets contain
no private data. Use the canonical www domain for sign-in.

## Activation sequence

1. Owner approves the new disk's recurring cost and deployment interruption.
2. Generate the owner access files outside Git; configure the hash and disk path.
3. Attach the smallest disk to the existing production service, never a second
   paid service. Keep one instance, manual deploys and the existing pulse limits.
4. Deploy the reviewed commit. Verify `/healthz`, canvas relay, anonymous 401
   on statistics/CSV, private sign-in, persistence across a controlled restart,
   and one real short two-device session. Keep new launch traffic on hold.
5. Confirm owner can open `/admin` on iPad and export a report.

Sources checked 27 September 2026:
- https://render.com/pricing
- https://render.com/docs/disks
- https://support.reddithelp.com/hc/en-us/articles/204535759-Is-it-ok-to-create-multiple-accounts
