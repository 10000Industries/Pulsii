'use strict';

// Run only when configuring private analytics. Both files are private,
// outside the repository; the secret is never printed to logs or stdout.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync } = require('node:crypto');
const [accessPath, environmentPath] = process.argv.slice(2);
if (!accessPath || !environmentPath || !path.isAbsolute(accessPath) || !path.isAbsolute(environmentPath)) {
  throw new Error('Provide absolute paths for the private owner access file and environment file');
}
const password = randomBytes(24).toString('base64url');
const salt = randomBytes(16).toString('hex');
const hash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
fs.writeFileSync(accessPath, `Pulsii private owner analytics\n\nAddress: https://www.pulsii.net/admin\nPassword: ${password}\n\nKeep this file private. The dashboard is available after analytics has been activated.\n`, { mode: 0o600, flag: 'wx' });
fs.writeFileSync(environmentPath, JSON.stringify([
  { key: 'ANALYTICS_DB_PATH', value: '/var/data/pulsii/analytics.sqlite' },
  { key: 'ADMIN_PASSWORD_HASH', value: hash },
]), { mode: 0o600, flag: 'wx' });
console.log('Created private access and environment files. No credentials printed.');
