import type { Db } from "./db.ts";
import type { Location } from "../shared/types.ts";

type Row = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  address: string | null;
  opens_at: string | null;
  closes_at: string | null;
  in_person_available: boolean;
};

const COLUMNS = `id, slug, name, kind, address, opens_at::text AS opens_at, closes_at::text AS closes_at, in_person_available`;

/** Postgres renders `time` as "HH:MM:SS"; the app speaks "HH:MM". */
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

const toLocation = (r: Row): Location => ({
  slug: r.slug,
  name: r.name,
  kind: r.kind,
  address: r.address,
  opensAt: hhmm(r.opens_at),
  closesAt: hhmm(r.closes_at),
  inPersonAvailable: r.in_person_available,
});

export async function listLocations(db: Db): Promise<Location[]> {
  const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM lots WHERE active ORDER BY sort_order, name`);
  return rows.map(toLocation);
}

export type LocationRecord = Location & { id: string };

export async function getLocation(db: Db, slug: string): Promise<LocationRecord | null> {
  const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM lots WHERE slug = $1 AND active`, [slug]);
  const r = rows[0];
  return r ? { ...toLocation(r), id: r.id } : null;
}
