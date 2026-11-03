import { useSearchParams } from "react-router-dom";
import type { QuoteRequest } from "../../shared/types.ts";
import { DAY, POLICY } from "../../shared/policy.ts";
import { addDays, isDateString, isTimeString, localDate } from "../../shared/time.ts";

export function defaultTrip(now = Date.now()): TripParams {
  const today = localDate(now, POLICY.timeZone);
  return { startDate: addDays(today, 1), startTime: "10:00", endDate: addDays(today, 4), endTime: "10:00", pickup: "", returnTo: "" };
}

/** A trip as the URL holds it. `pickup` and `returnTo` are "" until the renter chooses. */
export type TripParams = QuoteRequest;

export const tripSearch = (trip: TripParams) => {
  const entries = Object.entries(trip).filter(([, v]) => v !== "");
  return `?${new URLSearchParams(entries)}`;
};

/** Reads a trip from URL params, falling back to defaults for anything missing or malformed. */
function readTrip(params: URLSearchParams): TripParams {
  const d = defaultTrip();
  const date = (k: "startDate" | "endDate") => {
    const v = params.get(k);
    return isDateString(v) ? v : d[k];
  };
  const time = (k: "startTime" | "endTime") => {
    const v = params.get(k);
    return isTimeString(v) ? v : d[k];
  };
  const place = (k: "pickup" | "returnTo") => (params.get(k) ?? "").slice(0, 64);
  return {
    startDate: date("startDate"),
    startTime: time("startTime"),
    endDate: date("endDate"),
    endTime: time("endTime"),
    pickup: place("pickup"),
    returnTo: place("returnTo"),
  };
}

/** The trip lives in the URL, so a quote can be shared, bookmarked or carried from the home page. */
export function useTrip(): [TripParams, (patch: Partial<TripParams>) => void] {
  const [params, setParams] = useSearchParams();

  const update = (patch: Partial<TripParams>) => {
    // Build from the latest params, not this render's copy, so quick successive edits all land.
    setParams(
      (prev) => {
        const current = readTrip(prev);
        const next = { ...current, ...patch };
        // Moving pickup past the return drags the return along, keeping the trip length.
        if (patch.startDate && next.endDate <= next.startDate) {
          const len = Math.max(1, Math.round((Date.parse(current.endDate) - Date.parse(current.startDate)) / DAY));
          next.endDate = addDays(next.startDate, len);
        }
        return Object.fromEntries(Object.entries(next).filter(([, v]) => v !== ""));
      },
      { replace: true, preventScrollReset: true },
    );
  };

  return [readTrip(params), update];
}
