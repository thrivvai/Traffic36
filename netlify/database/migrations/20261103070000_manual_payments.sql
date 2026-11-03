-- Checkout with Cash App and Chime. Renters pay outside the site and upload a screenshot;
-- the host confirms the money arrived before a booking is confirmed. Stripe is used only
-- for the driver's license check.

-- New booking states:
--   awaiting_payment  dates are held until hold_expires_at while the renter pays and uploads proof
--   payment_review    proof uploaded; dates stay blocked until the host confirms or rejects it
ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
  'held', 'expired', 'awaiting_verification', 'needs_review', 'awaiting_payment', 'payment_review',
  'confirmed', 'active', 'returned', 'closed', 'cancelled'));

ALTER TABLE bookings
  ADD COLUMN payment_method text CHECK (payment_method IN ('card', 'cash_app', 'chime')),
  ADD COLUMN payment_note   text;   -- the host's note when a payment is rejected, shown to the renter

COMMENT ON COLUMN bookings.hold_expires_at IS 'While awaiting_payment, the dates are held until this time.';

-- Each screenshot a renter uploads. The image itself lives in Netlify Blobs under blob_key.
CREATE TABLE payment_proofs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  method       text NOT NULL CHECK (method IN ('cash_app', 'chime')),
  sender_name  text NOT NULL CHECK (char_length(sender_name) BETWEEN 1 AND 120),
  blob_key     text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size    integer NOT NULL CHECK (byte_size > 0),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  review_note  text,
  reviewed_by  uuid REFERENCES users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_proofs_booking_idx ON payment_proofs (booking_id, created_at);

-- Payments the host records by hand sit beside card payments in the same ledger.
ALTER TABLE payments
  ADD COLUMN method      text NOT NULL DEFAULT 'card' CHECK (method IN ('card', 'cash_app', 'chime')),
  ADD COLUMN recorded_by uuid REFERENCES users(id),
  ADD COLUMN note        text;

ALTER TABLE users
  ADD COLUMN identity_name     text,   -- legal name read from the verified license
  ADD COLUMN identity_attempts integer NOT NULL DEFAULT 0 CHECK (identity_attempts >= 0);
