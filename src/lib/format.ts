import type { Tier } from "../../shared/types.ts";
import { POLICY } from "../../shared/policy.ts";

export { formatMoney as money } from "../../shared/pricing.ts";

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

/** Half-hour slots between the first and last pickup times, e.g. ["07:00", "07:30", ...]. */
export function timeSlots(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const [fh] = POLICY.firstSlot.split(":").map(Number) as [number];
  const [lh] = POLICY.lastSlot.split(":").map(Number) as [number];
  for (let h = fh; h <= lh; h++) {
    for (const m of [0, 30]) {
      if (h === lh && m > 0) break;
      const value = `${String(h).padStart(2, "0")}:${m ? "30" : "00"}`;
      const label = `${((h + 11) % 12) + 1}:${m ? "30" : "00"} ${h < 12 ? "AM" : "PM"}`;
      out.push({ value, label });
    }
  }
  return out;
}
