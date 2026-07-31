# Privacy and safety notes

This document describes the restoration branch, not any unknown historical hosting configuration.

## What the application does

- It accepts a colour and normalized canvas coordinate from a connected browser.
- It validates and relays that pulse to other currently connected browsers.
- It broadcasts a current connection count.
- It keeps active WebSocket connections and rate-limit state only in server memory.
- It keeps visible rings only in browser memory until they fade.

## What the application does not contain

- No account, profile, name, email, chat, feed, database, cookie, local storage, or analytics code
- No stored canvas, pulse history, replay, export, or user-level metrics
- No third-party browser request during normal use

## Important limits on the claim

Pulsii is a shared public canvas, not a private room. Anyone with the URL can connect to the same server process.

The application does not deliberately log pulse coordinates or colours. The hosting platform, reverse proxy, or network provider may still retain ordinary operational data such as IP addresses, request timestamps, user agents, errors, or connection metadata. Therefore public copy should say:

> No accounts, names, messages, or canvas history.

It should not claim complete anonymity or that literally nothing is recorded without a separate review of the selected host's logs and retention settings.

## Abuse and failure controls in this restoration

- Strict pulse type, coordinate, and colour validation
- Small WebSocket message limit
- Per-connection pulse rate limit
- Concurrent-connection cap and slow-client backpressure cutoff
- Server heartbeat for dead connections
- Peer-only relay so one local action renders exactly once
- Client-side cap on active rings, with a lower non-additive reduced-motion cap
- Exponential reconnect backoff
- Honest connection count and sharing status
- Reduced-motion rendering for people who request it
- Explicit public-file allowlist
- Security headers and a health endpoint

## Before public launch

- Review actual host logging and retention.
- Load-test expected concurrency and pulse congestion.
- Test flashing and motion risk with many simultaneous users.
- Add a visible pause/exit control if reduced-motion handling is insufficient.
- Decide whether a single global public canvas is acceptable or rooms/moderation are required.
- Publish a short privacy notice based on the deployed infrastructure, not only this code.
