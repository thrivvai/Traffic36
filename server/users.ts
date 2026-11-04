import { randomInt } from "node:crypto";
import type { Db } from "./db.ts";
import type { AuthProvider, ClerkProfile } from "./auth.ts";
import { HttpError } from "./http.ts";
import { POLICY } from "../shared/policy.ts";
import { validThrough } from "../shared/pricing.ts";
import type { Me } from "../shared/types.ts";

export type IdentityStatus = "none" | "pending" | "verified" | "failed";

export type UserRecord = {
  id: string;
  clerkUserId: string;
  role: "renter" | "host";
  name: string;
  email: string | null;
  phone: string | null;
  identityStatus: IdentityStatus;
  /** How the license was (or is being) checked: reviewed by the host, or by Stripe. */
  identityMethod: "manual" | "stripe" | null;
  identitySessionId: string | null;
  identityName: string | null;
  identityDob: string | null;
  licenseExpiresOn: string | null;
  licenseState: string | null;
  licenseLast4: string | null;
  identityFailureReason: string | null;
  identityAttempts: number;
  doNotRent: boolean;
};

export const USER_COLUMNS = `
  id, clerk_user_id AS "clerkUserId", role, name, email, phone,
  identity_status AS "identityStatus", identity_method AS "identityMethod", identity_session_id AS "identitySessionId", identity_name AS "identityName",
  identity_dob::text AS "identityDob", license_expires_on::text AS "licenseExpiresOn",
  license_state AS "licenseState", license_last4 AS "licenseLast4",
  identity_failure_reason AS "identityFailureReason", identity_attempts AS "identityAttempts",
  do_not_rent AS "doNotRent"`;

export async function findUserByClerkId(db: Db, clerkUserId: string): Promise<UserRecord | null> {
  const { rows } = await db.query<UserRecord>(`SELECT ${USER_COLUMNS} FROM users WHERE clerk_user_id = $1`, [clerkUserId]);
  return rows[0] ?? null;
}

export async function findUserById(db: Db, id: string): Promise<UserRecord | null> {
  const { rows } = await db.query<UserRecord>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I, so codes read cleanly aloud

function referralCode(): string {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

/** HOST_EMAILS is a comma-separated list of the emails that get the host console. */
export function parseHostEmails(value: string | undefined): string[] {
  return (value ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/**
 * Creates or refreshes the app's row for a Clerk user. The host role follows HOST_EMAILS on every
 * sync, so removing an email there removes host access the next time that person loads the app.
 */
export async function syncUser(db: Db, clerkUserId: string, profile: ClerkProfile, hostEmails: string[]): Promise<UserRecord> {
  const role = profile.email && hostEmails.includes(profile.email.toLowerCase()) ? "host" : "renter";
  const { rows } = await db.query<UserRecord>(
    `INSERT INTO users (clerk_user_id, role, name, email, phone, referral_code)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (clerk_user_id) DO UPDATE
       SET role = EXCLUDED.role, name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone
     RETURNING ${USER_COLUMNS}`,
    [clerkUserId, role, profile.name.slice(0, 200), profile.email, profile.phone, referralCode()],
  );
  return rows[0]!;
}

export type AuthDeps = { db: Db; auth: AuthProvider; hostEmails: string[] };

/** The signed-in user, creating their row on first contact. Throws 401 when signed out. */
export async function requireUser(req: Request, deps: AuthDeps, opts: { refresh?: boolean } = {}): Promise<UserRecord> {
  const clerkUserId = await deps.auth.userIdFrom(req);
  if (!clerkUserId) throw new HttpError(401, "Sign in to continue.");
  const existing = opts.refresh ? null : await findUserByClerkId(deps.db, clerkUserId);
  return existing ?? syncUser(deps.db, clerkUserId, await deps.auth.profile(clerkUserId), deps.hostEmails);
}

export async function requireHost(req: Request, deps: AuthDeps): Promise<UserRecord> {
  const user = await requireUser(req, deps);
  if (user.role !== "host") throw new HttpError(403, "This page is for the host.");
  return user;
}

/** True when the renter's license check is done and the license is still valid on `at`. */
export function licenseValid(user: UserRecord, at: Date): boolean {
  return user.identityStatus === "verified" && licenseCurrent(user, at);
}

/** True when the expiry date on file (verified or not) is still good on `at`. */
export function licenseCurrent(user: UserRecord, at: Date): boolean {
  return !!user.licenseExpiresOn && validThrough(user.licenseExpiresOn, at.getTime(), POLICY.timeZone);
}

/**
 * Can this renter hold dates? Yes once their license is approved, and also while a hand-reviewed
 * license is waiting for the host: the host approves it together with the payment, and a booking
 * can't be confirmed before that.
 */
export function canBook(user: UserRecord): boolean {
  return (
    !!user.identityDob &&
    !!user.licenseExpiresOn &&
    (user.identityStatus === "verified" || (user.identityStatus === "pending" && user.identityMethod === "manual"))
  );
}

/** What the browser is allowed to know about the signed-in user. Date of birth never leaves the server. */
export function publicMe(user: UserRecord, now: Date): Me {
  const expired = user.identityStatus === "verified" && !licenseValid(user, now);
  const inReview = user.identityStatus === "pending" && user.identityMethod === "manual";
  return {
    name: user.identityName ?? user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    identity: {
      status: expired ? "expired" : inReview ? "in_review" : user.identityStatus,
      method: user.identityMethod,
      name: user.identityName,
      licenseState: user.licenseState,
      licenseLast4: user.licenseLast4,
      licenseExpiresOn: user.licenseExpiresOn,
      failureReason: user.identityFailureReason,
      attemptsLeft: Math.max(0, POLICY.maxIdentityAttempts - user.identityAttempts),
    },
  };
}
