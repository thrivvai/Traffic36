import type { Db } from "./db.ts";
import { badRequest, notFound } from "./http.ts";
import { findConflicts } from "./availability.ts";
import { getVehicle } from "./vehicles.ts";
import { DAY, MINUTE, POLICY } from "../shared/policy.ts";
import { quoteRental } from "../shared/pricing.ts";
import { isDateString, isTimeString, zonedToUtc } from "../shared/time.ts";
import type { Quote, QuoteRequest } from "../shared/types.ts";

/** Reads and checks the four trip fields. Times are local to the lot, in POLICY.timeZone. */
export function parseTrip(input: Partial<Record<keyof QuoteRequest, unknown>>, now: Date): { start: Date; end: Date } {
  const { startDate, startTime, endDate, endTime } = input;
  if (!isDateString(startDate)) throw badRequest("Choose a pickup date.", "startDate");
  if (!isTimeString(startTime)) throw badRequest("Choose a pickup time.", "startTime");
  if (!isDateString(endDate)) throw badRequest("Choose a return date.", "endDate");
  if (!isTimeString(endTime)) throw badRequest("Choose a return time.", "endTime");
  for (const [t, field] of [[startTime, "startTime"], [endTime, "endTime"]] as const) {
    if (t < POLICY.firstSlot || t > POLICY.lastSlot) throw badRequest(`Pickups and returns run ${POLICY.firstSlot} to ${POLICY.lastSlot}.`, field);
  }

  const start = new Date(zonedToUtc(startDate, startTime, POLICY.timeZone));
  const end = new Date(zonedToUtc(endDate, endTime, POLICY.timeZone));
  if (start.getTime() < now.getTime() + POLICY.minLeadMinutes * MINUTE) {
    throw badRequest(`Pickup has to be at least ${POLICY.minLeadMinutes} minutes from now.`, "startDate");
  }
  if (start.getTime() > now.getTime() + POLICY.maxLeadDays * DAY) {
    throw badRequest(`Trips can be booked up to ${POLICY.maxLeadDays} days ahead.`, "startDate");
  }
  if (end <= start) throw badRequest("Return has to be after pickup.", "endDate");
  if (end.getTime() - start.getTime() > POLICY.maxTripDays * DAY) {
    throw badRequest(`Trips can run up to ${POLICY.maxTripDays} days.`, "endDate");
  }
  return { start, end };
}

/** A server-priced quote with live availability. Nothing here trusts a number from the browser. */
export async function quoteForVehicle(db: Db, slug: string, input: Parameters<typeof parseTrip>[0], now = new Date()): Promise<Quote> {
  const vehicle = await getVehicle(db, slug);
  if (!vehicle) throw notFound("That car isn't available.");
  const { start, end } = parseTrip(input, now);
  const q = quoteRental({ dailyCents: vehicle.dailyCents, weeklyCents: vehicle.weeklyCents }, start.getTime(), end.getTime(), POLICY.timeZone);
  const conflicts = await findConflicts(db, vehicle.id, start, end, { now });
  const first = conflicts[0];
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    days: q.days,
    lines: q.lines,
    rentalCents: q.rentalCents,
    weeklySavingsCents: q.weeklySavingsCents,
    depositCents: POLICY.depositCents,
    dueTodayCents: q.rentalCents + POLICY.depositCents,
    available: !first,
    conflict: first ? { start: first.start.toISOString(), end: first.end.toISOString() } : null,
  };
}
