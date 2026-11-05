import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { HostOnly, HostTabs, LicensePill } from "../components/HostKit.tsx";
import { Icon } from "../components/Icon.tsx";
import { useAccount } from "../lib/account.tsx";
import { formatDate, formatPhone } from "../lib/format.ts";
import { useRequest } from "../lib/useRequest.ts";

const LIMIT = 200;

export function HostRentersPage() {
  useEffect(() => {
    document.title = "Renters | Host | Traffic36";
  }, []);
  return <HostOnly what="renters">{() => <RenterList />}</HostOnly>;
}

function RenterList() {
  const account = useAccount();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  // The box updates instantly; the search waits for a pause in typing.
  const [text, setText] = useState(q);
  const { state, retry } = useRequest(`renters:${q}`, (signal) => account.api.hostRenters(q, signal), 250);

  const search = (value: string) => {
    setText(value);
    setParams(value.trim() ? { q: value.trim() } : {}, { replace: true });
  };

  return (
    <div className="page host narrow">
      <HostTabs />
      <h1 className="page-title">Renters</h1>
      <div className="search">
        <Icon name="search" size={17} />
        <label htmlFor="renter-search" className="sr-only">Search renters</label>
        <input
          id="renter-search"
          className="input"
          type="search"
          value={text}
          onChange={(e) => search(e.target.value)}
          placeholder="Name, email or phone"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {state.status === "error" ? (
        <div className="note bad" role="alert">
          <Icon name="alert" size={16} />
          <span>{state.error.message} <button className="link" onClick={retry}>Try again</button></span>
        </div>
      ) : state.status === "loading" ? (
        <div className="renters" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 74, borderRadius: 14 }} />)}
        </div>
      ) : state.data.length === 0 ? (
        <p className="host-empty">{q ? `No renters match "${q}".` : "No renters yet. Everyone who signs up shows up here."}</p>
      ) : (
        <>
          <p className="fine left" aria-live="polite">
            {state.data.length === LIMIT ? `The ${LIMIT} most recent. Search to narrow it down.` : `${state.data.length} ${state.data.length === 1 ? "renter" : "renters"}`}
          </p>
          <ul className="renters">
            {state.data.map((r) => (
              <li key={r.id}>
                <Link className="rrow" to={`/host/renters/${r.id}`}>
                  <span className="rrow-main">
                    <b>{r.name}</b>
                    <span>{[r.phone && formatPhone(r.phone), r.email].filter(Boolean).join(" · ") || "No contact details"}</span>
                  </span>
                  <span className="rrow-tags">
                    {r.doNotRent && <span className="status bad">Blocked</span>}
                    <LicensePill status={r.licenseStatus} />
                  </span>
                  <span className="rrow-trips">
                    {r.trips === 0 ? `Joined ${formatDate(r.joinedAt)}` : `${r.trips} ${r.trips === 1 ? "trip" : "trips"}${r.lastTripAt ? `, last ${formatDate(r.lastTripAt)}` : ""}`}
                  </span>
                  <Icon name="chevronRight" size={18} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
