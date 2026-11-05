import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { POLICY } from "../../shared/policy.ts";
import type { Me, Quote, VehicleDetail } from "../../shared/types.ts";
import { Icon } from "../components/Icon.tsx";
import { LicenseForm } from "../components/LicenseForm.tsx";
import { TripCard } from "../components/TripCard.tsx";
import { useAccount } from "../lib/account.tsx";
import { api, RequestError } from "../lib/api.ts";
import { formatWhen, money } from "../lib/format.ts";
import { useRequest } from "../lib/useRequest.ts";
import { tripSearch, useTrip } from "../lib/useTrip.ts";
import { useSession } from "../lib/session.tsx";
import { NotFound } from "./NotFound.tsx";

const TRIP_FIELDS = new Set(["startDate", "startTime", "endDate", "endTime", "pickup", "returnTo"]);

export function CheckoutPage() {
  const { slug = "" } = useParams();
  const [params] = useTrip();
  const vehicle = useRequest(`vehicle:${slug}`, (signal) => api.vehicle(slug, signal));
  const home = vehicle.state.status === "ready" ? vehicle.state.data.lot.slug : null;
  const trip = { ...params, pickup: params.pickup || home || "", returnTo: params.returnTo || home || "" };
  const quote = useRequest(home ? `quote:${slug}${tripSearch(trip)}` : null, (signal) => api.quote(slug, trip, signal));

  useEffect(() => {
    document.title = "Checkout | Traffic36";
  }, []);

  if (vehicle.state.status === "error") {
    if (vehicle.state.error instanceof RequestError && vehicle.state.error.status === 404) return <NotFound what="car" />;
    return <LoadError message={vehicle.state.error.message} retry={vehicle.retry} />;
  }
  if (quote.state.status === "error") {
    return (
      <div className="page narrow">
        <div className="empty" role="alert">
          <h1>These trip details need a change</h1>
          <p>{quote.state.error.message}</p>
          <Link className="btn btn-heat" to={`/cars/${slug}${tripSearch(trip)}`}>Change dates or places</Link>
        </div>
      </div>
    );
  }
  if (vehicle.state.status === "loading" || quote.state.status === "loading") {
    return (
      <div className="page" aria-busy="true">
        <div className="checkout">
          <div className="skeleton" style={{ height: 420 }} />
          <div className="skeleton" style={{ height: 460 }} />
        </div>
      </div>
    );
  }
  return <Checkout vehicle={vehicle.state.data} quote={quote.state.data} trip={trip} />;
}

function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="page empty" role="alert">
      <h1>We couldn't load checkout</h1>
      <p>{message}</p>
      <button className="btn btn-ghost" onClick={retry}>Try again</button>
    </div>
  );
}

type Trip = ReturnType<typeof useTrip>[0];

function Checkout({ vehicle, quote, trip }: { vehicle: VehicleDetail; quote: Quote; trip: Trip }) {
  const session = useSession();
  const account = useAccount();
  const me = account.state.status === "ready" ? account.state.me : null;
  // A hand-reviewed license that's waiting for the host is enough to hold dates and pay.
  const verified = me?.identity.status === "verified" || me?.identity.status === "in_review";
  const signedIn = session.status === "signed-in";
  const changeLink = `/cars/${vehicle.slug}${tripSearch(trip)}`;

  return (
    <div className="page">
      <Link className="crumb" to={changeLink}><Icon name="arrowLeft" size={16} />Back to the car</Link>
      <h1 className="page-title">Book your trip</h1>
      <div className="checkout">
        <ol className="flow">
          <Step n={1} title="Your account" state={signedIn && me ? "done" : "current"}>
            <AccountStep me={me} />
          </Step>
          <Step n={2} title="Driver's license" state={!signedIn || !me ? "locked" : verified ? "done" : "current"}>
            {signedIn && me && <LicenseStep me={me} minAge={vehicle.minDriverAge} />}
          </Step>
          <Step n={3} title="Review and hold your dates" state={verified ? "current" : "locked"}>
            {verified && <HoldStep vehicle={vehicle} quote={quote} trip={trip} changeLink={changeLink} />}
          </Step>
        </ol>
        <TripCard
          vehicle={{ ...vehicle, photo: vehicle.photos[0] ?? null }}
          start={quote.start}
          end={quote.end}
          pickup={quote.pickup}
          returnTo={quote.returnTo}
          lines={quote.lines}
          fees={[
            ...(quote.deliveryFeeCents ? [{ label: "Delivery to your address", cents: quote.deliveryFeeCents }] : []),
            { label: "Refundable deposit", cents: quote.depositCents },
          ]}
          total={{ label: "Total to pay", cents: quote.dueTodayCents }}
        >
          <Link className="tc-change" to={changeLink}>Change dates or places</Link>
        </TripCard>
      </div>
    </div>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "current" | "locked"; children?: ReactNode }) {
  return (
    <li className={`flow-step ${state}`} aria-current={state === "current" ? "step" : undefined}>
      <div className="flow-head">
        <span className="flow-n" aria-hidden="true">{state === "done" ? <Icon name="check" size={15} /> : n}</span>
        <h2>{title}</h2>
        {state === "done" && <span className="sr-only">(done)</span>}
      </div>
      {state !== "locked" && children && <div className="flow-body">{children}</div>}
    </li>
  );
}

function AccountStep({ me }: { me: Me | null }) {
  const session = useSession();
  const account = useAccount();
  if (session.status === "loading" || (session.status === "signed-in" && account.state.status === "loading")) {
    return <div className="skeleton" style={{ height: 44 }} />;
  }
  if (session.status === "unavailable") {
    return <div className="note bad"><Icon name="alert" size={16} /><span>Online booking isn't open yet. Call or text us at (646) 397-3139 to book.</span></div>;
  }
  if (session.status === "signed-out") {
    return (
      <>
        <p className="flow-text">Sign in or create an account with your email or phone number. We'll text or email you a code; there's no password.</p>
        <button className="btn btn-heat" onClick={session.openSignIn}>Continue</button>
      </>
    );
  }
  if (account.state.status === "error") {
    // Signed in with Clerk, but our server didn't accept the sign-in: a setup problem, not the renter's.
    const rejected = account.state.error instanceof RequestError && account.state.error.status === 401;
    return (
      <div className="note bad" role="alert">
        <Icon name="alert" size={16} />
        <span>
          {rejected
            ? "We couldn't confirm your sign-in. Sign out, sign back in, and try again. If it keeps happening, call or text us at (646) 397-3139."
            : account.state.error.message}{" "}
          {rejected && (account.state.error as RequestError).reason && (
            <span className="mono reason">Code: {(account.state.error as RequestError).reason}. </span>
          )}
          {rejected ? (
            <button className="link" onClick={() => void session.signOut()}>Sign out</button>
          ) : (
            <button className="link" onClick={() => void account.refresh()}>Try again</button>
          )}
        </span>
      </div>
    );
  }
  return <p className="flow-text done-text">Signed in as <b>{me?.email ?? me?.phone ?? me?.name}</b></p>;
}

function LicenseStep({ me, minAge }: { me: Me; minAge: number }) {
  const account = useAccount();
  const manual = account.state.status === "ready" && account.state.idCheck === "manual";
  return manual ? <ManualLicenseStep me={me} minAge={minAge} /> : <StripeLicenseStep me={me} minAge={minAge} />;
}

const longDate = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function ManualLicenseStep({ me, minAge }: { me: Me; minAge: number }) {
  const id = me.identity;
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [id.status]);

  if (id.status === "verified") {
    return (
      <p className="flow-text done-text">
        License approved{id.licenseState ? ` (${id.licenseState})` : ""}{id.licenseExpiresOn ? `, valid through ${longDate(id.licenseExpiresOn)}` : ""}.
      </p>
    );
  }
  if (id.status === "in_review" && !editing) {
    return (
      <>
        <p className="flow-text done-text">
          License sent for {id.name ?? "you"}. We check it by hand along with your payment, so you can book now.
        </p>
        <button className="link muted" onClick={() => setEditing(true)}>Fix a photo or detail</button>
      </>
    );
  }
  return (
    <>
      {id.status === "failed" && (
        <div className="note bad" role="alert">
          <Icon name="alert" size={16} />
          <span><b>We couldn't approve your license.</b> {id.failureReason}</span>
        </div>
      )}
      {id.status === "expired" && (
        <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>The license on your account has expired. Send your current one.</span></div>
      )}
      <p className="flow-text">
        Take three quick photos: the front and back of your driver's license, and a selfie holding it. Drivers for this car must be {minAge} or older.
      </p>
      <LicenseForm me={me} />
    </>
  );
}

function StripeLicenseStep({ me, minAge }: { me: Me; minAge: number }) {
  const account = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returned = new URLSearchParams(location.search).get("license") === "1";
  const id = me.identity;

  // Back from Stripe: results usually land within seconds. Check quietly for up to a minute.
  const polls = useRef(0);
  useEffect(() => {
    if (!returned || id.status !== "pending") return;
    if (polls.current >= 20) return;
    const t = setTimeout(() => {
      polls.current += 1;
      void account.refresh({ quiet: true });
    }, 3000);
    return () => clearTimeout(t);
  }, [returned, id.status, account, me]);

  // Once the check settles, drop the marker so a reload doesn't look like a fresh return.
  useEffect(() => {
    if (returned && id.status !== "pending") {
      const search = new URLSearchParams(location.search);
      search.delete("license");
      navigate({ search: `?${search}` }, { replace: true, preventScrollReset: true });
    }
  }, [returned, id.status, location.search, navigate]);

  const start = async () => {
    setBusy(true);
    setError(null);
    const search = new URLSearchParams(location.search);
    search.set("license", "1");
    try {
      const result = await account.api.startIdentity(`${location.pathname}?${search}`);
      if ("url" in result) window.location.assign(result.url);
      else {
        await account.refresh({ quiet: true });
        setBusy(false);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (id.status === "verified") {
    return (
      <p className="flow-text done-text">
        License {id.licenseLast4 ? `ending ${id.licenseLast4}` : ""} {id.licenseState ? `(${id.licenseState})` : ""} verified
        {id.licenseExpiresOn ? `, valid through ${new Date(`${id.licenseExpiresOn}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}.
      </p>
    );
  }

  const checking = returned && id.status === "pending" && polls.current < 20;
  return (
    <>
      {checking ? (
        <div className="note" role="status"><span className="spinner" aria-hidden="true" /><span>Checking your license. This usually takes a few seconds.</span></div>
      ) : (
        <>
          {id.status === "failed" && (
            <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{id.failureReason ?? "We couldn't verify that license."}</span></div>
          )}
          {id.status === "expired" && (
            <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>The license on your account has expired. Verify your current one.</span></div>
          )}
          <p className="flow-text">
            {id.status === "pending"
              ? "You started a license check. Pick up where you left off."
              : "Take a photo of the front and back of your driver's license, then a quick selfie. It takes about two minutes, and Stripe runs the check."}
          </p>
          <ul className="flow-facts">
            <li><Icon name="id" size={15} />Drivers for this car must be {minAge} or older.</li>
            <li><Icon name="lock" size={15} />We keep your name, license expiry and the last four digits. Stripe keeps the photos.</li>
          </ul>
          {id.attemptsLeft > 0 ? (
            <button className="btn btn-heat" onClick={start} disabled={busy}>
              {busy ? "Opening Stripe…" : id.status === "pending" ? "Continue license check" : id.status === "failed" ? "Try again" : "Verify my license"}
            </button>
          ) : (
            <p className="flow-text">You've used all your license checks. Call or text us at (646) 397-3139 and we'll help.</p>
          )}
          {error && <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
        </>
      )}
    </>
  );
}

function HoldStep({ vehicle, quote, trip, changeLink }: { vehicle: VehicleDetail; quote: Quote; trip: Trip; changeLink: string }) {
  const account = useAccount();
  const navigate = useNavigate();
  const delivery = quote.pickup.kind === "delivery";
  const [address, setAddress] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestError | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setError(new RequestError(400, "Read and agree to the rental agreement to continue.", "agreement"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { code } = await account.api.createBooking(vehicle.slug, {
        ...trip,
        deliveryAddress: delivery ? address : undefined,
        agreementVersion: POLICY.agreementVersion,
      });
      navigate(`/trips/${code}`);
    } catch (err) {
      setError(err instanceof RequestError ? err : new RequestError(0, (err as Error).message));
      setBusy(false);
    }
  };

  if (!quote.available) {
    return (
      <div className="note bad" role="alert">
        <Icon name="calendar" size={16} />
        <span>
          This car is booked {quote.conflict ? `from ${formatWhen(quote.conflict.start)} to ${formatWhen(quote.conflict.end)}` : "for part of that time"}.{" "}
          <Link className="link" to={changeLink}>Choose other dates</Link>
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      {delivery && (
        <div className={`field${error?.field === "deliveryAddress" ? " invalid" : ""}`} style={{ marginBottom: 14 }}>
          <label htmlFor="co-address">Delivery address</label>
          <input
            id="co-address"
            className="input"
            autoComplete="street-address"
            placeholder="Street, city, ZIP"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={200}
          />
          <span className="hint">We'll confirm we can deliver there before your booking is final. Delivery is drop-off only; you return the car to {quote.returnTo.name}.</span>
        </div>
      )}
      <ul className="flow-facts">
        <li><Icon name="clock" size={15} />We hold these dates for {POLICY.holdMinutes} minutes while you pay.</li>
        <li><Icon name="dollar" size={15} />Next, you'll send {money(quote.dueTodayCents)} by Cash App or Chime and upload a screenshot.</li>
        <li><Icon name="shield" size={15} />Your booking is confirmed once we see the payment arrive.</li>
      </ul>
      <label className={`check${error?.field === "agreement" ? " invalid" : ""}`}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          I've read and agree to the <Link to="/agreement" target="_blank" rel="noopener" className="link">rental agreement</Link>.
        </span>
      </label>
      {error && (
        <div className="note bad" role="alert">
          <Icon name="alert" size={16} />
          <span>
            {error.message}
            {error.field && TRIP_FIELDS.has(error.field) && <> <Link className="link" to={changeLink}>Change your trip</Link></>}
          </span>
        </div>
      )}
      <button className="btn btn-heat btn-block" type="submit" disabled={busy} style={{ marginTop: 16 }}>
        {busy ? "Holding your dates…" : `Hold these dates`}
      </button>
    </form>
  );
}
