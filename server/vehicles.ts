import type { Db } from "./db.ts";
import type { Photo, Spec, Tier, VehicleDetail, VehicleSummary } from "../shared/types.ts";

type Row = {
  id: string;
  slug: string;
  year: number;
  make: string;
  model: string;
  tier: Tier;
  tagline: string;
  daily_rate_cents: number;
  weekly_rate_cents: number;
  specs: Spec[];
  description: string[];
  highlights: string[];
  fuel: string;
  min_driver_age: number;
  lot_slug: string;
  lot_name: string;
  lot_kind: string;
  photos: Photo[] | null;
};

// Photos are aggregated in the same query, ordered, so a listing is one round trip.
const SELECT = `
  SELECT v.id, v.slug, v.year, v.make, v.model, v.tier, v.tagline, v.daily_rate_cents, v.weekly_rate_cents,
         v.specs, v.description, v.highlights, v.fuel, v.min_driver_age,
         l.slug AS lot_slug, l.name AS lot_name, l.kind AS lot_kind,
         (SELECT json_agg(json_build_object('src', p.src, 'alt', p.alt_text) ORDER BY p.sort_order)
            FROM vehicle_photos p WHERE p.vehicle_id = v.id) AS photos
  FROM vehicles v
  JOIN lots l ON l.id = v.lot_id
`;

function toSummary(r: Row): VehicleSummary {
  return {
    slug: r.slug,
    year: r.year,
    make: r.make,
    model: r.model,
    tier: r.tier,
    tagline: r.tagline,
    dailyCents: r.daily_rate_cents,
    weeklyCents: r.weekly_rate_cents,
    specs: r.specs,
    photos: r.photos ?? [],
    lot: { slug: r.lot_slug, name: r.lot_name, kind: r.lot_kind },
  };
}

export async function listVehicles(db: Db): Promise<VehicleSummary[]> {
  const { rows } = await db.query<Row>(`${SELECT} WHERE v.status = 'active' ORDER BY v.sort_order, v.year DESC`);
  return rows.map(toSummary);
}

export type VehicleRecord = VehicleDetail & { id: string };

export async function getVehicle(db: Db, slug: string): Promise<VehicleRecord | null> {
  const { rows } = await db.query<Row>(`${SELECT} WHERE v.slug = $1 AND v.status = 'active'`, [slug]);
  const r = rows[0];
  if (!r) return null;
  return {
    ...toSummary(r),
    id: r.id,
    description: r.description,
    highlights: r.highlights,
    fuel: r.fuel,
    minDriverAge: r.min_driver_age,
  };
}
