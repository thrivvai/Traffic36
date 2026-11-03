/**
 * Time-zone math without a library. Pickups happen at a physical lot, so dates and times
 * the renter picks are always read in the business's zone, whatever zone their phone is in.
 */

/** A timestamp's wall-clock time in `timeZone`, expressed as a UTC millisecond count. */
export function wallClockMs(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDateString(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function isTimeString(s: unknown): s is string {
  return typeof s === "string" && TIME_RE.test(s);
}

/**
 * The instant at which the clock in `timeZone` reads `date` `time`.
 * A time skipped by a spring-forward change resolves to the moment just after the gap.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const target = Date.UTC(y, mo - 1, d, h, mi);
  // Start from the target as if it were UTC and correct by the zone's offset until the wall clock matches.
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const wall = wallClockMs(guess, timeZone);
    if (wall === target) return guess;
    guess += target - wall;
  }
  // No instant shows this wall time (a spring-forward gap). The two candidates straddle the gap; take the later one.
  return Math.max(guess, guess + (target - wallClockMs(guess, timeZone)));
}

/** "07:00" -> "7:00 AM", "21:30" -> "9:30 PM". */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** YYYY-MM-DD for the day containing `ts` in `timeZone`. */
export function localDate(ts: number, timeZone: string): string {
  return new Date(wallClockMs(ts, timeZone)).toISOString().slice(0, 10);
}

/** Adds whole calendar days to a YYYY-MM-DD string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
