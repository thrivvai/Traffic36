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

export type ApiError = { error: string; field?: string; reason?: string };

/**
 * Where the renter's license check stands.
 *   pending    a Stripe check was started and isn't finished
 *   in_review  photos sent; the host hasn't reviewed them yet (the renter can still book and pay)
 *   expired    a license was verified but has since expired
 */
export type IdentityState = "none" | "pending" | "in_review" | "verified" | "failed" | "expired";

/** How licenses are checked right now: by the host from photos, or by Stripe. */
export type IdCheckMode = "manual" | "stripe";

export type IdDocumentKind = "license_front" | "license_back" | "selfie";

export type LicenseDetails = { legalName: string; dob: string; licenseState: string; licenseExpiresOn: string };

/** A license waiting for the host, with everything needed to compare the photos to the typed details. */
export type LicenseReview = LicenseDetails & {
  userId: string;
  submittedAt: string;
  accountName: string;
  email: string | null;
  phone: string | null;
  age: number;
  documents: { kind: IdDocumentKind; url: string }[];
  openBookings: string[];
  previousRejections: number;
};

export type Me = {
  name: string;
  email: string | null;
  phone: string | null;
  role: "renter" | "host";
  identity: {
    status: IdentityState;
    method: IdCheckMode | null;
    /** The legal name on the license, once it's been sent in. */
    name: string | null;
    licenseState: string | null;
    licenseLast4: string | null;
    licenseExpiresOn: string | null;
    failureReason: string | null;
    attemptsLeft: number;
  };
};

export type PaymentMethod = "cash_app" | "chime";

/**
 * A booking as the renter sees it.
 *   awaiting_payment  dates held until holdExpiresAt while the renter pays and uploads a screenshot
 *   payment_review    screenshot in; the host is checking the money arrived
 *   expired           the hold ran out before a screenshot came in
 */
export type BookingStatus =
  | "awaiting_payment"
  | "payment_review"
  | "confirmed"
  | "active"
  | "returned"
  | "closed"
  | "cancelled"
  | "expired";

export type PaymentProof = {
  id: string;
  method: PaymentMethod;
  senderName: string;
  status: "pending" | "accepted" | "rejected";
  reviewNote: string | null;
  createdAt: string;
  /** The screenshot, served only to this renter and the host. */
  url: string;
};

/** Where and how to pay. Only sent to the renter who owns the booking, while it's unpaid. */
export type PaymentInstructions = {
  amountCents: number;
  code: string;
  cashApp: { cashtag: string; link: string } | null;
  chime: { phone: string } | null;
};

/** How a confirmed trip is handed over. */
export type Handoff = "lockbox" | "in_person" | "delivery";

/**
 * The renter's pickup pass. It opens shortly before pickup and stays open until a little after
 * the return time, so the same code returns the key. `code` is only filled while it's open.
 */
export type PickupPass = {
  handoff: Handoff | null;
  opensAt: string;
  closesAt: string;
  open: boolean;
  code: string | null;
  /** The host's note for this trip, like where the car is parked. Only while the pass is open. */
  note: string | null;
  instructions: string | null;
};

export type Booking = {
  code: string;
  status: BookingStatus;
  vehicle: { slug: string; year: number; make: string; model: string; photo: Photo | null; minDriverAge: number };
  start: string;
  end: string;
  days: number;
  pickup: { kind: "location"; location: Location } | { kind: "delivery"; address: string };
  returnTo: Location;
  rentalCents: number;
  deliveryFeeCents: number;
  depositCents: number;
  totalCents: number;
  holdExpiresAt: string | null;
  paymentMethod: PaymentMethod | null;
  /** The host's note when they couldn't match a payment. */
  paymentNote: string | null;
  proofs: PaymentProof[];
  payment: PaymentInstructions | null;
  confirmedAt: string | null;
  createdAt: string;
  /** Present once the booking is confirmed. */
  pass: PickupPass | null;
};

export type CreateBookingRequest = QuoteRequest & { deliveryAddress?: string; agreementVersion: string };

/** A booking in the host console, with what the host needs to check a payment. */
export type HostBooking = Booking & {
  renter: {
    id: string;
    accountName: string;
    verifiedName: string | null;
    email: string | null;
    phone: string | null;
    licenseState: string | null;
    licenseLast4: string | null;
    licenseApproved: boolean;
  };
  /** Things to look at before confirming, in plain words. */
  warnings: string[];
  refundedCents: number;
  handoff: {
    method: Handoff | null;
    /** The lockbox code, for the host's eyes. */
    code: string | null;
    note: string | null;
    setAt: string | null;
    /** When the renter first opened their pass with this code. */
    revealedAt: string | null;
    opensAt: string;
    closesAt: string;
  };
};

export type PaymentEntry = {
  bookingCode: string;
  kind: "booking_charge" | "extension_charge" | "deposit_refund" | "cancellation_refund" | "late_payment_refund";
  amountCents: number;
  method: string;
  note: string | null;
  at: string;
};

export type ActivityEntry = { action: string; at: string; details: Record<string, unknown> };

export type HostBookingDetail = HostBooking & { payments: PaymentEntry[]; activity: ActivityEntry[] };

export type RenterSummary = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  licenseStatus: IdentityState;
  trips: number;
  lastTripAt: string | null;
  joinedAt: string;
  doNotRent: boolean;
};

export type RenterProfile = RenterSummary & {
  accountName: string;
  verifiedName: string | null;
  dob: string | null;
  age: number | null;
  licenseState: string | null;
  licenseExpiresOn: string | null;
  licenseLast4: string | null;
  licenseApprovedAt: string | null;
  doNotRentNote: string | null;
  licenses: (LicenseDetails & {
    submittedAt: string;
    status: "pending" | "approved" | "rejected" | "replaced";
    reviewNote: string | null;
    documents: { kind: IdDocumentKind; url: string }[];
  })[];
  bookings: HostBooking[];
  payments: PaymentEntry[];
};

export type HostDashboard = {
  licenses: LicenseReview[];
  review: HostBooking[];
  awaitingPayment: HostBooking[];
  upcoming: HostBooking[];
  depositsDue: HostBooking[];
};

export type RejectReason = "not_received" | "wrong_amount" | "name_mismatch" | "other";
