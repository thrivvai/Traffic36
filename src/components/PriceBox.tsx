import type { VehicleDetail } from "../../shared/types.ts";
import { POLICY } from "../../shared/policy.ts";
import { localDate } from "../../shared/time.ts";
import { api, RequestError } from "../lib/api.ts";
import { formatWhen, money, timeSlots } from "../lib/format.ts";
import { useRequest } from "../lib/useRequest.ts";
import { useTrip } from "../lib/useTrip.ts";
import { Icon } from "./Icon.tsx";
import { Rates } from "./VehicleCard.tsx";

const SLOTS = timeSlots();

export function PriceBox({ vehicle }: { vehicle: VehicleDetail }) {
  const [trip, setTrip] = useTrip();
  const { state } = useRequest(`${vehicle.slug}?${new URLSearchParams(trip)}`, (signal) => api.quote(vehicle.slug, trip, signal), 200);
  const field = state.status === "error" && state.error instanceof RequestError ? state.error.field : undefined;
  const today = localDate(Date.now(), POLICY.timeZone);
  const buffer = POLICY.turnaroundMinutes / 60;

  return (
    <aside className="pricebox" aria-label="Dates and price">
      <Rates dailyCents={vehicle.dailyCents} weeklyCents={vehicle.weeklyCents} />
      <div className="pb-grid">
        <div className={`field${field === "startDate" ? " invalid" : ""}`}>
          <label htmlFor="pb-start">Pickup date</label>
          <input id="pb-start" className="input" type="date" min={today} value={trip.startDate} onChange={(e) => e.target.value && setTrip({ startDate: e.target.value })} />
        </div>
        <div className={`field${field === "startTime" ? " invalid" : ""}`}>
          <label htmlFor="pb-start-time">Time</label>
          <select id="pb-start-time" className="select" value={trip.startTime} onChange={(e) => setTrip({ startTime: e.target.value })}>
            {SLOTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className={`field${field === "endDate" ? " invalid" : ""}`}>
          <label htmlFor="pb-end">Return date</label>
          <input id="pb-end" className="input" type="date" min={trip.startDate} value={trip.endDate} onChange={(e) => e.target.value && setTrip({ endDate: e.target.value })} />
        </div>
        <div className={`field${field === "endTime" ? " invalid" : ""}`}>
          <label htmlFor="pb-end-time">Time</label>
          <select id="pb-end-time" className="select" value={trip.endTime} onChange={(e) => setTrip({ endTime: e.target.value })}>
            {SLOTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
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
              <div className="ln total"><span>{state.data.days} {state.data.days === 1 ? "day" : "days"} total</span><b>{money(state.data.rentalCents)}</b></div>
              <div className="ln"><span>Refundable deposit</span><b>{money(state.data.depositCents)}</b></div>
            </div>
            {!state.data.available && state.data.conflict && (
              <div className="note bad">
                <Icon name="calendar" size={16} />
                <span>This car is booked from {formatWhen(state.data.conflict.start)} to {formatWhen(state.data.conflict.end)}, plus {buffer} {buffer === 1 ? "hour" : "hours"} to get it ready. Try dates outside that window.</span>
              </div>
            )}
          </>
        )}
      </div>

      <button className="btn btn-heat btn-block" style={{ marginTop: 16 }} disabled>
        Online booking opens soon
      </button>
      <p className="fine">Times are local to the pickup lot.</p>
    </aside>
  );
}
