import type { BookingStatus } from "../../shared/types.ts";

const LABELS: Record<BookingStatus, [string, "warn" | "ok" | "muted"]> = {
  awaiting_payment: ["Waiting for payment", "warn"],
  payment_review: ["Checking payment", "warn"],
  confirmed: ["Confirmed", "ok"],
  active: ["On trip", "ok"],
  returned: ["Returned", "muted"],
  closed: ["Completed", "muted"],
  cancelled: ["Cancelled", "muted"],
  expired: ["Hold expired", "muted"],
};

export function StatusPill({ status }: { status: BookingStatus }) {
  const [label, tone] = LABELS[status];
  return <span className={`status ${tone}`}>{label}</span>;
}
