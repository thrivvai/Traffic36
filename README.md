# Traffic36

Car rental web app: renters browse, price and book cars; the host runs the fleet. Everything runs on Netlify.

**Status: Phase 1, milestone 2 (checkout).** Listings, quotes, sign-in, driver's license checks, date holds, Cash App and Chime payments with host confirmation, trip pages and the host console. Pickup passes, lockboxes and messaging come next. The full plan lives in the *Traffic36 Build Plan* doc.

## Stack

| Layer | Service |
|---|---|
| Site | React 19 + Vite, served by Netlify |
| API | Netlify Functions (`netlify/functions`) |
| Database | Netlify Database (managed Postgres). Migrations in `netlify/database/migrations` run on every deploy |
| Sign-in | Clerk (email or phone code, passkeys; no passwords) |
| License checks | Reviewed by the host from three photos (license front, back, selfie holding it). Stripe Identity is built and switched off; set `ID_CHECK=stripe` to use it |
| Payments | Cash App and Chime. Renters upload a screenshot; the host confirms the money arrived |
| Files | Netlify Blobs (payment screenshots, private) |
| Coming next | Seam lockboxes, Twilio, Resend email, card payments on a Traffic36 Stripe account |

## Layout

```
shared/        Business rules (policy.ts), pricing and time-zone math. Used by the browser and the server.
server/        Data access and rules: listings, availability, quotes, bookings, license checks, auth.
               server/api.ts holds the signed-in handlers; tests drive them with fake Clerk, Stripe and Blobs.
netlify/
  functions/   API routes. Public: vehicles, quotes, locations. Signed in: /api/me, /api/identity/start,
               /api/bookings, /api/bookings/:code (+ /cancel, /proofs), /api/host. Stripe: /api/webhooks/stripe
  database/migrations/   Schema and seed data. Never edit a migration after it has deployed.
src/           The React app.
public/cars/   Launch car photos.
tests/         Pricing tests, plus database tests that run the real migrations on a local Postgres.
```

## Run it locally

Requires Node 20.12 or newer.

```bash
npm install
npm run db:migrate   # applies migrations to the local database in .netlify/db
npm run dev          # site, functions and database at http://localhost:5173
npm test
```

## Settings

Every setting is listed in `.env.example`. In Netlify, add them under **Project configuration > Environment variables**; mark keys as secret and scope them to Functions.

| Setting | What it's for |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Sign-in screens (public) |
| `CLERK_SECRET_KEY` | Checking who's signed in |
| `ID_CHECK` | Leave unset for hand-reviewed licenses; `stripe` switches to Stripe Identity |
| `STRIPE_SECRET_KEY` | Only with `ID_CHECK=stripe`: a **restricted** key (see `.env.example` for its permissions) |
| `STRIPE_WEBHOOK_SECRET` | Only with `ID_CHECK=stripe`: verifies Stripe's webhooks |
| `CASHAPP_CASHTAG`, `CHIME_PHONE` | Where renters pay. Kept out of the code on purpose |
| `HOST_EMAILS` | Who gets the host console |

## How checkout works

1. The renter signs in, sends their driver's license (three photos plus the details printed on it), and accepts the rental agreement. They can book while the license waits for review; age and expiry rules run on the typed details.
2. The dates are held for 30 minutes (`awaiting_payment`) while they pay by Cash App or Chime.
3. They upload a screenshot (`payment_review`). The dates stay blocked until the host decides.
4. The host approves the license (correcting any typo against the photos), checks the money actually arrived, then confirms (`confirmed`) or sends it back with a note and a fresh hold. A booking can't be confirmed until the license is approved, and the rules run again on the approved details.
5. After the trip, the host returns the deposit and the booking closes.

A screenshot never confirms a booking on its own. Age, license expiry, availability and price are all checked on the server.

## Deploy

Connect this repository in Netlify (**Add new project > Import an existing project > GitHub**). Netlify reads `netlify.toml`, builds, provisions the database and applies migrations before publishing. Netlify Database requires a credit-based Netlify plan.

The site sends `X-Robots-Tag: noindex` until launch. Remove that header block in `netlify.toml` when you go live.

## Placeholders to replace before launch

Every value that needs a real answer is marked in code:

- `shared/policy.ts`: `CONFIRM` (needs Roamly or a vendor) and `DECISION` (needs your call), for example the turnaround buffer and booking window.
- Park addresses and opening hours (`lots.address`, `opens_at`, `closes_at`), set in a new migration. Until a location has hours, the app offers the standard 7:00 AM to 9:00 PM window.
- Minimum driver ages per car wait on Roamly.
- The rental agreement (`src/pages/AgreementPage.tsx`) is a draft for a lawyer to review. Bump `POLICY.agreementVersion` when it changes.
- Emails queue in the `outbox` table until an email provider (Resend) is connected.
- License photos are kept indefinitely for now. DECISION: how long to keep them after a renter's last trip, then add a cleanup job.
