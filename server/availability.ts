import type { Db } from "./db.ts";
import { MINUTE, POLICY } from "../shared/policy.ts";

export type Conflict = { kind: "booking" | "extension" | "block"; start: Date; end: Date };

/** Booking states that occupy a car's calendar. A `held` booking counts only until its hold expires. */
export const BLOCKING_STATUSES = ["held", "awaiting_verification", "needs_review", "confirmed", "active"] as const;

/**
 * Everything on this car that overlaps [start, end), padded by the turnaround buffer on both sides.
 *
 * Race safety: when a booking is written, call this inside the same transaction after
 * `lockVehicle`. The row lock makes concurrent checkouts for one car run one at a time,
 * so two renters can never both win the same dates.
 */
export async function findConflicts(
  db: Db,
  vehicleId: string,
  start: Date,
  end: Date,
  opts: { now: Date; ignoreBookingId?: string },
): Promise<Conflict[]> {
  const bufferMs = POLICY.turnaroundMinutes * MINUTE;
  const from = new Date(start.getTime() - bufferMs);
  const to = new Date(end.getTime() + bufferMs);
  const { rows } = await db.query<{ kind: Conflict["kind"]; starts_at: Date; ends_at: Date }>(
    `
    SELECT 'booking' AS kind, starts_at, ends_at FROM bookings
     WHERE vehicle_id = $1 AND starts_at < $3 AND ends_at > $2
       AND status = ANY($4::text[])
       AND (status <> 'held' OR hold_expires_at > $5)
       AND ($6::uuid IS NULL OR id <> $6::uuid)
    UNION ALL
    SELECT 'extension', e.old_ends_at, e.new_ends_at FROM extensions e
      JOIN bookings b ON b.id = e.booking_id
     WHERE b.vehicle_id = $1 AND e.status IN ('pending', 'awaiting_payment')
       AND e.old_ends_at < $3 AND e.new_ends_at > $2
       AND ($6::uuid IS NULL OR b.id <> $6::uuid)
    UNION ALL
    SELECT 'block', starts_at, ends_at FROM blocks
     WHERE vehicle_id = $1 AND starts_at < $3 AND ends_at > $2
    ORDER BY 2
    `,
    [vehicleId, from, to, BLOCKING_STATUSES, opts.now, opts.ignoreBookingId ?? null],
  );
  return rows.map((r) => ({ kind: r.kind, start: new Date(r.starts_at), end: new Date(r.ends_at) }));
}

/** Serializes writes for one car. Call first inside a booking or extension transaction. */
export async function lockVehicle(tx: Db, vehicleId: string): Promise<void> {
  await tx.query(`SELECT id FROM vehicles WHERE id = $1 FOR UPDATE`, [vehicleId]);
}
