/**
 * Runs the real migrations against a local Postgres-compatible database, then exercises
 * the listing, quote and availability code exactly as the functions call it.
 */
import { NetlifyDB } from "@netlify/database-dev";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { wrapPool, type TxDb } from "../server/db.ts";
import { findConflicts, lockVehicle } from "../server/availability.ts";
import { HttpError } from "../server/http.ts";
import { quoteForVehicle } from "../server/quote.ts";
import { getVehicle, listVehicles } from "../server/vehicles.ts";

const GLC = "mercedes-glc-300-coupe-2021";
const ELANTRA = "hyundai-elantra-sel-sport-2026";
const NOW = new Date("2026-11-03T15:00:00Z"); // Tue Nov 3, 10:00 ET

let server: NetlifyDB;
let pool: pg.Pool;
let db: TxDb;
let applied: string[];

beforeAll(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  applied = await server.applyMigrations("./netlify/database/migrations");
  pool = new pg.Pool({ connectionString, max: 1 });
  db = wrapPool(pool);
});

afterAll(async () => {
  await pool?.end();
  await server?.stop();
});

let renterId: string;
beforeEach(async () => {
  await db.query("DELETE FROM extensions");
  await db.query("DELETE FROM bookings");
  await db.query("DELETE FROM blocks");
  await db.query("DELETE FROM users");
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (clerk_user_id, name, referral_code) VALUES ('user_test', 'Jordan Ellis', 'JORDAN36') RETURNING id`,
  );
  renterId = rows[0]!.id;
});

async function vehicleId(slug: string) {
  return (await getVehicle(db, slug))!.id;
}

async function book(slug: string, start: string, end: string, status = "confirmed", holdExpiresAt: string | null = null) {
  await db.query(
    `INSERT INTO bookings (vehicle_id, renter_id, starts_at, ends_at, status, hold_expires_at,
                           billable_days, rental_cents, deposit_cents, charge_cents)
     VALUES ($1, $2, $3, $4, $5, $6, 1, 9500, 5000, 14500)`,
    [await vehicleId(slug), renterId, start, end, status, holdExpiresAt],
  );
}

const trip = { startDate: "2026-11-06", startTime: "10:00", endDate: "2026-11-09", endTime: "10:00" };

describe("migrations", () => {
  test("apply cleanly in order", () => {
    expect(applied).toEqual(["20261103050000_core_schema", "20261103050100_seed_launch_fleet"]);
  });

  test("booking and incident codes are sequential and human-readable", async () => {
    await book(GLC, "2026-11-20T15:00:00Z", "2026-11-21T15:00:00Z");
    await book(GLC, "2026-11-25T15:00:00Z", "2026-11-26T15:00:00Z");
    const { rows } = await db.query<{ code: string }>("SELECT code FROM bookings ORDER BY code");
    expect(rows.map((r) => r.code)).toEqual(["T36-1001", "T36-1002"]);
  });

  test("the schema rejects impossible data", async () => {
    await expect(book(GLC, "2026-11-21T15:00:00Z", "2026-11-20T15:00:00Z")).rejects.toThrow(); // ends before it starts
    await expect(book(GLC, "2026-11-20T15:00:00Z", "2026-11-21T15:00:00Z", "approved")).rejects.toThrow(); // unknown status
  });
});

describe("listings", () => {
  test("the two launch cars come back in order with photos, rates and lot", async () => {
    const cars = await listVehicles(db);
    expect(cars.map((c) => c.slug)).toEqual([GLC, ELANTRA]);
    const [glc, elantra] = cars;
    expect(glc).toMatchObject({ make: "Mercedes-Benz", model: "GLC 300 Coupe", dailyCents: 9500, weeklyCents: 59500, tier: "luxury" });
    expect(elantra).toMatchObject({ make: "Hyundai", model: "Elantra SEL Sport", dailyCents: 7500, weeklyCents: 45000, tier: "economy" });
    expect(glc!.photos).toHaveLength(5);
    expect(elantra!.photos).toHaveLength(4);
    expect(glc!.photos[0]).toEqual({ src: "/cars/glc-300-coupe-1.webp", alt: "Silver GLC 300 Coupe, front three-quarter view" });
    expect(glc!.specs[0]).toEqual({ value: "255 hp", label: "2.0L turbo four" });
  });

  test("detail includes description and highlights; unknown and paused cars are hidden", async () => {
    const glc = await getVehicle(db, GLC);
    expect(glc?.description).toHaveLength(2);
    expect(glc?.minDriverAge).toBe(25);
    expect(await getVehicle(db, "nope")).toBeNull();
    await db.query(`UPDATE vehicles SET status = 'paused' WHERE slug = $1`, [ELANTRA]);
    expect((await listVehicles(db)).map((c) => c.slug)).toEqual([GLC]);
    await db.query(`UPDATE vehicles SET status = 'active' WHERE slug = $1`, [ELANTRA]);
  });
});

describe("quotes", () => {
  test("price, deposit and due-today come from the server", async () => {
    const q = await quoteForVehicle(db, GLC, trip, NOW);
    expect(q).toMatchObject({ days: 3, rentalCents: 28500, depositCents: 5000, dueTodayCents: 33500, available: true, conflict: null });
    expect(q.start).toBe("2026-11-06T15:00:00.000Z");
  });

  test("a week on the Elantra is $450", async () => {
    const q = await quoteForVehicle(db, ELANTRA, { ...trip, endDate: "2026-11-13" }, NOW);
    expect(q).toMatchObject({ days: 7, rentalCents: 45000, weeklySavingsCents: 7500 });
  });

  test("bad input gets a specific, fixable message", async () => {
    const reject = (input: object) => quoteForVehicle(db, GLC, { ...trip, ...input }, NOW);
    await expect(reject({ startDate: "2026-11-31" })).rejects.toMatchObject({ status: 400, field: "startDate" });
    await expect(reject({ startTime: "25:00" })).rejects.toMatchObject({ field: "startTime" });
    await expect(reject({ startTime: "05:00" })).rejects.toMatchObject({ message: "Pickups and returns run 07:00 to 21:00." });
    await expect(reject({ endDate: "2026-11-05" })).rejects.toMatchObject({ message: "Return has to be after pickup." });
    await expect(reject({ startDate: "2026-11-03", startTime: "10:30" })).rejects.toMatchObject({ field: "startDate" }); // under an hour away
    await expect(reject({ endDate: "2026-12-31" })).rejects.toMatchObject({ message: "Trips can run up to 45 days." });
    await expect(quoteForVehicle(db, "nope", trip, NOW)).rejects.toBeInstanceOf(HttpError);
  });
});

describe("availability", () => {
  test("an overlapping confirmed trip makes the car unavailable and says when", async () => {
    await book(GLC, "2026-11-08T15:00:00Z", "2026-11-12T15:00:00Z");
    const q = await quoteForVehicle(db, GLC, trip, NOW);
    expect(q.available).toBe(false);
    expect(q.conflict).toEqual({ start: "2026-11-08T15:00:00.000Z", end: "2026-11-12T15:00:00.000Z" });
    expect((await quoteForVehicle(db, ELANTRA, trip, NOW)).available).toBe(true); // other car unaffected
  });

  test("the 2-hour turnaround buffer is enforced between trips", async () => {
    await book(GLC, "2026-11-01T15:00:00Z", "2026-11-06T14:00:00Z"); // returns 9:00, an hour before our 10:00 pickup
    expect((await quoteForVehicle(db, GLC, trip, NOW)).available).toBe(false);
    await db.query("DELETE FROM bookings");
    await book(GLC, "2026-11-01T15:00:00Z", "2026-11-06T13:00:00Z"); // returns 8:00, exactly 2 hours before
    expect((await quoteForVehicle(db, GLC, trip, NOW)).available).toBe(true);
  });

  test("expired holds, cancelled and closed trips don't block; live holds and blocks do", async () => {
    await book(GLC, "2026-11-06T15:00:00Z", "2026-11-09T15:00:00Z", "held", "2026-11-03T14:50:00Z"); // expired 10 min ago
    await book(GLC, "2026-11-06T15:00:00Z", "2026-11-09T15:00:00Z", "cancelled");
    await book(GLC, "2026-11-06T15:00:00Z", "2026-11-09T15:00:00Z", "closed");
    expect((await quoteForVehicle(db, GLC, trip, NOW)).available).toBe(true);

    await book(GLC, "2026-11-06T15:00:00Z", "2026-11-09T15:00:00Z", "held", "2026-11-03T15:10:00Z"); // live for 10 more minutes
    expect((await quoteForVehicle(db, GLC, trip, NOW)).available).toBe(false);

    await db.query("DELETE FROM bookings");
    await db.query(`INSERT INTO blocks (vehicle_id, starts_at, ends_at, reason) VALUES ($1, '2026-11-07T00:00:00Z', '2026-11-07T23:00:00Z', 'Detailing')`, [
      await vehicleId(GLC),
    ]);
    const conflicts = await findConflicts(db, await vehicleId(GLC), new Date("2026-11-06T15:00:00Z"), new Date("2026-11-09T15:00:00Z"), { now: NOW });
    expect(conflicts.map((c) => c.kind)).toEqual(["block"]);
  });

  test("a pending extension reserves its extra time", async () => {
    await book(GLC, "2026-11-02T15:00:00Z", "2026-11-04T15:00:00Z", "active");
    const { rows } = await db.query<{ id: string }>("SELECT id FROM bookings LIMIT 1");
    await db.query(
      `INSERT INTO extensions (booking_id, old_ends_at, new_ends_at, added_cents, status) VALUES ($1, '2026-11-04T15:00:00Z', '2026-11-07T15:00:00Z', 28500, 'pending')`,
      [rows[0]!.id],
    );
    expect((await quoteForVehicle(db, GLC, trip, NOW)).available).toBe(false);
  });

  test("the vehicle lock and conflict check run inside one transaction", async () => {
    const id = await vehicleId(GLC);
    const result = await db.transaction(async (tx) => {
      await lockVehicle(tx, id);
      return findConflicts(tx, id, new Date("2026-11-06T15:00:00Z"), new Date("2026-11-09T15:00:00Z"), { now: NOW });
    });
    expect(result).toEqual([]);
    await expect(
      db.transaction(async (tx) => {
        await tx.query(`UPDATE vehicles SET tagline = 'changed' WHERE id = $1`, [id]);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect((await getVehicle(db, GLC))?.tagline).toBe("Coupe roofline, SUV stance, all-wheel drive."); // rolled back
  });
});
