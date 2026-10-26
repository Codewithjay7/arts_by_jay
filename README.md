# Arts by Jay

An art marketplace and immersive virtual gallery. Customers discover and buy
original paintings, limited prints and digital work. Artists open a storefront,
list their own work and set their own prices. Administrators moderate the
marketplace.

Prices in INR. Platform commission 10% of the artwork subtotal.

```bash
npm run install:all
npm run dev          # API on :5000, web on :5173
```

Then sign in with the credentials printed in the server console.

**Read [SETUP.md](SETUP.md) before relying on anything.** It states precisely
what is tested, what is not, and what still needs your credentials or a
Razorpay approval.

## What is here

| Area | Notes |
| ---- | ----- |
| Storefront | Home, shop with URL-driven search and filters, artwork detail, artist storefronts |
| Virtual gallery | Scroll-driven walk down a lit corridor, artwork on both walls, cinematic zoom to a piece, buy without leaving the room. Falls back to a full 2D walkthrough for reduced-motion and non-WebGL |
| Purchase | Server-priced cart, checkout, Razorpay, server-side payment verification, orders, delivery tracking, reviews by verified buyers |
| Artist dashboard | Listings with draft/review/live states, image upload, orders, earnings net of commission, enquiries, storefront settings |
| Admin | Marketplace stats, users, artist applications, artwork moderation, orders, refunds, categories, sales reports, read-only settings |
| Photo studio | Upload a photo, try four treatments in the browser, send it to an artist as a commission brief with explicit consent |

## Stack

React 18, Vite, Tailwind, React Three Fiber, TanStack Query, Zustand ·
Express, Mongoose, Zod · Razorpay · Supabase PostgreSQL schema (written, not
yet applied — see SETUP.md §5)

## Tests

```bash
cd server
npm run test:flows      # 164 API checks — needs a server on PAYMENT_PROVIDER=dev
npm run test:razorpay    # 19 checks against Razorpay test mode
```

## A note on honesty

Several features depend on credentials or provider approval that are not in
place. Wherever that is true the application says so in the interface rather
than implying the feature works: payments when no gateway is configured, email
when no SMTP is set, AI generation in the photo studio, and simulated payments
in development. Razorpay Route is **not enabled** on the account, so artist
payouts are tracked as an accounting ledger and are never shown as paid. See
SETUP.md §2.
