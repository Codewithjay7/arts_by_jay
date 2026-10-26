# Arts by Jay — setup and current status

This document says exactly what works, what is untested, and what needs an
action from you. Nothing here is described as working unless it was actually
run.

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

`supabase/migrations/` holds four migrations (227 SQL statements):

| File                              | Contents                                               |
| --------------------------------- | ------------------------------------------------------ |
| `0001_foundation.sql`             | Enums, profiles, roles, platform settings, audit log    |
| `0002_commerce.sql`               | Catalogue, cart, orders, **commission snapshot**, payments, transfers, webhook idempotency |
| `0003_rls.sql`                    | Row Level Security on all 23 tables                    |
| `0004_pricing_payouts_storage.sql`| Server-side cart pricing, payout eligibility, storage buckets |

### Honest status

- **Syntax validated** — all four parse cleanly under the real PostgreSQL
  parser (`libpg_query`).
- **Not executed, not tested.** This machine has no Docker, no Postgres and no
  Deno, so `supabase start` cannot run. Semantic errors (a mistyped column, a
  policy that is subtly too strict) would only surface on first apply.
- The frontend still talks to the Express API. **No Supabase client code is
  wired into the app yet** — that is the next decision, see §8.

### To apply them

```bash
npx supabase link --project-ref tdcdghuzasxkfdvactdz
npx supabase db push
```

You will be asked for the database password (Supabase dashboard → Settings →
Database). Apply to a branch or a throwaway project first — I have not been
able to run these, so treat the first apply as a test.

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

## 8. The open decision

You now have two backends:

- **`server/`** — Express + MongoDB. Complete, 164 tests passing, Razorpay
  wired, running now.
- **`supabase/`** — PostgreSQL schema + RLS. Written, syntax-checked, not
  applied, not connected to the frontend.

Your second prompt asks for Supabase; your first asked not to discard working
code. I have not deleted anything, and I have not rewritten the frontend's data
layer, because doing so is a one-way door worth agreeing first. See the
question at the end of my message for the options.
