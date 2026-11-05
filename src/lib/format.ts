import type { Tier } from "../../shared/types.ts";
import { POLICY } from "../../shared/policy.ts";
import { formatClock } from "../../shared/time.ts";

export { formatMoney as money } from "../../shared/pricing.ts";

/** "+14705550123" as "(470) 555-0123". Anything that isn't a US number is shown as given. */
export function formatPhone(phone: string): string {
  const m = /^\+?1?(\d{3})(\d{3})(\d{4})$/.exec(phone.replace(/[^\d+]/g, ""));
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

export const tierName: Record<Tier, string> = { economy: "Economy", luxury: "Luxury", exotic: "Exotic" };

/** "Fri, Nov 6, 10:00 AM", in the lot's time zone. */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: POLICY.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Nov 4, 2026" for an instant, in the lot's time zone. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: POLICY.timeZone, month: "short", day: "numeric", year: "numeric" });
}

/** "May 1, 1996" for a calendar date like a birthday, with no time zone shift. */
export function formatDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** "in 3 h 12 min", "in 2 days", for a moment ahead. */
export function untilText(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/** Half-hour slots inside the standard hours, narrowed to a location's own hours when it has them. */
export function timeSlots(hours?: { opensAt: string | null; closesAt: string | null }): { value: string; label: string }[] {
  const from = hours?.opensAt && hours.opensAt > POLICY.firstSlot ? hours.opensAt : POLICY.firstSlot;
  const to = hours?.closesAt && hours.closesAt < POLICY.lastSlot ? hours.closesAt : POLICY.lastSlot;
  const out: { value: string; label: string }[] = [];
  for (let mins = 0; mins < 24 * 60; mins += 30) {
    const value = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${mins % 60 ? "30" : "00"}`;
    if (value >= from && value <= to) out.push({ value, label: formatClock(value) });
  }
  return out;
}
