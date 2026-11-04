import type { Db } from "./db.ts";
import { badRequest, notFound } from "./http.ts";
import { findConflicts } from "./availability.ts";
import { getLocation, type LocationRecord } from "./locations.ts";
import { getVehicle, type VehicleRecord } from "./vehicles.ts";
import { DAY, MINUTE, POLICY } from "../shared/policy.ts";
import { quoteRental, type RentalQuote } from "../shared/pricing.ts";
import { formatClock, isDateString, isTimeString, zonedToUtc } from "../shared/time.ts";
import type { Quote, QuoteRequest } from "../shared/types.ts";

export type TripInput = Partial<Record<keyof QuoteRequest, unknown>>;

/** Reads and checks the date and time fields. Times are local to the lots, in POLICY.timeZone. */
export function parseTrip(input: TripInput, now: Date): { start: Date; end: Date; startTime: string; endTime: string } {
  const { startDate, startTime, endDate, endTime } = input;
  if (!isDateString(startDate)) throw badRequest("Choose a pickup date.", "startDate");
  if (!isTimeString(startTime)) throw badRequest("Choose a pickup time.", "startTime");
  if (!isDateString(endDate)) throw badRequest("Choose a return date.", "endDate");
  if (!isTimeString(endTime)) throw badRequest("Choose a return time.", "endTime");
  for (const [t, field] of [[startTime, "startTime"], [endTime, "endTime"]] as const) {
    if (t < POLICY.firstSlot || t > POLICY.lastSlot) {
      throw badRequest(`Pickups and returns run ${formatClock(POLICY.firstSlot)} to ${formatClock(POLICY.lastSlot)}.`, field);
    }
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
  return { start, end, startTime, endTime };
}

/** A location's own hours, when it has them, narrow the standard pickup and return times. */
function checkHours(loc: LocationRecord, time: string, field: "startTime" | "endTime") {
  if (!loc.opensAt || !loc.closesAt) return;
  if (time < loc.opensAt || time > loc.closesAt) {
    const what = field === "startTime" ? "pickup" : "return";
    throw badRequest(`${loc.name} is open ${formatClock(loc.opensAt)} to ${formatClock(loc.closesAt)}. Choose a ${what} time in those hours.`, field);
  }
}

export type Places = { pickup: LocationRecord | "delivery"; returnTo: LocationRecord };

/** Where the trip starts (a location or delivery) and ends (always a location). */
export async function resolvePlaces(db: Db, input: TripInput): Promise<Places> {
  const { pickup, returnTo } = input;
  if (typeof pickup !== "string" || !pickup) throw badRequest("Choose where to pick up the car.", "pickup");
  if (typeof returnTo !== "string" || !returnTo) throw badRequest("Choose where to return the car.", "returnTo");
  if (returnTo === POLICY.deliveryChoice) throw badRequest("Delivery is drop-off only. Choose a location to return the car to.", "returnTo");
  const pickupLoc = pickup === POLICY.deliveryChoice ? "delivery" : await getLocation(db, pickup);
  if (!pickupLoc) throw badRequest("That pickup location isn't available. Choose another.", "pickup");
  const returnLoc = await getLocation(db, returnTo);
  if (!returnLoc) throw badRequest("That return location isn't available. Choose another.", "returnTo");
  return { pickup: pickupLoc, returnTo: returnLoc };
}

export const publicLocation = ({ id: _id, ...loc }: LocationRecord) => loc;

export type PricedTrip = {
  vehicle: VehicleRecord;
  start: Date;
  end: Date;
  places: Places;
  rental: RentalQuote;
  deliveryFeeCents: number;
  depositCents: number;
  totalCents: number;
};

/** Validates a trip and prices it. Shared by quotes and bookings so the two can never disagree. */
export async function priceTrip(db: Db, slug: string, input: TripInput, now: Date): Promise<PricedTrip> {
  const vehicle = await getVehicle(db, slug);
  if (!vehicle) throw notFound("That car isn't available.");
  const trip = parseTrip(input, now);
  const places = await resolvePlaces(db, input);
  if (places.pickup !== "delivery") checkHours(places.pickup, trip.startTime, "startTime");
  checkHours(places.returnTo, trip.endTime, "endTime");

  const rental = quoteRental({ dailyCents: vehicle.dailyCents, weeklyCents: vehicle.weeklyCents }, trip.start.getTime(), trip.end.getTime(), POLICY.timeZone);
  const deliveryFeeCents = places.pickup === "delivery" ? POLICY.deliveryFeeCents : 0;
  return {
    vehicle,
    start: trip.start,
    end: trip.end,
    places,
    rental,
    deliveryFeeCents,
    depositCents: POLICY.depositCents,
    totalCents: rental.rentalCents + deliveryFeeCents + POLICY.depositCents,
  };
}

/** A server-priced quote with live availability. Nothing here trusts a number from the browser. */
export async function quoteForVehicle(db: Db, slug: string, input: TripInput, now = new Date()): Promise<Quote> {
  const p = await priceTrip(db, slug, input, now);
  const conflicts = await findConflicts(db, p.vehicle.id, p.start, p.end, { now });
  const first = conflicts[0];
  return {
    start: p.start.toISOString(),
    end: p.end.toISOString(),
    days: p.rental.days,
    lines: p.rental.lines,
    rentalCents: p.rental.rentalCents,
    weeklySavingsCents: p.rental.weeklySavingsCents,
    deliveryFeeCents: p.deliveryFeeCents,
    pickup: p.places.pickup === "delivery" ? { kind: "delivery" } : { kind: "location", location: publicLocation(p.places.pickup) },
    returnTo: publicLocation(p.places.returnTo),
    depositCents: p.depositCents,
    dueTodayCents: p.totalCents,
    available: !first,
    conflict: first ? { start: first.start.toISOString(), end: first.end.toISOString() } : null,
  };
}
