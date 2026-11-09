/** Pieces every host screen shares: the sign-in and role gate, the section tabs, and plain-word labels. */
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import type { ActivityEntry, IdentityState, PaymentEntry, PaymentMethod } from "../../shared/types.ts";
import { useAccount } from "../lib/account.tsx";
import { formatPhone, formatWhen, money } from "../lib/format.ts";
import { useSession } from "../lib/session.tsx";
import { SignInPrompt } from "../pages/TripsPage.tsx";

export const METHOD_NAMES: Record<PaymentMethod, string> = { cash_app: "Cash App", chime: "Chime" };

/**
 * Renders the host screen only for the host. Everyone else gets a sign-in prompt or a polite
 * "not for you", and nothing host-only is ever requested for them.
 */
export function HostOnly({ what, children }: { what: string; children: () => ReactNode }) {
  const session = useSession();
  const account = useAccount();
  if (session.status === "signed-out") return <SignInPrompt what={what} />;
  if (account.state.status === "ready" && account.state.me.role !== "host") {
    return (
      <div className="page empty">
        <h1>This page is for the host</h1>
        <Link className="btn btn-ghost" to="/trips">Go to your trips</Link>
      </div>
    );
  }
  if (account.state.status !== "ready") {
    return <div className="page narrow" aria-busy="true"><div className="skeleton" style={{ height: 360 }} /></div>;
  }
  return <>{children()}</>;
}

export function HostTabs() {
  return (
    <nav className="host-tabs" aria-label="Host">
      <NavLink to="/host" end>Console</NavLink>
      <NavLink to="/host/renters">Renters</NavLink>
      <NavLink to="/host/archive">Archive</NavLink>
    </nav>
  );
}

/** Call, text and email links, so the host can reach a renter in one tap. */
export function ContactLinks({ phone, email }: { phone: string | null; email: string | null }) {
  if (!phone && !email) return <span className="muted">No contact details</span>;
  return (
    <span className="contact">
      {phone && (
        <>
          <a className="link nowrap" href={`tel:${phone}`}>{formatPhone(phone)}</a>
          <a className="link" href={`sms:${phone}`}>Text</a>
        </>
      )}
      {email && <a className="link" href={`mailto:${email}`}>{email}</a>}
    </span>
  );
}

const LICENSE: Record<IdentityState, [string, "ok" | "warn" | "muted" | "bad"]> = {
  verified: ["License approved", "ok"],
  in_review: ["License to review", "warn"],
  pending: ["License check started", "warn"],
  failed: ["License sent back", "bad"],
  expired: ["License expired", "bad"],
  none: ["No license yet", "muted"],
};

export function LicensePill({ status }: { status: IdentityState }) {
  const [label, tone] = LICENSE[status];
  return <span className={`status ${tone}`}>{label}</span>;
}

const PAYMENT_KINDS: Record<PaymentEntry["kind"], string> = {
  booking_charge: "Paid for the trip",
  extension_charge: "Paid for extra time",
  deposit_refund: "Deposit sent back",
  cancellation_refund: "Refund for cancellation",
  late_payment_refund: "Refund for a late payment",
  early_end_refund: "Refund for ending early",
};

const paidIn = (kind: PaymentEntry["kind"]) => kind === "booking_charge" || kind === "extension_charge";

export function paymentLabel(p: PaymentEntry) {
  const via = p.method in METHOD_NAMES ? METHOD_NAMES[p.method as PaymentMethod] : p.method.replace(/_/g, " ");
  return { title: PAYMENT_KINDS[p.kind], via, amount: `${paidIn(p.kind) ? "+" : "−"}${money(Math.abs(p.amountCents))}`, incoming: paidIn(p.kind) };
}

const REJECT_REASONS: Record<string, string> = {
  not_received: "the money wasn't in the account",
  wrong_amount: "the amount was wrong",
  name_mismatch: "the sender didn't match the license",
  other: "something else",
};

/** One line per host action, in plain words. Lockbox codes are never in the log, so never shown here. */
export function activityLabel(a: ActivityEntry): string {
  const d = a.details;
  switch (a.action) {
    case "payment_confirmed":
      return `Payment confirmed${typeof d.amountCents === "number" ? `, ${money(d.amountCents)}` : ""}${d.deliveryApproved ? ", delivery address approved" : ""}`;
    case "payment_rejected":
      return `Payment sent back: ${REJECT_REASONS[String(d.reason)] ?? "see note"}${d.note ? `. "${String(d.note)}"` : ""}`;
    case "booking_cancelled":
      return `Booking cancelled${d.note ? `: "${String(d.note)}"` : ""}${typeof d.refundCents === "number" && d.refundCents > 0 ? `. Refunded ${money(d.refundCents)}` : ""}`;
    case "trip_ended_early":
      return `Trip ended early${typeof d.scheduledEnd === "string" ? ` (booked until ${formatWhen(d.scheduledEnd)})` : ""}${typeof d.refundCents === "number" && d.refundCents > 0 ? `. Refunded ${money(d.refundCents)}` : ""}${d.note ? `. "${String(d.note)}"` : ""}`;
    case "booking_archived":
      return "Archived";
    case "booking_restored":
      return "Restored from the archive";
    case "deposit_returned":
      return `Deposit returned${typeof d.refundCents === "number" ? `, ${money(d.refundCents)}` : ""}${typeof d.keptCents === "number" && d.keptCents > 0 ? ` (kept ${money(d.keptCents)}${d.note ? ` for ${String(d.note)}` : ""})` : ""}`;
    case "handoff_set":
      return d.method === "in_person" ? "Pickup set to meet in person" : "Lockbox code saved";
    default:
      return a.action.replace(/_/g, " ");
  }
}
