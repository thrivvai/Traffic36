/**
 * The host's controls on a booking record: end a trip early, cancel (with the refund the host sent
 * back), and archive or restore. The server decides what's allowed (`booking.can`), so these
 * buttons always match the rules.
 */
import { useState, type ReactNode } from "react";
import type { HostBookingDetail } from "../../shared/types.ts";
import { useAccount } from "../lib/account.tsx";
import { RequestError, type HostActionBody } from "../lib/api.ts";
import { formatDate, formatWhen, money } from "../lib/format.ts";
import { useNow } from "../lib/useNow.ts";
import { METHOD_NAMES } from "./HostKit.tsx";
import { Icon } from "./Icon.tsx";
import { Panel } from "./Panel.tsx";

type Mode = null | "end" | "cancel" | "archive";
type Action = "cancel" | "end" | "archive" | "restore";
type Failure = { message: string; field?: string };

const DAY = 24 * 60 * 60 * 1000;

/** "12.50" to 1250; null when it isn't a usable amount. */
function toCents(text: string): number | null {
  if (!/^\d{0,6}(\.\d{0,2})?$/.test(text) || text === "" || text === ".") return null;
  return Math.round(Number(text) * 100);
}
const toText = (cents: number) => (cents / 100).toFixed(2);

function useBookingAction(code: string, onChange: (b: HostBookingDetail) => void) {
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const run = async (action: Action, body: HostActionBody = {}) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await account.api.bookingAction(code, action, body));
      return true;
    } catch (err) {
      setError({ message: (err as Error).message, field: err instanceof RequestError ? err.field : undefined });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, clear: () => setError(null) };
}

/** A banner across the top of an archived booking, with a way back. */
export function ArchivedBanner({ booking: b, onChange }: { booking: HostBookingDetail; onChange: (b: HostBookingDetail) => void }) {
  const { busy, error, run } = useBookingAction(b.code, onChange);
  if (!b.archivedAt) return null;
  return (
    <div className="note archived" role="status">
      <Icon name="archive" size={16} />
      <span>Archived {formatDate(b.archivedAt)}. It's off your host lists. {error && <b className="bad-text">{error.message}</b>}</span>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run("restore")}>{busy ? "Restoring…" : "Restore"}</button>
    </div>
  );
}

export function TripControls({ booking: b, onChange }: { booking: HostBookingDetail; onChange: (b: HostBookingDetail) => void }) {
  const [mode, setMode] = useState<Mode>(null);
  const { busy, error, run, clear } = useBookingAction(b.code, onChange);
  const open = (m: Mode) => {
    clear();
    setMode(m);
  };
  const done = async (action: Action, body?: HostActionBody) => {
    if (await run(action, body)) setMode(null);
  };

  // An archived booking has its Restore button in the banner, so there's nothing to manage here.
  if (!b.can.end && !b.can.cancel && !b.can.archive) return null;

  return (
    <Panel icon="sliders" title="Manage booking">
      {mode === null && (
        <>
          <p>{summary(b)}</p>
          <div className="manage-actions">
            {b.can.end && <button className="btn btn-ghost btn-sm" onClick={() => open("end")}><Icon name="clock" size={15} />End trip now</button>}
            {b.can.cancel && <button className="btn btn-ghost btn-sm" onClick={() => open("cancel")}><Icon name="x" size={15} />{paid(b) ? "Cancel trip" : "Cancel booking"}</button>}
            {b.can.archive && <button className="btn btn-ghost btn-sm" onClick={() => open("archive")}><Icon name="archive" size={15} />Archive</button>}
          </div>
        </>
      )}
      {mode === "end" && <EndForm booking={b} busy={busy} error={error} onBack={() => setMode(null)} onSubmit={(body) => void done("end", body)} />}
      {mode === "cancel" && <CancelForm booking={b} busy={busy} error={error} onBack={() => setMode(null)} onSubmit={(body) => void done("cancel", body)} />}
      {mode === "archive" && (
        <Confirm
          busy={busy}
          error={error}
          onBack={() => setMode(null)}
          onConfirm={() => void done("archive")}
          confirmLabel="Archive booking"
        >
          <p>This takes the booking off your host lists. Nothing is deleted, the renter still sees it in their trips, and you can restore it from the Archive tab.</p>
          {b.depositOpen && (
            <div className="note">
              <Icon name="alert" size={16} />
              <span>The {money(b.depositCents)} deposit isn't marked as returned yet. Archiving takes it off Deposits to return.</span>
            </div>
          )}
        </Confirm>
      )}
    </Panel>
  );
}

const paid = (b: HostBookingDetail) => b.status === "confirmed" || b.status === "active";

function summary(b: HostBookingDetail): string {
  if (b.can.end) return "This trip is under way. End it now if the car is back early, or cancel it if the renter never picked it up.";
  if (b.can.cancel && paid(b)) return "This trip is paid and hasn't started. Cancelling frees the dates and records the refund you send back.";
  if (b.can.cancel) return "This booking isn't paid yet. Cancelling releases the dates.";
  if (b.archivedAt) return "This booking is archived.";
  return "This booking is finished. Archive it to clear it from your lists.";
}

function EndForm({ booking: b, busy, error, onBack, onSubmit }: FormProps) {
  const now = useNow(60_000);
  const [amount, setAmount] = useState("0.00");
  const [note, setNote] = useState("");
  const cents = toCents(amount);
  const max = Math.min(b.rentalCents, b.totalCents - b.refundedCents);
  const unusedDays = Math.floor((Date.parse(b.end) - now) / DAY);
  const suggested = Math.min(max, Math.round((b.rentalCents / Math.max(1, b.days)) * Math.max(0, unusedDays)));
  const valid = cents !== null && cents <= max;
  return (
    <form className="manage-form" onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit({ refundCents: cents, note }); }} noValidate>
      <p>
        The trip ends now instead of {formatWhen(b.end)}. The rest of the dates open up for other renters, and the {money(b.depositCents)} deposit
        moves to Deposits to return.
      </p>
      <div className={`field${error?.field === "refundCents" ? " invalid" : ""}`}>
        <label htmlFor={`end-refund-${b.code}`}>Refund for unused days (optional)</label>
        <MoneyInput id={`end-refund-${b.code}`} value={amount} onChange={setAmount} />
        <span className="hint">
          {suggested > 0 ? (
            <>
              About {unusedDays} unused {unusedDays === 1 ? "day" : "days"} is {money(suggested)} of the rental.{" "}
              <button type="button" className="link" onClick={() => setAmount(toText(suggested))}>Use {money(suggested)}</button>
              <br />
            </>
          ) : null}
          Send it by {methodName(b)} first, then record it here. Up to {money(max)}.
        </span>
      </div>
      <div className="field">
        <label htmlFor={`end-note-${b.code}`}>Note (optional)</label>
        <input id={`end-note-${b.code}`} className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Car came back a day early" />
      </div>
      <ErrorNote error={error} />
      <div className="hcard-actions">
        <button className="btn btn-heat" type="submit" disabled={busy || !valid}>{busy ? "Ending…" : cents ? `End trip and record ${money(cents)}` : "End trip now"}</button>
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>Back</button>
      </div>
    </form>
  );
}

function CancelForm({ booking: b, busy, error, onBack, onSubmit }: FormProps) {
  const isPaid = paid(b);
  const left = b.totalCents - b.refundedCents;
  const [amount, setAmount] = useState(toText(left));
  const [note, setNote] = useState("");
  const cents = toCents(amount);
  const amountOk = !isPaid || (cents !== null && cents <= left);
  const valid = note.trim().length > 0 && amountOk;
  const started = Date.parse(b.start) <= Date.now();
  return (
    <form
      className="manage-form"
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(isPaid ? { note, refundCents: cents ?? 0 } : { note }); }}
      noValidate
    >
      <p>
        {isPaid
          ? started
            ? "Use this if the renter never picked up the car. The booking is cancelled, the dates free up and the lockbox code is cleared."
            : "The booking is cancelled, the dates free up and the lockbox code is cleared."
          : b.status === "payment_review"
            ? `The booking is cancelled and the dates free up. If their money already arrived, send it back by ${methodName(b)}.`
            : "The booking is cancelled and the held dates free up."}
      </p>
      <div className={`field${error?.field === "note" ? " invalid" : ""}`}>
        <label htmlFor={`cancel-note-${b.code}`}>Reason, shown to the renter</label>
        <input id={`cancel-note-${b.code}`} className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="The car needs a repair" />
      </div>
      {isPaid && (
        <div className={`field${error?.field === "refundCents" ? " invalid" : ""}`}>
          <label htmlFor={`cancel-refund-${b.code}`}>Refund you sent back</label>
          <MoneyInput id={`cancel-refund-${b.code}`} value={amount} onChange={setAmount} />
          <span className="hint">
            They paid {money(b.totalCents)}{b.refundedCents ? `, and ${money(b.refundedCents)} is already back with them` : ""}. Send the refund by{" "}
            {methodName(b)} first; the app records it but doesn't move money.
          </span>
        </div>
      )}
      <ErrorNote error={error} />
      <div className="hcard-actions">
        <button className="btn btn-danger" type="submit" disabled={busy || !valid}>
          {busy ? "Cancelling…" : isPaid ? `Cancel trip${cents ? ` and record ${money(cents)}` : ""}` : "Cancel booking"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>Back</button>
      </div>
    </form>
  );
}

type FormProps = {
  booking: HostBookingDetail;
  busy: boolean;
  error: Failure | null;
  onBack: () => void;
  onSubmit: (body: HostActionBody) => void;
};

const methodName = (b: HostBookingDetail) => (b.paymentMethod ? METHOD_NAMES[b.paymentMethod] : "Cash App or Chime");

function MoneyInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <span className="money-input">
      <span aria-hidden="true">$</span>
      <input id={id} className="input" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} />
    </span>
  );
}

function Confirm({ children, busy, error, onBack, onConfirm, confirmLabel }: {
  children: ReactNode; busy: boolean; error: Failure | null; onBack: () => void; onConfirm: () => void; confirmLabel: string;
}) {
  return (
    <div className="manage-form">
      {children}
      <ErrorNote error={error} />
      <div className="hcard-actions">
        <button className="btn btn-heat" disabled={busy} onClick={onConfirm}>{busy ? "Saving…" : confirmLabel}</button>
        <button className="btn btn-ghost" onClick={onBack} disabled={busy}>Back</button>
      </div>
    </div>
  );
}

function ErrorNote({ error }: { error: Failure | null }) {
  if (!error) return null;
  return <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error.message}</span></div>;
}
