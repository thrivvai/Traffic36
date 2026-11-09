import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { HostBookingDetail } from "../../shared/types.ts";
import { ContactLinks, HostOnly, HostTabs, METHOD_NAMES, activityLabel, paymentLabel } from "../components/HostKit.tsx";
import { Icon } from "../components/Icon.tsx";
import { Panel } from "../components/Panel.tsx";
import { ProofImage } from "../components/ProofImage.tsx";
import { StatusPill } from "../components/StatusPill.tsx";
import { TripCard } from "../components/TripCard.tsx";
import { ArchivedBanner, TripControls } from "../components/TripControls.tsx";
import { useAccount } from "../lib/account.tsx";
import { RequestError } from "../lib/api.ts";
import { formatWhen, money } from "../lib/format.ts";
import { useRequest } from "../lib/useRequest.ts";

export function HostBookingPage() {
  const { code = "" } = useParams();
  useEffect(() => {
    document.title = `${code} | Host | Traffic36`;
  }, [code]);
  return <HostOnly what="this booking">{() => <BookingRecord code={code} />}</HostOnly>;
}

function BookingRecord({ code }: { code: string }) {
  const account = useAccount();
  const [booking, setBooking] = useState<HostBookingDetail | null>(null);
  const { state, retry } = useRequest(`host-booking:${code}`, (signal) => account.api.hostBooking(code, signal));
  useEffect(() => {
    if (state.status === "ready") setBooking(state.data);
  }, [state]);

  if (state.status === "error" && !booking) {
    const missing = state.error instanceof RequestError && state.error.status === 404;
    return (
      <div className="page empty" role="alert">
        <h1>{missing ? "No booking with that code" : "We couldn't load this booking"}</h1>
        <p>{missing ? "Check the code, or find it from the renter's profile." : state.error.message}</p>
        {missing ? <Link className="btn btn-ghost" to="/host">Host console</Link> : <button className="btn btn-ghost" onClick={retry}>Try again</button>}
      </div>
    );
  }
  if (!booking) {
    return (
      <div className="page" aria-busy="true">
        <HostTabs />
        <div className="checkout"><div className="skeleton" style={{ height: 480 }} /><div className="skeleton" style={{ height: 460 }} /></div>
      </div>
    );
  }

  const b = booking;
  const r = b.renter;
  const checking = b.status === "payment_review" || b.status === "awaiting_payment";
  return (
    <div className="page">
      <HostTabs />
      <Link className="crumb" to="/host"><Icon name="arrowLeft" size={16} />Host console</Link>
      <div className="trip-head">
        <h1 className="page-title">{b.vehicle.year} {b.vehicle.make} {b.vehicle.model}</h1>
        <div className="trip-meta"><span className="mono">{b.code}</span><StatusPill status={b.status} /></div>
      </div>
      <div className="checkout">
        <div className="trip-main">
          <ArchivedBanner booking={b} onChange={setBooking} />
          {b.status === "cancelled" && (
            <div className="note">
              <Icon name="x" size={16} />
              <span>
                {b.cancelReason ? `Cancelled: ${b.cancelReason}` : "The renter released these dates before paying."}
                {b.refundedCents > 0 ? ` Refunded ${money(b.refundedCents)}.` : ""}
              </span>
            </div>
          )}
          {b.endedEarly && (
            <div className="note">
              <Icon name="clock" size={16} />
              <span>Ended early {formatWhen(b.endedEarly.at)}. It was booked until {formatWhen(b.endedEarly.scheduledEnd)}.</span>
            </div>
          )}
          {b.warnings.length > 0 && (
            <ul className="warns">
              {b.warnings.map((w) => <li key={w}><Icon name="alert" size={15} />{w}</li>)}
            </ul>
          )}
          {checking && (
            <div className="note">
              <Icon name="info" size={16} />
              <span>
                {b.status === "payment_review" ? "The payment screenshot is waiting for you." : "The renter is still paying."} Confirm or send it back from the{" "}
                <Link className="link" to="/host">host console</Link>.
              </span>
            </div>
          )}

          <HandoffPanel booking={b} onSaved={setBooking} />
          <TripControls booking={b} onChange={setBooking} />

          <Panel icon="user" title="Renter">
            <dl className="kv">
              <div>
                <dt>Name</dt>
                <dd><Link className="link" to={`/host/renters/${r.id}`}>{r.verifiedName ?? r.accountName}</Link></dd>
              </div>
              <div>
                <dt>License</dt>
                <dd>{r.licenseApproved ? ["Approved", r.licenseState, r.licenseLast4 && `ends ${r.licenseLast4}`].filter(Boolean).join(" · ") : "Not approved yet"}</dd>
              </div>
              <div><dt>Contact</dt><dd><ContactLinks phone={r.phone} email={r.email} /></dd></div>
            </dl>
          </Panel>

          <Panel icon="dollar" title="Money" aside={b.paymentMethod ? `Paid by ${METHOD_NAMES[b.paymentMethod]}` : undefined}>
            {b.payments.length === 0 ? (
              <p>No payments recorded yet.</p>
            ) : (
              <ul className="ledger">
                {b.payments.map((p) => {
                  const l = paymentLabel(p);
                  return (
                    <li key={`${p.kind}-${p.at}`}>
                      <span><b>{l.title}</b><small>{l.via} · {formatWhen(p.at)}{p.note ? ` · ${p.note}` : ""}</small></span>
                      <span className={`mono ${l.incoming ? "in" : "out"}`}>{l.amount}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {b.proofs.length > 0 && (
              <div className="proofs">
                {b.proofs.map((p) => (
                  <figure key={p.id}>
                    <ProofImage url={p.url} alt={`${METHOD_NAMES[p.method]} screenshot from ${p.senderName}`} />
                    <figcaption>{METHOD_NAMES[p.method]} from {p.senderName} · {p.status === "accepted" ? "accepted" : p.status === "rejected" ? "sent back" : "waiting"}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </Panel>

          <Panel icon="clock" title="History">
            <ol className="timeline">
              {b.activity.map((a) => (
                <li key={`${a.action}-${a.at}`}><time dateTime={a.at}>{formatWhen(a.at)}</time><span>{activityLabel(a)}</span></li>
              ))}
              <li><time dateTime={b.createdAt}>{formatWhen(b.createdAt)}</time><span>Booked by the renter</span></li>
            </ol>
          </Panel>
        </div>
        <TripCard
          vehicle={b.vehicle}
          start={b.start}
          end={b.end}
          pickup={b.pickup}
          returnTo={b.returnTo}
          lines={[{ label: `${b.days} ${b.days === 1 ? "day" : "days"}`, cents: b.rentalCents }]}
          fees={[
            ...(b.deliveryFeeCents ? [{ label: "Delivery", cents: b.deliveryFeeCents }] : []),
            { label: "Refundable deposit", cents: b.depositCents },
          ]}
          total={{ label: "Total", cents: b.totalCents }}
        >
          {b.refundedCents > 0 && <p className="fine left">Sent back so far: {money(b.refundedCents)}</p>}
        </TripCard>
      </div>
    </div>
  );
}

/**
 * How the car is handed over. The host sets a new lockbox code for each trip; the renter sees it on
 * their trip page from an hour before pickup until two hours after the return time.
 */
function HandoffPanel({ booking: b, onSaved }: { booking: HostBookingDetail; onSaved: (b: HostBookingDetail) => void }) {
  const h = b.handoff;
  const ended = Date.parse(b.end) <= Date.now();
  const editable = (b.status === "confirmed" || b.status === "active") && b.pickup.kind === "location" && !ended;
  const [editing, setEditing] = useState(editable && !h.method);

  if (b.status === "cancelled" || b.status === "expired") return null;
  if (b.pickup.kind === "delivery") {
    return (
      <Panel icon="key" title="Pickup: delivery">
        <p>You hand the car over at {b.pickup.address}, {formatWhen(b.start)}. No lockbox code needed.</p>
      </Panel>
    );
  }
  if (b.status !== "confirmed" && b.status !== "active" && !h.method) {
    return (
      <Panel icon="key" title="Pickup plan">
        <p>{b.status === "awaiting_payment" || b.status === "payment_review" ? "You can add the lockbox code once the payment is confirmed." : "No pickup plan was set for this trip."}</p>
      </Panel>
    );
  }

  return (
    <Panel icon="key" title="Pickup plan" tone={h.method && (h.method !== "lockbox" || h.code) ? undefined : "warn"}>
      {!editing && <HandoffNow booking={b} />}
      {editing ? (
        <HandoffForm booking={b} onCancel={h.method ? () => setEditing(false) : undefined} onSaved={(next) => { onSaved(next); setEditing(false); }} />
      ) : (
        editable && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>{h.method === "lockbox" ? "Change code or note" : "Change pickup plan"}</button>
      )}
    </Panel>
  );
}

function HandoffNow({ booking: b }: { booking: HostBookingDetail }) {
  const h = b.handoff;
  const opens = Date.parse(h.opensAt);
  const where = b.pickup.kind === "location" ? b.pickup.location.name : "";
  return (
    <div className="handoff-now">
      {h.method === "lockbox" ? (
        h.code ? (
          <div className="hn-code">
            <span>Lockbox code</span>
            <b className="mono">{h.code}</b>
          </div>
        ) : (
          <p className="hn-missing"><Icon name="alert" size={15} />Lockbox chosen, but the code isn't saved.</p>
        )
      ) : (
        <p>You're meeting the renter at {where}, {formatWhen(b.start)}.</p>
      )}
      {h.note && <p className="hn-note"><Icon name="pin" size={15} />{h.note}</p>}
      <p className="hn-status" role="status">
        {h.method === "lockbox" && h.code && h.revealedAt ? (
          <><Icon name="check" size={15} /><span>The renter opened their code {formatWhen(h.revealedAt)}.</span></>
        ) : Date.now() > Date.parse(h.closesAt) ? (
          <><Icon name="clock" size={15} /><span>The renter's pass closed {formatWhen(h.closesAt)}.</span></>
        ) : Date.now() < opens ? (
          <><Icon name="clock" size={15} /><span>The renter sees this from {formatWhen(h.opensAt)} until {formatWhen(h.closesAt)}.</span></>
        ) : h.method === "lockbox" ? (
          <><Icon name="clock" size={15} /><span>The renter can see it now and hasn't opened it yet.</span></>
        ) : (
          <><Icon name="clock" size={15} /><span>The renter's trip page shows this now.</span></>
        )}
      </p>
      {h.setAt && <p className="fine left">Saved {formatWhen(h.setAt)}</p>}
    </div>
  );
}

function HandoffForm({ booking: b, onCancel, onSaved }: { booking: HostBookingDetail; onCancel?: () => void; onSaved: (b: HostBookingDetail) => void }) {
  const account = useAccount();
  const h = b.handoff;
  const [method, setMethod] = useState<"lockbox" | "in_person">(h.method === "in_person" ? "in_person" : "lockbox");
  const [code, setCode] = useState(h.code ?? "");
  const [note, setNote] = useState(h.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const changingSeenCode = !!h.revealedAt && method === "lockbox" && code.replace(/[\s-]/g, "") !== h.code;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await account.api.setHandoff(b.code, { method, lockboxCode: method === "lockbox" ? code : undefined, note }));
    } catch (err) {
      setError({ message: (err as Error).message, field: err instanceof RequestError ? err.field : undefined });
      setBusy(false);
    }
  };

  return (
    <form className="handoff-form" onSubmit={save} noValidate>
      <fieldset className="seg" aria-label="How the renter gets the key">
        {(
          [
            ["lockbox", "Lockbox"],
            ["in_person", "Meet in person"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className={method === value ? "on" : ""}>
            <input type="radio" name={`handoff-${b.code}`} value={value} checked={method === value} onChange={() => setMethod(value)} />
            {label}
          </label>
        ))}
      </fieldset>

      {method === "lockbox" ? (
        <div className={`field${error?.field === "lockboxCode" ? " invalid" : ""}`}>
          <label htmlFor={`code-${b.code}`}>Lockbox code</label>
          <input
            id={`code-${b.code}`}
            className="input mono code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.slice(0, 16))}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="numeric"
            placeholder="4821"
            required
          />
          <span className="hint">Set a new code on the lockbox for each renter, then enter the same code here.</span>
        </div>
      ) : (
        <p className="fine left">The renter's trip page tells them to meet you at {b.pickup.kind === "location" ? b.pickup.location.name : "the pickup spot"} at {formatWhen(b.start)}.</p>
      )}

      <div className={`field${error?.field === "note" ? " invalid" : ""}`}>
        <label htmlFor={`note-${b.code}`}>Note for the renter (optional)</label>
        <textarea
          id={`note-${b.code}`}
          className="input"
          rows={2}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={method === "lockbox" ? "Level 2, space 14. Lockbox is on the driver's window." : "Meet me at the front entrance."}
        />
        <span className="hint">Shown with the code, from {formatWhen(h.opensAt)}.</span>
      </div>

      {changingSeenCode && (
        <div className="note">
          <Icon name="info" size={16} />
          <span>The renter already opened the old code. Text them so they know it changed.</span>
        </div>
      )}
      {error && <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error.message}</span></div>}
      <div className="hcard-actions">
        <button className="btn btn-heat" type="submit" disabled={busy || (method === "lockbox" && !code.trim())}>
          {busy ? "Saving…" : method === "lockbox" ? "Save code" : "Save"}
        </button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  );
}
