/**
 * Validates every PostgREST select in the data layer against the LIVE schema.
 *
 * Why this exists: three separate "That did not load" failures reached the
 * deployed site because a query named a column or an embed that the database
 * does not have — `artist_profiles.stats`, a duplicated artist embed, and so
 * on. Each one only showed up when a human opened the page, because a select
 * string is just text until PostgREST parses it. Nothing in the build or the
 * test suite looked at it.
 *
 * This reads the real column list out of the real database, expands the
 * shared column constants the same way the bundler does, and reports every
 * name that cannot resolve. It touches no data and writes nothing.
 *
 *   node supabase/audit-selects.mjs
 *
 * Exits non-zero when anything is unresolvable, so it can gate a deploy.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

dotenv.config({ path: path.join(root, 'server', '.env') });

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT) || 5432,
  user: process.env.SUPABASE_DB_USER,
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

/* ───────────────────────── Live schema ───────────────────────── */

const loadSchema = async () => {
  // Columns of every table and view in the public schema.
  const cols = await client.query(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position
  `);

  const columns = new Map();
  for (const row of cols.rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
    columns.get(row.table_name).add(row.column_name);
  }

  // Foreign keys, so an embed can be checked for a real relationship.
  const fks = await client.query(`
    select
      src.relname  as src_table,
      tgt.relname  as tgt_table
    from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_class tgt on tgt.oid = c.confrelid
    join pg_namespace n on n.oid = src.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
  `);

  const related = new Map();
  const link = (a, b) => {
    if (!related.has(a)) related.set(a, new Set());
    related.get(a).add(b);
  };
  for (const row of fks.rows) {
    // An embed works in either direction in PostgREST.
    link(row.src_table, row.tgt_table);
    link(row.tgt_table, row.src_table);
  }

  return { columns, related };
};

/* ───────────────────────── Select parsing ───────────────────────── */

/**
 * Splits one level of a select list, respecting nested parentheses.
 * "a, b:t ( c, d ), e" -> ["a", "b:t ( c, d )", "e"]
 */
const splitTop = (text) => {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
};

/**
 * Walks a select list against one table, collecting problems.
 * Recurses into each embed using the embedded relation as the new table.
 */
const walk = (selectText, table, schema, problems, where) => {
  const known = schema.columns.get(table);
  if (!known) {
    problems.push(`${where}: unknown table or view "${table}"`);
    return;
  }

  const seenEmbeds = new Set();

  for (const part of splitTop(selectText)) {
    // An embed may carry modifiers: `profiles!artist_profiles_user_id_fkey`
    // names which foreign key to follow when several could apply, and
    // `orders!inner` forces an inner join. Both belong to the relation token,
    // so a regex that stops at a word boundary reads the whole thing as a
    // column name and reports it as missing.
    const embed = part.match(/^(?:(\w+)\s*:\s*)?(\w+)((?:!\w+)*)\s*\(([\s\S]*)\)$/);

    if (embed) {
      const [, alias, relation, modifiers, inner] = embed;

      // PostgREST names the join after the relation, so two embeds of the
      // same relation in one select collide regardless of their aliases:
      //   table name "artworks_artist_1" specified more than once
      if (seenEmbeds.has(relation)) {
        problems.push(`${where}: relation "${relation}" embedded more than once in one select on ${table}`);
      }
      seenEmbeds.add(relation);

      if (!schema.columns.has(relation)) {
        problems.push(`${where}: embeds "${relation}", which is not a table or view`);
        continue;
      }
      // An explicit !constraint hint names the relationship outright, so only
      // an unhinted embed needs one to be inferable from a foreign key.
      const hinted = Boolean(modifiers.replace(/!inner/g, ''));
      if (!hinted && !(schema.related.get(table) ?? new Set()).has(relation)) {
        problems.push(`${where}: embeds ${table} -> "${relation}" with no foreign key between them`);
      }

      walk(inner, relation, schema, problems, `${where} > ${alias ?? relation}`);
      continue;
    }

    // A plain column, possibly "alias:column" or with a ::cast.
    const name = part.replace(/::\w+$/, '').split(':').pop().trim();
    if (name === '*' || name === '') continue;
    // count() and other aggregates are not columns.
    if (/^\w+\(\)$/.test(name)) continue;

    if (!known.has(name)) {
      problems.push(`${where}: column "${table}.${name}" does not exist`);
    }
  }
};

/* ───────────────────────── Source scanning ───────────────────────── */

const expandConstants = (text, consts, depth = 0) => {
  if (depth > 8) return text;
  return text.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, name) =>
    expandConstants(consts[name] ?? '', consts, depth + 1),
  );
};

const scanFile = (file, schema, problems) => {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replace(/\\/g, '/');

  // Shared column constants, e.g. const CARD_COLUMNS = `...`;
  const consts = {};
  for (const m of src.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*[`'"]([\s\S]*?)[`'"]\s*;/g)) {
    consts[m[1]] = m[2];
  }

  // Pair each `.select(...)` with the NEAREST PRECEDING `.from('table')`.
  //
  // Scanning forward from each from() to the next select() looks equivalent
  // and is not: when a from() has no select of its own, or its select sits
  // past the scan window, it claims the NEXT from()'s select instead — and
  // then every column of the wrong table is reported missing. Searching
  // backwards cannot mis-pair that way, because the from() a select belongs
  // to is always the closest one behind it.
  const froms = [...src.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)/g)];

  for (const sel of src.matchAll(/\.select\(\s*([`'"])([\s\S]*?)\1/g)) {
    let owner = null;
    for (const f of froms) {
      if (f.index < sel.index) owner = f;
      else break;
    }
    if (!owner) continue;

    const table = owner[1];
    const line = src.slice(0, sel.index).split('\n').length;
    const text = expandConstants(sel[2], consts);

    // A select built from a runtime variable cannot be checked statically.
    if (/\$\{/.test(text)) continue;

    walk(text, table, schema, problems, `${rel}:${line} (${table})`);
  }
};

/* ───────────────────────── Run ───────────────────────── */

const run = async () => {
  await client.connect();
  const schema = await loadSchema();
  console.log(
    `[audit] live schema: ${schema.columns.size} tables/views, ` +
      `${[...schema.columns.values()].reduce((n, s) => n + s.size, 0)} columns\n`,
  );

  const dirs = [
    path.join(root, 'client', 'src', 'lib', 'data'),
    path.join(root, 'client', 'src', 'lib'),
  ];

  const files = new Set();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith('.js') || entry.endsWith('.jsx')) files.add(path.join(dir, entry));
    }
  }

  const problems = [];
  for (const file of [...files].sort()) scanFile(file, schema, problems);

  await client.end();

  if (!problems.length) {
    console.log('  OK: every select resolves against the live schema\n');
    process.exit(0);
  }

  console.log(`  ${problems.length} problem(s):\n`);
  for (const p of problems) console.log(`    ${p}`);
  console.log('');
  process.exit(1);
};

run().catch(async (err) => {
  console.error('[audit] failed:', err.message);
  await client.end().catch(() => {});
  process.exit(1);
});
