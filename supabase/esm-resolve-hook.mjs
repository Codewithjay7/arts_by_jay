/**
 * A Node module-resolution hook that understands Vite's import style.
 *
 * The client imports relatively and without extensions — `from '../supabase'`
 * — which Vite resolves and plain Node does not. Rather than append `.js` to
 * every import across the data layer purely so a test can load it, this
 * teaches the test runner the same resolution rule.
 *
 * The direction of that choice is deliberate: the application code stays
 * exactly as the browser build sees it, so what the audit exercises is the
 * real thing and not a port of it.
 *
 * Used as:
 *   node --import ./supabase/esm-resolve-hook.mjs supabase/audit-pages.mjs
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./esm-resolve-hook-impl.mjs', pathToFileURL(import.meta.filename));
