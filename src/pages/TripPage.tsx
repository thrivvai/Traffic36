import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { SUPPORT } from "../../shared/contact.ts";
import { POLICY } from "../../shared/policy.ts";
import type { Booking, PaymentMethod } from "../../shared/types.ts";
import { CopyButton } from "../components/CopyButton.tsx";
import { Icon } from "../components/Icon.tsx";
import { Panel } from "../components/Panel.tsx";
import { PickupPass, passPending } from "../components/PickupPass.tsx";
import { ProofImage } from "../components/ProofImage.tsx";
import { StatusPill } from "../components/StatusPill.tsx";
import { TripCard } from "../components/TripCard.tsx";
import { useAccount } from "../lib/account.tsx";
import { RequestError } from "../lib/api.ts";
import { formatWhen, money } from "../lib/format.ts";
import { prepareImage } from "../lib/image.ts";
import { useNow } from "../lib/useNow.ts";
import { useRequest } from "../lib/useRequest.ts";
import { useSession } from "../lib/session.tsx";
import { SignInPrompt } from "./TripsPage.tsx";

export function TripPage() {
  const { code = "" } = useParams();
  const session = useSession();
  const account = useAccount();
  const [booking, setBooking] = useState<Booking | null>(null);
  const { state, retry } = useRequest(session.status === "signed-in" ? `booking:${code}` : null, (signal) => account.api.booking(code, signal));

  useEffect(() => {
    document.title = `${code} | Traffic36`;
  }, [code]);
  useEffect(() => {
    if (state.status === "ready") setBooking(state.data);
  }, [state]);

  // When the trip moves to a new stage (paid, confirmed), bring the renter back to the top to see it.
  const shownStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!booking) return;
    if (shownStatus.current && shownStatus.current !== booking.status) window.scrollTo({ top: 0, behavior: "smooth" });
    shownStatus.current = booking.status;
  }, [booking]);

  // While the host checks a payment, look for the answer every 30 seconds.
  useEffect(() => {
    if (booking?.status !== "payment_review") return;
    const id = setInterval(() => {
      account.api.booking(code).then(setBooking, () => undefined);
    }, 30_000);
    return () => clearInterval(id);
  }, [booking?.status, account.api, code]);

  // The pickup pass: fetch it the moment it opens, keep checking while the host is still setting
  // it up, and refresh whenever the renter comes back to this tab (the host may have changed the code).
  const opensAt = booking?.pass?.opensAt;
  const passOpen = booking?.pass?.open;
  const pending = booking ? passPending(booking) : false;
  useEffect(() => {
    if (!opensAt) return;
    const refresh = () => account.api.booking(code).then(setBooking, () => undefined);
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!passOpen) {
      const wait = Date.parse(opensAt) - Date.now();
      // If this device's clock runs ahead of ours, try again shortly rather than in a tight loop.
      if (wait < 2 ** 31 - 1) timers.push(setTimeout(refresh, wait > 0 ? wait + 1500 : 30_000));
    }
    const poll = pending ? setInterval(refresh, 60_000) : null;
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      timers.forEach(clearTimeout);
      if (poll) clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [opensAt, passOpen, pending, account.api, code]);

  if (session.status === "signed-out") return <SignInPrompt what="this trip" />;
  if (state.status === "error") {
    const missing = state.error instanceof RequestError && state.error.status === 404;
    return (
      <div className="page empty" role="alert">
        <h1>{missing ? "We can't find that trip" : "We couldn't load this trip"}</h1>
        <p>{missing ? "Check the link, or find it in your trips." : state.error.message}</p>
        {missing ? <Link className="btn btn-heat" to="/trips">Your trips</Link> : <button className="btn btn-ghost" onClick={retry}>Try again</button>}
      </div>
    );
  }
  if (!booking) {
    return (
      <div className="page" aria-busy="true">
        <div className="checkout"><div className="skeleton" style={{ height: 480 }} /><div className="skeleton" style={{ height: 460 }} /></div>
      </div>
    );
  }

  const b = booking;
  return (
    <div className="page">
      <Link className="crumb" to="/trips"><Icon name="arrowLeft" size={16} />Your trips</Link>
      <div className="trip-head">
        <h1 className="page-title">{b.vehicle.year} {b.vehicle.make} {b.vehicle.model}</h1>
        <div className="trip-meta"><span className="mono">{b.code}</span><StatusPill status={b.status} /></div>
      </div>
      <div className="checkout">
        <div className="trip-main">
          {b.status === "awaiting_payment" && <PayPanel booking={b} onChange={setBooking} />}
          {b.status === "payment_review" && <ReviewPanel booking={b} onChange={setBooking} />}
          {(b.status === "confirmed" || b.status === "active") && <ConfirmedPanel booking={b} />}
          {b.status === "expired" && (
            <Panel icon="clock" title="This hold ran out">
              <p>The dates were held for {POLICY.holdMinutes} minutes and no payment screenshot came in. If you already paid, call or text us at (646) 397-3139 with your booking code and we'll sort it out.</p>
              <Link className="btn btn-heat" to={`/cars/${b.vehicle.slug}`}>Book this car again</Link>
            </Panel>
          )}
          {b.status === "cancelled" && <CancelledPanel booking={b} />}
          {(b.status === "returned" || b.status === "closed") && (
            <Panel icon="check" title={b.status === "closed" ? "Trip complete" : "Car returned"}>
              {b.endedEarly && (
                <p>Your trip ended {formatWhen(b.endedEarly.at)}, ahead of the booked return time of {formatWhen(b.endedEarly.scheduledEnd)}.</p>
              )}
              {b.refundedCents > 0 && <p>We've sent {money(b.refundedCents)} back to the {paidWith(b)} account you paid from.</p>}
              {b.status === "returned" && <p>Your {money(b.depositCents)} deposit comes back after we check the car.</p>}
              <p>Thanks for driving with Traffic36.</p>
            </Panel>
          )}
        </div>
        <TripCard
          vehicle={b.vehicle}
          start={b.start}
          end={b.end}
          pickup={b.pickup}
          returnTo={b.returnTo}
          lines={[{ label: `${b.days} ${b.days === 1 ? "day" : "days"}`, cents: b.rentalCents }]}
          fees={[
            ...(b.deliveryFeeCents ? [{ label: "Delivery to your address", cents: b.deliveryFeeCents }] : []),
            { label: "Refundable deposit", cents: b.depositCents },
          ]}
          total={{ label: "Total", cents: b.totalCents }}
        />
      </div>
    </div>
  );
}

const paidWith = (b: Booking) => (b.paymentMethod ? METHOD_NAMES[b.paymentMethod] : "Cash App or Chime");

function CancelledPanel({ booking: b }: { booking: Booking }) {
  const releasedByRenter = !b.cancelReason && !b.confirmedAt && b.proofs.length === 0;
  return (
    <Panel icon="x" title="This booking was cancelled">
      {releasedByRenter ? (
        <p>You released these dates before paying, so nothing was charged.</p>
      ) : (
        <>
          {b.cancelReason && <p>Reason: {b.cancelReason}</p>}
          {b.refundedCents > 0 ? (
            <p>We've sent {money(b.refundedCents)} back to the {paidWith(b)} account you paid from.</p>
          ) : (
            <p>If you paid for it, we'll send the money back to the account you paid from.</p>
          )}
          <p>Questions? Call or text us at <a className="link nowrap" href={`tel:${SUPPORT.e164}`}>{SUPPORT.phone}</a>.</p>
        </>
      )}
    </Panel>
  );
}

function Countdown({ until }: { until: string }) {
  const now = useNow(1000);
  const left = Math.max(0, new Date(until).getTime() - now);
  const mins = Math.floor(left / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  if (left === 0) {
    return (
      <div className="note bad" role="status">
        <Icon name="clock" size={16} />
        <span>Your hold ran out. If you've already paid, upload your screenshot anyway. We'll confirm if the dates are still open.</span>
      </div>
    );
  }
  return (
    <div className="hold" role="timer" aria-live="off">
      <Icon name="clock" size={16} />
      <span>Dates held for</span>
      <b className="mono">{mins}:{String(secs).padStart(2, "0")}</b>
    </div>
  );
}

const METHOD_NAMES: Record<PaymentMethod, string> = { cash_app: "Cash App", chime: "Chime" };

function PayPanel({ booking, onChange }: { booking: Booking; onChange: (b: Booking) => void }) {
  const pay = booking.payment!;
  const [method, setMethod] = useState<PaymentMethod>(pay.cashApp ? "cash_app" : "chime");
  return (
    <>
      {booking.holdExpiresAt && <Countdown until={booking.holdExpiresAt} />}
      {booking.paymentNote && (
        <div className="note bad" role="alert">
          <Icon name="alert" size={16} />
          <span><b>We couldn't confirm your last payment.</b> {booking.paymentNote}</span>
        </div>
      )}
      <Panel icon="dollar" title={`1. Send ${money(pay.amountCents)}`}>
        <div className="paygrid">
          {pay.cashApp && (
            <div className={`paycard${method === "cash_app" ? " picked" : ""}`}>
              <div className="pc-head"><b>Cash App</b><span>Opens with the amount filled in</span></div>
              <a className="btn btn-heat btn-block" href={pay.cashApp.link} target="_blank" rel="noopener" onClick={() => setMethod("cash_app")}>
                Open Cash App with {money(pay.amountCents)}<Icon name="external" size={15} />
              </a>
              <div className="pc-row"><span>Cashtag</span><span className="mono">{pay.cashApp.cashtag}</span><CopyButton value={pay.cashApp.cashtag} label="cashtag" /></div>
            </div>
          )}
          {pay.chime && (
            <div className={`paycard${method === "chime" ? " picked" : ""}`}>
              <div className="pc-head"><b>Chime</b><span>Pay Anyone</span></div>
              <div className="pc-row"><span>Phone</span><span className="mono">{pay.chime.phone}</span><CopyButton value={pay.chime.phone} label="Chime phone number" /></div>
              <div className="pc-row"><span>Amount</span><span className="mono">{money(pay.amountCents)}</span><CopyButton value={(pay.amountCents / 100).toFixed(2)} label="amount" /></div>
            </div>
          )}
        </div>
        <div className="memo">
          <span>In the payment note, write</span>
          <b className="mono">{pay.code}</b>
          <CopyButton value={pay.code} label="booking code" />
        </div>
        <p className="fine left">Pay from an account in your own name. If someone else pays for you, say so in their payment note.</p>
      </Panel>
      <Panel icon="upload" title="2. Upload your payment screenshot">
        <ProofForm booking={booking} method={method} setMethod={setMethod} onDone={onChange} />
      </Panel>
      <CancelUnpaid booking={booking} onChange={onChange} />
    </>
  );
}

function ProofForm({
  booking,
  method,
  setMethod,
  onDone,
  compact,
}: {
  booking: Booking;
  method: PaymentMethod;
  setMethod: (m: PaymentMethod) => void;
  onDone: (b: Booking) => void;
  compact?: boolean;
}) {
  const account = useAccount();
  const me = account.state.status === "ready" ? account.state.me : null;
  const methods = (["cash_app", "chime"] as const).filter((m) => (m === "cash_app" ? booking.payment?.cashApp : booking.payment?.chime));
  const [sender, setSender] = useState(me?.name ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sender && me?.name) setSender(me.name);
  }, [me?.name, sender]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const choose = async (picked: File | undefined) => {
    setError(null);
    if (!picked) return;
    try {
      const ready = await prepareImage(picked);
      setFile(ready);
      setPreview(URL.createObjectURL(ready));
    } catch (err) {
      setFile(null);
      setPreview(null);
      setError({ message: (err as Error).message, field: "file" });
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setError({ message: "Add a screenshot of your payment.", field: "file" });
    if (!sender.trim()) return setError({ message: "Enter the name on the account you paid from.", field: "senderName" });
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("method", method);
    form.set("senderName", sender.trim());
    form.set("file", file, file.name);
    try {
      onDone(await account.api.uploadProof(booking.code, form));
    } catch (err) {
      setError({ message: (err as Error).message, field: err instanceof RequestError ? err.field : undefined });
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="proofform">
      {methods.length > 1 && (
        <fieldset className="seg" aria-label="How you paid">
          {methods.map((m) => (
            <label key={m} className={method === m ? "on" : ""}>
              <input type="radio" name={`method-${compact ? "c" : "f"}`} value={m} checked={method === m} onChange={() => setMethod(m)} />
              {METHOD_NAMES[m]}
            </label>
          ))}
        </fieldset>
      )}
      <div className={`field${error?.field === "senderName" ? " invalid" : ""}`}>
        <label htmlFor={`pf-sender-${compact ? "c" : "f"}`}>Name on the {METHOD_NAMES[method]} account you paid from</label>
        <input id={`pf-sender-${compact ? "c" : "f"}`} className="input" value={sender} onChange={(e) => setSender(e.target.value)} maxLength={120} autoComplete="name" />
      </div>
      <div className={`drop${error?.field === "file" ? " invalid" : ""}${preview ? " has" : ""}`}>
        <input
          ref={input}
          id={`pf-file-${compact ? "c" : "f"}`}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        {preview ? (
          <>
            <img src={preview} alt="Your payment screenshot" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()}>Choose a different image</button>
          </>
        ) : (
          <label htmlFor={`pf-file-${compact ? "c" : "f"}`} className="drop-label">
            <Icon name="upload" size={22} />
            <b>Choose your screenshot</b>
            <span>It should show the amount, who you paid, and the date.</span>
          </label>
        )}
      </div>
      {error && <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error.message}</span></div>}
      <button className="btn btn-heat btn-block" type="submit" disabled={busy} style={{ marginTop: 14 }}>
        {busy ? "Uploading…" : "Send for confirmation"}
      </button>
    </form>
  );
}

function CancelUnpaid({ booking, onChange }: { booking: Booking; onChange: (b: Booking) => void }) {
  const account = useAccount();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = async () => {
    setBusy(true);
    try {
      await account.api.cancelBooking(booking.code);
      onChange(await account.api.booking(booking.code));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="cancel-row">
      {!asking ? (
        <button className="link muted" onClick={() => setAsking(true)}>Cancel this booking</button>
      ) : (
        <div className="confirm-inline">
          <span>Release these dates? Only do this if you haven't paid.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setAsking(false)} disabled={busy}>Keep it</button>
          <button className="btn btn-danger btn-sm" onClick={cancel} disabled={busy}>{busy ? "Cancelling…" : "Cancel booking"}</button>
        </div>
      )}
      {error && <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
    </div>
  );
}

function ReviewPanel({ booking, onChange }: { booking: Booking; onChange: (b: Booking) => void }) {
  const account = useAccount();
  const identity = account.state.status === "ready" ? account.state.me.identity : null;
  const licenseInReview = identity?.status === "in_review";
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>(booking.paymentMethod ?? "cash_app");
  const pending = booking.proofs.filter((p) => p.status === "pending");
  return (
    <Panel icon="clock" title="We're checking your payment" tone="warn">
      <p>
        Your dates are blocked for you while we confirm {money(booking.totalCents)} arrived in our {booking.paymentMethod ? METHOD_NAMES[booking.paymentMethod] : ""} account
        {licenseInReview ? " and check your license" : ""}. This page updates by itself once it's confirmed.
      </p>
      <div className="proofs">
        {pending.map((p) => (
          <figure key={p.id}>
            <ProofImage url={p.url} alt={`Payment screenshot from ${p.senderName}`} />
            <figcaption>{METHOD_NAMES[p.method]} from {p.senderName}</figcaption>
          </figure>
        ))}
      </div>
      {identity?.status === "failed" && (
        <div className="note bad" role="alert">
          <Icon name="alert" size={16} />
          <span><b>We need new license photos.</b> {identity.failureReason} <Link className="link" to="/license">Send them again</Link></span>
        </div>
      )}
      {adding ? (
        <ProofForm booking={booking} method={method} setMethod={setMethod} onDone={(b) => { setAdding(false); onChange(b); }} compact />
      ) : (
        <button className="link" onClick={() => setAdding(true)}>Add another screenshot</button>
      )}
    </Panel>
  );
}

function ConfirmedPanel({ booking }: { booking: Booking }) {
  const pickup = booking.pickup;
  const booked = (
    <Panel icon="check" title="You're booked" tone="ok">
      <p>Payment received. See you {formatWhen(booking.start)}.</p>
      <ul className="flow-facts">
        {pickup.kind === "location" ? (
          <li><Icon name="pin" size={15} />Pick up at {pickup.location.name}{pickup.location.address ? `, ${pickup.location.address}` : ""}.</li>
        ) : (
          <li><Icon name="pin" size={15} />We'll deliver the car to {pickup.address}.</li>
        )}
        <li><Icon name="id" size={15} />Bring the driver's license you verified.</li>
        <li><Icon name="fuel" size={15} />Return the car to {booking.returnTo.name} by {formatWhen(booking.end)}, at the fuel level you got it.</li>
      </ul>
    </Panel>
  );
  // Once the pass is open it's the thing the renter came for, so it goes first.
  return booking.pass?.open ? (
    <>
      <PickupPass booking={booking} />
      {booked}
    </>
  ) : (
    <>
      {booked}
      <PickupPass booking={booking} />
    </>
  );
}
