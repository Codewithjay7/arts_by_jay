# Arts by Jay — setup and current status

This document says exactly what works, what is untested, and what needs an
action from you. Nothing here is described as working unless it was actually
run.

---

## 0. Target architecture — nothing self-hosted

No database, server process or file storage on your own machines:

```
Netlify  ──  the React site (static files only, no server)
   │
   ├─ Supabase PostgreSQL   all data
   ├─ Supabase Auth         accounts and sessions
   ├─ Supabase Storage      every artwork and avatar image
   ├─ Supabase Edge Fns     checkout, payment verification, webhooks
   └─ Razorpay              payments
```

`server/` (Express + MongoDB) and `server/uploads/` are the **old** path. They
still run today because the Supabase path is not yet verified, and they are
retired the moment it is. Nothing in the target architecture needs anything
from your company.

### Once you have the Supabase keys, the whole setup is five commands

```bash
npm run db:link                  # links to project tdcdghuzasxkfdvactdz
npm run db:push                  # applies migrations 0001 → 0006
npm run functions:deploy         # deploys the three Edge Functions

SUPABASE_URL=https://tdcdghuzasxkfdvactdz.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
npm run seed:supabase            # categories, artists, artwork + images to Storage

npm --prefix client run build    # then deploy client/dist to Netlify
```

The seed generates artwork images in memory and uploads them straight to
Supabase Storage — nothing is written to local disk. It is re-runnable, and it
**refuses to reset** if any seeded account has a real order attached, because
deleting a paid order would destroy a financial record.

---

## 1. What is running today

A complete, working art marketplace: React 18 + Vite frontend, Express +
MongoDB API, Razorpay payments.

```
C:\Arts_By_Jay
├── client/            React 18 + Vite + Tailwind frontend
├── server/            Express + Mongoose API
├── supabase/          Supabase migrations (NOT yet applied — see §5)
└── SETUP.md
```

### Run it

```bash
npm run install:all     # once
npm run dev             # API on :5000, web on :5173
```

On first boot with `USE_MEMORY_DB=true` the server downloads a MongoDB binary
(~600 MB, once), starts an in-memory database and seeds it. Sign-in details are
printed to the console:

| Role     | Email                  | Password        |
| -------- | ---------------------- | --------------- |
| Admin    | `admin@artsbyjay.test` | `ArtsByJay2025` |
| Artist   | `jay@artsbyjay.test`   | `ArtsByJay2025` |
| Customer | `priya@collector.test` | `ArtsByJay2025` |

> **In-memory means in-memory.** Every account, listing and order is discarded
> when the server stops. Point `MONGODB_URI` at a real MongoDB and set
> `USE_MEMORY_DB=false` before relying on any of it.

### Test it

```bash
cd server
npm run test:flows      # 164 checks against a running API
npm run test:razorpay   # 19 checks against Razorpay test mode
```

Both suites pass. `test:flows` needs a server started with
`PAYMENT_PROVIDER=dev`, because completing a real card payment needs a browser:

```bash
PORT=5050 PAYMENT_PROVIDER=dev USE_MEMORY_DB=true node src/index.js
TEST_BASE_URL=http://localhost:5050 npm run test:flows
```

---

## 2. Razorpay Route: the answer, from your account

Your prompt asked me to verify Route eligibility rather than assume it. I asked
Razorpay directly with your test key:

```
POST https://api.razorpay.com/v2/accounts
→ 400  "Route feature not enabled for the merchant"
```

**Route is not enabled on your account.** Re-check at any time with
`npm run test:razorpay`.

### What that means

| Capability                               | Status                                  |
| ---------------------------------------- | --------------------------------------- |
| Take customer payments                   | **Works** — verified in test mode       |
| Verify payments server-side              | **Works** — verified, forgeries rejected |
| Split a payment to artists automatically | **Blocked** — needs Route               |
| Linked accounts for artists              | **Blocked** — needs Route               |
| Hold settlement until delivery           | **Blocked** — needs Route               |

### Why this matters for delivery-confirmed payouts

Your prompt was right to flag it. Without Route, **all customer money settles
into your single Razorpay account.** Paying artists then means you making bank
transfers out of your own balance.

I have therefore built the payout lifecycle as **an accounting ledger, not an
escrow**: it records when an artist has *earned* their share and refuses to
call it paid. It never claims a database row moved money. That is the honest
version of the rule you asked for, and it becomes real automatically once Route
is approved.

### To unblock it

Razorpay's published Route eligibility (verify current terms with them):

- Domestic turnover above ₹40 lakh, or export turnover above ₹5 lakh, in FY26
  or FY25.
- A payer–payee transparency declaration describing your marketplace use case.

Apply via your Razorpay dashboard or account manager. When approved, set
`RAZORPAY_ROUTE_ENABLED=true` and re-run `npm run test:razorpay` to confirm
before trusting it.

**Interim option:** keep selling, accrue artist earnings in the ledger, and
settle artists by manual bank transfer, recording each one against
`transfers.out_of_band` with a reference. Artists see "eligible", never "paid",
until that is recorded.

---

## 3. Commission — 10%, snapshotted

Set to 10% and verified by test:

```
Artwork subtotal   ₹2,000.00   (200000 paise)
Platform (10%)       ₹200.00   ( 20000 paise)
Artist gross       ₹1,800.00   (180000 paise)
```

- Applied to the **artwork line total only** — never to shipping. Tested.
- All money is **integer paise** (`bigint` / JS integers). No floats anywhere.
- Every order item stores `commissionRatePercent` and `commissionBasisMinor`
  as an **immutable snapshot**. Changing the platform rate later cannot rewrite
  a past sale. In Postgres this is enforced by a trigger that raises on any
  attempt to alter it, *including by the service role*.
- Change the rate for future orders via `PLATFORM_COMMISSION_PERCENT` (Express)
  or the `platform_settings` table (Supabase).

---

## 4. Order and settlement lifecycle

```
pending_payment → paid → processing → shipped → delivered
                                           → eligible_for_settlement → settled
        ↘ cancelled   ↘ refunded   ↘ disputed
```

An artist's share becomes `eligible` only when **all** of these hold:

1. Delivery is confirmed, with a recorded source (`carrier` / `admin` /
   `customer`) and an evidence reference.
2. The return window has closed (`RETURN_WINDOW_DAYS`, default 7).
3. No dispute is open on the line.
4. Nothing has been refunded on it.
5. The payment is `captured` **and** `verified_at` is set.

Artists cannot write any settlement, delivery or dispute field — blocked by
RLS plus a trigger in Postgres, and by server-side checks in Express. They can
only move their own line along `awaiting → preparing → shipped → delivered`.

---

## 5. Supabase — written, **not applied**

### Migrations — `supabase/migrations/` (242 SQL statements)

| File                               | Contents                                               |
| ---------------------------------- | ------------------------------------------------------ |
| `0001_foundation.sql`              | Enums, profiles, roles, platform settings, audit log    |
| `0002_commerce.sql`                | Catalogue, cart, orders, **commission snapshot**, payments, transfers, webhook idempotency |
| `0003_rls.sql`                     | Row Level Security on all 23 tables                    |
| `0004_pricing_payouts_storage.sql` | Server-side cart pricing, payout eligibility, storage buckets |
| `0005_settlement_functions.sql`    | Atomic settlement, refunds with proportional commission reversal, disputes, payout recording |

### Edge Functions — `supabase/functions/`

| Function           | JWT  | Job                                                       |
| ------------------ | ---- | --------------------------------------------------------- |
| `create-order`     | yes  | Prices the cart **in the database**, creates the order and the Razorpay order. The request carries an address and a shipping choice — no amounts. |
| `verify-payment`   | yes  | Verifies Razorpay's HMAC, then asks Razorpay directly, then cross-checks amount, currency and order id before settling. |
| `razorpay-webhook` | **no** | The authoritative path. Verifies the signature over the raw bytes, de-duplicates by event id, settles or records a refund. JWT off because Razorpay carries no session; the HMAC is the authentication. |

Money-moving SQL functions are `REVOKE`d from `anon` and `authenticated`
entirely, so there is no path from a browser to settlement, refunds or
payouts — only service-role code inside an Edge Function can reach them.

### Honest status

- **Migrations: syntax validated.** All five parse cleanly under the real
  PostgreSQL parser (`libpg_query`).
- **Edge Functions: syntax validated.** All five TypeScript files transpile
  cleanly under esbuild.
- **Nothing has been executed.** This machine has no Docker, no Postgres and
  no Deno, so `supabase start` cannot run. Semantic errors — a mistyped
  column, a policy that is subtly too strict, an RPC signature that does not
  match its caller — would only surface on first apply. **Treat the first
  apply as a test, on a branch or a throwaway project.**
- **The frontend still talks to the Express API.** No Supabase client code is
  wired into the app yet. See §8.

### To apply

```bash
npx supabase link --project-ref tdcdghuzasxkfdvactdz
npx supabase db push                       # applies 0001 → 0005

# Edge Function secrets — these never go in client code or Git
npx supabase secrets set \
  RAZORPAY_KEY_ID=rzp_test_TsPMzji5nqQ09l \
  RAZORPAY_KEY_SECRET=<your test secret> \
  RAZORPAY_WEBHOOK_SECRET=<from the dashboard, see §6> \
  SITE_URL=http://localhost:5173

npx supabase functions deploy create-order
npx supabase functions deploy verify-payment
npx supabase functions deploy razorpay-webhook --no-verify-jwt
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected into Edge Functions automatically; you do not set those yourself.

### After applying, seed an admin

1. Set the bootstrap email:
   `update platform_settings set value = 'you@example.com' where key = 'admin_bootstrap_email';`
2. Sign up with that email. The `handle_new_user` trigger grants the admin
   role to the first such account and to no one else.
3. Insert categories — artists cannot list work without at least one.

### Credentials I still need

| Value                       | Where to find it                              | Goes where                     |
| --------------------------- | --------------------------------------------- | ------------------------------ |
| Project URL                 | already known: `https://tdcdghuzasxkfdvactdz.supabase.co` | `client/.env`       |
| `anon` / publishable key    | Settings → API                                | `client/.env` (public, safe)   |
| `service_role` key          | Settings → API                                | **Edge Function secrets only** |
| Database password           | Settings → Database                           | used by the CLI, stored nowhere |

The `service_role` key bypasses RLS entirely. It must never appear in
`client/`, in Git, or in chat.

---

## 6. Razorpay dashboard: one thing outstanding

Payments work. **Webhooks do not yet**, because there is no webhook secret.

1. Razorpay dashboard → Settings → Webhooks → Add New Webhook.
2. URL: your API's `/api/payments/webhook/razorpay` (Express), or the
   `razorpay-webhook` Edge Function URL once on Supabase. It must be publicly
   reachable — use a tunnel for local testing.
3. Events: `payment.captured`, `payment.failed`, `refund.processed`.
4. Copy the generated secret into `RAZORPAY_WEBHOOK_SECRET` in `server/.env`.
5. Re-run `npm run test:razorpay`: the webhook section will stop skipping and
   will verify that a correctly signed delivery is accepted and a forged or
   tampered one is rejected.

Until then the webhook endpoint **rejects every delivery, including genuine
ones** — which is the correct failure mode, but it means the authoritative
settlement path is not active. Client-side confirmation still verifies the
signature server-side, so payments are safe; webhooks are the belt to that
braces.

### Rotate the keys you pasted

You sent a test Key Secret in chat. Test keys cannot move real money, but
rotate them in the dashboard when convenient. They are in `server/.env`, which
is gitignored — verified with `git check-ignore`.

---

## 7. What is tested, and what is not

### Verified by automated test

- 164 API checks: registration, login, refresh rotation, role gates, artwork
  CRUD with cross-artist ownership denial, cart maths, checkout validation,
  idempotent checkout, **forged payment signature rejected**, order settlement,
  stock deduction only after verified payment, fulfilment transitions,
  reviews limited to delivered buyers, moderation, refunds, commission
  accounting, error handling.
- 19 Razorpay checks against live test mode: real order creation, genuine HMAC
  accepted, tampered signature / swapped payment id / swapped order id all
  rejected, Route eligibility probed.
- `npm run build` succeeds; ESLint clean.

### NOT tested

- **A completed card payment.** Needs a browser and Razorpay's hosted
  checkout. The order-creation and verification halves are tested; the middle
  is manual.
- **Webhooks**, pending the secret above.
- **Every Supabase migration, RLS policy and SQL function.** Syntax-checked
  only. See §5.
- **Stripe.** The server adapter and browser Payment Element are written but
  were never run — no Stripe keys. Razorpay is the configured provider.
- **Route transfers, linked accounts, settlement holds.** Cannot be tested;
  the feature is disabled on the account.
- **Email.** No SMTP is configured, so nothing is sent. The app says so rather
  than implying a receipt was emailed.
- **AI image generation** in the photo studio. Not configured, so the four
  treatments are browser-side CSS previews and the UI states that plainly.

---

## 8. Migration to Supabase — in progress

You chose a full migration to Supabase. Express stays in the tree until the
Supabase path is verified working, then it is retired. Nothing is deleted
before its replacement is proven.

### Done

- Schema, RLS, pricing and settlement functions (§5) — syntax validated
- The three money-critical Edge Functions (§5) — syntax validated

### Blocked on credentials

| Needed                | Why                                        |
| --------------------- | ------------------------------------------ |
| Database password     | to run `supabase db push` and verify the schema actually applies |
| `anon` key            | the frontend cannot talk to Supabase at all without it |
| `service_role` key    | only as an Edge Function secret, never in `client/` |

Until the schema is applied and confirmed, rewriting the frontend's data layer
would be writing a large amount of code against an unverified schema. The
sensible order is: apply → verify → then port the frontend.

### Remaining work, in order

1. Apply the migrations; fix whatever the first real apply reveals.
2. Seed categories and an admin account (§5).
3. Deploy the Edge Functions; add the webhook secret (§6).
4. Add a Supabase client and port auth (`client/src/store/auth.js`) from JWT
   to `supabase.auth`.
5. Port reads to `supabase-js` queries, page by page, leaning on RLS instead
   of the Express route guards.
6. Port writes: cart, wishlist, addresses, artwork CRUD, enquiries.
7. Point checkout at `create-order` / `verify-payment`.
8. Port the artist onboarding and payout screens.
9. Re-run the equivalent of `test:flows` against Supabase, then retire
   `server/`.

Steps 4–8 are mechanical once step 1 succeeds. Step 1 is the risk.
