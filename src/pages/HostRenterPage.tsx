import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { IdDocumentKind, RenterProfile } from "../../shared/types.ts";
import { US_LICENSE_STATES } from "../../shared/usStates.ts";
import { ContactLinks, HostOnly, HostTabs, LicensePill, paymentLabel } from "../components/HostKit.tsx";
import { Icon } from "../components/Icon.tsx";
import { Panel } from "../components/Panel.tsx";
import { ProofImage } from "../components/ProofImage.tsx";
import { StatusPill } from "../components/StatusPill.tsx";
import { useAccount } from "../lib/account.tsx";
import { RequestError } from "../lib/api.ts";
import { formatDate, formatDay, formatWhen, money } from "../lib/format.ts";
import { useRequest } from "../lib/useRequest.ts";

export function HostRenterPage() {
  const { id = "" } = useParams();
  return <HostOnly what="this renter">{() => <RenterRecord id={id} />}</HostOnly>;
}

function RenterRecord({ id }: { id: string }) {
  const account = useAccount();
  const [renter, setRenter] = useState<RenterProfile | null>(null);
  const { state, retry } = useRequest(`renter:${id}`, (signal) => account.api.hostRenter(id, signal));
  useEffect(() => {
    if (state.status === "ready") setRenter(state.data);
  }, [state]);
  useEffect(() => {
    document.title = `${renter?.name ?? "Renter"} | Host | Traffic36`;
  }, [renter?.name]);

  if (state.status === "error" && !renter) {
    const missing = state.error instanceof RequestError && state.error.status === 404;
    return (
      <div className="page empty" role="alert">
        <h1>{missing ? "We can't find that renter" : "We couldn't load this renter"}</h1>
        <p>{missing ? "They may have been removed. Search the renter list." : state.error.message}</p>
        {missing ? <Link className="btn btn-ghost" to="/host/renters">All renters</Link> : <button className="btn btn-ghost" onClick={retry}>Try again</button>}
      </div>
    );
  }
  if (!renter) {
    return (
      <div className="page" aria-busy="true">
        <HostTabs />
        <div className="checkout"><div className="skeleton" style={{ height: 520 }} /><div className="skeleton" style={{ height: 380 }} /></div>
      </div>
    );
  }

  const r = renter;
  const [latest, ...earlier] = r.licenses;
  const stateName = (code: string | null) => (code ? (US_LICENSE_STATES as Record<string, string>)[code] ?? code : null);

  return (
    <div className="page">
      <HostTabs />
      <Link className="crumb" to="/host/renters"><Icon name="arrowLeft" size={16} />Renters</Link>
      <div className="trip-head">
        <h1 className="page-title">{r.name}</h1>
        <div className="trip-meta">
          {r.doNotRent && <span className="status bad">Blocked</span>}
          <LicensePill status={r.licenseStatus} />
        </div>
      </div>

      <div className="checkout renter-layout">
        <div className="trip-main">
          <Panel icon="id" title="Driver's license" aside={latest ? `Sent ${formatDate(latest.submittedAt)}` : undefined}>
            {!latest ? (
              <p>{r.licenseStatus === "verified" ? "Checked by Stripe, so there are no photos here." : "No license photos sent yet."}</p>
            ) : (
              <LicenseSubmission sub={latest} name={r.name} />
            )}
            {earlier.length > 0 && <EarlierSubmissions subs={earlier} name={r.name} />}
          </Panel>

          <Panel icon="car" title="Trips" aside={`${r.bookings.length}`}>
            {r.bookings.length === 0 ? (
              <p>No bookings yet.</p>
            ) : (
              <ul className="rtrips">
                {r.bookings.map((b) => (
                  <li key={b.code}>
                    <Link className="rtrip" to={`/host/bookings/${b.code}`}>
                      <span className="mono">{b.code}</span>
                      <span className="rtrip-car">{b.vehicle.year} {b.vehicle.make} {b.vehicle.model}</span>
                      <span className="rtrip-when">{formatWhen(b.start)} to {formatWhen(b.end)}</span>
                      <span className="rtrip-end"><StatusPill status={b.status} /><span className="mono">{money(b.totalCents)}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel icon="dollar" title="Payments">
            {r.payments.length === 0 ? (
              <p>No payments recorded yet.</p>
            ) : (
              <ul className="ledger">
                {r.payments.map((p) => {
                  const l = paymentLabel(p);
                  return (
                    <li key={`${p.bookingCode}-${p.kind}-${p.at}`}>
                      <span>
                        <b>{l.title}</b>
                        <small><Link className="link muted" to={`/host/bookings/${p.bookingCode}`}>{p.bookingCode}</Link> · {l.via} · {formatWhen(p.at)}{p.note ? ` · ${p.note}` : ""}</small>
                      </span>
                      <span className={`mono ${l.incoming ? "in" : "out"}`}>{l.amount}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="trip-main">
          <Panel icon="user" title="Details">
            <dl className="kv">
              <div><dt>Contact</dt><dd><ContactLinks phone={r.phone} email={r.email} /></dd></div>
              <div><dt>Name on license</dt><dd>{r.verifiedName ?? "Not approved yet"}</dd></div>
              {r.verifiedName !== r.accountName && <div><dt>Account name</dt><dd>{r.accountName}</dd></div>}
              {r.dob && <div><dt>Born</dt><dd>{formatDay(r.dob)}{r.age !== null ? ` (age ${r.age})` : ""}</dd></div>}
              {r.licenseState && <div><dt>License</dt><dd>{stateName(r.licenseState)}{r.licenseLast4 ? `, ends ${r.licenseLast4}` : ""}</dd></div>}
              {r.licenseExpiresOn && <div><dt>Expires</dt><dd>{formatDay(r.licenseExpiresOn)}</dd></div>}
              {r.licenseApprovedAt && <div><dt>Approved</dt><dd>{formatDate(r.licenseApprovedAt)}</dd></div>}
              <div><dt>Joined</dt><dd>{formatDate(r.joinedAt)}</dd></div>
            </dl>
          </Panel>
          <BookingAccess renter={r} onChange={setRenter} />
        </aside>
      </div>
    </div>
  );
}

const DOC_LABELS: Record<IdDocumentKind, string> = { license_front: "Front", license_back: "Back", selfie: "Selfie" };
const SUB_STATUS = { approved: ["Approved", "ok"], pending: ["Waiting for review", "warn"], rejected: ["Sent back", "bad"], replaced: ["Replaced by newer photos", "muted"] } as const;

function LicenseSubmission({ sub, name }: { sub: RenderedSubmission; name: string }) {
  const [label, tone] = SUB_STATUS[sub.status];
  return (
    <div className="lic-sub">
      <div className="lic-photos">
        {sub.documents.map((d) => (
          <figure key={d.kind}>
            <ProofImage url={d.url} alt={`${DOC_LABELS[d.kind]} of ${name}'s license`} />
            <figcaption>{DOC_LABELS[d.kind]}</figcaption>
          </figure>
        ))}
      </div>
      <div className="lic-sub-facts">
        <span className={`status ${tone}`}>{label}</span>
        <dl className="kv">
          <div><dt>Typed name</dt><dd>{sub.legalName}</dd></div>
          <div><dt>Born</dt><dd>{formatDay(sub.dob)}</dd></div>
          <div><dt>State</dt><dd>{sub.licenseState}</dd></div>
          <div><dt>Expires</dt><dd>{formatDay(sub.licenseExpiresOn)}</dd></div>
        </dl>
        {sub.reviewNote && <p className="fine left">Your note: {sub.reviewNote}</p>}
      </div>
    </div>
  );
}

type RenderedSubmission = RenterProfile["licenses"][number];

/** Older photo sets load only when opened, so the profile stays quick. */
function EarlierSubmissions({ subs, name }: { subs: RenderedSubmission[]; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="earlier" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Earlier photos ({subs.length})</summary>
      {open && subs.map((s) => (
        <div key={s.submittedAt} className="earlier-item">
          <p className="fine left">Sent {formatWhen(s.submittedAt)}</p>
          <LicenseSubmission sub={s} name={name} />
        </div>
      ))}
    </details>
  );
}

function BookingAccess({ renter: r, onChange }: { renter: RenterProfile; onChange: (r: RenterProfile) => void }) {
  const account = useAccount();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  const save = async (value: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await account.api.blockRenter(r.id, { value, note: value ? note : undefined }));
      setAsking(false);
      setNote("");
    } catch (err) {
      setError({ message: (err as Error).message, field: err instanceof RequestError ? err.field : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel icon="shield" title="Booking access" tone={r.doNotRent ? "warn" : undefined}>
      {r.doNotRent ? (
        <>
          <p>Blocked from booking.{r.doNotRentNote ? ` Reason: ${r.doNotRentNote}` : ""}</p>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void save(false)}>{busy ? "Saving…" : "Let them book again"}</button>
        </>
      ) : asking ? (
        <div className="hcard-panel">
          <div className={`field${error?.field === "note" ? " invalid" : ""}`}>
            <label htmlFor="block-note">Reason, for your records only</label>
            <textarea id="block-note" className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="fine left">They can't start new bookings. Trips already booked don't change.</p>
          <div className="hcard-actions">
            <button className="btn btn-danger" disabled={busy} onClick={() => void save(true)}>{busy ? "Saving…" : "Block from booking"}</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setAsking(false)}>Back</button>
          </div>
        </div>
      ) : (
        <>
          <p>Can book.</p>
          <button className="link muted" onClick={() => setAsking(true)}>Stop this renter from booking</button>
        </>
      )}
      {error && <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error.message}</span></div>}
    </Panel>
  );
}
