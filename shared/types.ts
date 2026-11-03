/** Shapes the API returns. Shared so the browser and the functions can't drift apart. */
import type { QuoteLine } from "./pricing.ts";

export type Tier = "economy" | "luxury" | "exotic";

export type Photo = { src: string; alt: string };
export type Spec = { value: string; label: string };

export type Lot = { slug: string; name: string; kind: string };

/** A pickup and return location. Hours are local "HH:MM"; null means the app's standard hours. */
export type Location = Lot & {
  address: string | null;
  opensAt: string | null;
  closesAt: string | null;
  inPersonAvailable: boolean;
};

export type VehicleSummary = {
  slug: string;
  year: number;
  make: string;
  model: string;
  tier: Tier;
  tagline: string;
  dailyCents: number;
  weeklyCents: number;
  specs: Spec[];
  photos: Photo[];
  lot: Lot;
};

export type VehicleDetail = VehicleSummary & {
  description: string[];
  highlights: string[];
  fuel: string;
  minDriverAge: number;
};

export type QuoteRequest = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  /** A location slug, or "delivery". */
  pickup: string;
  /** A location slug. Delivery is drop-off only. */
  returnTo: string;
};

export type Quote = {
  start: string; // ISO instant
  end: string;
  days: number;
  lines: QuoteLine[];
  rentalCents: number;
  weeklySavingsCents: number;
  /** Charged when the renter chooses delivery. Delivery bookings wait for the host to approve the address. */
  deliveryFeeCents: number;
  pickup: { kind: "location"; location: Location } | { kind: "delivery" };
  returnTo: Location;
  depositCents: number;
  dueTodayCents: number;
  available: boolean;
  /** When unavailable, the first window in the way, so the renter can pick around it. */
  conflict: { start: string; end: string } | null;
};

export type ApiError = { error: string; field?: string };
