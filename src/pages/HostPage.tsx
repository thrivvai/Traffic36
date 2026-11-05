import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { POLICY } from "../../shared/policy.ts";
import type { HostBooking, HostDashboard, IdDocumentKind, LicenseReview, RejectReason } from "../../shared/types.ts";
import { US_LICENSE_STATES } from "../../shared/usStates.ts";
import { HostTabs, METHOD_NAMES } from "../components/HostKit.tsx";
import { Icon } from "../components/Icon.tsx";
import { ProofImage } from "../components/ProofImage.tsx";
import { StatusPill } from "../components/StatusPill.tsx";
import { useAccount } from "../lib/account.tsx";
import type { HostActionBody } from "../lib/api.ts";
import { formatPhone, formatWhen, money } from "../lib/format.ts";
import { useSession } from "../lib/session.tsx";
import { SignInPrompt } from "./TripsPage.tsx";

export function HostPage() {
  const session = useSession();
  const account = useAccount();
  const [data, setData] = useState<HostDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number>(0);
  const isHost = account.state.status === "ready" && account.state.me.role === "host";

  const load = async () => {
    try {
      setData(await account.api.hostDashboard());
      setError(null);
      setLoadedAt(Date.now());
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    document.title = "Host | Traffic36";
  }, []);
  useEffect(() => {
    if (!isHost) return;
    void load();
    // Fresh numbers whenever the host comes back to this tab, and every minute while it's open.
    const onFocus = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onFocus);
    const id = setInterval(onFocus, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(id);
    };
  }, [isHost]);

  if (session.status === "signed-out") return <SignInPrompt what="the host console" />;
  if (account.state.status === "ready" && !isHost) {
    return (
      <div className="page empty">
        <h1>This page is for the host</h1>
        <Link className="btn btn-ghost" to="/trips">Go to your trips</Link>
      </div>
    );
  }
  if (!data) {
    return error ? (
      <div className="page empty" role="alert">
        <h1>We couldn't load the host console</h1>
        <p>{error}</p>
        <button className="btn btn-ghost" onClick={() => void load()}>Try again</button>
      </div>
    ) : (
      <div className="page narrow" aria-busy="true"><div className="skeleton" style={{ height: 360 }} /></div>
    );
  }

  const act = async (code: string, action: "confirm" | "reject" | "cancel" | "deposit", body: HostActionBody) => {
    setData(await account.api.hostAction(code, action, body));
  };

  return (
    <div className="page host">
      <HostTabs />
      <div className="host-head">
        <h1 className="page-title">Host console</h1>
        <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
          <Icon name="refresh" size={15} />Refresh
        </button>
      </div>
      {error && <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
      <p className="fine left" aria-live="polite">Updated {new Date(loadedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>

      <Section title="Licenses to review" count={data.licenses.length} empty="No licenses waiting. New ones show up here.">
        {data.licenses.map((l) => <LicenseCard key={l.userId} l={l} onDone={setData} />)}
      </Section>

      <Section title="Payments to check" count={data.review.length} empty="Nothing to check. New payment screenshots show up here.">
        {data.review.map((b) => <ReviewCard key={b.code} b={b} act={act} />)}
      </Section>

      <Section title="Deposits to return" count={data.depositsDue.length} empty="No deposits waiting.">
        {data.depositsDue.map((b) => <DepositCard key={b.code} b={b} act={act} />)}
      </Section>

      <Section title="Upcoming trips" count={data.upcoming.length} empty="No confirmed trips coming up.">
        {data.upcoming.map((b) => <MiniRow key={b.code} b={b} plan />)}
      </Section>

      <Section title="Holding for payment" count={data.awaitingPayment.length} empty="No one is mid-checkout right now.">
        {data.awaitingPayment.map((b) => <MiniRow key={b.code} b={b} note={b.holdExpiresAt ? `Hold ends ${new Date(b.holdExpiresAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : undefined} />)}
      </Section>
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section className="host-sec">
      <h2>{title} <span className="count">{count}</span></h2>
      {count === 0 ? <p className="host-empty">{empty}</p> : <div className="host-list">{children}</div>}
    </section>
  );
}

type Act = (code: string, action: "confirm" | "reject" | "cancel" | "deposit", body: HostActionBody) => Promise<void>;

function useAction(act: Act, code: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const run = async (action: Parameters<Act>[1], body: HostActionBody) => {
    setBusy(true);
    setError(null);
    try {
      await act(code, action, body);
    } catch (err) {
      setError({ message: (err as Error).message, field: (err as { field?: string }).field });
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Who({ b }: { b: HostBooking }) {
  const r = b.renter;
  return (
    <dl className="kv">
      <div>
        <dt>Renter</dt>
        <dd>
          <Link className="link" to={`/host/renters/${r.id}`}>{r.verifiedName ?? r.accountName}</Link>
          {r.verifiedName ? "" : " (license not approved)"}
          {r.licenseState ? ` · ${r.licenseState}` : ""}{r.licenseLast4 ? ` · ends ${r.licenseLast4}` : ""}
        </dd>
      </div>
      <div>
        <dt>Contact</dt>
        <dd>
          {r.phone && <a className="link" href={`sms:${r.phone}`}>{formatPhone(r.phone)}</a>}
          {r.phone && r.email && " · "}
          {r.email && <a className="link" href={`mailto:${r.email}`}>{r.email}</a>}
        </dd>
      </div>
    </dl>
  );
}

function ReviewCard({ b, act }: { b: HostBooking; act: Act }) {
  const [mode, setMode] = useState<"idle" | "confirm" | "reject" | "cancel">("idle");
  const [seen, setSeen] = useState(false);
  const [approveDelivery, setApproveDelivery] = useState(false);
  const [reason, setReason] = useState<RejectReason>("not_received");
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction(act, b.code);
  const proofs = b.proofs.filter((p) => p.status === "pending");
  const latest = proofs[proofs.length - 1];
  const method = latest ? METHOD_NAMES[latest.method] : "your";
  const delivery = b.pickup.kind === "delivery" ? b.pickup.address : null;

  return (
    <article className="hcard">
      <div className="hcard-proofs">
        {proofs.map((p) => <ProofImage key={p.id} url={p.url} alt={`${METHOD_NAMES[p.method]} screenshot from ${p.senderName}`} />)}
      </div>
      <div className="hcard-body">
        <div className="hcard-top">
          <Link className="mono link muted" to={`/host/bookings/${b.code}`}>{b.code}</Link>
          <StatusPill status={b.status} />
        </div>
        <div className="hcard-amount">{money(b.totalCents)}<span>by {latest ? METHOD_NAMES[latest.method] : "?"} from <b>{latest?.senderName ?? "?"}</b></span></div>
        <p className="hcard-trip">{b.vehicle.year} {b.vehicle.make} {b.vehicle.model} · {formatWhen(b.start)} to {formatWhen(b.end)}</p>
        <Who b={b} />
        {b.warnings.length > 0 && (
          <ul className="warns">
            {b.warnings.map((w) => <li key={w}><Icon name="alert" size={15} />{w}</li>)}
          </ul>
        )}

        {mode === "idle" && (
          <div className="hcard-actions">
            <button className="btn btn-heat" onClick={() => setMode("confirm")} disabled={!b.renter.licenseApproved}>Confirm payment</button>
            <button className="btn btn-ghost" onClick={() => setMode("reject")}>Can't find it</button>
            <button className="link muted" onClick={() => setMode("cancel")}>Cancel booking</button>
          </div>
        )}

        {mode === "confirm" && (
          <div className="hcard-panel">
            <label className="check">
              <input type="checkbox" checked={seen} onChange={(e) => setSeen(e.target.checked)} />
              <span>I see {money(b.totalCents)} from {latest?.senderName ?? "the renter"} in my {method} account.</span>
            </label>
            {delivery && (
              <label className={`check${error?.field === "approveDelivery" ? " invalid" : ""}`}>
                <input type="checkbox" checked={approveDelivery} onChange={(e) => setApproveDelivery(e.target.checked)} />
                <span>I can deliver to {delivery}.</span>
              </label>
            )}
            <div className="hcard-actions">
              <button className="btn btn-heat" disabled={!seen || (!!delivery && !approveDelivery) || busy} onClick={() => void run("confirm", { approveDelivery })}>
                {busy ? "Confirming…" : "Confirm booking"}
              </button>
              <button className="btn btn-ghost" onClick={() => setMode("idle")} disabled={busy}>Back</button>
            </div>
          </div>
        )}

        {mode === "reject" && (
          <div className="hcard-panel">
            <fieldset className="radios">
              <legend>What's wrong?</legend>
              {(
                [
                  ["not_received", "The money isn't in my account"],
                  ["wrong_amount", "Wrong amount"],
                  ["name_mismatch", "Sender doesn't match the license"],
                  ["other", "Something else"],
                ] as const
              ).map(([value, label]) => (
                <label key={value}><input type="radio" name={`reason-${b.code}`} checked={reason === value} onChange={() => setReason(value)} />{label}</label>
              ))}
            </fieldset>
            <div className={`field${error?.field === "note" ? " invalid" : ""}`}>
              <label htmlFor={`note-${b.code}`}>Note to the renter {reason === "other" ? "" : "(optional)"}</label>
              <textarea id={`note-${b.code}`} className="input" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="fine left">The renter gets a fresh {POLICY.holdMinutes}-minute hold to send it again.</p>
            <div className="hcard-actions">
              <button className="btn btn-heat" disabled={busy} onClick={() => void run("reject", { reason, note })}>{busy ? "Sending…" : "Send back to renter"}</button>
              <button className="btn btn-ghost" onClick={() => setMode("idle")} disabled={busy}>Back</button>
            </div>
          </div>
        )}

        {mode === "cancel" && (
          <div className="hcard-panel">
            <div className={`field${error?.field === "note" ? " invalid" : ""}`}>
              <label htmlFor={`cancel-${b.code}`}>Reason, shown to the renter</label>
              <textarea id={`cancel-${b.code}`} className="input" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="fine left">If they paid, send the money back from your {method} account.</p>
            <div className="hcard-actions">
              <button className="btn btn-danger" disabled={busy} onClick={() => void run("cancel", { note })}>{busy ? "Cancelling…" : "Cancel booking"}</button>
              <button className="btn btn-ghost" onClick={() => setMode("idle")} disabled={busy}>Back</button>
            </div>
          </div>
        )}

        {error && <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error.message}</span></div>}
      </div>
    </article>
  );
}

const DOC_LABELS: Record<IdDocumentKind, string> = { license_front: "Front", license_back: "Back", selfie: "Selfie" };

const REJECT_PRESETS = [
  "A photo is blurry. Retake it in bright light and hold still.",
  "Glare covers part of the license. Tilt it away from the light and retake it.",
  "The selfie doesn't clearly show your face next to the license.",
  "The details you typed don't match the license.",
  "The license is expired or damaged. Send a current, undamaged license.",
];

function LicenseCard({ l, onDone }: { l: LicenseReview; onDone: (d: HostDashboard) => void }) {
  const account = useAccount();
  const [form, setForm] = useState({ legalName: l.legalName, dob: l.dob, licenseState: l.licenseState, licenseExpiresOn: l.licenseExpiresOn, licenseLast4: "" });
  const [checks, setChecks] = useState([false, false, false]);
  const [mode, setMode] = useState<"review" | "reject">("review");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const run = async (action: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      onDone(await account.api.hostLicense(l.userId, action, action === "approve" ? form : { reason }));
    } catch (err) {
      setError({ message: (err as Error).message, field: (err as { field?: string }).field });
      setBusy(false);
    }
  };
  const invalid = (f: string) => `field${error?.field === f ? " invalid" : ""}`;
  const checkLabels = [
    "The name, birth date, state and expiry above match the license.",
    "The license looks real: not expired, damaged, edited or a photo of a screen.",
    "The face in the selfie matches the license photo.",
  ];

  return (
    <article className="hcard license">
      <div className="lic-photos">
        {l.documents.map((d) => (
          <figure key={d.kind}>
            <ProofImage url={d.url} alt={`${DOC_LABELS[d.kind]} of ${l.legalName}'s license`} />
            <figcaption>{DOC_LABELS[d.kind]}</figcaption>
          </figure>
        ))}
      </div>
      <div className="hcard-body">
        <div className="hcard-top">
          <span>Sent {formatWhen(l.submittedAt)}</span>
          {l.previousRejections > 0 && <span className="status warn">Rejected {l.previousRejections}x before</span>}
        </div>
        <div className="hcard-amount lic-name">{l.legalName}<span>age {l.age} · account “{l.accountName}” · <Link className="link muted" to={`/host/renters/${l.userId}`}>Profile</Link></span></div>
        <dl className="kv">
          <div>
            <dt>Contact</dt>
            <dd>
              {l.phone && <a className="link" href={`sms:${l.phone}`}>{formatPhone(l.phone)}</a>}
              {l.phone && l.email && " · "}
              {l.email && <a className="link" href={`mailto:${l.email}`}>{l.email}</a>}
            </dd>
          </div>
          {l.openBookings.length > 0 && <div><dt>Trips waiting</dt><dd className="mono">{l.openBookings.join(", ")}</dd></div>}
        </dl>

        {mode === "review" ? (
          <div className="hcard-panel">
            <p className="fine left">Compare with the photos. Fix any typo before approving; the corrected details are what the booking rules use.</p>
            <div className="lic-grid">
              <div className={`${invalid("legalName")} span2`}>
                <label htmlFor={`ln-${l.userId}`}>Legal name</label>
                <input id={`ln-${l.userId}`} className="input" value={form.legalName} onChange={set("legalName")} />
              </div>
              <div className={invalid("dob")}>
                <label htmlFor={`dob-${l.userId}`}>Date of birth</label>
                <input id={`dob-${l.userId}`} className="input" type="date" value={form.dob} onChange={set("dob")} />
              </div>
              <div className={invalid("licenseExpiresOn")}>
                <label htmlFor={`exp-${l.userId}`}>Expires</label>
                <input id={`exp-${l.userId}`} className="input" type="date" value={form.licenseExpiresOn} onChange={set("licenseExpiresOn")} />
              </div>
              <div className={invalid("licenseState")}>
                <label htmlFor={`st-${l.userId}`}>State</label>
                <select id={`st-${l.userId}`} className="select" value={form.licenseState} onChange={set("licenseState")}>
                  {Object.entries(US_LICENSE_STATES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </div>
              <div className={invalid("licenseLast4")}>
                <label htmlFor={`l4-${l.userId}`}>License no. last 4 (optional)</label>
                <input id={`l4-${l.userId}`} className="input mono" maxLength={4} value={form.licenseLast4} onChange={set("licenseLast4")} />
              </div>
            </div>
            {checkLabels.map((label, i) => (
              <label className="check" key={label}>
                <input type="checkbox" checked={checks[i]} onChange={(e) => setChecks((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} />
                <span>{label}</span>
              </label>
            ))}
            <div className="hcard-actions">
              <button className="btn btn-heat" disabled={!checks.every(Boolean) || busy} onClick={() => void run("approve")}>
                {busy ? "Approving…" : "Approve license"}
              </button>
              <button className="btn btn-ghost" onClick={() => setMode("reject")} disabled={busy}>Ask for new photos</button>
            </div>
          </div>
        ) : (
          <div className="hcard-panel">
            <fieldset className="radios">
              <legend>What should they fix?</legend>
              {REJECT_PRESETS.map((p) => (
                <label key={p}><input type="radio" name={`lr-${l.userId}`} checked={reason === p} onChange={() => setReason(p)} />{p}</label>
              ))}
            </fieldset>
            <div className={invalid("reason")}>
              <label htmlFor={`rs-${l.userId}`}>Message to the renter</label>
              <textarea id={`rs-${l.userId}`} className="input" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <p className="fine left">If they already paid for a trip and can't fix this, cancel the booking and send their money back.</p>
            <div className="hcard-actions">
              <button className="btn btn-heat" disabled={busy} onClick={() => void run("reject")}>{busy ? "Sending…" : "Send to renter"}</button>
              <button className="btn btn-ghost" onClick={() => setMode("review")} disabled={busy}>Back</button>
            </div>
          </div>
        )}
        {error && <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error.message}</span></div>}
      </div>
    </article>
  );
}

function DepositCard({ b, act }: { b: HostBooking; act: Act }) {
  const [amount, setAmount] = useState((b.depositCents / 100).toFixed(2));
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction(act, b.code);
  const cents = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(cents) && cents >= 0 && cents <= b.depositCents;
  const keeping = valid && cents < b.depositCents;
  return (
    <article className="hcard compact">
      <div className="hcard-body">
        <div className="hcard-top"><Link className="mono link muted" to={`/host/bookings/${b.code}`}>{b.code}</Link><span className="fine">Ended {formatWhen(b.end)}</span></div>
        <p className="hcard-trip">{b.renter.verifiedName ?? b.renter.accountName} · {b.vehicle.make} {b.vehicle.model} · paid by {b.paymentMethod ? METHOD_NAMES[b.paymentMethod] : "?"}</p>
        <div className="deposit-row">
          <div className={`field${error?.field === "refundCents" ? " invalid" : ""}`}>
            <label htmlFor={`dep-${b.code}`}>Amount sent back</label>
            <input id={`dep-${b.code}`} className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
          {keeping && (
            <div className={`field grow${error?.field === "note" ? " invalid" : ""}`}>
              <label htmlFor={`depnote-${b.code}`}>What the {money(b.depositCents - cents)} kept covers</label>
              <input id={`depnote-${b.code}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Fuel, cleaning, late return…" />
            </div>
          )}
        </div>
        <div className="hcard-actions">
          <button className="btn btn-heat" disabled={!valid || busy} onClick={() => void run("deposit", { refundCents: cents, note })}>
            {busy ? "Saving…" : `Mark ${valid ? money(cents) : ""} returned`}
          </button>
        </div>
        {error && <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error.message}</span></div>}
      </div>
    </article>
  );
}

/** What the host still has to do to hand the car over, in two or three words. */
function planLabel(b: HostBooking): [string, "ok" | "warn" | "muted"] {
  const h = b.handoff;
  if (h.method === "delivery") return ["Delivery", "muted"];
  if (h.method === "in_person") return ["Meeting in person", "ok"];
  if (h.method === "lockbox") return h.code ? [h.revealedAt ? "Code opened" : "Code set", "ok"] : ["Add lockbox code", "warn"];
  return ["Add pickup plan", b.warnings.length ? "warn" : "muted"];
}

function MiniRow({ b, note, plan }: { b: HostBooking; note?: string; plan?: boolean }) {
  const [label, tone] = planLabel(b);
  return (
    <Link className="minirow" to={`/host/bookings/${b.code}`}>
      <span className="mono">{b.code}</span>
      <span>{b.renter.verifiedName ?? b.renter.accountName}</span>
      <span>{b.vehicle.make} {b.vehicle.model}</span>
      <span>{formatWhen(b.start)}</span>
      {plan ? <span className={`status ${tone}`}>{label}</span> : <span className="fine">{note ?? (b.pickup.kind === "delivery" ? "Delivery" : b.pickup.location.name)}</span>}
    </Link>
  );
}
