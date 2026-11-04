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
