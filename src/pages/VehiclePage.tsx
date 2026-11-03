import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { POLICY } from "../../shared/policy.ts";
import { Gallery } from "../components/Gallery.tsx";
import { Icon } from "../components/Icon.tsx";
import { PriceBox } from "../components/PriceBox.tsx";
import { api, RequestError } from "../lib/api.ts";
import { money, tierName } from "../lib/format.ts";
import { useRequest } from "../lib/useRequest.ts";
import { NotFound } from "./NotFound.tsx";

export function VehiclePage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const { state, retry } = useRequest(`vehicle:${slug}`, (signal) => api.vehicle(slug, signal));

  useEffect(() => {
    if (state.status === "ready") document.title = `${state.data.year} ${state.data.make} ${state.data.model} | Traffic36`;
  }, [state]);

  if (state.status === "error") {
    if (state.error instanceof RequestError && state.error.status === 404) return <NotFound what="car" />;
    return (
      <div className="page empty" role="alert">
        <h1>We couldn't load this car</h1>
        <p>{state.error.message}</p>
        <button className="btn btn-ghost" onClick={retry}>Try again</button>
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="page" aria-busy="true">
        <div className="vd">
          <div className="skeleton" style={{ aspectRatio: "3 / 2" }} />
          <div className="skeleton" style={{ height: 420 }} />
        </div>
      </div>
    );
  }

  const v = state.data;
  return (
    <div className="page">
      <Link className="crumb" to={`/${params.size ? `?${params}` : ""}#cars`}><Icon name="arrowLeft" size={16} />All cars</Link>
      <div className="vd">
        <div>
          <Gallery photos={v.photos} />
          <div className="vd-title">
            <span className={`pill ${v.tier}`}>{tierName[v.tier]}</span>
            <div className="vyear" style={{ marginTop: 12 }}>{v.year} {v.make}</div>
            <h1 className="vname">{v.model}</h1>
            {v.description.map((p) => <p className="vd-desc" key={p.slice(0, 32)}>{p}</p>)}
          </div>
          <div className="specgrid">
            {v.specs.map((s) => <div key={s.label}><b>{s.value}</b><span>{s.label}</span></div>)}
          </div>
          <h2 className="h3">Included with every trip</h2>
          <ul className="hl">
            {v.highlights.map((h) => <li key={h}><Icon name="check" size={16} />{h}</li>)}
          </ul>
          <h2 className="h3">Good to know</h2>
          <ul className="hl">
            <li><Icon name="fuel" size={16} />{v.fuel} fuel. Return it at the level you picked it up.</li>
            <li><Icon name="lock" size={16} />A {money(POLICY.depositCents)} refundable deposit covers fuel and incidentals. It's refunded after your return check.</li>
            <li><Icon name="id" size={16} />Drivers {v.minDriverAge} and older with a valid license.</li>
            <li><Icon name="pin" size={16} />Pickup and return at {v.lot.name}.</li>
          </ul>
        </div>
        <PriceBox vehicle={v} />
      </div>
    </div>
  );
}
