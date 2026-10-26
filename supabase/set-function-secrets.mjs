/**
 * Sets the Edge Function secrets from server/.env.
 *
 *   node supabase/set-function-secrets.mjs
 *
 * Why a script rather than a command you type: the values would otherwise sit
 * in your shell history and scroll-back. This reads them from server/.env
 * (which is gitignored), hands them to the Supabase CLI through a temporary
 * file with no-read permissions for anyone else, and deletes that file on the
 * way out — including if it fails. Nothing is ever printed.
 *
 * Re-run it any time a value changes; it overwrites whatever is there. After
 * rotating the Razorpay secret or adding the webhook secret, update
 * server/.env and run this again.
 *
 * What it does NOT set: anything beginning with SUPABASE_. Those names are
 * reserved and injected into every function automatically, and the API
 * rejects an attempt to set them.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const envPath = path.join(root, 'server', '.env');
if (!fs.existsSync(envPath)) {
  console.error('\n[secrets] server/.env not found. Nothing to read.\n');
  process.exit(1);
}

const env = dotenv.parse(fs.readFileSync(envPath));

const PROJECT_REF = env.SUPABASE_PROJECT_REF ?? 'tdcdghuzasxkfdvactdz';

/**
 * The secrets the deployed functions actually read.
 *
 * `required` ones stop the deploy from working at all. SITE_URL is optional
 * because the CORS helper compiles the production origin in as a default, so
 * it only matters if you serve the site from somewhere else.
 */
const WANTED = [
  { name: 'RAZORPAY_KEY_ID', required: true, note: 'public Key ID, used by create-order' },
  { name: 'RAZORPAY_KEY_SECRET', required: true, note: 'signs and verifies payments' },
  { name: 'RAZORPAY_WEBHOOK_SECRET', required: false, note: 'verifies webhook deliveries' },
  { name: 'SITE_URL', required: false, note: 'extra allowed browser origins' },
];

const present = [];
const missing = [];

for (const entry of WANTED) {
  const value = (env[entry.name] ?? '').trim();
  if (value) present.push({ ...entry, value });
  else missing.push(entry);
}

if (!present.length) {
  console.error('\n[secrets] None of the expected values are filled in in server/.env:');
  for (const entry of WANTED) console.error(`             ${entry.name}  (${entry.note})`);
  console.error('');
  process.exit(1);
}

console.log(`\n[secrets] project ${PROJECT_REF}`);
console.log('[secrets] will set:');
// Lengths only. A length is enough to spot a truncated paste and tells an
// onlooker nothing about the value.
for (const entry of present) console.log(`             ${entry.name}  (${entry.value.length} chars)`);

if (missing.length) {
  console.log('[secrets] not set, because server/.env has no value for them:');
  for (const entry of missing) {
    console.log(`             ${entry.name}  ${entry.required ? '** REQUIRED **' : '(optional)'}  - ${entry.note}`);
  }
}

/* ── Hand the values over without putting them on a command line ── */

// A command line is visible to every other process on the machine via the
// process table, so the values go in a file instead.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abj-secrets-'));
const tmpFile = path.join(tmpDir, `${crypto.randomUUID()}.env`);

const cleanUp = () => {
  try {
    if (fs.existsSync(tmpFile)) {
      // Overwrite before unlinking, so the bytes are not left in free space.
      fs.writeFileSync(tmpFile, '0'.repeat(fs.statSync(tmpFile).size));
      fs.unlinkSync(tmpFile);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best effort: a failed cleanup must not mask the real result.
  }
};

process.on('exit', cleanUp);
process.on('SIGINT', () => process.exit(130));

let exitCode = 0;

try {
  fs.writeFileSync(tmpFile, present.map((e) => `${e.name}=${e.value}`).join('\n') + '\n', { mode: 0o600 });

  console.log('\n[secrets] calling the Supabase CLI...\n');

  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['--yes', 'supabase@latest', 'secrets', 'set', '--env-file', tmpFile, '--project-ref', PROJECT_REF],
    {
      stdio: 'inherit',
      // The CLI authenticates with this; it is read from server/.env and
      // never written to the temporary file.
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN ?? '' },
    },
  );

  exitCode = result.status ?? 1;
} finally {
  cleanUp();
}

if (exitCode === 0) {
  console.log('\n[secrets] done.');
  const stillMissing = missing.filter((m) => m.required);
  if (stillMissing.length) {
    console.log('[secrets] checkout will STILL refuse, because these are required and unset:');
    for (const m of stillMissing) console.log(`             ${m.name}`);
  } else {
    console.log('[secrets] create-order has what it needs. Verify with:');
    console.log('             node supabase/check-payments.mjs');
  }
  console.log('');
} else {
  console.error('\n[secrets] the CLI failed. Nothing was printed; re-read its error above.\n');
}

process.exit(exitCode);
