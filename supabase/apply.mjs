/**
 * Applies the migrations in supabase/migrations to a Postgres database.
 *
 * Why this exists rather than `supabase db push`: that command needs the CLI
 * to be logged in (an access token), which is a separate credential from the
 * database password. This connects straight to Postgres with the password and
 * writes the same migration history table the CLI uses, so moving to the CLI
 * later stays consistent.
 *
 * Each migration runs inside its own transaction, so a failure rolls that
 * file back completely rather than leaving the schema half-built.
 *
 * Usage:
 *   node supabase/apply.mjs            # apply anything not yet applied
 *   node supabase/apply.mjs --dry-run  # show what would run
 *   node supabase/apply.mjs --verify   # report what is in the database
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../server/.env') });

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const verifyOnly = args.has('--verify');

const {
  SUPABASE_DB_HOST: host,
  SUPABASE_DB_PORT: port,
  SUPABASE_DB_USER: user,
  SUPABASE_DB_NAME: database,
  SUPABASE_DB_PASSWORD: password,
} = process.env;

if (!host || !user || !password) {
  console.error('\n[apply] Missing database connection details in server/.env.');
  console.error('[apply] Need SUPABASE_DB_HOST, SUPABASE_DB_USER and SUPABASE_DB_PASSWORD.\n');
  process.exit(1);
}

const client = new pg.Client({
  host,
  port: Number(port) || 5432,
  user,
  database: database || 'postgres',
  password,
  // Supabase terminates TLS at the pooler with a certificate chain this
  // client has no local root for. The connection is still encrypted.
  ssl: { rejectUnauthorized: false },
  // A long migration must not be cut off part-way through.
  statement_timeout: 300_000,
  query_timeout: 300_000,
  connectionTimeoutMillis: 30_000,
});

const migrationsDir = path.join(here, 'migrations');

const files = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

/* ─────────────────────────── Verification ─────────────────────────── */

const verify = async () => {
  const q = async (sql) => (await client.query(sql)).rows;

  const tables = await q(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);

  const rlsOff = await q(`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    order by c.relname
  `);

  const policies = await q(`select count(*)::int as n from pg_policies where schemaname = 'public'`);

  const functions = await q(`
    select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname
  `);

  const triggers = await q(`
    select count(*)::int as n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
  `);

  const enums = await q(`
    select t.typname from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
    order by t.typname
  `);

  let buckets = [];
  try {
    buckets = await q(`select id from storage.buckets order by id`);
  } catch {
    buckets = [];
  }

  console.log('\n── Database state ──');
  console.log(`  tables     ${tables.length}`);
  if (tables.length) console.log(`             ${tables.map((r) => r.table_name).join(', ')}`);
  console.log(`  enums      ${enums.length}`);
  console.log(`  functions  ${functions.length}`);
  console.log(`  policies   ${policies[0].n}`);
  console.log(`  triggers   ${triggers[0].n}`);
  console.log(`  buckets    ${buckets.length}  ${buckets.map((r) => r.id).join(', ')}`);

  if (rlsOff.length) {
    console.log(`\n  WARNING: RLS is DISABLED on: ${rlsOff.map((r) => r.relname).join(', ')}`);
  } else if (tables.length) {
    console.log('\n  OK: Row Level Security is enabled on every public table');
  }

  return { tables: tables.length, policies: policies[0].n, functions: functions.length };
};

/* ─────────────────────────── Apply ─────────────────────────── */

const run = async () => {
  console.log(`\nArts by Jay — applying migrations to ${host}`);

  await client.connect();

  const version = (await client.query('select version()')).rows[0].version;
  console.log(`[apply] connected: ${version.split(',')[0]}`);

  if (verifyOnly) {
    await verify();
    await client.end();
    return;
  }

  // The same table the Supabase CLI uses, so the two remain interchangeable.
  await client.query('create schema if not exists supabase_migrations');
  await client.query(`
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    )
  `);

  const applied = new Set(
    (await client.query('select version from supabase_migrations.schema_migrations')).rows.map(
      (row) => row.version,
    ),
  );

  const pending = files.filter((file) => !applied.has(file.split('_')[0]));

  if (!pending.length) {
    console.log('[apply] nothing pending — every migration is already applied');
    await verify();
    await client.end();
    return;
  }

  console.log(`[apply] ${applied.size} applied, ${pending.length} pending\n`);

  if (dryRun) {
    pending.forEach((file) => console.log(`  would apply  ${file}`));
    await client.end();
    return;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const fileVersion = file.split('_')[0];

    process.stdout.write(`  applying  ${file} (${sha(sql)}) ... `);

    try {
      // One transaction per file: a failure leaves no partial schema behind.
      await client.query('begin');
      await client.query(sql);
      await client.query(
        'insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)',
        [fileVersion, file],
      );
      await client.query('commit');
      console.log('ok');
    } catch (err) {
      await client.query('rollback').catch(() => {});
      console.log('FAILED');
      console.error(`\n[apply] ${file} failed and was rolled back.\n`);
      console.error(`  ${err.message}`);
      if (err.detail) console.error(`  detail:   ${err.detail}`);
      if (err.hint) console.error(`  hint:     ${err.hint}`);
      if (err.where) console.error(`  where:    ${err.where.split('\n')[0]}`);
      if (err.position) {
        const pos = Number(err.position);
        const before = sql.slice(Math.max(0, pos - 220), pos);
        const after = sql.slice(pos, pos + 120);
        console.error(`\n  near character ${pos}:`);
        console.error(`  ...${before}>>>HERE<<<${after}...\n`);
      }
      await client.end();
      process.exit(1);
    }
  }

  await verify();
  await client.end();
  console.log('\n[apply] done\n');
};

run().catch(async (err) => {
  console.error('\n[apply] connection or unexpected failure:');
  console.error(`  ${err.message}`);
  if (/password authentication failed/i.test(err.message)) {
    console.error('\n  The password in server/.env (SUPABASE_DB_PASSWORD) was rejected.');
    console.error('  Reset it at Dashboard > Project Settings > Database.\n');
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(err.message)) {
    console.error('\n  Could not reach the host. Use the SESSION-mode pooler on port 5432:');
    console.error('  aws-0-<region>.pooler.supabase.com — the direct db.<ref> host is IPv6-only.\n');
  }
  await client.end().catch(() => {});
  process.exit(1);
});
