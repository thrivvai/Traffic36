/**
 * Business rules in one place. Each value says where it came from.
 * CONFIRM = needs a vendor's answer. DECISION = needs Xavier's call.
 */
export const POLICY = {
  /** Pickup and return times are in this zone, and billing days are counted in it. CONFIRM: operating zone. */
  timeZone: "America/New_York",

  /** Refundable deposit, paid with the rental and returned after the return check. Decided by Xavier. */
  depositCents: 50_00,

  /** Delivery to the renter's address. Drop-off only: the renter returns to a pickup location. Decided by Xavier. */
  deliveryFeeCents: 65_00,

  /** The pickup choice that means delivery, in quotes and URLs. */
  deliveryChoice: "delivery",

  /** How long a checkout holds the dates while the renter pays by Cash App or Chime and uploads proof. */
  holdMinutes: 30,

  /** A renter can hold or have in review at most this many unpaid bookings at once, so nobody can squat on dates. */
  maxOpenBookings: 2,

  /** Payment screenshots per booking, and the largest one accepted. */
  maxProofsPerBooking: 5,
  maxProofBytes: 5 * 1024 * 1024,

  /** Stripe license checks a renter can start before they have to contact the host. Each completed check costs about $1.50. */
  maxIdentityAttempts: 5,

  /** Hand-reviewed license photos: the largest one accepted, and how many a renter can upload in a day. */
  maxIdPhotoBytes: 3 * 1024 * 1024,
  maxIdUploadsPerDay: 30,

  /**
   * The rental agreement renters accept at checkout. Bump the version whenever the text changes.
   * DECISION: the text is a draft until a lawyer reviews it.
   */
  agreementVersion: "2026-11-03-draft",

  /** Cleaning and inspection buffer between trips on the same car. DECISION: 2 hours is a placeholder. */
  turnaroundMinutes: 120,

  /** Longest single trip. CONFIRM with Roamly. */
  maxTripDays: 45,

  /** How far ahead a trip can start. DECISION: 180 days is a placeholder. */
  maxLeadDays: 180,

  /** Earliest a trip can start, counted from now, so there's time to stage the car. DECISION: placeholder. */
  minLeadMinutes: 60,

  /** No renter under this age, whatever the car. Per-car minimums live on each vehicle. CONFIRM with Roamly. */
  minAgeFloor: 21,

  /** Lockbox code is revealed this long before pickup. */
  passWindowMinutes: 60,

  /** Pickup and return times offered in the booking form, local time. */
  firstSlot: "07:00",
  lastSlot: "21:00",
} as const;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
