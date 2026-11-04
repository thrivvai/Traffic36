import { randomUUID } from "node:crypto";
import type { Db, TxDb } from "./db.ts";
import { env } from "./env.ts";
import { HttpError, badRequest, notFound } from "./http.ts";
import { findConflicts, lockVehicle } from "./availability.ts";
import { priceTrip, type TripInput } from "./quote.ts";
import { sniffImage, type ProofStore } from "./proofs.ts";
import { canBook, licenseCurrent, type UserRecord } from "./users.ts";
import { pendingLicenses } from "./licenseReview.ts";
import { MINUTE, POLICY } from "../shared/policy.ts";
import { ageAt, formatMoney, validThrough } from "../shared/pricing.ts";
import type {
  Booking,
  BookingStatus,
  HostBooking,
  Location,
  PaymentInstructions,
  PaymentMethod,
  PaymentProof,
  Photo,
} from "../shared/types.ts";

// ---------------------------------------------------------------------------------------------
// Payment settings
// ---------------------------------------------------------------------------------------------

/** Where renters send money. Set in Netlify (CASHAPP_CASHTAG, CHIME_PHONE) so it stays out of the code. */
export type PaymentConfig = { cashtag: string | null; chimePhone: string | null };

export function paymentConfigFromEnv(): PaymentConfig {
  const tag = env("CASHAPP_CASHTAG");
  return { cashtag: tag ? `$${tag.replace(/^\$/, "")}` : null, chimePhone: env("CHIME_PHONE") ?? null };
}

export function enabledMethods(cfg: PaymentConfig): PaymentMethod[] {
  return [...(cfg.cashtag ? (["cash_app"] as const) : []), ...(cfg.chimePhone ? (["chime"] as const) : [])];
}

/** Opens Cash App on the renter's phone with the cashtag and amount filled in. */
export function cashAppLink(cashtag: string, cents: number): string {
  const amount = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  return `https://cash.app/${encodeURIComponent(cashtag).replace("%24", "$")}/${amount}`;
}

function instructions(cfg: PaymentConfig, code: string, amountCents: number): PaymentInstructions {
  return {
    amountCents,
    code,
    cashApp: cfg.cashtag ? { cashtag: cfg.cashtag, link: cashAppLink(cfg.cashtag, amountCents) } : null,
    chime: cfg.chimePhone ? { phone: cfg.chimePhone } : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Reading bookings
// ---------------------------------------------------------------------------------------------

type Row = {
  id: string;
  code: string;
  status: string;
  hold_expires_at: Date | null;
  starts_at: Date;
  ends_at: Date;
  billable_days: number;
  rental_cents: number;
  delivery_fee_cents: number;
  deposit_cents: number;
  charge_cents: number;
  refunded_cents: number;
  payment_method: PaymentMethod | null;
  payment_note: string | null;
  review_reasons: string[];
  delivery_address: string | null;
  confirmed_at: Date | null;
  created_at: Date;
  renter_id: string;
  vehicle_id: string;
  v_slug: string;
  v_year: number;
  v_make: string;
  v_model: string;
  v_min_age: number;
  v_photo: Photo | null;
  pickup_loc: Location | null;
  return_loc: Location;
  r_name: string;
  r_verified: string | null;
  r_email: string | null;
  r_phone: string | null;
  r_state: string | null;
  r_last4: string | null;
  r_identity: string;
  r_dob: string | null;
  r_expires: string | null;
};

const loc = (alias: string) => `json_build_object(
  'slug', ${alias}.slug, 'name', ${alias}.name, 'kind', ${alias}.kind, 'address', ${alias}.address,
  'opensAt', to_char(${alias}.opens_at, 'HH24:MI'), 'closesAt', to_char(${alias}.closes_at, 'HH24:MI'),
  'inPersonAvailable', ${alias}.in_person_available)`;

const SELECT = `
  SELECT b.id, b.code, b.status, b.hold_expires_at, b.starts_at, b.ends_at, b.billable_days, b.rental_cents,
         b.delivery_fee_cents, b.deposit_cents, b.charge_cents, b.refunded_cents, b.payment_method, b.payment_note,
         b.review_reasons, b.delivery_address, b.confirmed_at, b.created_at, b.renter_id, b.vehicle_id,
         v.slug AS v_slug, v.year AS v_year, v.make AS v_make, v.model AS v_model, v.min_driver_age AS v_min_age,
         (SELECT json_build_object('src', p.src, 'alt', p.alt_text) FROM vehicle_photos p
           WHERE p.vehicle_id = v.id ORDER BY p.sort_order LIMIT 1) AS v_photo,
         CASE WHEN pl.id IS NULL THEN NULL ELSE ${loc("pl")} END AS pickup_loc,
         ${loc("rl")} AS return_loc,
         u.name AS r_name, u.identity_name AS r_verified, u.email AS r_email, u.phone AS r_phone,
         u.license_state AS r_state, u.license_last4 AS r_last4, u.identity_status AS r_identity,
         u.identity_dob::text AS r_dob, u.license_expires_on::text AS r_expires
    FROM bookings b
    JOIN vehicles v ON v.id = b.vehicle_id
    LEFT JOIN lots pl ON pl.id = b.pickup_lot_id
    JOIN lots rl ON rl.id = b.return_lot_id
    JOIN users u ON u.id = b.renter_id`;

type ProofRow = {
  id: string;
  booking_id: string;
  method: PaymentMethod;
  sender_name: string;
  status: PaymentProof["status"];
  review_note: string | null;
  created_at: Date;
};

async function proofsFor(db: Db, rows: Row[]): Promise<Map<string, ProofRow[]>> {
  const byBooking = new Map<string, ProofRow[]>();
  if (!rows.length) return byBooking;
  const { rows: proofs } = await db.query<ProofRow>(
    `SELECT id, booking_id, method, sender_name, status, review_note, created_at
       FROM payment_proofs WHERE booking_id = ANY($1::uuid[]) ORDER BY created_at`,
    [rows.map((r) => r.id)],
  );
  for (const p of proofs) byBooking.set(p.booking_id, [...(byBooking.get(p.booking_id) ?? []), p]);
  return byBooking;
}

/** The status a person should see. A hold that ran out reads as expired even before anything tidies it up. */
function shownStatus(r: Row, now: Date): BookingStatus {
  if ((r.status === "awaiting_payment" || r.status === "held") && (!r.hold_expires_at || r.hold_expires_at <= now)) return "expired";
  if (r.status === "held" || r.status === "awaiting_verification" || r.status === "needs_review") return "awaiting_payment";
  return r.status as BookingStatus;
}

function toBooking(r: Row, proofs: ProofRow[], cfg: PaymentConfig, now: Date): Booking {
  const status = shownStatus(r, now);
  const unpaid = status === "awaiting_payment" || status === "payment_review";
  return {
    code: r.code,
    status,
    vehicle: { slug: r.v_slug, year: r.v_year, make: r.v_make, model: r.v_model, photo: r.v_photo, minDriverAge: r.v_min_age },
    start: r.starts_at.toISOString(),
    end: r.ends_at.toISOString(),
    days: r.billable_days,
    pickup: r.pickup_loc ? { kind: "location", location: r.pickup_loc } : { kind: "delivery", address: r.delivery_address ?? "" },
    returnTo: r.return_loc,
    rentalCents: r.rental_cents,
    deliveryFeeCents: r.delivery_fee_cents,
    depositCents: r.deposit_cents,
    totalCents: r.charge_cents,
    holdExpiresAt: status === "awaiting_payment" && r.hold_expires_at ? r.hold_expires_at.toISOString() : null,
    paymentMethod: r.payment_method,
    paymentNote: status === "awaiting_payment" ? r.payment_note : null,
    proofs: proofs.map((p) => ({
      id: p.id,
      method: p.method,
      senderName: p.sender_name,
      status: p.status,
      reviewNote: p.review_note,
      createdAt: p.created_at.toISOString(),
      url: `/api/bookings/${r.code}/proofs/${p.id}`,
    })),
    payment: unpaid ? instructions(cfg, r.code, r.charge_cents) : null,
    confirmedAt: r.confirmed_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  };
}

/** Lowercase words, accents and punctuation dropped, for comparing names loosely. */
const words = (name: string) =>
  name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);

/** True when the sender's name contains the license's first and last name, in any order. */
export function namesMatch(sender: string, verified: string): boolean {
  const s = new Set(words(sender));
  const v = words(verified);
  const first = v[0];
  const last = v[v.length - 1];
  return !!first && !!last && s.has(first) && s.has(last);
}

function warningsFor(r: Row, proofs: ProofRow[], now: Date): string[] {
  const out: string[] = [];
  if (r.r_identity !== "verified" && (r.status === "payment_review" || r.status === "awaiting_payment")) {
    out.push("This renter's license isn't approved yet. Review it under Licenses to review before confirming.");
  }
  const pending = proofs.filter((p) => p.status === "pending");
  const latest = pending[pending.length - 1];
  if (latest && r.r_verified && !namesMatch(latest.sender_name, r.r_verified)) {
    out.push(`Sender name "${latest.sender_name}" doesn't match the license name "${r.r_verified}".`);
  }
  if (r.review_reasons.includes("dates_taken")) {
    out.push("This payment came in after the hold ran out, and the dates now overlap another trip. Reject it and send the money back, or offer the renter new dates.");
  }
  if (r.delivery_address) out.push(`Delivery to ${r.delivery_address}. Confirming approves this address.`);
  const hoursToPickup = (r.starts_at.getTime() - now.getTime()) / (60 * MINUTE);
  if (r.status === "payment_review" && hoursToPickup < 6) {
    out.push(hoursToPickup > 0 ? `Pickup is in ${Math.max(1, Math.round(hoursToPickup))} hour${Math.round(hoursToPickup) === 1 ? "" : "s"}.` : "The pickup time has passed.");
  }
  return out;
}

function toHostBooking(r: Row, proofs: ProofRow[], cfg: PaymentConfig, now: Date): HostBooking {
  return {
    ...toBooking(r, proofs, cfg, now),
    renter: {
      accountName: r.r_name,
      verifiedName: r.r_verified,
      email: r.r_email,
      phone: r.r_phone,
      licenseState: r.r_state,
      licenseLast4: r.r_last4,
      licenseApproved: r.r_identity === "verified",
    },
    warnings: warningsFor(r, proofs, now),
    refundedCents: r.refunded_cents,
  };
}

async function rowByCode(db: Db, code: string, lock = false): Promise<Row | null> {
  const { rows } = await db.query<Row>(`${SELECT} WHERE b.code = $1${lock ? " FOR UPDATE OF b" : ""}`, [code]);
  return rows[0] ?? null;
}

async function ownRow(db: Db, user: UserRecord, code: string, lock = false): Promise<Row> {
  const row = await rowByCode(db, code, lock);
  // Someone else's booking looks exactly like a missing one, so codes can't be probed.
  if (!row || row.renter_id !== user.id) throw notFound("We couldn't find that booking.");
  return row;
}

export async function getBooking(db: Db, cfg: PaymentConfig, user: UserRecord, code: string, now: Date): Promise<Booking> {
  const row = await ownRow(db, user, code);
  return toBooking(row, (await proofsFor(db, [row])).get(row.id) ?? [], cfg, now);
}

export async function listBookings(db: Db, cfg: PaymentConfig, user: UserRecord, now: Date): Promise<Booking[]> {
  const { rows } = await db.query<Row>(`${SELECT} WHERE b.renter_id = $1 ORDER BY b.starts_at DESC LIMIT 50`, [user.id]);
  const proofs = await proofsFor(db, rows);
  return rows.map((r) => toBooking(r, proofs.get(r.id) ?? [], cfg, now));
}

// ---------------------------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------------------------

export type CreateInput = TripInput & { deliveryAddress?: unknown; agreementVersion?: unknown };

/**
 * Holds the dates for POLICY.holdMinutes while the renter pays. Every rule is checked here, on the
 * server: license, age, agreement, limits, and availability under the car's row lock.
 */
export async function createBooking(
  db: TxDb,
  cfg: PaymentConfig,
  user: UserRecord,
  slug: string,
  input: CreateInput,
  meta: { ip: string | null; now: Date },
): Promise<{ code: string }> {
  const { now } = meta;
  if (user.doNotRent) throw new HttpError(403, "We can't take bookings for this account. Message us at admin@traffic36.com.");
  if (!enabledMethods(cfg).length) {
    console.error("No payment method configured. Set CASHAPP_CASHTAG and/or CHIME_PHONE in Netlify.");
    throw new HttpError(503, "Booking is temporarily unavailable. Try again later or message us at admin@traffic36.com.");
  }
  if (input.agreementVersion !== POLICY.agreementVersion) {
    throw badRequest("Read and agree to the rental agreement to continue.", "agreement");
  }

  const trip = await priceTrip(db, slug, input, now);

  if (!canBook(user)) {
    throw new HttpError(403, "Add your driver's license before booking.", "identity");
  }
  if (!licenseCurrent(user, trip.end)) {
    throw new HttpError(403, "Your license expires before this trip ends. Add a current license to book these dates.", "identity");
  }
  const minAge = Math.max(trip.vehicle.minDriverAge, POLICY.minAgeFloor);
  if (ageAt(user.identityDob!, trip.start.getTime(), POLICY.timeZone) < minAge) {
    throw new HttpError(403, `Drivers for this car must be ${minAge} or older on the pickup date.`, "identity");
  }

  let deliveryAddress: string | null = null;
  if (trip.places.pickup === "delivery") {
    deliveryAddress = typeof input.deliveryAddress === "string" ? input.deliveryAddress.trim().replace(/\s+/g, " ") : "";
    if (deliveryAddress.length < 8) throw badRequest("Enter the full street address for delivery.", "deliveryAddress");
    if (deliveryAddress.length > 200) throw badRequest("That address is too long. Shorten it to 200 characters.", "deliveryAddress");
  }

  const { rows: open } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bookings
      WHERE renter_id = $1 AND ((status = 'awaiting_payment' AND hold_expires_at > $2) OR status = 'payment_review')`,
    [user.id, now],
  );
  if ((open[0]?.n ?? 0) >= POLICY.maxOpenBookings) {
    throw new HttpError(429, "You already have bookings waiting on payment. Finish or cancel one of those first.");
  }

  return db.transaction(async (tx) => {
    await lockVehicle(tx, trip.vehicle.id);
    const conflicts = await findConflicts(tx, trip.vehicle.id, trip.start, trip.end, { now });
    if (conflicts.length) throw new HttpError(409, "Those dates were just taken. Choose different dates.", "startDate");
    const { rows } = await tx.query<{ code: string }>(
      `INSERT INTO bookings (vehicle_id, renter_id, starts_at, ends_at, status, hold_expires_at, billable_days,
         rental_cents, delivery_fee_cents, deposit_cents, charge_cents, pickup_lot_id, delivery_address, return_lot_id,
         agreement_version, agreement_accepted_at, agreement_ip, review_reasons)
       VALUES ($1, $2, $3, $4, 'awaiting_payment', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING code`,
      [
        trip.vehicle.id,
        user.id,
        trip.start,
        trip.end,
        new Date(now.getTime() + POLICY.holdMinutes * MINUTE),
        trip.rental.days,
        trip.rental.rentalCents,
        trip.deliveryFeeCents,
        trip.depositCents,
        trip.totalCents,
        trip.places.pickup === "delivery" ? null : trip.places.pickup.id,
        deliveryAddress,
        trip.places.returnTo.id,
        POLICY.agreementVersion,
        now,
        meta.ip,
        deliveryAddress ? ["delivery_address"] : [],
      ],
    );
    return { code: rows[0]!.code };
  });
}

/** A renter can let go of dates they haven't paid for yet. Once a screenshot is in, they message the host. */
export async function cancelUnpaid(db: TxDb, user: UserRecord, code: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await ownRow(tx, user, code, true);
    if (row.status !== "awaiting_payment") {
      throw new HttpError(409, row.status === "payment_review"
        ? "Your payment is being checked. Message us to cancel so we can send your money back."
        : "This booking can't be cancelled here. Message us for help.");
    }
    await tx.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = $2, cancel_reason = 'Cancelled by renter before paying' WHERE id = $1`,
      [row.id, now],
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Payment proof
// ---------------------------------------------------------------------------------------------

export type ProofInput = { method: unknown; senderName: unknown; file: unknown };

/**
 * Takes a payment screenshot and puts the booking in front of the host. A screenshot is never
 * proof on its own: the booking is confirmed only after the host sees the money in their account.
 * A renter who paid just after their hold ran out is still taken in, flagged if the dates are gone.
 */
export async function submitProof(
  db: TxDb,
  store: ProofStore,
  cfg: PaymentConfig,
  user: UserRecord,
  code: string,
  input: ProofInput,
  hostEmails: string[],
  now: Date,
): Promise<void> {
  const methods = enabledMethods(cfg);
  if (typeof input.method !== "string" || !(methods as string[]).includes(input.method)) {
    throw badRequest("Choose how you paid.", "method");
  }
  const method = input.method as PaymentMethod;
  const senderName = typeof input.senderName === "string" ? input.senderName.trim().replace(/\s+/g, " ") : "";
  if (!senderName) throw badRequest("Enter the name on the account you paid from.", "senderName");
  if (senderName.length > 120) throw badRequest("That name is too long.", "senderName");
  if (!(input.file instanceof Blob) || input.file.size === 0) throw badRequest("Add a screenshot of your payment.", "file");
  if (input.file.size > POLICY.maxProofBytes) throw badRequest("That image is too large. Use a screenshot under 5 MB.", "file");
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const contentType = sniffImage(bytes);
  if (!contentType) throw badRequest("Upload a screenshot as a JPG, PNG or WebP image.", "file");

  const row = await ownRow(db, user, code);
  if (row.status === "confirmed" || row.status === "active" || row.status === "returned" || row.status === "closed") {
    throw new HttpError(409, "This booking is already paid and confirmed.");
  }
  if (row.status === "cancelled" || row.status === "expired") {
    throw new HttpError(409, "This booking was cancelled. If you already paid, message us at admin@traffic36.com and we'll sort it out.");
  }
  const { rows: count } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM payment_proofs WHERE booking_id = $1`, [row.id]);
  if ((count[0]?.n ?? 0) >= POLICY.maxProofsPerBooking) {
    throw new HttpError(429, "That's the most screenshots one booking can take. Message us if something's wrong.");
  }

  const proofId = randomUUID();
  const blobKey = `${row.id}/${proofId}`;
  await store.put(blobKey, bytes.buffer as ArrayBuffer, contentType);

  await db.transaction(async (tx) => {
    await lockVehicle(tx, row.vehicle_id);
    const fresh = (await rowByCode(tx, code, true))!;
    if (fresh.status !== "awaiting_payment" && fresh.status !== "payment_review") {
      throw new HttpError(409, "This booking changed while you were uploading. Refresh the page.");
    }
    const holdRanOut = fresh.status === "awaiting_payment" && (!fresh.hold_expires_at || fresh.hold_expires_at <= now);
    const taken = holdRanOut && (await findConflicts(tx, fresh.vehicle_id, fresh.starts_at, fresh.ends_at, { now, ignoreBookingId: fresh.id })).length > 0;
    await tx.query(
      `INSERT INTO payment_proofs (id, booking_id, method, sender_name, blob_key, content_type, byte_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [proofId, fresh.id, method, senderName, blobKey, contentType, bytes.byteLength],
    );
    await tx.query(
      `UPDATE bookings SET status = 'payment_review', hold_expires_at = NULL, payment_method = $2, payment_note = NULL,
         review_reasons = CASE WHEN $3 AND NOT ('dates_taken' = ANY(review_reasons))
                               THEN array_append(review_reasons, 'dates_taken') ELSE review_reasons END
       WHERE id = $1`,
      [fresh.id, method, taken],
    );
    for (const email of hostEmails) {
      await tx.query(`INSERT INTO outbox (channel, recipient, template, payload) VALUES ('email', $1, 'host_payment_review', $2)`, [
        email,
        { code, amount: formatMoney(fresh.charge_cents), method, senderName },
      ]);
    }
  });
}

/** The screenshot bytes, for the renter who uploaded it or the host. */
export async function readProof(
  db: Db,
  store: ProofStore,
  user: UserRecord,
  code: string,
  proofId: string,
): Promise<{ data: ArrayBuffer; contentType: string }> {
  const row = await rowByCode(db, code);
  if (!row || (row.renter_id !== user.id && user.role !== "host")) throw notFound("We couldn't find that screenshot.");
  if (!/^[0-9a-f-]{36}$/i.test(proofId)) throw notFound("We couldn't find that screenshot.");
  const { rows } = await db.query<{ blob_key: string }>(`SELECT blob_key FROM payment_proofs WHERE id = $1 AND booking_id = $2`, [proofId, row.id]);
  const key = rows[0]?.blob_key;
  const blob = key ? await store.get(key) : null;
  if (!blob) throw notFound("We couldn't find that screenshot.");
  return blob;
}

// ---------------------------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------------------------

export async function hostDashboard(db: Db, cfg: PaymentConfig, now: Date) {
  const list = async (where: string, order: string, params: unknown[] = []) => {
    const { rows } = await db.query<Row>(`${SELECT} WHERE ${where} ORDER BY ${order} LIMIT 50`, params);
    const proofs = await proofsFor(db, rows);
    return rows.map((r) => toHostBooking(r, proofs.get(r.id) ?? [], cfg, now));
  };
  const [licenses, review, awaitingPayment, upcoming, depositsDue] = await Promise.all([
    pendingLicenses(db, now),
    list(`b.status = 'payment_review'`, `b.starts_at`),
    list(`b.status = 'awaiting_payment' AND b.hold_expires_at > $1`, `b.hold_expires_at`, [now]),
    list(`b.status IN ('confirmed', 'active') AND b.ends_at > $1`, `b.starts_at`, [now]),
    list(`b.status IN ('confirmed', 'active', 'returned') AND b.ends_at <= $1`, `b.ends_at`, [now]),
  ]);
  return { licenses, review, awaitingPayment, upcoming, depositsDue };
}

async function hostRow(tx: Db, code: string): Promise<Row> {
  const row = await rowByCode(tx, code, true);
  if (!row) throw notFound("We couldn't find that booking.");
  return row;
}

const audit = (tx: Db, host: UserRecord, action: string, row: Row, details: Record<string, unknown>) =>
  tx.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES ($1, $2, 'booking', $3, $4)`, [
    host.id,
    action,
    row.id,
    { code: row.code, ...details },
  ]);

const notifyRenter = (tx: Db, row: Row, template: string, payload: Record<string, unknown>) =>
  row.r_email
    ? tx.query(`INSERT INTO outbox (channel, recipient, template, payload) VALUES ('email', $1, $2, $3)`, [
        row.r_email,
        template,
        { code: row.code, ...payload },
      ])
    : Promise.resolve();

/** The host saw the money arrive. Confirms the trip; a delivery booking also needs the address approved. */
export async function confirmPayment(
  db: TxDb,
  host: UserRecord,
  code: string,
  input: { approveDelivery?: unknown },
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const peek = await rowByCode(tx, code);
    if (!peek) throw notFound("We couldn't find that booking.");
    await lockVehicle(tx, peek.vehicle_id);
    const row = await hostRow(tx, code);
    if (row.status !== "payment_review") throw new HttpError(409, "This booking isn't waiting for a payment check.");
    if (row.delivery_address && input.approveDelivery !== true) {
      throw badRequest("Approve the delivery address to confirm this booking.", "approveDelivery");
    }
    // The license as approved, not as typed at checkout: the host may have corrected it.
    if (row.r_identity !== "verified" || !row.r_dob || !row.r_expires) {
      throw new HttpError(409, "Approve this renter's license first. It's under Licenses to review.");
    }
    if (!validThrough(row.r_expires, row.ends_at.getTime(), POLICY.timeZone)) {
      throw new HttpError(409, "The renter's license expires before this trip ends. Reject the payment and send the money back.");
    }
    const minAge = Math.max(row.v_min_age, POLICY.minAgeFloor);
    if (ageAt(row.r_dob, row.starts_at.getTime(), POLICY.timeZone) < minAge) {
      throw new HttpError(409, `The approved license shows the renter is under ${minAge}, the minimum for this car. Reject the payment and send the money back.`);
    }
    const conflicts = await findConflicts(tx, row.vehicle_id, row.starts_at, row.ends_at, { now, ignoreBookingId: row.id });
    if (conflicts.length) {
      throw new HttpError(409, "These dates now overlap another trip. Reject this payment and send the money back, or agree new dates with the renter.");
    }
    await tx.query(
      `UPDATE bookings SET status = 'confirmed', confirmed_at = $2, paid_at = $2, review_reasons = '{}', payment_note = NULL WHERE id = $1`,
      [row.id, now],
    );
    await tx.query(
      `INSERT INTO payments (booking_id, kind, amount_cents, status, method, recorded_by)
       VALUES ($1, 'booking_charge', $2, 'succeeded', $3, $4)`,
      [row.id, row.charge_cents, row.payment_method ?? "cash_app", host.id],
    );
    await tx.query(
      `UPDATE payment_proofs SET status = 'accepted', reviewed_by = $2, reviewed_at = $3 WHERE booking_id = $1 AND status = 'pending'`,
      [row.id, host.id, now],
    );
    await audit(tx, host, "payment_confirmed", row, { amountCents: row.charge_cents, method: row.payment_method, deliveryApproved: !!row.delivery_address });
    await notifyRenter(tx, row, "booking_confirmed", { start: row.starts_at.toISOString() });
  });
}

const REJECT_TEXT = {
  not_received: "We couldn't find this payment in our account.",
  wrong_amount: "The amount we received doesn't match your total.",
  name_mismatch: "The payment came from a name that doesn't match your license.",
  other: "",
} as const;

/** The money isn't there or doesn't match. The renter gets a fresh hold and the host's note. */
export async function rejectPayment(
  db: TxDb,
  host: UserRecord,
  code: string,
  input: { reason?: unknown; note?: unknown },
  now: Date,
): Promise<void> {
  const reason = typeof input.reason === "string" && input.reason in REJECT_TEXT ? (input.reason as keyof typeof REJECT_TEXT) : null;
  if (!reason) throw badRequest("Choose a reason.", "reason");
  const extra = typeof input.note === "string" ? input.note.trim().slice(0, 300) : "";
  if (reason === "other" && !extra) throw badRequest("Tell the renter what's wrong.", "note");
  const note = [REJECT_TEXT[reason], extra].filter(Boolean).join(" ");

  await db.transaction(async (tx) => {
    const row = await hostRow(tx, code);
    if (row.status !== "payment_review") throw new HttpError(409, "This booking isn't waiting for a payment check.");
    await tx.query(
      `UPDATE payment_proofs SET status = 'rejected', review_note = $2, reviewed_by = $3, reviewed_at = $4
        WHERE booking_id = $1 AND status = 'pending'`,
      [row.id, note, host.id, now],
    );
    await tx.query(
      `UPDATE bookings SET status = 'awaiting_payment', hold_expires_at = $2, payment_note = $3 WHERE id = $1`,
      [row.id, new Date(now.getTime() + POLICY.holdMinutes * MINUTE), note],
    );
    await audit(tx, host, "payment_rejected", row, { reason, note });
    await notifyRenter(tx, row, "payment_rejected", { note });
  });
}

/** The host calls off a booking that isn't confirmed yet. Any money received goes back by hand. */
export async function cancelByHost(db: TxDb, host: UserRecord, code: string, input: { note?: unknown }, now: Date): Promise<void> {
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : "";
  if (!note) throw badRequest("Add a short reason for the renter.", "note");
  await db.transaction(async (tx) => {
    const row = await hostRow(tx, code);
    if (row.status !== "awaiting_payment" && row.status !== "payment_review") {
      throw new HttpError(409, "Only bookings that aren't confirmed yet can be cancelled here.");
    }
    await tx.query(`UPDATE bookings SET status = 'cancelled', cancelled_at = $2, cancel_reason = $3 WHERE id = $1`, [row.id, now, note]);
    await audit(tx, host, "booking_cancelled", row, { note, hadProof: row.status === "payment_review" });
    await notifyRenter(tx, row, "booking_cancelled", { note });
  });
}

/** After the trip: the host sends the deposit back (all or part) and closes the booking. */
export async function returnDeposit(
  db: TxDb,
  host: UserRecord,
  code: string,
  input: { refundCents?: unknown; note?: unknown },
  now: Date,
): Promise<void> {
  const refund = input.refundCents;
  if (typeof refund !== "number" || !Number.isInteger(refund) || refund < 0) throw badRequest("Enter the amount you sent back.", "refundCents");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";

  await db.transaction(async (tx) => {
    const row = await hostRow(tx, code);
    if (!["confirmed", "active", "returned"].includes(row.status)) throw new HttpError(409, "This booking's deposit is already settled.");
    if (row.ends_at > now) throw new HttpError(409, "Return the deposit after the trip ends.");
    if (refund > row.deposit_cents) throw badRequest(`The deposit was ${formatMoney(row.deposit_cents)}.`, "refundCents");
    const kept = row.deposit_cents - refund;
    if (kept > 0 && !note) throw badRequest("Say what the kept amount covers, like fuel or cleaning.", "note");
    if (refund > 0) {
      await tx.query(
        `INSERT INTO payments (booking_id, kind, amount_cents, status, method, recorded_by, note)
         VALUES ($1, 'deposit_refund', $2, 'succeeded', $3, $4, $5)`,
        [row.id, -refund, row.payment_method ?? "cash_app", host.id, note || null],
      );
    }
    await tx.query(
      `UPDATE bookings SET status = 'closed', closed_at = $2, refunded_cents = refunded_cents + $3,
         deposit_deduction_cents = $4, deposit_note = $5 WHERE id = $1`,
      [row.id, now, refund, kept, note || null],
    );
    await audit(tx, host, "deposit_returned", row, { refundCents: refund, keptCents: kept, note });
    await notifyRenter(tx, row, "deposit_returned", { refund: formatMoney(refund), kept: formatMoney(kept), note });
  });
}
