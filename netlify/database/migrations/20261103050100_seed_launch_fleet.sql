-- The two launch cars and the lots they're staged at.
-- PLACEHOLDER: both lots are the mock's sample partners. Replace names, addresses and
-- instructions with your signed partner sites in a later migration before launch.
-- PLACEHOLDER: min_driver_age (25 luxury, 21 economy) until Roamly confirms the minimums.

INSERT INTO lots (slug, name, kind, instructions) VALUES
  ('grandview', 'Grandview Hotel', 'Hotel perimeter lot',
   'North perimeter row, signed Traffic36. Lockbox at the end of the row.'),
  ('midtown', 'Midtown Auto Care', 'Service partner',
   'Row C, spaces 1 to 4. Lockbox on the fence post by the bay doors.');

INSERT INTO vehicles (slug, unit_code, year, make, model, tier, daily_rate_cents, weekly_rate_cents,
                      min_driver_age, lot_id, fuel, tagline, description, specs, highlights, sort_order)
VALUES
  ('mercedes-glc-300-coupe-2021', 'T36-001', 2021, 'Mercedes-Benz', 'GLC 300 Coupe', 'luxury', 9500, 59500,
   25, (SELECT id FROM lots WHERE slug = 'grandview'), 'Premium',
   'Coupe roofline, SUV stance, all-wheel drive.',
   ARRAY[
     'The GLC 300 Coupe gives you a fastback roofline with the ride height and grip of an SUV. A 255 hp turbocharged four and a quick 9-speed automatic make merging and passing effortless, and 4MATIC all-wheel drive keeps it planted when the weather turns.',
     'The diamond-pattern grille and big alloy wheels mean it arrives looking like an occasion. It seats five, with a liftgate for weekend bags. Book it for client meetings, a date night, or a weekend out of town.'
   ],
   '[{"value":"255 hp","label":"2.0L turbo four"},{"value":"6.1 s","label":"0 to 60 mph"},{"value":"4MATIC","label":"All-wheel drive"},{"value":"9-speed","label":"Automatic"},{"value":"5","label":"Seats"},{"value":"Premium","label":"Fuel"}]'::jsonb,
   ARRAY['Insurance included on every trip', 'Weekly rate works out to $85 a day',
         'All-wheel drive for rain and road trips', 'Contactless pickup with a smart lockbox'],
   1),
  ('hyundai-elantra-sel-sport-2026', 'T36-002', 2026, 'Hyundai', 'Elantra SEL Sport', 'economy', 7500, 45000,
   21, (SELECT id FROM lots WHERE slug = 'midtown'), 'Regular',
   'Brand new, sharp to look at, easy on gas.',
   ARRAY[
     'A brand-new 2026 Elantra in SEL Sport trim: creased bodywork, gloss-black 17-inch wheels and a rear spoiler. It looks quicker than an economy car has any right to.',
     'Inside you get a digital gauge cluster and an 8-inch touchscreen with Apple CarPlay and Android Auto, so your maps and music are on screen in seconds. The 2.0-liter four and smooth automatic are tuned for economy, so a weekly rental goes further at the pump.'
   ],
   '[{"value":"147 hp","label":"2.0L four"},{"value":"IVT","label":"Automatic"},{"value":"17 in","label":"Gloss-black wheels"},{"value":"8 in","label":"Touchscreen"},{"value":"5","label":"Seats"},{"value":"Regular","label":"Fuel"}]'::jsonb,
   ARRAY['Insurance included on every trip', 'Weekly rate works out to about $64 a day',
         'Apple CarPlay and Android Auto', 'Contactless pickup with a smart lockbox'],
   2);

INSERT INTO vehicle_photos (vehicle_id, src, alt_text, sort_order)
SELECT v.id, p.src, p.alt_text, p.sort_order
FROM (VALUES
  ('mercedes-glc-300-coupe-2021', '/cars/glc-300-coupe-1.webp', 'Silver GLC 300 Coupe, front three-quarter view', 1),
  ('mercedes-glc-300-coupe-2021', '/cars/glc-300-coupe-2.webp', 'GLC 300 Coupe from the front, showing the diamond-pattern grille', 2),
  ('mercedes-glc-300-coupe-2021', '/cars/glc-300-coupe-3.webp', 'GLC 300 Coupe side profile with its sloping roofline', 3),
  ('mercedes-glc-300-coupe-2021', '/cars/glc-300-coupe-4.webp', 'Close front three-quarter view with LED headlight and multi-spoke wheel', 4),
  ('mercedes-glc-300-coupe-2021', '/cars/glc-300-coupe-5.webp', 'GLC 300 Coupe in a studio, three-quarter view', 5),
  ('hyundai-elantra-sel-sport-2026', '/cars/elantra-sel-sport-1.webp', 'Gray 2026 Elantra SEL Sport, front three-quarter view', 1),
  ('hyundai-elantra-sel-sport-2026', '/cars/elantra-sel-sport-2.webp', 'Elantra SEL Sport side profile with gloss-black wheels', 2),
  ('hyundai-elantra-sel-sport-2026', '/cars/elantra-sel-sport-3.webp', 'Elantra SEL Sport rear three-quarter view with the spoiler', 3),
  ('hyundai-elantra-sel-sport-2026', '/cars/elantra-sel-sport-4.webp', 'Elantra interior with the digital gauge cluster and touchscreen', 4)
) AS p (slug, src, alt_text, sort_order)
JOIN vehicles v ON v.slug = p.slug;
