/**
 * Driver's licenses checked by the host. The renter photographs the front and back of their
 * license and takes a selfie holding it, then types the details printed on it. The host compares
 * photos to details and approves (fixing typos if needed) or rejects with a reason.
 */
import { randomUUID } from "node:crypto";
import type { Db, TxDb } from "./db.ts";
import { env } from "./env.ts";
import { HttpError, badRequest, notFound } from "./http.ts";
import { sniffImage, type ProofStore } from "./proofs.ts";
import { findUserById, licenseValid, type UserRecord } from "./users.ts";
import { POLICY } from "../shared/policy.ts";
import { ageAt, validThrough } from "../shared/pricing.ts";
import { isDateString } from "../shared/time.ts";
import type { IdCheckMode, IdDocumentKind, LicenseDetails, LicenseReview } from "../shared/types.ts";
import { US_LICENSE_STATES } from "../shared/usStates.ts";

/** Manual review unless ID_CHECK=stripe is set. Switching back to Stripe later is this one setting. */
export function idCheckMode(): IdCheckMode {
  return env("ID_CHECK") === "stripe" ? "stripe" : "manual";
}

export const ID_DOCUMENT_KINDS: readonly IdDocumentKind[] = ["license_front", "license_back", "selfie"];

/** Saves one photo. Photos go up one at a time so a weak phone signal only has to retry one. */
export async function uploadIdDocument(
  db: Db,
  store: ProofStore,
  user: UserRecord,
  input: { kind: unknown; file: unknown },
  now: Date,
): Promise<{ id: string }> {
  const kind = typeof input.kind === "string" && (ID_DOCUMENT_KINDS as string[]).includes(input.kind) ? (input.kind as IdDocumentKind) : null;
  if (!kind) throw badRequest("Unknown photo type.", "kind");
  if (!(input.file instanceof Blob) || input.file.size === 0) throw badRequest("Add a photo.", kind);
  if (input.file.size > POLICY.maxIdPhotoBytes) throw badRequest("That photo is too large. Retake it or choose a smaller one.", kind);
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const contentType = sniffImage(bytes);
  if (!contentType) throw badRequest("Upload a photo as a JPG, PNG or WebP image.", kind);

  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM identity_documents WHERE user_id = $1 AND created_at > $2`,
    [user.id, new Date(now.getTime() - 24 * 60 * 60_000)],
  );
  if ((rows[0]?.n ?? 0) >= POLICY.maxIdUploadsPerDay) {
    throw new HttpError(429, "That's a lot of uploads for one day. Try again tomorrow or call or text us at (646) 397-3139.");
  }

  const id = randomUUID();
  const blobKey = `${user.id}/${id}`;
  await store.put(blobKey, bytes.buffer as ArrayBuffer, contentType);
  await db.query(
    `INSERT INTO identity_documents (id, user_id, kind, blob_key, content_type, byte_size) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, user.id, kind, blobKey, contentType, bytes.byteLength],
  );
  return { id };
}

/** Checks the typed license details. `who` changes the wording for the host's corrections. */
export function readDetails(input: Record<string, unknown>, now: Date, who: "renter" | "host" = "renter"): LicenseDetails {
  const legalName = typeof input.legalName === "string" ? input.legalName.trim().replace(/\s+/g, " ") : "";
  if (legalName.length < 2) throw badRequest("Enter the full name exactly as it's printed on the license.", "legalName");
  if (legalName.length > 120) throw badRequest("That name is too long.", "legalName");

  const dob = input.dob;
  if (!isDateString(dob)) throw badRequest("Enter the date of birth from the license.", "dob");
  const age = ageAt(dob, now.getTime(), POLICY.timeZone);
  if (age < 0 || age > 110) throw badRequest("Check the date of birth.", "dob");
  if (age < POLICY.minAgeFloor) {
    throw badRequest(who === "renter" ? `Renters must be ${POLICY.minAgeFloor} or older.` : `This renter is under ${POLICY.minAgeFloor}.`, "dob");
  }

  const licenseState = typeof input.licenseState === "string" ? input.licenseState.trim().toUpperCase() : "";
  if (!(licenseState in US_LICENSE_STATES)) throw badRequest("Choose the state that issued the license.", "licenseState");

  const licenseExpiresOn = input.licenseExpiresOn;
  if (!isDateString(licenseExpiresOn)) throw badRequest("Enter the expiration date from the license.", "licenseExpiresOn");
  if (!validThrough(licenseExpiresOn, now.getTime(), POLICY.timeZone)) {
    throw badRequest("That license has expired. Use a current driver's license.", "licenseExpiresOn");
  }
  return { legalName, dob, licenseState, licenseExpiresOn };
}

/**
 * Sends the three photos and the typed details for review. A renter can resend while waiting
 * (to fix a typo or a bad photo); the newer submission replaces the older one.
 */
export async function submitLicense(
  db: TxDb,
  user: UserRecord,
  input: Record<string, unknown>,
  hostEmails: string[],
  now: Date,
): Promise<void> {
  if (user.doNotRent) throw new HttpError(403, "We can't take bookings for this account. Call or text us at (646) 397-3139.");
  if (licenseValid(user, now)) throw new HttpError(409, "Your license is already approved.");
  const details = readDetails(input, now);
  const docs = (input.documents ?? {}) as Partial<Record<IdDocumentKind, unknown>>;
  const ids: Record<IdDocumentKind, string> = { license_front: "", license_back: "", selfie: "" };
  for (const kind of ID_DOCUMENT_KINDS) {
    const id = docs[kind];
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw badRequest(kind === "selfie" ? "Add a selfie holding your license." : `Add a photo of the ${kind === "license_front" ? "front" : "back"} of your license.`, kind);
    }
    ids[kind] = id;
  }

  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; kind: IdDocumentKind }>(
      `SELECT id, kind FROM identity_documents WHERE user_id = $1 AND submission_id IS NULL AND id = ANY($2::uuid[]) FOR UPDATE`,
      [user.id, Object.values(ids)],
    );
    for (const kind of ID_DOCUMENT_KINDS) {
      if (!rows.some((r) => r.id === ids[kind] && r.kind === kind)) {
        throw badRequest("One of your photos didn't upload. Add it again and resend.", kind);
      }
    }
    await tx.query(
      `UPDATE identity_submissions SET status = 'replaced', review_note = 'Replaced by a newer submission' WHERE user_id = $1 AND status = 'pending'`,
      [user.id],
    );
    const { rows: sub } = await tx.query<{ id: string }>(
      `INSERT INTO identity_submissions (user_id, legal_name, dob, license_state, license_expires_on)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [user.id, details.legalName, details.dob, details.licenseState, details.licenseExpiresOn],
    );
    await tx.query(`UPDATE identity_documents SET submission_id = $1 WHERE id = ANY($2::uuid[])`, [sub[0]!.id, Object.values(ids)]);
    await tx.query(
      `UPDATE users SET identity_method = 'manual', identity_status = 'pending', identity_session_id = NULL,
         identity_name = $2, identity_dob = $3, license_state = $4, license_expires_on = $5, license_last4 = NULL,
         identity_failure_reason = NULL, identity_verified_at = NULL
       WHERE id = $1`,
      [user.id, details.legalName, details.dob, details.licenseState, details.licenseExpiresOn],
    );
    for (const email of hostEmails) {
      await tx.query(`INSERT INTO outbox (channel, recipient, template, payload) VALUES ('email', $1, 'host_license_review', $2)`, [
        email,
        { name: details.legalName },
      ]);
    }
  });
}

type ReviewRow = {
  user_id: string;
  created_at: Date;
  legal_name: string;
  dob: string;
  license_state: string;
  license_expires_on: string;
  account_name: string;
  email: string | null;
  phone: string | null;
  documents: { id: string; kind: IdDocumentKind }[] | null;
  open_bookings: string[] | null;
  rejections: number;
};

/** Every license waiting for the host, oldest first, with any trips riding on it. */
export async function pendingLicenses(db: Db, now: Date): Promise<LicenseReview[]> {
  const { rows } = await db.query<ReviewRow>(
    `SELECT s.user_id, s.created_at, s.legal_name, s.dob::text AS dob, s.license_state, s.license_expires_on::text AS license_expires_on,
            u.name AS account_name, u.email, u.phone,
            (SELECT json_agg(json_build_object('id', d.id, 'kind', d.kind) ORDER BY d.kind) FROM identity_documents d WHERE d.submission_id = s.id) AS documents,
            (SELECT array_agg(b.code ORDER BY b.starts_at) FROM bookings b
              WHERE b.renter_id = s.user_id AND b.status IN ('awaiting_payment', 'payment_review', 'confirmed')) AS open_bookings,
            (SELECT count(*)::int FROM identity_submissions r WHERE r.user_id = s.user_id AND r.status = 'rejected') AS rejections
       FROM identity_submissions s JOIN users u ON u.id = s.user_id
      WHERE s.status = 'pending'
      ORDER BY s.created_at`,
  );
  const order: IdDocumentKind[] = ["license_front", "license_back", "selfie"];
  return rows.map((r) => ({
    userId: r.user_id,
    submittedAt: r.created_at.toISOString(),
    accountName: r.account_name,
    email: r.email,
    phone: r.phone,
    legalName: r.legal_name,
    dob: r.dob,
    licenseState: r.license_state,
    licenseExpiresOn: r.license_expires_on,
    age: ageAt(r.dob, now.getTime(), POLICY.timeZone),
    documents: (r.documents ?? [])
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
      .map((d) => ({ kind: d.kind, url: `/api/identity/documents/${d.id}` })),
    openBookings: r.open_bookings ?? [],
    previousRejections: r.rejections,
  }));
}

/** The host approves, with any typos fixed. The approved details become the renter's license on file. */
export async function approveLicense(db: TxDb, host: UserRecord, userId: string, input: Record<string, unknown>, now: Date): Promise<void> {
  const details = readDetails(input, now, "host");
  const last4 = typeof input.licenseLast4 === "string" ? input.licenseLast4.trim().toUpperCase() : "";
  if (last4 && !/^[A-Z0-9]{4}$/.test(last4)) throw badRequest("Enter the last four characters of the license number, or leave it blank.", "licenseLast4");
  await db.transaction(async (tx) => {
    const sub = await pendingSubmission(tx, userId);
    await tx.query(`UPDATE identity_submissions SET status = 'approved', reviewed_by = $2, reviewed_at = $3 WHERE id = $1`, [sub.id, host.id, now]);
    await tx.query(
      `UPDATE users SET identity_status = 'verified', identity_verified_at = $2, identity_reviewed_by = $3, identity_failure_reason = NULL,
         identity_name = $4, identity_dob = $5, license_state = $6, license_expires_on = $7, license_last4 = $8
       WHERE id = $1`,
      [userId, now, host.id, details.legalName, details.dob, details.licenseState, details.licenseExpiresOn, last4 || null],
    );
    await tx.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES ($1, 'license_approved', 'user', $2, $3)`, [
      host.id,
      userId,
      { corrected: details.legalName !== sub.legal_name || details.dob !== sub.dob || details.licenseExpiresOn !== sub.license_expires_on },
    ]);
  });
}

/** The host can't approve. The renter sees the reason and can send new photos. */
export async function rejectLicense(db: TxDb, host: UserRecord, userId: string, input: Record<string, unknown>, now: Date): Promise<void> {
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  if (!reason) throw badRequest("Tell the renter what to fix.", "reason");
  await db.transaction(async (tx) => {
    const sub = await pendingSubmission(tx, userId);
    await tx.query(`UPDATE identity_submissions SET status = 'rejected', review_note = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = $1`, [
      sub.id,
      reason,
      host.id,
      now,
    ]);
    await tx.query(`UPDATE users SET identity_status = 'failed', identity_failure_reason = $2, identity_reviewed_by = $3 WHERE id = $1`, [
      userId,
      reason,
      host.id,
    ]);
    await tx.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES ($1, 'license_rejected', 'user', $2, $3)`, [
      host.id,
      userId,
      { reason },
    ]);
    const renter = await findUserById(tx, userId);
    if (renter?.email) {
      await tx.query(`INSERT INTO outbox (channel, recipient, template, payload) VALUES ('email', $1, 'license_rejected', $2)`, [renter.email, { reason }]);
    }
  });
}

async function pendingSubmission(tx: Db, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw notFound("We couldn't find that license.");
  const { rows } = await tx.query<{ id: string; legal_name: string; dob: string; license_expires_on: string }>(
    `SELECT id, legal_name, dob::text AS dob, license_expires_on::text AS license_expires_on
       FROM identity_submissions WHERE user_id = $1 AND status = 'pending' FOR UPDATE`,
    [userId],
  );
  if (!rows[0]) throw new HttpError(409, "This license isn't waiting for review anymore. Refresh the page.");
  return rows[0];
}

/** A license photo, for the host only. Renters never get these back from the server. */
export async function readIdDocument(db: Db, store: ProofStore, viewer: UserRecord, id: string) {
  if (viewer.role !== "host" || !/^[0-9a-f-]{36}$/i.test(id)) throw notFound("We couldn't find that photo.");
  const { rows } = await db.query<{ blob_key: string }>(`SELECT blob_key FROM identity_documents WHERE id = $1`, [id]);
  const blob = rows[0] ? await store.get(rows[0].blob_key) : null;
  if (!blob) throw notFound("We couldn't find that photo.");
  return blob;
}
