'use strict';

// Only aggregate numbers cross the persistence boundary. No event payloads,
// IP addresses, user agents, URLs, visitor IDs, or browser fingerprints.
const FIELDS = Object.freeze([
  'pageLoads', 'redditPageLoads', 'connections', 'closed', 'activeClosed',
  'durationMs', 'pulses', 'busy', 'capacity', 'peak', 'observedMs',
  'connectionMs', 'sharedMs', 'sharedConnectionMs',
]);
module.exports = { FIELDS, MINUTE: 60_000, RETENTION_DAYS: 90 };
