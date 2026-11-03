/**
 * Pricing. The server computes every number a renter is charged; the browser only displays them.
 * Pure functions, so both sides import the same code.
 */
import { DAY } from "./policy.ts";
import { wallClockMs } from "./time.ts";

export type Rates = { dailyCents: number; weeklyCents: number };

export type QuoteLine = { label: string; cents: number };

export type RentalQuote = {
  days: number;
  weeks: number;
  extraDays: number;
  /** The rental with weekly pricing applied. */
  rentalCents: number;
  /** The same days at the daily rate alone. */
  listCents: number;
  weeklySavingsCents: number;
  lines: QuoteLine[];
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Every started 24 hours of wall-clock time is one billable day, minimum one. Daylight-saving changes never add or remove a day. */
export function billableDays(start: number, end: number, timeZone: string): number {
  const span = wallClockMs(end, timeZone) - wallClockMs(start, timeZone);
  return Math.max(1, Math.ceil(span / DAY - 1e-9));
}

/** Full weeks bill at the weekly rate. Leftover days bill daily, capped at one weekly rate. */
export function quoteRental(rates: Rates, start: number, end: number, timeZone: string): RentalQuote {
  const days = billableDays(start, end, timeZone);
  const weeks = Math.floor(days / 7);
  const extraDays = days % 7;
  const extraRaw = extraDays * rates.dailyCents;
  const extraCents = Math.min(extraRaw, rates.weeklyCents);
  const rentalCents = weeks * rates.weeklyCents + extraCents;
  const listCents = days * rates.dailyCents;
  const lines: QuoteLine[] = [];
  if (weeks) lines.push({ label: `${plural(weeks, "week")} at the weekly rate`, cents: weeks * rates.weeklyCents });
  if (extraDays) {
    lines.push({
      label: extraRaw > rates.weeklyCents ? `${plural(extraDays, "day")}, capped at the weekly rate` : `${plural(extraDays, "day")} at the daily rate`,
      cents: extraCents,
    });
  }
  return { days, weeks, extraDays, rentalCents, listCents, weeklySavingsCents: listCents - rentalCents, lines };
}

/** Whole years between a YYYY-MM-DD birth date and a moment, judged in `timeZone`. */
export function ageAt(dob: string, at: number, timeZone: string): number {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  const local = new Date(wallClockMs(at, timeZone));
  let age = local.getUTCFullYear() - y;
  if ((local.getUTCMonth() + 1) * 100 + local.getUTCDate() < m * 100 + d) age--;
  return age;
}

/** True if a YYYY-MM-DD expiry date is still valid at the end of the day containing `at`. */
export function validThrough(expiry: string, at: number, timeZone: string): boolean {
  const [y, m, d] = expiry.split("-").map(Number) as [number, number, number];
  return wallClockMs(at, timeZone) < Date.UTC(y, m - 1, d + 1);
}

export function formatMoney(cents: number): string {
  const whole = cents % 100 === 0;
  return (
    (cents < 0 ? "-$" : "$") +
    (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
  );
}
