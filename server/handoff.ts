/**
 * Handing the car over: a lockbox code shown on the renter's pickup pass, an in-person meet,
 * or delivery. Codes are encrypted before they're stored (AES-256-GCM, key in ACCESS_CODE_KEY),
 * so a copy of the database, like the one each preview site gets, never holds a usable code.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Db, TxDb } from "./db.ts";
import { env } from "./env.ts";
import { HttpError, badRequest, notFound } from "./http.ts";
import type { UserRecord } from "./users.ts";
import { MINUTE, POLICY } from "../shared/policy.ts";
import type { Handoff, PickupPass } from "../shared/types.ts";

/** The encryption key from ACCESS_CODE_KEY (32 random bytes, base64), or null when it isn't set up. */
export function codeKeyFromEnv(): Buffer | null {
  const raw = env("ACCESS_CODE_KEY");
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    console.error("ACCESS_CODE_KEY must be 32 random bytes, base64-encoded.");
    return null;
  }
  return key;
}

export function sealCode(code: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function openCode(sealed: string, key: Buffer): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    console.error("A stored lockbox code couldn't be decrypted. Was ACCESS_CODE_KEY changed?");
    return null;
  }
}

/** When the pass opens and closes for a trip. */
export function passWindow(startsAt: Date, endsAt: Date) {
  return {
    opensAt: new Date(startsAt.getTime() - POLICY.passWindowMinutes * MINUTE),
    closesAt: new Date(endsAt.getTime() + POLICY.passCloseAfterReturnMinutes * MINUTE),
  };
}

export type PassInput = {
  status: string;
  startsAt: Date;
  endsAt: Date;
  handoff: Handoff | null;
  sealedCode: string | null;
  note: string | null;
  instructions: string | null;
};

/**
 * What the renter's trip page shows about pickup. The code itself is included only while the pass
 * is open; before that the renter sees when it opens.
 */
export function passFor(input: PassInput, key: Buffer | null, now: Date): PickupPass | null {
  if (input.status !== "confirmed" && input.status !== "active") return null;
  const { opensAt, closesAt } = passWindow(input.startsAt, input.endsAt);
  const open = now >= opensAt && now <= closesAt;
  const code = open && input.handoff === "lockbox" && input.sealedCode && key ? openCode(input.sealedCode, key) : null;
  return {
    handoff: input.handoff,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
    open,
    code,
    note: open ? input.note : null,
    instructions: input.instructions,
  };
}

/** Records that the renter has seen their code, the first time only. */
export async function markRevealed(db: Db, bookingId: string, now: Date): Promise<void> {
  await db.query(`UPDATE access_codes SET revealed_at = $2 WHERE booking_id = $1 AND purpose = 'pickup' AND revealed_at IS NULL`, [
    bookingId,
    now,
  ]);
}

const CODE_PATTERN = /^[A-Za-z0-9#*]{3,12}$/;
const NOTE_MAX = 300;

/** "4-8-2-1" and "4 8 2 1" are the same code as "4821". */
export const normalizeCode = (raw: unknown) => (typeof raw === "string" ? raw.replace(/[\s-]/g, "") : "");

/**
 * The host chooses how a confirmed trip is handed over. A lockbox code can be changed until the
 * trip ends; changing it resets "opened" so the host can see whether the renter saw the new one.
 */
export async function setHandoff(
  db: TxDb,
  key: Buffer | null,
  host: UserRecord,
  code: string,
  input: { method?: unknown; lockboxCode?: unknown; note?: unknown },
  now: Date,
): Promise<void> {
  const method = input.method;
  if (method !== "lockbox" && method !== "in_person") throw badRequest("Choose lockbox or in person.", "method");
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > NOTE_MAX) throw badRequest(`Keep the note under ${NOTE_MAX} characters.`, "note");
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; status: string; starts_at: Date; ends_at: Date; delivery_address: string | null }>(
      `SELECT id, status, starts_at, ends_at, delivery_address FROM bookings WHERE code = $1 FOR UPDATE`,
      [code],
    );
    const b = rows[0];
    if (!b) throw notFound("We couldn't find that booking.");
    if (b.status !== "confirmed" && b.status !== "active") throw new HttpError(409, "Set the pickup plan once the booking is confirmed.");
    if (b.delivery_address) throw new HttpError(409, "This is a delivery. You hand the car over at the renter's address.");
    if (b.ends_at <= now) throw new HttpError(409, "This trip has already ended.");

    if (method === "lockbox") {
      const lockboxCode = normalizeCode(input.lockboxCode);
      if (!CODE_PATTERN.test(lockboxCode)) throw badRequest("Enter the lockbox code: 3 to 12 digits or letters.", "lockboxCode");
      if (!key) {
        console.error("ACCESS_CODE_KEY is missing, so lockbox codes can't be saved. Add it in Netlify.");
        throw new HttpError(503, "Lockbox codes can't be saved right now. Try again shortly.");
      }
      const { opensAt, closesAt } = passWindow(b.starts_at, b.ends_at);
      await tx.query(
        `INSERT INTO access_codes (booking_id, purpose, code_ciphertext, valid_from, valid_to, source, set_by, updated_at)
         VALUES ($1, 'pickup', $2, $3, $4, 'manual', $5, $6)
         ON CONFLICT (booking_id, purpose) DO UPDATE
           SET code_ciphertext = EXCLUDED.code_ciphertext, valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to,
               source = 'manual', set_by = EXCLUDED.set_by, updated_at = EXCLUDED.updated_at, revealed_at = NULL`,
        [b.id, sealCode(lockboxCode, key), opensAt, closesAt, host.id, now],
      );
    } else {
      await tx.query(`DELETE FROM access_codes WHERE booking_id = $1 AND purpose = 'pickup'`, [b.id]);
    }
    await tx.query(`UPDATE bookings SET handoff = $2, handoff_note = $3 WHERE id = $1`, [b.id, method, note || null]);
    // The code itself never goes in the audit log.
    await tx.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES ($1, 'handoff_set', 'booking', $2, $3)`, [
      host.id,
      b.id,
      { code, method },
    ]);
  });
}
