import type { ReactNode } from "react";
import type { Location, Photo } from "../../shared/types.ts";
import { formatWhen, money } from "../lib/format.ts";
import { Icon } from "./Icon.tsx";

export type TripCardProps = {
  vehicle: { year: number; make: string; model: string; photo: Photo | null };
  start: string;
  end: string;
  pickup: { kind: "location"; location: Location } | { kind: "delivery"; address?: string };
  returnTo: Location;
  /** The rental itself, then insurance, then fees and the deposit. */
  lines: { label: string; cents: number }[];
  fees: { label: string; cents: number }[];
  total: { label: string; cents: number };
  children?: ReactNode;
};

// "Norman Berry Dr, 3400 Norman Berry Dr" reads twice; the address alone says it.
const place = (l: Location) => (!l.address ? l.name : l.address.includes(l.name) ? l.address : `${l.name}, ${l.address}`);

/** The car, the when and where, and the money, as one card. Used at checkout and on every trip page. */
export function TripCard({ vehicle, start, end, pickup, returnTo, lines, fees, total, children }: TripCardProps) {
  return (
    <aside className="tripcard" aria-label="Trip summary">
      {vehicle.photo && <img className="tc-photo" src={vehicle.photo.src} alt={vehicle.photo.alt} width={640} height={427} />}
      <div className="tc-body">
        <div className="vyear">{vehicle.year} {vehicle.make}</div>
        <div className="tc-name">{vehicle.model}</div>
        <dl className="tc-when">
          <div>
            <dt><Icon name="calendar" size={15} />Pickup</dt>
            <dd>
              <b>{formatWhen(start)}</b>
              <span>{pickup.kind === "location" ? place(pickup.location) : pickup.address ? `Delivered to ${pickup.address}` : "Delivered to your address"}</span>
            </dd>
          </div>
          <div>
            <dt><Icon name="pin" size={15} />Return</dt>
            <dd>
              <b>{formatWhen(end)}</b>
              <span>{place(returnTo)}</span>
            </dd>
          </div>
        </dl>
        <div className="quote">
          {lines.map((l) => (
            <div className="ln" key={l.label}><span>{l.label}</span><b>{money(l.cents)}</b></div>
          ))}
          <div className="ln"><span>Insurance</span><b>Included</b></div>
          {fees.map((l) => (
            <div className="ln" key={l.label}><span>{l.label}</span><b>{money(l.cents)}</b></div>
          ))}
          <div className="ln total"><span>{total.label}</span><b>{money(total.cents)}</b></div>
        </div>
        {children}
      </div>
    </aside>
  );
}
