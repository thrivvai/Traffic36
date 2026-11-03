import type { ApiError, Quote, QuoteRequest, VehicleDetail, VehicleSummary } from "../../shared/types.ts";

/** An API failure with the server's own message, ready to show the renter. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { accept: "application/json" } });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new RequestError(0, "You appear to be offline. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok || !body) throw new RequestError(res.status, body?.error ?? "Something went wrong. Try again in a moment.", body?.field);
  return body;
}

export const api = {
  vehicles: (signal?: AbortSignal) => get<{ vehicles: VehicleSummary[] }>("/api/vehicles", signal).then((r) => r.vehicles),
  vehicle: (slug: string, signal?: AbortSignal) =>
    get<{ vehicle: VehicleDetail }>(`/api/vehicles/${encodeURIComponent(slug)}`, signal).then((r) => r.vehicle),
  quote: (slug: string, trip: QuoteRequest, signal?: AbortSignal) =>
    get<{ quote: Quote }>(`/api/vehicles/${encodeURIComponent(slug)}/quote?${new URLSearchParams(trip)}`, signal).then((r) => r.quote),
};
