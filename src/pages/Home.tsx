import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { VehicleSummary } from "../../shared/types.ts";
import { POLICY } from "../../shared/policy.ts";
import { addDays, localDate } from "../../shared/time.ts";
import { Icon, type IconName } from "../components/Icon.tsx";
import { VehicleCard } from "../components/VehicleCard.tsx";
import { api } from "../lib/api.ts";
import { money } from "../lib/format.ts";
import { useRequest } from "../lib/useRequest.ts";
import { tripSearch, useTrip } from "../lib/useTrip.ts";

const TRUST: [IconName, string, string][] = [
  ["shield", "Insurance included", "On every car, every trip"],
  ["lock", `${money(POLICY.depositCents)} deposit`, "Refunded after your return check"],
  ["calendar", "Weekly rates", "Applied automatically at 7 days"],
  ["phone", "A host you can reach", "Message or call during your trip"],
];

export function Home() {
  const { state, retry } = useRequest("vehicles", (signal) => api.vehicles(signal));
  const [trip, setTrip] = useTrip();
  const navigate = useNavigate();
  const search = tripSearch(trip);
  const vehicles: VehicleSummary[] = state.status === "ready" ? state.data : [];
  const hero = vehicles[0];
  const today = localDate(Date.now(), POLICY.timeZone);

  useEffect(() => {
    document.title = "Traffic36 | Car rental, insurance included";
  }, []);

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-wrap">
          <div>
            <h1 id="hero-title">
              Rent like you<br />know the <span className="heat">owner.</span>
            </h1>
            <p className="sub">
              Insurance is included on every car. The deposit is {money(POLICY.depositCents)}. Weekly rates apply on their own. Pick up from a
              smart lockbox, with no counter and no line.
            </p>
            <form
              className="qbar"
              onSubmit={(e) => {
                e.preventDefault();
                const slug = new FormData(e.currentTarget).get("car");
                if (slug) navigate(`/cars/${slug}${search}`);
                else document.getElementById("cars")?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              <div className="qf">
                <label htmlFor="q-start">Pickup</label>
                <input id="q-start" type="date" min={today} value={trip.startDate} onChange={(e) => e.target.value && setTrip({ startDate: e.target.value })} />
              </div>
              <div className="qf">
                <label htmlFor="q-end">Return</label>
                <input id="q-end" type="date" min={addDays(trip.startDate, 1)} value={trip.endDate} onChange={(e) => e.target.value && setTrip({ endDate: e.target.value })} />
              </div>
              <div className="qf car">
                <label htmlFor="q-car">Car</label>
                <select id="q-car" name="car" defaultValue="">
                  <option value="">Show all cars</option>
                  {vehicles.map((v) => (
                    <option key={v.slug} value={v.slug}>{v.make} {v.model}</option>
                  ))}
                </select>
              </div>
              <button className="btn btn-heat" type="submit">Check price</button>
            </form>
          </div>
          {hero ? (
            <Link className="hero-card" to={`/cars/${hero.slug}${search}`} aria-label={`See the ${hero.year} ${hero.make} ${hero.model}`}>
              {hero.photos[0] && <img src={hero.photos[0].src} alt={hero.photos[0].alt} fetchPriority="high" width={1024} height={683} />}
              <div className="cap">
                <div><b>{hero.year} {hero.model}</b><span>{hero.tagline}</span></div>
                <div className="rate"><b style={{ fontSize: 22 }}>{money(hero.dailyCents)}</b><span>per day</span></div>
              </div>
            </Link>
          ) : (
            <div className="skeleton" style={{ aspectRatio: "3 / 2" }} aria-hidden="true" />
          )}
        </div>
      </section>

      <section className="section" id="cars" aria-labelledby="cars-title">
        <div className="sec-head">
          <h2 id="cars-title">Available now</h2>
          <p>Pick a car to see every photo and an exact price for your dates.</p>
        </div>
        {state.status === "error" ? (
          <div className="empty" role="alert">
            <h2>We couldn't load the cars</h2>
            <p>{state.error.message}</p>
            <button className="btn btn-ghost" onClick={retry}>Try again</button>
          </div>
        ) : state.status === "loading" ? (
          <div className="vgrid" aria-busy="true">
            <div className="skeleton" style={{ height: 520 }} />
            <div className="skeleton" style={{ height: 520 }} />
          </div>
        ) : vehicles.length ? (
          <div className="vgrid">
            {vehicles.map((v) => <VehicleCard key={v.slug} v={v} search={search} />)}
          </div>
        ) : (
          <div className="empty"><h2>Every car is out right now</h2><p>Check back soon.</p></div>
        )}
      </section>

      <section className="section tight" id="how" aria-labelledby="how-title">
        <div className="sec-head"><h2 id="how-title">How a trip works</h2></div>
        <div className="steps">
          <div className="step"><span className="n">01</span><h3>Book and verify</h3><p>Pick your dates, then confirm your license and a selfie from your phone.</p></div>
          <div className="step"><span className="n">02</span><h3>Walk around, then drive</h3><p>Your lockbox code unlocks an hour before pickup. Take six quick photos so the car's condition is on record for both of us.</p></div>
          <div className="step"><span className="n">03</span><h3>Return and get your deposit back</h3><p>Same lot, same fuel level, six more photos. Your {money(POLICY.depositCents)} deposit is refunded after the return check.</p></div>
        </div>
      </section>

      <div className="trust" style={{ marginTop: 56 }}>
        <div className="trust-in">
          {TRUST.map(([icon, title, sub]) => (
            <div className="trust-item" key={title}>
              <div className="ti"><Icon name={icon} size={19} /></div>
              <div><b>{title}</b><span>{sub}</span></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
