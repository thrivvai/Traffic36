import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon.tsx";
import { StatusPill } from "../components/StatusPill.tsx";
import { useAccount } from "../lib/account.tsx";
import { formatWhen, money } from "../lib/format.ts";
import { useRequest } from "../lib/useRequest.ts";
import { useSession } from "../lib/session.tsx";

export function SignInPrompt({ what }: { what: string }) {
  const session = useSession();
  return (
    <div className="page empty">
      <h1>Sign in to see {what}</h1>
      <p>Use the email or phone number you booked with.</p>
      <button className="btn btn-heat" onClick={session.openSignIn}>Sign in</button>
    </div>
  );
}

export function TripsPage() {
  const session = useSession();
  const account = useAccount();
  const { state, retry } = useRequest(session.status === "signed-in" ? "bookings" : null, (signal) => account.api.bookings(signal));

  useEffect(() => {
    document.title = "Your trips | Traffic36";
  }, []);

  if (session.status === "signed-out") return <SignInPrompt what="your trips" />;
  if (state.status === "error") {
    return (
      <div className="page empty" role="alert">
        <h1>We couldn't load your trips</h1>
        <p>{state.error.message}</p>
        <button className="btn btn-ghost" onClick={retry}>Try again</button>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <h1 className="page-title">Your trips</h1>
      {state.status === "loading" ? (
        <div className="trips" aria-busy="true">
          <div className="skeleton" style={{ height: 96 }} />
          <div className="skeleton" style={{ height: 96 }} />
        </div>
      ) : state.data.length === 0 ? (
        <div className="empty">
          <h2>No trips yet</h2>
          <p>Pick a car and your dates to get started.</p>
          <Link className="btn btn-heat" to="/#cars">See the cars</Link>
        </div>
      ) : (
        <ul className="trips">
          {state.data.map((b) => (
            <li key={b.code}>
              <Link className="tripitem" to={`/trips/${b.code}`}>
                {b.vehicle.photo && <img src={b.vehicle.photo.src} alt="" width={160} height={107} />}
                <div className="ti-body">
                  <div className="ti-top">
                    <b>{b.vehicle.year} {b.vehicle.make} {b.vehicle.model}</b>
                    <StatusPill status={b.status} />
                  </div>
                  <span>{formatWhen(b.start)} to {formatWhen(b.end)}</span>
                  <span className="ti-sub"><span className="mono">{b.code}</span> · {money(b.totalCents)}</span>
                </div>
                <Icon name="chevronRight" size={18} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
