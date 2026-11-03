import Stripe from "stripe";
import type { Db } from "./db.ts";
import { requireEnv } from "./env.ts";
import { HttpError } from "./http.ts";
import { findUserById, licenseValid, type UserRecord } from "./users.ts";
import { POLICY } from "../shared/policy.ts";
import { validThrough } from "../shared/pricing.ts";

/** What Stripe reports about one license check. Sensitive fields are read once, right after the check. */
export type IdentityResult =
  | { status: "requires_input"; url: string | null; reason: string | null }
  | { status: "processing" }
  | { status: "canceled" }
  | {
      status: "verified";
      firstName: string | null;
      lastName: string | null;
      dob: string | null;
      expiresOn: string | null;
      state: string | null;
      last4: string | null;
    };

export interface IdentityProvider {
  create(opts: { userId: string; returnUrl: string; idempotencyKey: string }): Promise<{ id: string; url: string }>;
  retrieve(sessionId: string): Promise<IdentityResult>;
  /** Checks a webhook's signature. Returns the session it concerns, or null for events we ignore. */
  webhookSession(body: string, signature: string): Promise<string | null>;
}

const ymd = (d: { year: number | null; month: number | null; day: number | null } | null | undefined) =>
  d?.year && d.month && d.day ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null;

/**
 * Stripe Identity. Needs a restricted key (STRIPE_SECRET_KEY) with Identity verification sessions
 * set to Write, plus Identity Verification Results and Recent Detailed Verification Results set to
 * Read: Stripe releases date of birth and license expiry only to restricted keys.
 */
export function stripeIdentity(): IdentityProvider {
  let stripe: Stripe | null = null;
  const client = () => (stripe ??= new Stripe(requireEnv("STRIPE_SECRET_KEY"), { maxNetworkRetries: 2, timeout: 15_000 }));
  return {
    async create({ userId, returnUrl, idempotencyKey }) {
      const session = await client().identity.verificationSessions.create(
        {
          type: "document",
          client_reference_id: userId,
          metadata: { user_id: userId },
          options: {
            document: {
              allowed_types: ["driving_license"],
              require_live_capture: true,
              require_matching_selfie: true,
            },
          },
          return_url: returnUrl,
        },
        { idempotencyKey },
      );
      if (!session.url) throw new Error(`Stripe returned no URL for verification session ${session.id}`);
      return { id: session.id, url: session.url };
    },
    async retrieve(sessionId) {
      const s = await client().identity.verificationSessions.retrieve(sessionId, {
        expand: [
          "verified_outputs",
          "verified_outputs.dob",
          "last_verification_report",
          "last_verification_report.document.expiration_date",
          "last_verification_report.document.number",
        ],
      });
      if (s.status === "verified") {
        const out = s.verified_outputs;
        const report = typeof s.last_verification_report === "object" ? s.last_verification_report : null;
        const doc = report?.document;
        return {
          status: "verified",
          firstName: out?.first_name ?? doc?.first_name ?? null,
          lastName: out?.last_name ?? doc?.last_name ?? null,
          dob: ymd(out?.dob) ?? ymd(doc?.dob),
          expiresOn: ymd(doc?.expiration_date),
          state: out?.address?.state ?? doc?.address?.state ?? null,
          last4: doc?.number ? doc.number.slice(-4) : null,
        };
      }
      if (s.status === "requires_input") return { status: "requires_input", url: s.url, reason: s.last_error?.reason ?? null };
      if (s.status === "processing") return { status: "processing" };
      return { status: "canceled" };
    },
    async webhookSession(body, signature) {
      const event = await client().webhooks.constructEventAsync(body, signature, requireEnv("STRIPE_WEBHOOK_SECRET"));
      if (!event.type.startsWith("identity.verification_session.")) return null;
      return (event.data.object as { id?: string }).id ?? null;
    },
  };
}

/** Saves what a check concluded. Returns the updated user. */
async function applyResult(db: Db, user: UserRecord, result: IdentityResult, now: Date): Promise<UserRecord> {
  if (result.status === "processing") {
    await db.query(`UPDATE users SET identity_status = 'pending', identity_failure_reason = NULL WHERE id = $1`, [user.id]);
  } else if (result.status === "canceled") {
    await db.query(`UPDATE users SET identity_status = 'none', identity_session_id = NULL WHERE id = $1`, [user.id]);
  } else if (result.status === "requires_input") {
    // No error yet means the renter opened the check but hasn't finished it.
    await db.query(`UPDATE users SET identity_status = $2, identity_failure_reason = $3 WHERE id = $1`, [
      user.id,
      result.reason ? "failed" : "pending",
      result.reason,
    ]);
  } else {
    // Stripe verified the document. Our own rules still apply: it has to be current and readable.
    const problem = !result.dob || !result.expiresOn
      ? "We couldn't read the birth date or expiry date on that license. Try again with a clearer photo."
      : !validThrough(result.expiresOn, now.getTime(), POLICY.timeZone)
        ? "That license has expired. Verify a current driver's license."
        : null;
    const name = [result.firstName, result.lastName].filter(Boolean).join(" ") || null;
    await db.query(
      `UPDATE users SET
         identity_status = $2, identity_failure_reason = $3, identity_verified_at = CASE WHEN $2 = 'verified' THEN now() END,
         identity_name = $4, identity_dob = $5::date, license_expires_on = $6::date, license_state = $7, license_last4 = $8
       WHERE id = $1`,
      [user.id, problem ? "failed" : "verified", problem, name, result.dob, result.expiresOn, result.state, result.last4],
    );
  }
  return (await findUserById(db, user.id))!;
}

/** Asks Stripe for the latest on a renter's open check and saves it. Safe to call repeatedly. */
export async function refreshIdentity(db: Db, provider: IdentityProvider, user: UserRecord, now: Date): Promise<UserRecord> {
  if (!user.identitySessionId || user.identityStatus === "verified") return user;
  return applyResult(db, user, await provider.retrieve(user.identitySessionId), now);
}

/**
 * Where to send the renter to check their license. Reuses an unfinished check so a renter who
 * leaves halfway picks up where they stopped, and caps fresh checks because each one costs money.
 */
export async function startIdentity(
  db: Db,
  provider: IdentityProvider,
  user: UserRecord,
  returnUrl: string,
  now: Date,
): Promise<{ url: string } | { done: true }> {
  if (licenseValid(user, now)) return { done: true };
  if (user.doNotRent) throw new HttpError(403, "We can't take bookings for this account. Message us at admin@traffic36.com.");

  if (user.identitySessionId && user.identityStatus !== "verified") {
    const result = await provider.retrieve(user.identitySessionId);
    if (result.status === "requires_input" && result.url) return { url: result.url };
    if (result.status === "processing") throw new HttpError(409, "Stripe is still checking your license. This usually takes a minute.");
    if (result.status === "verified") {
      const updated = await applyResult(db, user, result, now);
      if (licenseValid(updated, now)) return { done: true };
    }
    // Canceled, or verified but unusable (expired): start a fresh check below.
  }

  if (user.identityAttempts >= POLICY.maxIdentityAttempts) {
    throw new HttpError(429, "You've reached the limit for license checks. Message us at admin@traffic36.com and we'll help.");
  }
  const session = await provider.create({
    userId: user.id,
    returnUrl,
    // Same previous check, same key: a double tap can't create two paid checks.
    idempotencyKey: `identity:${user.id}:${user.identitySessionId ?? "first"}:${user.identityAttempts}`,
  });
  await db.query(
    `UPDATE users SET identity_session_id = $2, identity_status = 'pending', identity_failure_reason = NULL,
       identity_attempts = identity_attempts + 1 WHERE id = $1`,
    [user.id, session.id],
  );
  return { url: session.url };
}

/** Handles a Stripe webhook about a license check. Unknown sessions are ignored. */
export async function identityWebhook(db: Db, provider: IdentityProvider, sessionId: string, now: Date): Promise<void> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE identity_session_id = $1`, [sessionId]);
  const row = rows[0];
  if (!row) return;
  const user = (await findUserById(db, row.id))!;
  await refreshIdentity(db, provider, user, now);
}
