-- Traffic36 core schema.
-- Conventions: ids are UUIDs, money is integer cents, times are timestamptz (stored as UTC).
-- Never edit this file once deployed. Change the schema with a new, later migration.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Partner pickup sites.
CREATE TABLE lots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  name              text NOT NULL,
  kind              text NOT NULL,
  address           text,
  instructions      text NOT NULL,          -- shown on the pickup pass
  lockbox_device_id text,                   -- Seam device id for the lot's smart lockbox
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Renters and hosts. Sign-in is handled by Clerk; this row holds everything else.
CREATE TABLE users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id           text NOT NULL UNIQUE,
  role                    text NOT NULL DEFAULT 'renter' CHECK (role IN ('renter', 'host')),
  name                    text NOT NULL DEFAULT '',
  email                   text,
  phone                   text,
  referral_code           text NOT NULL UNIQUE,
  referred_by_user_id     uuid REFERENCES users(id),
  stripe_customer_id      text UNIQUE,
  identity_status         text NOT NULL DEFAULT 'none' CHECK (identity_status IN ('none', 'pending', 'verified', 'failed')),
  identity_session_id     text,
  identity_verified_at    timestamptz,
  identity_dob            date,             -- from the verified document, never typed by the renter
  license_expires_on      date,
  license_state           text,
  license_last4           text,
  identity_failure_reason text,
  do_not_rent             boolean NOT NULL DEFAULT false,
  do_not_rent_note        text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_email_idx ON users (lower(email));
CREATE INDEX users_role_idx ON users (role);

CREATE TABLE vehicles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  unit_code         text NOT NULL UNIQUE,
  year              integer NOT NULL CHECK (year BETWEEN 1990 AND 2100),
  make              text NOT NULL,
  model             text NOT NULL,
  tier              text NOT NULL CHECK (tier IN ('economy', 'luxury', 'exotic')),
  daily_rate_cents  integer NOT NULL CHECK (daily_rate_cents > 0),
  weekly_rate_cents integer NOT NULL CHECK (weekly_rate_cents > 0),
  min_driver_age    integer NOT NULL CHECK (min_driver_age >= 21),
  acv_cents         integer CHECK (acv_cents > 0),   -- actual cash value, checked against the insurance cap
  lot_id            uuid NOT NULL REFERENCES lots(id),
  fuel              text NOT NULL,
  tagline           text NOT NULL,
  description       text[] NOT NULL DEFAULT '{}',    -- paragraphs
  specs             jsonb NOT NULL DEFAULT '[]',     -- [{ "value": "255 hp", "label": "2.0L turbo four" }]
  highlights        text[] NOT NULL DEFAULT '{}',
  tracker_device_id text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'retired')),
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicle_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  src         text NOT NULL,       -- a site path (/cars/...) or a Blobs key for host uploads
  alt_text    text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_photos_vehicle_idx ON vehicle_photos (vehicle_id, sort_order);

-- Host-entered windows when a car can't be booked: maintenance, detailing, personal use.
CREATE TABLE blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  reason      text NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX blocks_vehicle_end_idx ON blocks (vehicle_id, ends_at);

-- Lifecycle:
--   held -> awaiting_verification -> confirmed -> active -> returned -> closed
--                                \-> needs_review -> confirmed | cancelled
--   held -> expired (checkout timed out); any open state -> cancelled
CREATE SEQUENCE booking_code_seq START 1001;
CREATE TABLE bookings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    text NOT NULL UNIQUE DEFAULT ('T36-' || nextval('booking_code_seq')),
  vehicle_id              uuid NOT NULL REFERENCES vehicles(id),
  renter_id               uuid NOT NULL REFERENCES users(id),
  starts_at               timestamptz NOT NULL,
  ends_at                 timestamptz NOT NULL,
  status                  text NOT NULL CHECK (status IN ('held', 'expired', 'awaiting_verification', 'needs_review',
                                                         'confirmed', 'active', 'returned', 'closed', 'cancelled')),
  hold_expires_at         timestamptz,
  -- Price snapshot at checkout. Changed only by an approved extension.
  billable_days           integer NOT NULL CHECK (billable_days >= 1),
  rental_cents            integer NOT NULL CHECK (rental_cents >= 0),
  credit_cents            integer NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  friend_discount_cents   integer NOT NULL DEFAULT 0 CHECK (friend_discount_cents >= 0),
  deposit_cents           integer NOT NULL CHECK (deposit_cents >= 0),
  charge_cents            integer NOT NULL CHECK (charge_cents >= 0),   -- rental - credit - friend + deposit
  friend_referrer_id      uuid REFERENCES users(id),
  agreement_version       text,
  agreement_accepted_at   timestamptz,
  agreement_ip            text,
  payment_intent_id       text UNIQUE,
  paid_at                 timestamptz,
  deposit_deduction_cents integer NOT NULL DEFAULT 0 CHECK (deposit_deduction_cents >= 0),
  deposit_note            text,
  refunded_cents          integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  review_reasons          text[] NOT NULL DEFAULT '{}',
  cancel_reason           text,
  confirmed_at            timestamptz,
  picked_up_at            timestamptz,
  returned_at             timestamptz,
  closed_at               timestamptz,
  cancelled_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX bookings_vehicle_end_idx ON bookings (vehicle_id, ends_at);
CREATE INDEX bookings_renter_idx ON bookings (renter_id, starts_at DESC);
CREATE INDEX bookings_status_idx ON bookings (status, starts_at);

-- Every charge and refund, as Stripe reported it. Positive = charged, negative = refunded.
CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES bookings(id),
  kind             text NOT NULL CHECK (kind IN ('booking_charge', 'extension_charge', 'deposit_refund',
                                                 'cancellation_refund', 'late_payment_refund')),
  amount_cents     integer NOT NULL,
  stripe_object_id text UNIQUE,
  status           text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  failure_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_booking_idx ON payments (booking_id);

-- Lockbox codes live apart from bookings so no booking query can leak one early.
CREATE TABLE access_codes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  purpose             text NOT NULL CHECK (purpose IN ('pickup', 'return')),
  code_ciphertext     text NOT NULL,      -- encrypted with ACCESS_CODE_KEY; never stored in plain text
  valid_from          timestamptz NOT NULL,
  valid_to            timestamptz NOT NULL,
  source              text NOT NULL CHECK (source IN ('seam', 'manual')),
  seam_access_code_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, purpose),
  CHECK (valid_to > valid_from)
);

-- Six timestamped photos at pickup and six at return.
CREATE TABLE walkaround_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  phase       text NOT NULL CHECK (phase IN ('pickup', 'return')),
  slot        text NOT NULL CHECK (slot IN ('front', 'driver_side', 'rear', 'passenger_side', 'fuel', 'odometer')),
  blob_key    text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),   -- server time, so it can't be faked from the phone
  lat         double precision,
  lng         double precision,
  UNIQUE (booking_id, phase, slot)
);

CREATE TABLE extensions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  old_ends_at       timestamptz NOT NULL,
  new_ends_at       timestamptz NOT NULL,
  added_cents       integer NOT NULL CHECK (added_cents >= 0),
  status            text NOT NULL CHECK (status IN ('pending', 'awaiting_payment', 'approved', 'payment_failed',
                                                    'declined', 'cancelled')),
  payment_intent_id text UNIQUE,
  failure_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  CHECK (new_ends_at > old_ends_at)
);
CREATE INDEX extensions_booking_idx ON extensions (booking_id, created_at);
CREATE INDEX extensions_status_idx ON extensions (status, created_at);

CREATE SEQUENCE incident_code_seq START 501;
CREATE TABLE incidents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE DEFAULT ('INC-' || nextval('incident_code_seq')),
  booking_id       uuid NOT NULL REFERENCES bookings(id),
  renter_id        uuid NOT NULL REFERENCES users(id),
  category         text NOT NULL CHECK (category IN ('accident', 'breakdown', 'flat_tire', 'lockout', 'theft', 'other')),
  injured          boolean,
  drivable         text CHECK (drivable IN ('yes', 'no', 'unsure')),
  lat              double precision,
  lng              double precision,
  accuracy_m       double precision,
  location_note    text,
  notes            text,
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'resolved')),
  escalation_level integer NOT NULL DEFAULT 0,
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incidents_status_idx ON incidents (status, created_at);
CREATE INDEX incidents_booking_idx ON incidents (booking_id);

CREATE TABLE incident_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  blob_key    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One thread per booking, plus one support thread per renter.
CREATE TABLE threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id       uuid NOT NULL REFERENCES users(id),
  booking_id      uuid UNIQUE REFERENCES bookings(id),
  kind            text NOT NULL CHECK (kind IN ('booking', 'support')),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_preview    text NOT NULL DEFAULT '',
  unread_renter   integer NOT NULL DEFAULT 0 CHECK (unread_renter >= 0),
  unread_host     integer NOT NULL DEFAULT 0 CHECK (unread_host >= 0),
  CHECK ((kind = 'booking') = (booking_id IS NOT NULL))
);
CREATE UNIQUE INDEX threads_one_support_per_renter ON threads (renter_id) WHERE kind = 'support';
CREATE INDEX threads_renter_idx ON threads (renter_id, last_message_at DESC);
CREATE INDEX threads_last_idx ON threads (last_message_at DESC);

CREATE TABLE messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author     text NOT NULL CHECK (author IN ('renter', 'host', 'system')),
  author_id  uuid REFERENCES users(id),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  is_alert   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_thread_idx ON messages (thread_id, created_at);

-- Append-only. A user's credit balance is the sum of their entries.
CREATE TABLE credit_ledger (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  amount_cents integer NOT NULL CHECK (amount_cents <> 0),
  reason       text NOT NULL CHECK (reason IN ('referral_reward', 'booking_applied', 'booking_released', 'host_adjustment')),
  booking_id   uuid REFERENCES bookings(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_user_idx ON credit_ledger (user_id, created_at);

CREATE TABLE referrals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id  uuid NOT NULL REFERENCES users(id),
  referee_id   uuid NOT NULL UNIQUE REFERENCES users(id),
  booking_id   uuid REFERENCES bookings(id),
  status       text NOT NULL CHECK (status IN ('signed_up', 'booked', 'rewarded', 'void')),
  reward_cents integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_id <> referee_id)
);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_id, created_at);

CREATE TABLE waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  tier       text NOT NULL CHECK (tier IN ('luxury', 'exotic')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX waitlist_email_tier_idx ON waitlist (lower(email), tier);

-- Texts, calls and emails waiting to go out. A scheduled function sends and retries them.
CREATE TABLE outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel    text NOT NULL CHECK (channel IN ('sms', 'voice', 'email')),
  recipient  text NOT NULL,
  template   text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  status     text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts   integer NOT NULL DEFAULT 0,
  last_error text,
  send_after timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_due_idx ON outbox (status, send_after);

-- Host actions with money or safety consequences: refunds, deductions, restart blocks, overrides.
CREATE TABLE audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid REFERENCES users(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, created_at);

CREATE TRIGGER lots_updated_at BEFORE UPDATE ON lots FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
