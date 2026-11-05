-- How each confirmed trip is handed over, and the lockbox code the renter sees on their pickup pass.
--   lockbox    the host sets a code; the renter sees it from shortly before pickup until after the return
--   in_person  the host meets the renter
--   delivery   the host brings the car to the renter's address
ALTER TABLE bookings
  ADD COLUMN handoff text CHECK (handoff IN ('lockbox', 'in_person', 'delivery')),
  -- Where to find the car and the lockbox, shown on the pass with the code.
  ADD COLUMN handoff_note text CHECK (char_length(handoff_note) <= 300);

-- access_codes already holds one encrypted code per booking and purpose. These columns record who
-- set it, when it last changed, and when the renter first opened it.
ALTER TABLE access_codes
  ADD COLUMN set_by      uuid REFERENCES users(id),
  ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN revealed_at timestamptz;

-- The host can stop an account from booking; the note says why, for the host only.
COMMENT ON COLUMN users.do_not_rent_note IS 'Host-only reason an account is blocked from booking.';
