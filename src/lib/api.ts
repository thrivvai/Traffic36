import type {
  ApiError,
  Booking,
  CreateBookingRequest,
  HostBookingDetail,
  HostDashboard,
  IdCheckMode,
  IdDocumentKind,
  LicenseDetails,
  Location,
  Me,
  PaymentMethod,
  Quote,
  QuoteRequest,
  RejectReason,
  RenterProfile,
  RenterSummary,
  VehicleDetail,
  VehicleSummary,
} from "../../shared/types.ts";

/** An API failure with the server's own message, ready to show the renter. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}

type Init = { method?: string; body?: unknown; signal?: AbortSignal; token?: string | null };

async function send(path: string, init: Init = {}): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) body = init.body;
  else if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  try {
    return await fetch(path, { method: init.method ?? "GET", headers, body, signal: init.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new RequestError(0, "You appear to be offline. Check your connection and try again.");
  }
}

async function request<T>(path: string, init: Init = {}): Promise<T> {
  const res = await send(path, init);
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok || !body) {
    throw new RequestError(res.status, body?.error ?? "Something went wrong. Try again in a moment.", body?.field, body?.reason);
  }
  return body;
}

/** Public data: no sign-in needed. */
export const api = {
  vehicles: (signal?: AbortSignal) => request<{ vehicles: VehicleSummary[] }>("/api/vehicles", { signal }).then((r) => r.vehicles),
  vehicle: (slug: string, signal?: AbortSignal) =>
    request<{ vehicle: VehicleDetail }>(`/api/vehicles/${encodeURIComponent(slug)}`, { signal }).then((r) => r.vehicle),
  locations: (signal?: AbortSignal) => request<{ locations: Location[] }>("/api/locations", { signal }).then((r) => r.locations),
  quote: (slug: string, trip: QuoteRequest, signal?: AbortSignal) =>
    request<{ quote: Quote }>(`/api/vehicles/${encodeURIComponent(slug)}/quote?${new URLSearchParams(trip)}`, { signal }).then((r) => r.quote),
};

export type TokenSource = () => Promise<string | null>;

/** Signed-in calls. Each one asks Clerk for a fresh short-lived token. */
export function accountApi(getToken: TokenSource) {
  const call = async <T,>(path: string, init: Init = {}) => request<T>(path, { ...init, token: await getToken() });
  const enc = encodeURIComponent;
  return {
    me: (opts: { sync?: boolean; signal?: AbortSignal } = {}) =>
      call<{ me: Me; paymentMethods: PaymentMethod[]; idCheck: IdCheckMode }>(`/api/me${opts.sync ? "?sync=1" : ""}`, { signal: opts.signal }),
    uploadIdPhoto: (kind: IdDocumentKind, file: File) => {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file, file.name);
      return call<{ id: string }>("/api/identity/documents", { method: "POST", body: form });
    },
    submitLicense: (details: LicenseDetails, documents: Record<IdDocumentKind, string>) =>
      call<{ me: Me }>("/api/identity/submit", { method: "POST", body: { ...details, documents } }).then((r) => r.me),
    hostLicense: (userId: string, action: "approve" | "reject", body: Partial<LicenseDetails> & { licenseLast4?: string; reason?: string }) =>
      call<{ dashboard: HostDashboard }>(`/api/host/licenses/${enc(userId)}/${action}`, { method: "POST", body }).then((r) => r.dashboard),
    startIdentity: (returnPath: string) =>
      call<{ url: string } | { done: true }>("/api/identity/start", { method: "POST", body: { returnPath } }),
    createBooking: (slug: string, input: CreateBookingRequest) =>
      call<{ code: string }>("/api/bookings", { method: "POST", body: { slug, ...input } }),
    bookings: (signal?: AbortSignal) => call<{ bookings: Booking[] }>("/api/bookings", { signal }).then((r) => r.bookings),
    booking: (code: string, signal?: AbortSignal) =>
      call<{ booking: Booking }>(`/api/bookings/${enc(code)}`, { signal }).then((r) => r.booking),
    cancelBooking: (code: string) => call<{ ok: true }>(`/api/bookings/${enc(code)}/cancel`, { method: "POST" }),
    uploadProof: (code: string, form: FormData) =>
      call<{ booking: Booking }>(`/api/bookings/${enc(code)}/proofs`, { method: "POST", body: form }).then((r) => r.booking),
    /** A private image (payment screenshot or license photo) as an object URL. The caller revokes it. */
    proofImage: async (url: string, signal?: AbortSignal) => {
      const res = await send(url, { signal, token: await getToken() });
      if (!res.ok) throw new RequestError(res.status, "We couldn't load that screenshot.");
      return URL.createObjectURL(await res.blob());
    },
    hostDashboard: (signal?: AbortSignal) => call<{ dashboard: HostDashboard }>("/api/host", { signal }).then((r) => r.dashboard),
    hostAction: (code: string, action: "confirm" | "reject" | "cancel" | "deposit", body: HostActionBody = {}) =>
      call<{ dashboard: HostDashboard }>(`/api/host/bookings/${enc(code)}/${action}`, { method: "POST", body }).then((r) => r.dashboard),
    hostBooking: (code: string, signal?: AbortSignal) =>
      call<{ booking: HostBookingDetail }>(`/api/host/bookings/${enc(code)}`, { signal }).then((r) => r.booking),
    setHandoff: (code: string, body: HandoffBody) =>
      call<{ booking: HostBookingDetail }>(`/api/host/bookings/${enc(code)}/handoff`, { method: "POST", body }).then((r) => r.booking),
    hostRenters: (q: string, signal?: AbortSignal) =>
      call<{ renters: RenterSummary[] }>(`/api/host/renters${q ? `?${new URLSearchParams({ q })}` : ""}`, { signal }).then((r) => r.renters),
    hostRenter: (id: string, signal?: AbortSignal) =>
      call<{ renter: RenterProfile }>(`/api/host/renters/${enc(id)}`, { signal }).then((r) => r.renter),
    blockRenter: (id: string, body: { value: boolean; note?: string }) =>
      call<{ renter: RenterProfile }>(`/api/host/renters/${enc(id)}/block`, { method: "POST", body }).then((r) => r.renter),
  };
}

export type HandoffBody = { method: "lockbox" | "in_person"; lockboxCode?: string; note?: string };

export type HostActionBody = { approveDelivery?: boolean; reason?: RejectReason; note?: string; refundCents?: number };

export type AccountApi = ReturnType<typeof accountApi>;
