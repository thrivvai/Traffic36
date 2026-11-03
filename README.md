# Traffic36

Car rental web app: renters browse, price and book cars; the host runs the fleet. Everything runs on Netlify.

**Status: Phase 1, milestone 1 (foundation).** Live listings, car pages and server-priced quotes with real availability. Sign-in, booking and payment come next. The full plan lives in the *Traffic36 Build Plan* doc.

## Stack

| Layer | Service |
|---|---|
| Site | React 19 + Vite, served by Netlify |
| API | Netlify Functions (`netlify/functions`) |
| Database | Netlify Database (managed Postgres). Migrations in `netlify/database/migrations` run on every deploy |
| Coming next | Clerk sign-in, Stripe payments and Identity, Netlify Blobs for photos, Seam lockboxes, Twilio, Resend |

## Layout

```
shared/        Business rules (policy.ts), pricing and time-zone math. Used by the browser and the server.
server/        Data access: listings, availability, quotes, HTTP helpers.
netlify/
  functions/   API routes: /api/vehicles, /api/vehicles/:slug, /api/vehicles/:slug/quote
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

## Deploy

Connect this repository in Netlify (**Add new project > Import an existing project > GitHub**). Netlify reads `netlify.toml`, builds, provisions the database and applies migrations before publishing. Netlify Database requires a credit-based Netlify plan.

The site sends `X-Robots-Tag: noindex` until launch. Remove that header block in `netlify.toml` when you go live.

## Placeholders to replace before launch

Every value that needs a real answer is marked in code:

- `shared/policy.ts`: `CONFIRM` (needs Roamly or a vendor) and `DECISION` (needs your call), for example the turnaround buffer and booking window.
- `netlify/database/migrations/20261103050100_seed_launch_fleet.sql`: the two pickup lots are the mock's samples. Minimum driver ages wait on Roamly.
