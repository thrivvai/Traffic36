import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { HostArchive } from "../../shared/types.ts";
import { HostOnly, HostTabs, LicensePill } from "../components/HostKit.tsx";
import { Icon } from "../components/Icon.tsx";
import { StatusPill } from "../components/StatusPill.tsx";
import { useAccount } from "../lib/account.tsx";
import { formatDate, formatPhone, formatWhen } from "../lib/format.ts";
import { useRequest } from "../lib/useRequest.ts";

export function HostArchivePage() {
  useEffect(() => {
    document.title = "Archive | Host | Traffic36";
  }, []);
  return <HostOnly what="the archive">{() => <ArchiveList />}</HostOnly>;
}

function ArchiveList() {
  const account = useAccount();
  const { state, retry } = useRequest("host-archive", (signal) => account.api.hostArchive(signal));
  const [data, setData] = useState<HostArchive | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (state.status === "ready") setData(state.data);
  }, [state]);

  const restore = async (key: string, run: () => Promise<unknown>, drop: (a: HostArchive) => HostArchive) => {
    setBusy(key);
    setError(null);
    try {
      await run();
      setData((d) => (d ? drop(d) : d));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page host narrow">
      <HostTabs />
      <h1 className="page-title">Archive</h1>
      <p className="lede">Bookings and renters you've cleared from your lists. Nothing here is deleted, and you can restore anything.</p>
      {error && <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}

      {state.status === "error" && !data ? (
        <div className="note bad" role="alert">
          <Icon name="alert" size={16} />
          <span>{state.error.message} <button className="link" onClick={retry}>Try again</button></span>
        </div>
      ) : !data ? (
        <div className="renters" aria-busy="true">
          {[0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 74, borderRadius: 14 }} />)}
        </div>
      ) : (
        <>
          <section className="host-sec">
            <h2>Bookings <span className="count">{data.bookings.length}</span></h2>
            {data.bookings.length === 0 ? (
              <p className="host-empty">No archived bookings. Archive a finished booking from its record to clear it from your console.</p>
            ) : (
              <ul className="renters">
                {data.bookings.map((b) => (
                  <li key={b.code} className="arow">
                    <Link className="rrow" to={`/host/bookings/${b.code}`}>
                      <span className="rrow-main">
                        <b><span className="mono">{b.code}</span> · {b.vehicle.make} {b.vehicle.model}</b>
                        <span>{b.renter.verifiedName ?? b.renter.accountName} · {formatWhen(b.start)}</span>
                      </span>
                      <span className="rrow-tags"><StatusPill status={b.status} /></span>
                      <span className="rrow-trips">Archived {b.archivedAt ? formatDate(b.archivedAt) : ""}</span>
                      <Icon name="chevronRight" size={18} />
                    </Link>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy !== null}
                      onClick={() => void restore(b.code, () => account.api.bookingAction(b.code, "restore"), (a) => ({ ...a, bookings: a.bookings.filter((x) => x.code !== b.code) }))}
                    >
                      {busy === b.code ? "Restoring…" : "Restore"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="host-sec">
            <h2>Renters <span className="count">{data.renters.length}</span></h2>
            {data.renters.length === 0 ? (
              <p className="host-empty">No archived renters. Archive one from their profile to clear them from your renter list.</p>
            ) : (
              <ul className="renters">
                {data.renters.map((r) => (
                  <li key={r.id} className="arow">
                    <Link className="rrow" to={`/host/renters/${r.id}`}>
                      <span className="rrow-main">
                        <b>{r.name}</b>
                        <span>{[r.phone && formatPhone(r.phone), r.email].filter(Boolean).join(" · ") || "No contact details"}</span>
                      </span>
                      <span className="rrow-tags"><LicensePill status={r.licenseStatus} /></span>
                      <span className="rrow-trips">{r.trips} {r.trips === 1 ? "trip" : "trips"}</span>
                      <Icon name="chevronRight" size={18} />
                    </Link>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy !== null}
                      onClick={() => void restore(r.id, () => account.api.archiveRenter(r.id, false), (a) => ({ ...a, renters: a.renters.filter((x) => x.id !== r.id) }))}
                    >
                      {busy === r.id ? "Restoring…" : "Restore"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
