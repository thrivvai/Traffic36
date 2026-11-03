import { Link } from "react-router-dom";
import type { VehicleSummary } from "../../shared/types.ts";
import { POLICY } from "../../shared/policy.ts";
import { money, tierName } from "../lib/format.ts";
import { Icon } from "./Icon.tsx";

export function Rates({ dailyCents, weeklyCents }: { dailyCents: number; weeklyCents: number }) {
  return (
    <div className="rates">
      <div className="rate"><b>{money(dailyCents)}</b><span>per day</span></div>
      <div className="rate wk"><b>{money(weeklyCents)}</b><span>per week</span></div>
    </div>
  );
}

export function VehicleCard({ v, search }: { v: VehicleSummary; search: string }) {
  const href = `/cars/${v.slug}${search}`;
  const cover = v.photos[0];
  return (
    <article className="vcard">
      <Link className="vphoto" to={href} aria-label={`${v.year} ${v.make} ${v.model}`} tabIndex={-1}>
        {cover && <img src={cover.src} alt={cover.alt} loading="lazy" decoding="async" width={1024} height={512} />}
        <span className={`pill ${v.tier}`}>{tierName[v.tier]}</span>
        <span className="count">{v.photos.length} photos</span>
      </Link>
      <div className="vbody">
        <div>
          <div className="vyear">{v.year} {v.make}</div>
          <h3 className="vname">{v.model}</h3>
        </div>
        <p className="vtag">{v.tagline}</p>
        <div className="vspecs">
          {v.specs.slice(0, 3).map((s) => (
            <div key={s.label}><b>{s.value}</b>{s.label}</div>
          ))}
        </div>
        <div className="incl">
          <span className="pill ok"><Icon name="shield" size={13} />Insurance included</span>
          <span className="pill neutral">{money(POLICY.depositCents)} deposit</span>
        </div>
        <div className="vfoot">
          <Rates dailyCents={v.dailyCents} weeklyCents={v.weeklyCents} />
          <Link className="btn btn-heat" to={href}>See dates and price</Link>
        </div>
      </div>
    </article>
  );
}
