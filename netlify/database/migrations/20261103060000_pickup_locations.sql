-- Real pickup and return locations, replacing the mock's sample lots.
-- Every booking now chooses where to pick up (a location, or delivery) and where to return.
-- A car's lot_id is its home base: where it's kept between trips.

ALTER TABLE lots
  ADD COLUMN opens_at time,                 -- local time; NULL means the app's standard hours
  ADD COLUMN closes_at time,
  ADD COLUMN in_person_available boolean NOT NULL DEFAULT false,
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT lots_hours_valid CHECK (
    (opens_at IS NULL AND closes_at IS NULL) OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)
  );

-- CONFIRM before launch: each park's street address, the parking area the car uses, and the park's
-- opening hours (set opens_at / closes_at so the app never offers a time when the park is closed).
INSERT INTO lots (slug, name, kind, address, instructions, in_person_available, sort_order) VALUES
  ('norman-berry', 'Norman Berry Dr', 'Home base', '3400 Norman Berry Dr, Atlanta, GA 30344',
   'Your exact spot and lockbox code are on your pickup pass. Prefer an in-person handoff? Message your host.', true, 1),
  ('lovejoy-regional-park', 'Lovejoy Regional Park', 'Park', NULL,
   'Your car''s parking spot and lockbox code are on your pickup pass.', false, 2),
  ('east-hampton-community-park', 'East Hampton Community Park', 'Park', NULL,
   'Your car''s parking spot and lockbox code are on your pickup pass.', false, 3);

UPDATE vehicles SET lot_id = (SELECT id FROM lots WHERE slug = 'norman-berry');
DELETE FROM lots WHERE slug IN ('grandview', 'midtown');

-- Where this trip starts and ends. Delivery is drop-off only: the renter returns to a location.
ALTER TABLE bookings
  ADD COLUMN pickup_lot_id uuid REFERENCES lots(id),
  ADD COLUMN delivery_address text,
  ADD COLUMN delivery_fee_cents integer NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  ADD COLUMN return_lot_id uuid NOT NULL REFERENCES lots(id),
  ADD CONSTRAINT bookings_one_pickup CHECK ((pickup_lot_id IS NULL) <> (delivery_address IS NULL));

COMMENT ON COLUMN bookings.charge_cents IS 'rental - credit - friend discount + delivery fee + deposit';
