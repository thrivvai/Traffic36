import type { Location, VehicleDetail } from "../../shared/types.ts";
import { POLICY } from "../../shared/policy.ts";
import { localDate } from "../../shared/time.ts";
import { api, RequestError } from "../lib/api.ts";
import { formatWhen, money, timeSlots } from "../lib/format.ts";
import { useRequest } from "../lib/useRequest.ts";
import { useTrip } from "../lib/useTrip.ts";
import { Icon } from "./Icon.tsx";
import { Rates } from "./VehicleCard.tsx";

const DELIVERY = POLICY.deliveryChoice;

export function PriceBox({ vehicle, locations }: { vehicle: VehicleDetail; locations: Location[] }) {
  const [params, setTrip] = useTrip();
  // Until the renter chooses, the trip starts and ends at the car's home base.
  const trip = { ...params, pickup: params.pickup || vehicle.lot.slug, returnTo: params.returnTo || vehicle.lot.slug };
  const { state } = useRequest(`${vehicle.slug}?${new URLSearchParams(trip)}`, (signal) => api.quote(vehicle.slug, trip, signal), 200);
  const field = state.status === "error" && state.error instanceof RequestError ? state.error.field : undefined;

  const today = localDate(Date.now(), POLICY.timeZone);
  const bufferHours = POLICY.turnaroundMinutes / 60;
  const pickupLoc = locations.find((l) => l.slug === trip.pickup);
  const returnLoc = locations.find((l) => l.slug === trip.returnTo);
  const pickupSlots = timeSlots(pickupLoc);
  const returnSlots = timeSlots(returnLoc);
  const invalid = (name: string) => `field${field === name ? " invalid" : ""}`;

  // Switching location keeps the chosen time when that location is open then; otherwise it moves to the first open slot.
  const choosePickup = (slug: string) => {
    const slots = timeSlots(locations.find((l) => l.slug === slug));
    setTrip({ pickup: slug, startTime: slots.some((s) => s.value === trip.startTime) ? trip.startTime : (slots[0]?.value ?? trip.startTime) });
  };
  const chooseReturn = (slug: string) => {
    const slots = timeSlots(locations.find((l) => l.slug === slug));
    setTrip({ returnTo: slug, endTime: slots.some((s) => s.value === trip.endTime) ? trip.endTime : (slots[0]?.value ?? trip.endTime) });
  };

  return (
    <aside className="pricebox" aria-label="Dates and price">
      <Rates dailyCents={vehicle.dailyCents} weeklyCents={vehicle.weeklyCents} />

      <div className="pb-grid">
        <div className={`${invalid("pickup")} span2`}>
          <label htmlFor="pb-pickup">Pick up at</label>
          <select id="pb-pickup" className="select" value={trip.pickup} onChange={(e) => choosePickup(e.target.value)}>
            {locations.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
            <option value={DELIVERY}>Deliver to my address (+{money(POLICY.deliveryFeeCents)})</option>
          </select>
        </div>
        <div className={invalid("startDate")}>
          <label htmlFor="pb-start">Pickup date</label>
          <input id="pb-start" className="input" type="date" min={today} value={trip.startDate} onChange={(e) => e.target.value && setTrip({ startDate: e.target.value })} />
        </div>
        <div className={invalid("startTime")}>
          <label htmlFor="pb-start-time">Time</label>
          <select id="pb-start-time" className="select" value={trip.startTime} onChange={(e) => setTrip({ startTime: e.target.value })}>
            {pickupSlots.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div className={`${invalid("returnTo")} span2`}>
          <label htmlFor="pb-return">Return to</label>
          <select id="pb-return" className="select" value={trip.returnTo} onChange={(e) => chooseReturn(e.target.value)}>
            {locations.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
          </select>
        </div>
        <div className={invalid("endDate")}>
          <label htmlFor="pb-end">Return date</label>
          <input id="pb-end" className="input" type="date" min={trip.startDate} value={trip.endDate} onChange={(e) => e.target.value && setTrip({ endDate: e.target.value })} />
        </div>
        <div className={invalid("endTime")}>
          <label htmlFor="pb-end-time">Time</label>
          <select id="pb-end-time" className="select" value={trip.endTime} onChange={(e) => setTrip({ endTime: e.target.value })}>
            {returnSlots.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div aria-live="polite">
        {state.status === "error" ? (
          <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{state.error.message}</span></div>
        ) : state.status === "loading" ? (
          <div className="quote loading"><div className="ln"><span>Checking price and availability…</span></div></div>
        ) : (
          <>
            <div className="quote">
              {state.data.lines.map((l) => (
                <div className="ln" key={l.label}><span>{l.label}</span><b>{money(l.cents)}</b></div>
              ))}
              {state.data.weeklySavingsCents > 0 && (
                <div className="ln save"><span>Weekly rate savings</span><b>{money(state.data.weeklySavingsCents)} off</b></div>
              )}
              <div className="ln"><span>Insurance</span><b>Included</b></div>
              {state.data.deliveryFeeCents > 0 && (
                <div className="ln"><span>Delivery to your address</span><b>{money(state.data.deliveryFeeCents)}</b></div>
              )}
              <div className="ln"><span>Refundable deposit</span><b>{money(state.data.depositCents)}</b></div>
              <div className="ln total"><span>Due today</span><b>{money(state.data.dueTodayCents)}</b></div>
            </div>
            {state.data.pickup.kind === "delivery" && (
              <div className="note">
                <Icon name="pin" size={16} />
                <span>You'll enter the delivery address at checkout. Your host confirms the address before the booking is final. Return the car to {state.data.returnTo.name}.</span>
              </div>
            )}
            {!state.data.available && state.data.conflict && (
              <div className="note bad">
                <Icon name="calendar" size={16} />
                <span>
                  This car is booked from {formatWhen(state.data.conflict.start)} to {formatWhen(state.data.conflict.end)}, plus {bufferHours}{" "}
                  {bufferHours === 1 ? "hour" : "hours"} to get it ready. Try dates outside that window.
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <button className="btn btn-heat btn-block" style={{ marginTop: 16 }} disabled>
        Online booking opens soon
      </button>
      <p className="fine">Times are local to the pickup location. The deposit is refunded after your return check.</p>
    </aside>
  );
}
