import { SUPPORT } from "../../shared/contact.ts";
import { POLICY } from "../../shared/policy.ts";
import type { Booking, Location } from "../../shared/types.ts";
import { formatWhen, untilText } from "../lib/format.ts";
import { useNow } from "../lib/useNow.ts";
import { Icon } from "./Icon.tsx";
import { Panel } from "./Panel.tsx";

const mapsLink = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
const place = (l: Location) => (!l.address ? l.name : l.address.includes(l.name) ? l.address : `${l.name}, ${l.address}`);

/** True while the pass is open but the host hasn't finished setting it up, so the page should keep checking. */
export function passPending(b: Booking): boolean {
  const p = b.pass;
  return !!p && p.open && (p.handoff === null || (p.handoff === "lockbox" && !p.code));
}

/**
 * The renter's pickup pass. Before it opens it says when it will; while it's open it shows the lockbox
 * code (or the meet-up or delivery details), where to go, and what to do.
 */
export function PickupPass({ booking: b }: { booking: Booking }) {
  const now = useNow(30_000);
  const p = b.pass;
  if (!p || now > Date.parse(p.closesAt)) return null;
  const location = b.pickup.kind === "location" ? b.pickup.location : null;
  const address = b.pickup.kind === "delivery" ? b.pickup.address : location?.address ?? null;
  const call = <a className="link nowrap" href={`tel:${SUPPORT.e164}`}>{SUPPORT.phone}</a>;

  if (!p.open) {
    const opensIn = Date.parse(p.opensAt) - now;
    return (
      <Panel icon="lock" title="Pickup pass" aside={<span className="status muted">Opens {untilText(Math.max(0, opensIn))}</span>}>
        <p>
          {p.handoff === "delivery"
            ? `We'll bring the car to ${address ?? "your address"} at ${formatWhen(b.start)}.`
            : p.handoff === "in_person"
              ? `Your host will meet you at ${location ? place(location) : "the pickup spot"} at ${formatWhen(b.start)}.`
              : `Your lockbox code and pickup steps show here from ${formatWhen(p.opensAt)}, ${POLICY.passWindowMinutes} minutes before pickup.`}
        </p>
      </Panel>
    );
  }

  if (p.handoff === "delivery" || p.handoff === "in_person") {
    const delivery = p.handoff === "delivery";
    return (
      <section className="panel pass">
        <PassHead title={delivery ? "Delivery" : "Meet your host"} />
        <p className="pass-lead">
          {delivery ? `We're bringing the car to ${address ?? "your address"} at ${formatWhen(b.start)}.` : `Your host will meet you at ${formatWhen(b.start)}.`}
        </p>
        {p.note && <p className="pass-note"><Icon name="info" size={16} />{p.note}</p>}
        {!delivery && address && <Where label={location ? place(location) : address} address={address} />}
        <ul className="flow-facts">
          <li><Icon name="id" size={15} />Have your driver's license ready. Your host will check it matches the one you sent.</li>
          <li><Icon name="phone" size={15} /><span>Running late or can't find us? Call or text {call}.</span></li>
        </ul>
      </section>
    );
  }

  if (!p.code) {
    return (
      <Panel icon="lock" title="Pickup pass" tone="warn" aside={<span className="status warn">Getting ready</span>}>
        <p>Your host is getting the car ready. Your lockbox code will show here as soon as it's set. This page checks every minute.</p>
        <p>Pickup is {formatWhen(b.start)}. If there's no code by then, call or text {call}.</p>
      </Panel>
    );
  }

  return (
    <section className="panel pass" aria-labelledby="pass-title">
      <PassHead title="Pickup pass" />
      <div className="pass-code">
        <span className="pass-code-label">Lockbox code</span>
        <b className="mono" aria-hidden="true">{p.code}</b>
        <span className="sr-only">{p.code.split("").join(" ")}</span>
      </div>
      {p.note && <p className="pass-note"><Icon name="pin" size={16} />{p.note}</p>}
      {address && <Where label={location ? place(location) : address} address={address} />}
      {p.instructions && <p className="pass-instructions">{p.instructions}</p>}
      <ol className="pass-steps">
        <li>Find the car and the lockbox{p.note ? ", using the note above" : ""}.</li>
        <li>Enter the code, open the lockbox and take the key.</li>
        <li>Close the lockbox and scramble the code so nobody else can see it.</li>
        <li>Before you drive off, take a few photos of the outside and the dashboard, showing the fuel level and miles.</li>
      </ol>
      <div className="pass-return">
        <Icon name="clock" size={15} />
        <span>
          <b>Returning:</b> open the same lockbox with this code and put the key back by {formatWhen(b.end)}. The code stays on this page until {formatWhen(p.closesAt)}.
        </span>
      </div>
      <p className="fine left">Trouble with the lockbox? Call or text {call}.</p>
    </section>
  );
}

function PassHead({ title }: { title: string }) {
  return (
    <h2 id="pass-title" className="pass-head">
      <Icon name="key" size={18} />
      {title}
      <span className="status ok">Open now</span>
    </h2>
  );
}

function Where({ label, address }: { label: string; address: string }) {
  return (
    <div className="pass-where">
      <Icon name="pin" size={16} />
      <span>{label}</span>
      <a className="btn btn-ghost btn-sm" href={mapsLink(address)} target="_blank" rel="noopener">
        Directions<Icon name="external" size={14} />
      </a>
    </div>
  );
}
