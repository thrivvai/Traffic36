import { describe, expect, test } from "vitest";
import { POLICY } from "../shared/policy.ts";
import { ageAt, billableDays, formatMoney, quoteRental, validThrough } from "../shared/pricing.ts";
import { addDays, isDateString, localDate, zonedToUtc } from "../shared/time.ts";

const TZ = POLICY.timeZone;
const at = (iso: string) => new Date(iso).getTime();
const glc = { dailyCents: 9500, weeklyCents: 59500 };

describe("rental pricing", () => {
  test("3 days bill daily", () => {
    expect(quoteRental(glc, at("2026-11-06T15:00:00Z"), at("2026-11-09T15:00:00Z"), TZ)).toMatchObject({
      days: 3,
      rentalCents: 28500,
      weeklySavingsCents: 0,
    });
  });

  test("7 days switches to the weekly rate", () => {
    const q = quoteRental(glc, at("2026-11-06T15:00:00Z"), at("2026-11-13T15:00:00Z"), TZ);
    expect(q).toMatchObject({ days: 7, weeks: 1, rentalCents: 59500, weeklySavingsCents: 7 * 9500 - 59500 });
    expect(q.lines).toEqual([{ label: "1 week at the weekly rate", cents: 59500 }]);
  });

  test("8 days is one week plus one day", () => {
    expect(quoteRental(glc, at("2026-11-06T15:00:00Z"), at("2026-11-14T15:00:00Z"), TZ)).toMatchObject({
      days: 8,
      weeks: 1,
      extraDays: 1,
      rentalCents: 59500 + 9500,
    });
  });

  test("leftover days never cost more than another week", () => {
    expect(quoteRental(glc, at("2026-11-06T15:00:00Z"), at("2026-11-19T15:00:00Z"), TZ).rentalCents).toBe(59500 + 6 * 9500);
    const cheapWeek = { dailyCents: 9500, weeklyCents: 50000 };
    const q = quoteRental(cheapWeek, at("2026-11-06T15:00:00Z"), at("2026-11-19T15:00:00Z"), TZ);
    expect(q.rentalCents).toBe(50000 + 50000);
    expect(q.lines[1]?.label).toBe("6 days, capped at the weekly rate");
  });

  test("the daylight-saving change on Nov 1 doesn't add a day", () => {
    // Oct 30 10:00 EDT to Nov 3 10:00 EST is 97 real hours but 4 calendar days.
    expect(billableDays(at("2026-10-30T14:00:00Z"), at("2026-11-03T15:00:00Z"), TZ)).toBe(4);
  });

  test("one minute late starts another day; a short trip is still one day", () => {
    expect(billableDays(at("2026-11-06T15:00:00Z"), at("2026-11-09T15:01:00Z"), TZ)).toBe(4);
    expect(billableDays(at("2026-11-06T15:00:00Z"), at("2026-11-06T18:00:00Z"), TZ)).toBe(1);
  });
});

describe("driver checks", () => {
  test("age and license validity are judged in local time", () => {
    expect(ageAt("2001-11-06", at("2026-11-06T15:00:00Z"), TZ)).toBe(25);
    expect(ageAt("2001-11-07", at("2026-11-06T15:00:00Z"), TZ)).toBe(24);
    expect(validThrough("2026-11-09", at("2026-11-10T03:00:00Z"), TZ)).toBe(true); // 10pm ET on the 9th
    expect(validThrough("2026-11-09", at("2026-11-10T06:00:00Z"), TZ)).toBe(false);
  });
});

describe("time zones", () => {
  test("a lot-local date and time converts to the right instant on both sides of DST", () => {
    expect(new Date(zonedToUtc("2026-11-06", "10:00", TZ)).toISOString()).toBe("2026-11-06T15:00:00.000Z"); // EST
    expect(new Date(zonedToUtc("2026-10-30", "10:00", TZ)).toISOString()).toBe("2026-10-30T14:00:00.000Z"); // EDT
    expect(new Date(zonedToUtc("2026-11-01", "01:30", TZ)).getTime()).toBeGreaterThan(0); // the repeated hour resolves
  });

  test("a skipped spring-forward time resolves just after the gap", () => {
    const ts = zonedToUtc("2027-03-14", "02:30", TZ);
    expect(localDate(ts, TZ)).toBe("2027-03-14");
    expect(new Date(ts).toISOString()).toBe("2027-03-14T07:30:00.000Z"); // 03:30 EDT
  });

  test("date helpers", () => {
    expect(isDateString("2026-02-29")).toBe(false);
    expect(isDateString("2028-02-29")).toBe(true);
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(localDate(at("2026-11-07T03:30:00Z"), TZ)).toBe("2026-11-06");
  });

  test("money formatting", () => {
    expect(formatMoney(59500)).toBe("$595");
    expect(formatMoney(145)).toBe("$1.45");
    expect(formatMoney(123456)).toBe("$1,234.56");
  });
});
