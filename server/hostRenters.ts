/** The host's view of renters: a searchable list, a full profile, and a full booking record. */
import type { Db, TxDb } from "./db.ts";
import { HttpError, badRequest, notFound } from "./http.ts";
import { hostBookings, type PaymentConfig } from "./bookings.ts";
import type { HostArchive } from "../shared/types.ts";
import type { UserRecord } from "./users.ts";
import { POLICY } from "../shared/policy.ts";
import { ageAt, validThrough } from "../shared/pricing.ts";
import type {
  ActivityEntry,
  HostBookingDetail,
  IdDocumentKind,
  IdentityState,
  PaymentEntry,
  RenterProfile,
  RenterSummary,
} from "../shared/types.ts";

type SummaryRow = {
  id: string;
  name: string;
  identity_name: string | null;
  email: string | null;
  phone: string | null;
  identity_status: string;
  identity_method: string | null;
  license_expires_on: string | null;
  trips: number;
  last_trip_at: Date | null;
  created_at: Date;
  do_not_rent: boolean;
  archived_at: Date | null;
};

const SUMMARY = `
  SELECT u.id, u.name, u.identity_name, u.email, u.phone, u.identity_status, u.identity_method,
         u.license_expires_on::text AS license_expires_on, u.created_at, u.do_not_rent, u.archived_at,
         (SELECT count(*)::int FROM bookings b WHERE b.renter_id = u.id AND b.status IN ('confirmed', 'active', 'returned', 'closed')) AS trips,
         (SELECT max(b.starts_at) FROM bookings b WHERE b.renter_id = u.id AND b.status IN ('confirmed', 'active', 'returned', 'closed')) AS last_trip_at
    FROM users u`;

function licenseState(r: { identity_status: string; identity_method: string | null; license_expires_on: string | null }, now: Date): IdentityState {
  if (r.identity_status === "verified" && r.license_expires_on && !validThrough(r.license_expires_on, now.getTime(), POLICY.timeZone)) return "expired";
  if (r.identity_status === "pending" && r.identity_method === "manual") return "in_review";
  return r.identity_status as IdentityState;
}

const summary = (r: SummaryRow, now: Date): RenterSummary => ({
  id: r.id,
  name: r.identity_name ?? r.name,
  email: r.email,
  phone: r.phone,
  licenseStatus: licenseState(r, now),
  trips: r.trips,
  lastTripAt: r.last_trip_at?.toISOString() ?? null,
  joinedAt: r.created_at.toISOString(),
  doNotRent: r.do_not_rent,
  archived: !!r.archived_at,
});

/**
 * Everyone who has signed up as a renter, newest activity first. `q` matches name, email or phone.
 * Archived renters are listed only when asked for.
 */
export async function listRenters(db: Db, q: string, now: Date, opts: { archived?: boolean } = {}): Promise<RenterSummary[]> {
  const term = q.trim().slice(0, 80);
  const digits = term.replace(/\D/g, "");
  const { rows } = await db.query<SummaryRow>(
    `${SUMMARY}
      WHERE u.role = 'renter' AND (u.archived_at IS NOT NULL) = $3
        AND ($1 = '' OR u.name ILIKE '%' || $1 || '%' OR u.identity_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%'
             OR ($2 <> '' AND regexp_replace(coalesce(u.phone, ''), '\\D', '', 'g') LIKE '%' || $2 || '%'))
      ORDER BY coalesce((SELECT max(b.created_at) FROM bookings b WHERE b.renter_id = u.id), u.created_at) DESC
      LIMIT 200`,
    [term, digits.length >= 3 ? digits : "", !!opts.archived],
  );
  return rows.map((r) => summary(r, now));
}

const uuid = (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("We couldn't find that renter.");
  return id;
};

async function paymentsFor(db: Db, where: string, param: string): Promise<PaymentEntry[]> {
  const { rows } = await db.query<{ code: string; kind: PaymentEntry["kind"]; amount_cents: number; method: string; note: string | null; created_at: Date }>(
    `SELECT b.code, p.kind, p.amount_cents, p.method, p.note, p.created_at
       FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE ${where} AND p.status = 'succeeded'
      ORDER BY p.created_at DESC`,
    [param],
  );
  return rows.map((r) => ({ bookingCode: r.code, kind: r.kind, amountCents: r.amount_cents, method: r.method, note: r.note, at: r.created_at.toISOString() }));
}

/** Everything about one renter: license (with photos), contact, every booking and every payment. */
export async function renterProfile(db: Db, cfg: PaymentConfig, id: string, now: Date): Promise<RenterProfile> {
  uuid(id);
  const { rows } = await db.query<SummaryRow & {
    identity_dob: string | null; license_state: string | null; license_last4: string | null;
    identity_verified_at: Date | null; do_not_rent_note: string | null; role: string;
  }>(
    `${SUMMARY.replace("SELECT u.id,", `SELECT u.role, u.identity_dob::text AS identity_dob, u.license_state, u.license_last4,
         u.identity_verified_at, u.do_not_rent_note, u.id,`)} WHERE u.id = $1`,
    [id],
  );
  const u = rows[0];
  if (!u || u.role !== "renter") throw notFound("We couldn't find that renter.");

  const { rows: subs } = await db.query<{
    id: string; status: RenterProfile["licenses"][number]["status"]; legal_name: string; dob: string; license_state: string;
    license_expires_on: string; review_note: string | null; created_at: Date;
    documents: { id: string; kind: IdDocumentKind }[] | null;
  }>(
    `SELECT s.id, s.status, s.legal_name, s.dob::text AS dob, s.license_state, s.license_expires_on::text AS license_expires_on,
            s.review_note, s.created_at,
            (SELECT json_agg(json_build_object('id', d.id, 'kind', d.kind)) FROM identity_documents d WHERE d.submission_id = s.id) AS documents
       FROM identity_submissions s WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 20`,
    [id],
  );
  const order: IdDocumentKind[] = ["license_front", "license_back", "selfie"];

  return {
    ...summary(u, now),
    accountName: u.name,
    verifiedName: u.identity_name,
    dob: u.identity_dob,
    age: u.identity_dob ? ageAt(u.identity_dob, now.getTime(), POLICY.timeZone) : null,
    licenseState: u.license_state,
    licenseExpiresOn: u.license_expires_on,
    licenseLast4: u.license_last4,
    licenseApprovedAt: u.identity_status === "verified" ? (u.identity_verified_at?.toISOString() ?? null) : null,
    doNotRentNote: u.do_not_rent_note,
    licenses: subs.map((s) => ({
      submittedAt: s.created_at.toISOString(),
      status: s.status,
      legalName: s.legal_name,
      dob: s.dob,
      licenseState: s.license_state,
      licenseExpiresOn: s.license_expires_on,
      reviewNote: s.review_note,
      documents: (s.documents ?? [])
        .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
        .map((d) => ({ kind: d.kind, url: `/api/identity/documents/${d.id}` })),
    })),
    bookings: await hostBookings(db, cfg, now, "b.renter_id = $1", "b.starts_at DESC", [id], 100),
    payments: await paymentsFor(db, "b.renter_id = $1", id),
  };
}

/** One booking with its money trail and every host action on it. */
export async function hostBookingDetail(db: Db, cfg: PaymentConfig, code: string, now: Date): Promise<HostBookingDetail> {
  const [booking] = await hostBookings(db, cfg, now, "b.code = $1", "b.created_at", [code], 1);
  if (!booking) throw notFound("We couldn't find that booking.");
  const { rows } = await db.query<{ action: string; created_at: Date; details: Record<string, unknown> }>(
    `SELECT a.action, a.created_at, a.details FROM audit_log a JOIN bookings b ON a.entity = 'booking' AND a.entity_id = b.id::text
      WHERE b.code = $1 ORDER BY a.created_at DESC`,
    [code],
  );
  const activity: ActivityEntry[] = rows.map((r) => ({ action: r.action, at: r.created_at.toISOString(), details: r.details }));
  return { ...booking, payments: await paymentsFor(db, "b.code = $1", code), activity };
}

/** Stops (or lets again) an account from booking. The note is for the host only. */
export async function setDoNotRent(db: TxDb, host: UserRecord, id: string, input: { value?: unknown; note?: unknown }): Promise<void> {
  uuid(id);
  if (typeof input.value !== "boolean") throw badRequest("Choose whether this renter can book.", "value");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  if (input.value && !note) throw badRequest("Add a short reason, for your records.", "note");
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ role: string }>(`SELECT role FROM users WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw notFound("We couldn't find that renter.");
    if (rows[0].role !== "renter") throw new HttpError(409, "Only renter accounts can be blocked.");
    await tx.query(`UPDATE users SET do_not_rent = $2, do_not_rent_note = $3 WHERE id = $1`, [id, input.value, input.value ? note : null]);
    await tx.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES ($1, $2, 'user', $3, $4)`, [
      host.id,
      input.value ? "renter_blocked" : "renter_unblocked",
      id,
      { note },
    ]);
  });
}

/**
 * Hides a renter from the host's list, or brings them back. Nothing about them is deleted, and they
 * come back on their own if they book again or send a new license. A renter with a trip still in
 * play can't be archived until it's cancelled or ended.
 */
export async function setRenterArchived(db: TxDb, host: UserRecord, id: string, input: { value?: unknown }, now: Date): Promise<void> {
  uuid(id);
  if (typeof input.value !== "boolean") throw badRequest("Choose whether to archive this renter.", "value");
  const archive = input.value;
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ role: string; archived_at: Date | null }>(`SELECT role, archived_at FROM users WHERE id = $1 FOR UPDATE`, [id]);
    const u = rows[0];
    if (!u) throw notFound("We couldn't find that renter.");
    if (u.role !== "renter") throw new HttpError(409, "Only renter accounts can be archived.");
    if (archive) {
      const { rows: live } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM bookings
          WHERE renter_id = $1 AND (status = 'payment_review'
             OR (status = 'awaiting_payment' AND hold_expires_at > $2)
             OR (status IN ('confirmed', 'active') AND ends_at > $2))`,
        [id, now],
      );
      if ((live[0]?.n ?? 0) > 0) throw new HttpError(409, "This renter has a booking still in play. Cancel it or end the trip first.");
    }
    if (archive === !!u.archived_at) return;
    await tx.query(`UPDATE users SET archived_at = $2, archived_by = $3 WHERE id = $1`, [id, archive ? now : null, archive ? host.id : null]);
    await tx.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES ($1, $2, 'user', $3, '{}')`, [
      host.id,
      archive ? "renter_archived" : "renter_restored",
      id,
    ]);
  });
}

/** Everything the host has cleared from their lists, most recent first. */
export async function hostArchive(db: Db, cfg: PaymentConfig, now: Date): Promise<HostArchive> {
  const [bookings, renters] = await Promise.all([
    hostBookings(db, cfg, now, "b.archived_at IS NOT NULL", "b.archived_at DESC", [], 200),
    listRenters(db, "", now, { archived: true }),
  ]);
  return { bookings, renters };
}
