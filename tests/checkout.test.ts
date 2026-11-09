/**
 * Checkout end to end through the real handlers and the real migrations, with Clerk, Stripe
 * and Blobs replaced by fakes: sign-in, license check, holding dates, payment screenshots,
 * and the host's confirm, reject and deposit steps.
 */
import { NetlifyDB } from "@netlify/database-dev";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import * as api from "../server/api.ts";
import type { AuthProvider, ClerkProfile } from "../server/auth.ts";
import { cashAppLink, namesMatch } from "../server/bookings.ts";
import { wrapPool, type TxDb } from "../server/db.ts";
import type { IdentityProvider, IdentityResult } from "../server/identity.ts";
import { sniffImage, type ProofStore } from "../server/proofs.ts";
import type { Services } from "../server/services.ts";
import { MINUTE, POLICY } from "../shared/policy.ts";
import type { Booking, HostArchive, HostBookingDetail, HostDashboard, Me, RenterProfile, RenterSummary } from "../shared/types.ts";

const GLC = "mercedes-glc-300-coupe-2021"; // drivers 25+
const ELANTRA = "hyundai-elantra-sel-sport-2026"; // drivers 21+
const HOST_EMAIL = "host@traffic36.com";

let server: NetlifyDB;
let pool: pg.Pool;
let db: TxDb;

beforeAll(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  await server.applyMigrations("./netlify/database/migrations");
  pool = new pg.Pool({ connectionString, max: 2 });
  db = wrapPool(pool);
});

afterAll(async () => {
  await pool?.end();
  await server?.stop();
});

// ---- fakes ---------------------------------------------------------------------------------

const profiles = new Map<string, ClerkProfile>();
const auth: AuthProvider = {
  async verify(req) {
    const token = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
    return token.startsWith("token-") ? { ok: true, userId: token.slice(6), profile: null } : { ok: false, reason: "no-token" };
  },
  async profile(id) {
    return profiles.get(id) ?? { email: null, phone: null, name: "" };
  },
};

let sessionCount = 0;
const outcomes = new Map<string, IdentityResult>();
const created: { userId: string; returnUrl: string; idempotencyKey: string }[] = [];
const identity: IdentityProvider = {
  async create(opts) {
    created.push(opts);
    const id = `vs_${++sessionCount}`;
    outcomes.set(id, { status: "requires_input", url: `https://verify.stripe.test/${id}`, reason: null });
    return { id, url: `https://verify.stripe.test/${id}` };
  },
  async retrieve(id) {
    return outcomes.get(id) ?? { status: "canceled" };
  },
  async webhookSession(body, signature) {
    if (signature !== "valid") throw new Error("bad signature");
    return (JSON.parse(body) as { session: string }).session;
  },
};

const blobs = new Map<string, { data: ArrayBuffer; contentType: string }>();
const store: ProofStore = {
  async put(key, data, contentType) {
    blobs.set(key, { data, contentType });
  },
  async get(key) {
    return blobs.get(key) ?? null;
  },
};

const idBlobs = new Map<string, { data: ArrayBuffer; contentType: string }>();
const idStore: ProofStore = {
  async put(key, data, contentType) {
    idBlobs.set(key, { data, contentType });
  },
  async get(key) {
    return idBlobs.get(key) ?? null;
  },
};

const CODE_KEY = Buffer.alloc(32, 7);

let clock = new Date("2026-11-03T15:00:00Z"); // Tue Nov 3, 10:00 AM in Atlanta
let idCheck: "manual" | "stripe" = "stripe";
const services = (): Services => ({
  db,
  auth,
  identity,
  proofs: store,
  idDocuments: idStore,
  idCheck,
  payments: { cashtag: "$traffic36test", chimePhone: "470-555-0100" },
  codeKey: CODE_KEY,
  hostEmails: [HOST_EMAIL],
  now: () => clock,
});

// ---- helpers -------------------------------------------------------------------------------

type Handler = (req: Request, ctx?: { params?: Record<string, string>; ip?: string }) => Promise<Response>;

async function call<T = Record<string, unknown>>(
  make: (get: () => Services) => Handler,
  opts: { method?: string; path: string; as?: string; body?: unknown; form?: FormData; params?: Record<string, string> },
): Promise<{ status: number; body: T & { error?: string; field?: string } }> {
  const headers = new Headers();
  if (opts.as) headers.set("authorization", `Bearer token-${opts.as}`);
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set("content-type", "application/json");
  }
  const req = new Request(`http://localhost:5173${opts.path}`, { method: opts.method ?? "GET", headers, body });
  const res = await make(services)(req, { params: opts.params ?? {}, ip: "203.0.113.5" });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, body: (type.includes("json") ? await res.json() : { bytes: (await res.arrayBuffer()).byteLength, type }) as T & { error?: string } };
}

const me = (as: string, sync = false) => call<{ me: Me; paymentMethods: string[] }>(api.meHandler, { path: `/api/me${sync ? "?sync=1" : ""}`, as });

function signUp(clerkId: string, name: string, email: string) {
  profiles.set(clerkId, { email, phone: "+14705550123", name });
  return me(clerkId, true);
}

/** Runs a renter through a passing license check. */
async function verify(clerkId: string, dob: string, opts: { expiresOn?: string; name?: [string, string] } = {}) {
  const start = await call<{ url: string }>(api.identityStartHandler, { method: "POST", path: "/api/identity/start", as: clerkId, body: { returnPath: "/checkout" } });
  const sessionId = start.body.url.split("/").pop()!;
  outcomes.set(sessionId, {
    status: "verified",
    firstName: opts.name?.[0] ?? "Jordan",
    lastName: opts.name?.[1] ?? "Ellis",
    dob,
    expiresOn: opts.expiresOn ?? "2030-01-31",
    state: "GA",
    last4: "4821",
  });
  return me(clerkId);
}

const trip = { startDate: "2026-11-06", startTime: "10:00", endDate: "2026-11-09", endTime: "10:00", pickup: "norman-berry", returnTo: "norman-berry" };

const createBooking = (as: string, slug: string, extra: Record<string, unknown> = {}) =>
  call<{ code: string }>(api.bookingsHandler, {
    method: "POST",
    path: "/api/bookings",
    as,
    body: { slug, ...trip, agreementVersion: POLICY.agreementVersion, ...extra },
  });

const getBooking = (as: string, code: string) =>
  call<{ booking: Booking }>(api.bookingHandler, { path: `/api/bookings/${code}`, as, params: { code } });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

function upload(as: string, code: string, opts: { method?: string; sender?: string; bytes?: Uint8Array } = {}) {
  const form = new FormData();
  form.set("method", opts.method ?? "cash_app");
  form.set("senderName", opts.sender ?? "Jordan Ellis");
  form.set("file", new Blob([(opts.bytes ?? PNG) as Uint8Array<ArrayBuffer>], { type: "image/png" }), "payment.png");
  return call<{ booking: Booking }>(api.proofUploadHandler, { method: "POST", path: `/api/bookings/${code}/proofs`, as, form, params: { code } });
}

const dashboard = (as = "host") => call<{ dashboard: HostDashboard }>(api.hostDashboardHandler, { path: "/api/host", as });
const hostAction = (code: string, action: string, body: unknown = {}, as = "host") =>
  call<{ dashboard: HostDashboard }>(api.hostActionHandler, { method: "POST", path: `/api/host/bookings/${code}/${action}`, as, body, params: { code, action } });

beforeEach(async () => {
  for (const table of ["audit_log", "outbox", "payments", "payment_proofs", "identity_documents", "identity_submissions", "extensions", "bookings", "blocks"]) {
    await db.query(`DELETE FROM ${table}`);
  }
  await db.query(`UPDATE users SET identity_reviewed_by = NULL, archived_by = NULL`);
  for (const table of ["users"]) {
    await db.query(`DELETE FROM ${table}`);
  }
  profiles.clear();
  outcomes.clear();
  blobs.clear();
  idBlobs.clear();
  idCheck = "stripe";
  created.length = 0;
  clock = new Date("2026-11-03T15:00:00Z");
  await signUp("host", "Xavier Smith", HOST_EMAIL);
});

// ---- tests ---------------------------------------------------------------------------------

describe("sign-in and profile", () => {
  test("signed-out calls are refused", async () => {
    const res = await call(api.meHandler, { path: "/api/me" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Sign in to continue.");
  });

  test("first call creates the renter; HOST_EMAILS decides who is host", async () => {
    const renter = await signUp("jordan", "Jordan Ellis", "jordan@example.com");
    expect(renter.status).toBe(200);
    expect(renter.body.me).toMatchObject({ name: "Jordan Ellis", role: "renter", identity: { status: "none", attemptsLeft: 5 } });
    expect(renter.body.paymentMethods).toEqual(["cash_app", "chime"]);
    expect((await me("host")).body.me.role).toBe("host");
  });

  test("a renter can't open the host console", async () => {
    await signUp("jordan", "Jordan Ellis", "jordan@example.com");
    expect((await dashboard("jordan")).status).toBe(403);
  });
});

describe("license check", () => {
  beforeEach(() => signUp("jordan", "Jordan Ellis", "jordan@example.com"));

  test("sends the renter to Stripe and comes back to this site only", async () => {
    const bad = await call(api.identityStartHandler, { method: "POST", path: "/api/identity/start", as: "jordan", body: { returnPath: "//evil.example" } });
    expect(bad.status).toBe(400);
    const res = await call<{ url: string }>(api.identityStartHandler, { method: "POST", path: "/api/identity/start", as: "jordan", body: { returnPath: "/checkout/x?a=1" } });
    expect(res.body.url).toMatch(/^https:\/\/verify\.stripe\.test\/vs_/);
    expect(created.at(-1)?.returnUrl).toBe("http://localhost:5173/checkout/x?a=1");
    expect((await me("jordan")).body.me.identity.status).toBe("pending");
  });

  test("an unfinished check is reused, not paid for twice", async () => {
    const a = await call<{ url: string }>(api.identityStartHandler, { method: "POST", path: "/api/identity/start", as: "jordan", body: {} });
    const b = await call<{ url: string }>(api.identityStartHandler, { method: "POST", path: "/api/identity/start", as: "jordan", body: {} });
    expect(b.body.url).toBe(a.body.url);
    expect(created).toHaveLength(1);
  });

  test("a verified license shows its state and last four, never the birth date", async () => {
    const res = await verify("jordan", "1996-05-01");
    expect(res.body.me.identity).toMatchObject({ status: "verified", licenseState: "GA", licenseLast4: "4821", licenseExpiresOn: "2030-01-31" });
    expect(JSON.stringify(res.body)).not.toContain("1996");
  });

  test("an expired license fails with a clear reason", async () => {
    const res = await verify("jordan", "1996-05-01", { expiresOn: "2026-10-01" });
    expect(res.body.me.identity.status).toBe("failed");
    expect(res.body.me.identity.failureReason).toBe("That license has expired. Verify a current driver's license.");
  });

  test("a failed attempt shows Stripe's reason, and trying again reuses the same check", async () => {
    const start = await call<{ url: string }>(api.identityStartHandler, { method: "POST", path: "/api/identity/start", as: "jordan", body: {} });
    const session = start.body.url.split("/").pop()!;
    outcomes.set(session, { status: "requires_input", url: start.body.url, reason: "The photo was too blurry to read." });
    const res = await me("jordan");
    expect(res.body.me.identity).toMatchObject({ status: "failed", failureReason: "The photo was too blurry to read.", attemptsLeft: 4 });
    const retry = await call<{ url: string }>(api.identityStartHandler, { method: "POST", path: "/api/identity/start", as: "jordan", body: {} });
    expect(retry.body.url).toBe(start.body.url);
    expect(created).toHaveLength(1);
  });

  test("fresh checks are capped", async () => {
    await db.query(`UPDATE users SET identity_attempts = $1 WHERE clerk_user_id = 'jordan'`, [POLICY.maxIdentityAttempts]);
    const res = await call(api.identityStartHandler, { method: "POST", path: "/api/identity/start", as: "jordan", body: {} });
    expect(res.status).toBe(429);
  });

  test("Stripe webhooks must be signed, and update the renter when they are", async () => {
    const start = await call<{ url: string }>(api.identityStartHandler, { method: "POST", path: "/api/identity/start", as: "jordan", body: {} });
    const session = start.body.url.split("/").pop()!;
    outcomes.set(session, { status: "verified", firstName: "Jordan", lastName: "Ellis", dob: "1996-05-01", expiresOn: "2030-01-31", state: "GA", last4: "4821" });
    const hook = (signature: string) =>
      api.stripeWebhookHandler(services)(
        new Request("http://localhost:5173/api/webhooks/stripe", {
          method: "POST",
          headers: { "stripe-signature": signature },
          body: JSON.stringify({ session }),
        }),
      );
    expect((await hook("forged")).status).toBe(400);
    expect((await hook("valid")).status).toBe(200);
    const { rows } = await db.query<{ identity_status: string }>(`SELECT identity_status FROM users WHERE clerk_user_id = 'jordan'`);
    expect(rows[0]?.identity_status).toBe("verified");
  });
});

describe("holding dates", () => {
  beforeEach(() => signUp("jordan", "Jordan Ellis", "jordan@example.com"));

  test("requires a verified license", async () => {
    const res = await createBooking("jordan", ELANTRA);
    expect(res.status).toBe(403);
    expect(res.body.field).toBe("identity");
  });

  test("enforces each car's minimum age on the pickup date", async () => {
    await verify("jordan", "2004-05-01"); // 22
    const glc = await createBooking("jordan", GLC);
    expect(glc.status).toBe(403);
    expect(glc.body.error).toBe("Drivers for this car must be 25 or older on the pickup date.");
    expect((await createBooking("jordan", ELANTRA)).status).toBe(201);
  });

  test("the license has to be valid until the trip ends", async () => {
    await verify("jordan", "1996-05-01", { expiresOn: "2026-11-08" });
    const res = await createBooking("jordan", ELANTRA);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/expires before this trip ends/);
  });

  test("requires agreeing to the current rental agreement", async () => {
    await verify("jordan", "1996-05-01");
    const res = await createBooking("jordan", ELANTRA, { agreementVersion: "old" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("agreement");
  });

  test("a hold shows the server's price and how to pay", async () => {
    await verify("jordan", "1996-05-01");
    const res = await createBooking("jordan", ELANTRA);
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^T36-\d+$/);
    const { body } = await getBooking("jordan", res.body.code);
    expect(body.booking).toMatchObject({
      status: "awaiting_payment",
      rentalCents: 22500,
      depositCents: 5000,
      totalCents: 27500,
      holdExpiresAt: new Date(clock.getTime() + POLICY.holdMinutes * MINUTE).toISOString(),
      payment: {
        amountCents: 27500,
        code: res.body.code,
        cashApp: { cashtag: "$traffic36test", link: "https://cash.app/$traffic36test/275" },
        chime: { phone: "470-555-0100" },
      },
    });
    const { rows } = await db.query<{ agreement_version: string; agreement_ip: string }>(`SELECT agreement_version, agreement_ip FROM bookings`);
    expect(rows[0]).toEqual({ agreement_version: POLICY.agreementVersion, agreement_ip: "203.0.113.5" });
  });

  test("delivery needs an address and goes to the host for approval", async () => {
    await verify("jordan", "1996-05-01");
    const missing = await createBooking("jordan", ELANTRA, { pickup: "delivery" });
    expect(missing.body.field).toBe("deliveryAddress");
    const res = await createBooking("jordan", ELANTRA, { pickup: "delivery", deliveryAddress: "  123 Peachtree St NE,   Atlanta, GA 30303 " });
    const { body } = await getBooking("jordan", res.body.code);
    expect(body.booking.pickup).toEqual({ kind: "delivery", address: "123 Peachtree St NE, Atlanta, GA 30303" });
    expect(body.booking.totalCents).toBe(27500 + 6500);
  });

  test("two renters can't hold the same dates, and an expired hold frees them", async () => {
    await verify("jordan", "1996-05-01");
    await signUp("sam", "Sam Lee", "sam@example.com");
    await verify("sam", "1990-01-01", { name: ["Sam", "Lee"] });
    expect((await createBooking("jordan", ELANTRA)).status).toBe(201);
    const second = await createBooking("sam", ELANTRA);
    expect(second.status).toBe(409);
    clock = new Date(clock.getTime() + (POLICY.holdMinutes + 1) * MINUTE);
    expect((await createBooking("sam", ELANTRA)).status).toBe(201);
  });

  test("a renter can't squat on more than two unpaid bookings", async () => {
    await verify("jordan", "1996-05-01");
    expect((await createBooking("jordan", ELANTRA)).status).toBe(201);
    expect((await createBooking("jordan", GLC)).status).toBe(201);
    const third = await createBooking("jordan", ELANTRA, { startDate: "2026-11-20", endDate: "2026-11-22" });
    expect(third.status).toBe(429);
  });

  test("a renter can cancel before paying, which frees the dates", async () => {
    await verify("jordan", "1996-05-01");
    const { body } = await createBooking("jordan", ELANTRA);
    const res = await call(api.bookingCancelHandler, { method: "POST", path: `/api/bookings/${body.code}/cancel`, as: "jordan", params: { code: body.code } });
    expect(res.status).toBe(200);
    expect((await getBooking("jordan", body.code)).body.booking.status).toBe("cancelled");
    expect((await createBooking("jordan", ELANTRA)).status).toBe(201);
  });

  test("another renter's booking looks like it doesn't exist", async () => {
    await verify("jordan", "1996-05-01");
    const { body } = await createBooking("jordan", ELANTRA);
    await signUp("sam", "Sam Lee", "sam@example.com");
    expect((await getBooking("sam", body.code)).status).toBe(404);
  });
});

describe("payment screenshots", () => {
  let code: string;
  beforeEach(async () => {
    await signUp("jordan", "Jordan Ellis", "jordan@example.com");
    await verify("jordan", "1996-05-01");
    code = (await createBooking("jordan", ELANTRA)).body.code;
  });

  test("only real images are accepted, whatever the file claims to be", async () => {
    const res = await upload("jordan", code, { bytes: new TextEncoder().encode("<script>alert(1)</script>") });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("file");
  });

  test("an upload sends the booking to the host and keeps the dates blocked", async () => {
    const res = await upload("jordan", code);
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe("payment_review");
    expect(res.body.booking.proofs).toHaveLength(1);
    clock = new Date(clock.getTime() + (POLICY.holdMinutes + 150) * MINUTE); // long after the hold would have run out
    await signUp("sam", "Sam Lee", "sam@example.com");
    await verify("sam", "1990-01-01", { name: ["Sam", "Lee"] });
    expect((await createBooking("sam", ELANTRA)).status).toBe(409);
    const { rows } = await db.query<{ recipient: string; template: string }>(`SELECT recipient, template FROM outbox`);
    expect(rows).toEqual([{ recipient: HOST_EMAIL, template: "host_payment_review" }]);
  });

  test("the screenshot is visible to its renter and the host only", async () => {
    const { body } = await upload("jordan", code);
    const proof = body.booking.proofs[0]!;
    const path = `/api/bookings/${code}/proofs/${proof.id}`;
    const params = { code, proofId: proof.id };
    expect((await call(api.proofImageHandler, { path, as: "jordan", params })).body).toEqual({ bytes: PNG.byteLength, type: "image/png" });
    expect((await call(api.proofImageHandler, { path, as: "host", params })).status).toBe(200);
    await signUp("sam", "Sam Lee", "sam@example.com");
    expect((await call(api.proofImageHandler, { path, as: "sam", params })).status).toBe(404);
  });

  test("a late payment is still taken in, and flagged when the dates are gone", async () => {
    clock = new Date(clock.getTime() + (POLICY.holdMinutes + 10) * MINUTE);
    await signUp("sam", "Sam Lee", "sam@example.com");
    await verify("sam", "1990-01-01", { name: ["Sam", "Lee"] });
    expect((await createBooking("sam", ELANTRA)).status).toBe(201);
    expect((await upload("jordan", code)).status).toBe(201);
    const review = (await dashboard()).body.dashboard.review;
    expect(review[0]?.warnings.join(" ")).toMatch(/after the hold ran out/);
  });
});

describe("host review", () => {
  let code: string;
  beforeEach(async () => {
    await signUp("jordan", "Jordan Ellis", "jordan@example.com");
    await verify("jordan", "1996-05-01");
    code = (await createBooking("jordan", ELANTRA)).body.code;
  });

  test("the review queue flags a sender name that doesn't match the license", async () => {
    await upload("jordan", code, { sender: "Pat Morgan" });
    const item = (await dashboard()).body.dashboard.review[0]!;
    expect(item.renter).toMatchObject({ verifiedName: "Jordan Ellis", licenseLast4: "4821" });
    expect(item.warnings[0]).toBe('Sender name "Pat Morgan" doesn\'t match the license name "Jordan Ellis".');
  });

  test("confirming records the payment and confirms the trip", async () => {
    await upload("jordan", code);
    const res = await hostAction(code, "confirm");
    expect(res.status).toBe(200);
    expect(res.body.dashboard.upcoming.map((b) => b.code)).toEqual([code]);
    const { body } = await getBooking("jordan", code);
    expect(body.booking).toMatchObject({ status: "confirmed", payment: null });
    expect(body.booking.proofs[0]?.status).toBe("accepted");
    const { rows } = await db.query<{ kind: string; amount_cents: number; method: string }>(`SELECT kind, amount_cents, method FROM payments`);
    expect(rows).toEqual([{ kind: "booking_charge", amount_cents: 27500, method: "cash_app" }]);
    const audit = await db.query<{ action: string }>(`SELECT action FROM audit_log`);
    expect(audit.rows.map((r) => r.action)).toEqual(["payment_confirmed"]);
  });

  test("rejecting gives the renter the reason and a fresh hold to try again", async () => {
    await upload("jordan", code);
    clock = new Date(clock.getTime() + 2 * 60 * MINUTE);
    const res = await hostAction(code, "reject", { reason: "wrong_amount", note: "We got $250." });
    expect(res.status).toBe(200);
    const { body } = await getBooking("jordan", code);
    expect(body.booking).toMatchObject({
      status: "awaiting_payment",
      paymentNote: "The amount we received doesn't match your total. We got $250.",
      holdExpiresAt: new Date(clock.getTime() + POLICY.holdMinutes * MINUTE).toISOString(),
    });
    expect(body.booking.proofs[0]?.status).toBe("rejected");
    expect((await upload("jordan", code)).body.booking.status).toBe("payment_review");
  });

  test("a delivery booking needs the address approved", async () => {
    const delivery = await createBooking("jordan", GLC, { pickup: "delivery", deliveryAddress: "500 Main St, Atlanta, GA" });
    await upload("jordan", delivery.body.code);
    expect((await hostAction(delivery.body.code, "confirm")).body.field).toBe("approveDelivery");
    expect((await hostAction(delivery.body.code, "confirm", { approveDelivery: true })).status).toBe(200);
  });

  test("the host can't confirm a booking that isn't in review", async () => {
    expect((await hostAction(code, "confirm")).status).toBe(409);
  });

  test("deposits: full refund closes the trip; keeping some needs a reason", async () => {
    await upload("jordan", code);
    await hostAction(code, "confirm");
    expect((await hostAction(code, "deposit", { refundCents: 5000 })).status).toBe(409); // trip hasn't ended
    clock = new Date("2026-11-09T18:00:00Z");
    expect((await dashboard()).body.dashboard.depositsDue.map((b) => b.code)).toEqual([code]);
    expect((await hostAction(code, "deposit", { refundCents: 3000 })).body.field).toBe("note");
    expect((await hostAction(code, "deposit", { refundCents: 3000, note: "Fuel was a quarter tank low." })).status).toBe(200);
    const { rows } = await db.query<{ status: string; refunded_cents: number; deposit_deduction_cents: number }>(
      `SELECT status, refunded_cents, deposit_deduction_cents FROM bookings WHERE code = $1`,
      [code],
    );
    expect(rows[0]).toEqual({ status: "closed", refunded_cents: 3000, deposit_deduction_cents: 2000 });
  });
});

describe("license reviewed by the host", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
  const details = { legalName: "Jordan A Ellis", dob: "2004-05-01", licenseState: "ga", licenseExpiresOn: "2030-01-31" };

  async function uploadDoc(as: string, kind: string, bytes: Uint8Array = JPEG) {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }), `${kind}.jpg`);
    return call<{ id: string }>(api.idDocumentUploadHandler, { method: "POST", path: "/api/identity/documents", as, form });
  }

  async function sendLicense(as: string, extra: Record<string, unknown> = {}) {
    const documents: Record<string, string> = {};
    for (const kind of ["license_front", "license_back", "selfie"]) documents[kind] = (await uploadDoc(as, kind)).body.id;
    return call<{ me: Me }>(api.licenseSubmitHandler, { method: "POST", path: "/api/identity/submit", as, body: { ...details, documents, ...extra } });
  }

  const license = (userId: string, action: string, body: unknown) =>
    call<{ dashboard: HostDashboard }>(api.hostLicenseHandler, { method: "POST", path: `/api/host/licenses/${userId}/${action}`, as: "host", body, params: { userId, action } });

  beforeEach(async () => {
    idCheck = "manual";
    await signUp("jordan", "Jordan Ellis", "jordan@example.com");
  });

  test("the app says which kind of check is running, and Stripe's route is closed", async () => {
    expect((await me("jordan")).body).toMatchObject({ idCheck: "manual" });
    const res = await call(api.identityStartHandler, { method: "POST", path: "/api/identity/start", as: "jordan", body: {} });
    expect(res.status).toBe(409);
  });

  test("photos must be real images of a known kind", async () => {
    expect((await uploadDoc("jordan", "passport")).body.field).toBe("kind");
    expect((await uploadDoc("jordan", "selfie", new TextEncoder().encode("not an image"))).body.field).toBe("selfie");
    expect((await uploadDoc("jordan", "selfie")).status).toBe(201);
  });

  test("all three photos and valid details are required", async () => {
    const front = (await uploadDoc("jordan", "license_front")).body.id;
    const missing = await call(api.licenseSubmitHandler, {
      method: "POST", path: "/api/identity/submit", as: "jordan", body: { ...details, documents: { license_front: front } },
    });
    expect(missing.body.field).toBe("license_back");
    expect((await sendLicense("jordan", { dob: "2008-01-01" })).body.error).toBe("Renters must be 21 or older.");
    expect((await sendLicense("jordan", { licenseExpiresOn: "2026-10-01" })).body.field).toBe("licenseExpiresOn");
    expect((await sendLicense("jordan", { licenseState: "ZZ" })).body.field).toBe("licenseState");
  });

  test("someone else's photos can't be used", async () => {
    await signUp("sam", "Sam Lee", "sam@example.com");
    const theirs = (await uploadDoc("sam", "selfie")).body.id;
    const documents = {
      license_front: (await uploadDoc("jordan", "license_front")).body.id,
      license_back: (await uploadDoc("jordan", "license_back")).body.id,
      selfie: theirs,
    };
    const res = await call(api.licenseSubmitHandler, { method: "POST", path: "/api/identity/submit", as: "jordan", body: { ...details, documents } });
    expect(res.body.field).toBe("selfie");
  });

  test("a sent license is in review, and the renter can hold dates and pay while it waits", async () => {
    const res = await sendLicense("jordan");
    expect(res.status).toBe(201);
    expect(res.body.me.identity).toMatchObject({ status: "in_review", method: "manual", name: "Jordan A Ellis", licenseState: "GA" });
    expect((await createBooking("jordan", GLC)).body.error).toBe("Drivers for this car must be 25 or older on the pickup date.");
    const { body } = await createBooking("jordan", ELANTRA);
    expect((await upload("jordan", body.code)).status).toBe(201);
    const { rows } = await db.query<{ template: string }>(`SELECT template FROM outbox ORDER BY created_at`);
    expect(rows.map((r) => r.template)).toEqual(["host_license_review", "host_payment_review"]);
  });

  test("the host sees the photos and details; nobody else can open the photos", async () => {
    await sendLicense("jordan");
    const { body } = await dashboard();
    const review = body.dashboard.licenses[0]!;
    expect(review).toMatchObject({ legalName: "Jordan A Ellis", dob: "2004-05-01", age: 22, licenseState: "GA", previousRejections: 0 });
    expect(review.documents.map((d) => d.kind)).toEqual(["license_front", "license_back", "selfie"]);
    const id = review.documents[0]!.url.split("/").pop()!;
    const open = (as: string) => call(api.idDocumentImageHandler, { path: review.documents[0]!.url, as, params: { id } });
    expect((await open("host")).body).toEqual({ bytes: JPEG.byteLength, type: "image/jpeg" });
    expect((await open("jordan")).status).toBe(404);
  });

  test("a booking can't be confirmed until the license is approved", async () => {
    await sendLicense("jordan");
    const { body } = await createBooking("jordan", ELANTRA);
    await upload("jordan", body.code, { sender: "Jordan Ellis" });
    const card = (await dashboard()).body.dashboard.review[0]!;
    expect(card.renter.licenseApproved).toBe(false);
    expect(card.warnings[0]).toMatch(/license isn't approved yet/);
    expect((await hostAction(body.code, "confirm")).status).toBe(409);
    const userId = (await dashboard()).body.dashboard.licenses[0]!.userId;
    expect((await license(userId, "approve", { ...details, licenseLast4: "4821" })).status).toBe(200);
    expect((await me("jordan")).body.me.identity).toMatchObject({ status: "verified", licenseLast4: "4821" });
    expect((await hostAction(body.code, "confirm")).status).toBe(200);
  });

  test("the host's corrections count: a corrected birth date can block a confirmation", async () => {
    await sendLicense("jordan", { dob: "1999-05-01" }); // typed as 27
    const { body } = await createBooking("jordan", GLC);
    await upload("jordan", body.code);
    const userId = (await dashboard()).body.dashboard.licenses[0]!.userId;
    await license(userId, "approve", { ...details, dob: "2003-05-01" }); // the photo says 23
    const res = await hostAction(body.code, "confirm");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/under 25/);
  });

  test("a rejected license shows the reason, and the renter can send new photos", async () => {
    await sendLicense("jordan");
    const userId = (await dashboard()).body.dashboard.licenses[0]!.userId;
    expect((await license(userId, "reject", {})).body.field).toBe("reason");
    await license(userId, "reject", { reason: "The back photo is blurry. Retake it in better light." });
    expect((await me("jordan")).body.me.identity).toMatchObject({ status: "failed", failureReason: "The back photo is blurry. Retake it in better light." });
    expect((await createBooking("jordan", ELANTRA)).status).toBe(403);
    expect((await sendLicense("jordan")).status).toBe(201);
    const again = (await dashboard()).body.dashboard.licenses;
    expect(again).toHaveLength(1);
    expect(again[0]!.previousRejections).toBe(1);
  });

  test("resending while in review replaces the earlier submission", async () => {
    await sendLicense("jordan", { legalName: "Jordn Ellis" });
    await sendLicense("jordan");
    const reviews = (await dashboard()).body.dashboard.licenses;
    expect(reviews.map((r) => r.legalName)).toEqual(["Jordan A Ellis"]);
  });
});

describe("pickup pass and renter records", () => {
  let code: string;
  const handoff = (body: unknown, as = "host") => hostAction(code, "handoff", body, as);
  const detail = () =>
    call<{ booking: HostBookingDetail }>(api.hostBookingHandler, { path: `/api/host/bookings/${code}`, as: "host", params: { code } });
  const pass = async () => (await getBooking("jordan", code)).body.booking.pass;

  beforeEach(async () => {
    await signUp("jordan", "Jordan Ellis", "jordan@example.com");
    await verify("jordan", "1996-05-01");
    code = (await createBooking("jordan", ELANTRA)).body.code; // Fri Nov 6 10:00 to Mon Nov 9 10:00, Atlanta time
    await upload("jordan", code);
    await hostAction(code, "confirm");
  });

  test("the host is warned the day before when there's no pickup plan", async () => {
    clock = new Date("2026-11-05T16:00:00Z");
    const [trip] = (await dashboard()).body.dashboard.upcoming;
    expect(trip?.warnings).toContain("No pickup plan yet. Add the lockbox code, or choose to meet the renter in person.");
  });

  test("codes are checked, never stored or logged in plain text, and only the host can set them", async () => {
    expect((await handoff({ method: "teleport" })).body.field).toBe("method");
    expect((await handoff({ method: "lockbox", lockboxCode: "12" })).body.field).toBe("lockboxCode");
    expect((await handoff({ method: "lockbox", lockboxCode: "4821" }, "jordan")).status).toBe(403);
    expect((await handoff({ method: "lockbox", lockboxCode: "4821" })).status).toBe(200);
    const { rows } = await db.query<{ code_ciphertext: string }>(`SELECT code_ciphertext FROM access_codes`);
    expect(rows[0]?.code_ciphertext).not.toContain("4821");
    const audit = await db.query<{ details: unknown }>(`SELECT details FROM audit_log WHERE action = 'handoff_set'`);
    expect(JSON.stringify(audit.rows)).not.toContain("4821");
    expect((await detail()).body.booking.handoff).toMatchObject({ method: "lockbox", code: "4821", revealedAt: null });
  });

  test("the renter sees the code from an hour before pickup until two hours after the return", async () => {
    await handoff({ method: "lockbox", lockboxCode: "4821" });
    clock = new Date("2026-11-06T13:59:00Z"); // 8:59 AM, one minute before the pass opens
    expect(await pass()).toMatchObject({ handoff: "lockbox", open: false, code: null, opensAt: "2026-11-06T14:00:00.000Z" });
    expect((await detail()).body.booking.handoff.revealedAt).toBeNull();

    clock = new Date("2026-11-06T14:30:00Z");
    expect(await pass()).toMatchObject({ open: true, code: "4821", closesAt: "2026-11-09T17:00:00.000Z" });
    expect((await detail()).body.booking.handoff.revealedAt).toBe("2026-11-06T14:30:00.000Z");

    clock = new Date("2026-11-09T17:01:00Z");
    expect(await pass()).toMatchObject({ open: false, code: null });
  });

  test("dashes and spaces in a code are ignored, and the trip note shows with the code", async () => {
    await handoff({ method: "lockbox", lockboxCode: "4-8 2-1", note: "Space 14, lockbox on the driver's window" });
    expect((await detail()).body.booking.handoff).toMatchObject({ code: "4821", note: "Space 14, lockbox on the driver's window" });
    expect(await pass()).toMatchObject({ open: false, note: null });
    clock = new Date("2026-11-06T14:30:00Z");
    expect(await pass()).toMatchObject({ code: "4821", note: "Space 14, lockbox on the driver's window" });
    expect((await handoff({ method: "lockbox", lockboxCode: "4821", note: "x".repeat(301) })).body.field).toBe("note");
  });

  test("a new code resets 'opened', and switching to in person removes the code", async () => {
    await handoff({ method: "lockbox", lockboxCode: "4821" });
    clock = new Date("2026-11-06T14:30:00Z");
    await pass();
    await handoff({ method: "lockbox", lockboxCode: "7734" });
    expect((await detail()).body.booking.handoff).toMatchObject({ code: "7734", revealedAt: null });
    await handoff({ method: "in_person" });
    expect(await pass()).toMatchObject({ handoff: "in_person", open: true, code: null });
    const { rows } = await db.query(`SELECT 1 FROM access_codes`);
    expect(rows).toHaveLength(0);
  });

  test("a delivery is handed over at the address, so there's no code to set", async () => {
    const delivery = (await createBooking("jordan", GLC, { pickup: "delivery", deliveryAddress: "500 Main St, Atlanta, GA" })).body.code;
    await upload("jordan", delivery);
    await hostAction(delivery, "confirm", { approveDelivery: true });
    expect((await getBooking("jordan", delivery)).body.booking.pass?.handoff).toBe("delivery");
    expect((await hostAction(delivery, "handoff", { method: "lockbox", lockboxCode: "4821" })).status).toBe(409);
  });

  test("the host can find a renter and open their full record", async () => {
    const list = await call<{ renters: RenterSummary[] }>(api.hostRentersHandler, { path: "/api/host/renters?q=jordan@", as: "host" });
    expect(list.body.renters).toHaveLength(1);
    const renter = list.body.renters[0]!;
    expect(renter).toMatchObject({ name: "Jordan Ellis", trips: 1, licenseStatus: "verified", doNotRent: false });
    const byPhone = await call<{ renters: RenterSummary[] }>(api.hostRentersHandler, { path: "/api/host/renters?q=555-0123", as: "host" });
    expect(byPhone.body.renters.map((r) => r.id)).toEqual([renter.id]);

    const profile = await call<{ renter: RenterProfile }>(api.hostRentersHandler, {
      path: `/api/host/renters/${renter.id}`, as: "host", params: { id: renter.id },
    });
    expect(profile.body.renter).toMatchObject({ dob: "1996-05-01", age: 30, licenseState: "GA", licenseLast4: "4821" });
    expect(profile.body.renter.bookings.map((b) => b.code)).toEqual([code]);
    expect(profile.body.renter.payments).toEqual([expect.objectContaining({ bookingCode: code, kind: "booking_charge", amountCents: 27500 })]);
    const renterView = await call(api.hostRentersHandler, { path: "/api/host/renters", as: "jordan" });
    expect(renterView.status).toBe(403);
  });

  test("the booking record shows the money and every host action", async () => {
    await handoff({ method: "lockbox", lockboxCode: "4821" });
    const { booking } = (await detail()).body;
    expect(booking.payments.map((p) => p.kind)).toEqual(["booking_charge"]);
    expect(booking.activity.map((a) => a.action)).toEqual(["handoff_set", "payment_confirmed"]);
    expect(booking.renter.id).toBeTruthy();
  });

  test("the host can stop a renter from booking, with a reason", async () => {
    const id = (await call<{ renters: RenterSummary[] }>(api.hostRentersHandler, { path: "/api/host/renters", as: "host" })).body.renters[0]!.id;
    const block = (body: unknown) =>
      call<{ renter: RenterProfile }>(api.hostRenterActionHandler, { method: "POST", path: `/api/host/renters/${id}/block`, as: "host", body, params: { id, action: "block" } });
    expect((await block({ value: true })).body.field).toBe("note");
    expect((await block({ value: true, note: "Returned the car late twice" })).body.renter).toMatchObject({ doNotRent: true, doNotRentNote: "Returned the car late twice" });
    expect((await createBooking("jordan", GLC, { startDate: "2026-11-20", endDate: "2026-11-22" })).status).toBe(403);
    await block({ value: false });
    expect((await createBooking("jordan", GLC, { startDate: "2026-11-20", endDate: "2026-11-22" })).status).toBe(201);
  });
});

describe("ending, cancelling and archiving trips", () => {
  let code: string;
  const record = (c = code) =>
    call<{ booking: HostBookingDetail }>(api.hostBookingHandler, { path: `/api/host/bookings/${c}`, as: "host", params: { code: c } });
  const act = (action: string, body: unknown = {}, as = "host", c = code) =>
    call<{ booking: HostBookingDetail }>(api.hostActionHandler, { method: "POST", path: `/api/host/bookings/${c}/${action}?view=booking`, as, body, params: { code: c, action } });
  const archive = () => call<{ archive: HostArchive }>(api.hostArchiveHandler, { path: "/api/host/archive", as: "host" });
  const renters = () => call<{ renters: RenterSummary[] }>(api.hostRentersHandler, { path: "/api/host/renters", as: "host" });
  const archiveRenter = (id: string, value: boolean) =>
    call<{ renter: RenterProfile }>(api.hostRenterActionHandler, { method: "POST", path: `/api/host/renters/${id}/archive`, as: "host", body: { value }, params: { id, action: "archive" } });

  beforeEach(async () => {
    await signUp("jordan", "Jordan Ellis", "jordan@example.com");
    await verify("jordan", "1996-05-01");
    code = (await createBooking("jordan", ELANTRA)).body.code; // Fri Nov 6 10:00 to Mon Nov 9 10:00, Atlanta time
    await upload("jordan", code);
    await hostAction(code, "confirm");
  });

  test("a paid trip can be cancelled with a reason and the refund the host sent back", async () => {
    await act("handoff", { method: "lockbox", lockboxCode: "4821" });
    const paid = (await getBooking("jordan", code)).body.booking.totalCents;
    expect((await act("cancel", { refundCents: paid })).body.field).toBe("note");
    expect((await act("cancel", { note: "The car is in the shop" })).body.field).toBe("refundCents");
    expect((await act("cancel", { note: "The car is in the shop", refundCents: paid + 1 })).body.field).toBe("refundCents");
    expect((await act("cancel", { note: "The car is in the shop", refundCents: paid }, "jordan")).status).toBe(403);

    const res = await act("cancel", { note: "The car is in the shop", refundCents: paid });
    expect(res.body.booking).toMatchObject({ status: "cancelled", refundedCents: paid, can: { cancel: false, end: false, archive: true } });
    expect(res.body.booking.payments.map((p) => [p.kind, p.amountCents])).toEqual([["cancellation_refund", -paid], ["booking_charge", paid]]);
    expect(res.body.booking.activity[0]).toMatchObject({ action: "booking_cancelled", details: { refundCents: paid, wasConfirmed: true } });
    expect((await db.query(`SELECT 1 FROM access_codes`)).rows).toHaveLength(0);

    const renterView = (await getBooking("jordan", code)).body.booking;
    expect(renterView).toMatchObject({ status: "cancelled", cancelReason: "The car is in the shop", refundedCents: paid, pass: null });
    expect((await act("cancel", { note: "Again", refundCents: 0 })).status).toBe(409);

    // The dates are free again.
    await signUp("sam", "Sam Rivera", "sam@example.com");
    await verify("sam", "1990-02-02");
    expect((await createBooking("sam", ELANTRA)).status).toBe(201);
  });

  test("a renter's own early release isn't shown back to them as a host reason", async () => {
    const other = (await createBooking("jordan", GLC, { startDate: "2026-11-20", endDate: "2026-11-22" })).body.code;
    await call(api.bookingCancelHandler, { method: "POST", path: `/api/bookings/${other}/cancel`, as: "jordan", params: { code: other } });
    expect((await getBooking("jordan", other)).body.booking).toMatchObject({ status: "cancelled", cancelReason: null });
  });

  test("a trip in progress can be ended early, which frees the rest of the dates", async () => {
    expect((await act("end")).body.error).toMatch(/hasn't started/);
    clock = new Date("2026-11-07T17:00:00Z"); // Sat noon
    const { rentalCents } = (await getBooking("jordan", code)).body.booking;
    expect((await act("end", { refundCents: rentalCents + 1 })).body.field).toBe("refundCents");

    const res = await act("end", { refundCents: 50_00, note: "Came back a day early" });
    expect(res.body.booking).toMatchObject({
      status: "returned",
      end: "2026-11-07T17:00:00.000Z",
      endedEarly: { at: "2026-11-07T17:00:00.000Z", scheduledEnd: "2026-11-09T15:00:00.000Z" },
      refundedCents: 50_00,
      depositOpen: true,
      can: { cancel: false, end: false, archive: true },
    });
    expect(res.body.booking.payments[0]).toMatchObject({ kind: "early_end_refund", amountCents: -50_00, note: "Came back a day early" });
    expect((await getBooking("jordan", code)).body.booking.pass).toBeNull();
    const board = (await dashboard()).body.dashboard;
    expect(board.upcoming.map((b) => b.code)).not.toContain(code);
    expect(board.depositsDue.map((b) => b.code)).toContain(code);
    expect((await act("end")).status).toBe(409);

    // Sunday is open for someone else now.
    await signUp("sam", "Sam Rivera", "sam@example.com");
    await verify("sam", "1990-02-02");
    expect((await createBooking("sam", ELANTRA, { startDate: "2026-11-08", endDate: "2026-11-09" })).status).toBe(201);

    // The deposit is returned as usual, which closes the trip.
    expect((await hostAction(code, "deposit", { refundCents: POLICY.depositCents })).status).toBe(200);
    expect((await getBooking("jordan", code)).body.booking).toMatchObject({ status: "closed", refundedCents: 50_00 + POLICY.depositCents });
  });

  test("only finished bookings can be archived; they leave the host's lists and come back on restore", async () => {
    expect((await act("archive")).status).toBe(409);
    clock = new Date("2026-11-09T18:00:00Z"); // after the return time, deposit not yet settled
    const archived = await act("archive");
    expect(archived.body.booking).toMatchObject({ depositOpen: true, can: { archive: false } });
    expect(archived.body.booking.archivedAt).toBe("2026-11-09T18:00:00.000Z");
    expect((await dashboard()).body.dashboard.depositsDue).toHaveLength(0);
    expect((await archive()).body.archive.bookings.map((b) => b.code)).toEqual([code]);
    // The renter still has their trip history.
    const mine = await call<{ bookings: Booking[] }>(api.bookingsHandler, { path: "/api/bookings", as: "jordan" });
    expect(mine.body.bookings.map((b) => b.code)).toContain(code);

    expect((await act("restore")).body.booking.archivedAt).toBeNull();
    expect((await archive()).body.archive.bookings).toHaveLength(0);
    expect((await dashboard()).body.dashboard.depositsDue.map((b) => b.code)).toEqual([code]);
  });

  test("a late payment on an archived hold brings it back for review", async () => {
    await signUp("sam", "Sam Rivera", "sam@example.com");
    await verify("sam", "1990-02-02");
    const held = (await createBooking("sam", GLC, { startDate: "2026-11-20", endDate: "2026-11-22" })).body.code;
    clock = new Date(clock.getTime() + (POLICY.holdMinutes + 1) * 60_000);
    expect((await act("archive", {}, "host", held)).body.booking.archivedAt).not.toBeNull();
    await upload("sam", held, { sender: "Jordan Ellis" });
    expect((await record(held)).body.booking.archivedAt).toBeNull();
    expect((await dashboard()).body.dashboard.review.map((b) => b.code)).toEqual([held]);
  });

  test("renters with nothing in play can be archived, and come back when they book again", async () => {
    const id = (await renters()).body.renters[0]!.id;
    expect((await archiveRenter(id, true)).status).toBe(409);
    await act("cancel", { note: "Test booking", refundCents: 0 });
    expect((await archiveRenter(id, true)).body.renter).toMatchObject({ archived: true });
    expect((await renters()).body.renters).toHaveLength(0);
    expect((await archive()).body.archive.renters.map((r) => r.id)).toEqual([id]);
    expect((await archiveRenter(id, false)).body.renter.archived).toBe(false);
    await archiveRenter(id, true);

    expect((await createBooking("jordan", GLC, { startDate: "2026-11-20", endDate: "2026-11-22" })).status).toBe(201);
    expect((await renters()).body.renters.map((r) => r.id)).toEqual([id]);
    const actions = await db.query<{ action: string }>(`SELECT action FROM audit_log WHERE entity = 'user' ORDER BY created_at`);
    expect(actions.rows.map((r) => r.action)).toEqual(["renter_archived", "renter_restored", "renter_archived"]);
  });
});

describe("helpers", () => {
  test("names match loosely: order, case, accents and middle names don't matter", () => {
    expect(namesMatch("ELLIS, JORDAN A", "Jordan Ellis")).toBe(true);
    expect(namesMatch("José Ramírez", "Jose Ramirez")).toBe(true);
    expect(namesMatch("Jordan Smith", "Jordan Ellis")).toBe(false);
  });

  test("Cash App links carry the amount", () => {
    expect(cashAppLink("$traffic36test", 27500)).toBe("https://cash.app/$traffic36test/275");
    expect(cashAppLink("$traffic36test", 27550)).toBe("https://cash.app/$traffic36test/275.50");
  });

  test("image types are read from the bytes", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("RIFF0000WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBeNull();
  });
});
