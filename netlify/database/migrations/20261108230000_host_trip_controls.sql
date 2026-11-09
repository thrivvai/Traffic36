-- Host trip controls: end a trip early, cancel a paid trip with a recorded refund, and archive
-- finished bookings and renters. Archiving only hides a record from the host's lists; nothing is
-- erased, and it can be undone.

ALTER TABLE bookings
  ADD COLUMN scheduled_end_at timestamptz,
  ADD COLUMN archived_at      timestamptz,
  ADD COLUMN archived_by      uuid REFERENCES users(id);

COMMENT ON COLUMN bookings.scheduled_end_at IS
  'Set when the host ends a trip early: the return time originally booked. ends_at then holds the actual end, so the rest of the dates free up.';
COMMENT ON COLUMN bookings.archived_at IS 'Hidden from the host''s lists. The renter still sees the booking in their trips.';

ALTER TABLE users
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES users(id);

COMMENT ON COLUMN users.archived_at IS 'Hidden from the host''s renter list. Cleared when the renter books again or sends a new license.';

-- A refund for unused days when the host ends a trip early.
ALTER TABLE payments DROP CONSTRAINT payments_kind_check;
ALTER TABLE payments ADD CONSTRAINT payments_kind_check CHECK (kind IN (
  'booking_charge', 'extension_charge', 'deposit_refund', 'cancellation_refund', 'late_payment_refund', 'early_end_refund'));
