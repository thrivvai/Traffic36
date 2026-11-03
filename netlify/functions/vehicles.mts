import type { Config } from "@netlify/functions";
import { db } from "../../server/db.ts";
import { json, notFound, route } from "../../server/http.ts";
import { getVehicle, listVehicles } from "../../server/vehicles.ts";

// Listings change rarely; let browsers and the CDN reuse them briefly.
const CACHE = "public, max-age=60, stale-while-revalidate=300";

export default route(["GET"], async (_req, params) => {
  if (!params.slug) return json({ vehicles: await listVehicles(db()) }, { cache: CACHE });
  const vehicle = await getVehicle(db(), params.slug);
  if (!vehicle) throw notFound("That car isn't available.");
  const { id: _id, ...publicFields } = vehicle;
  return json({ vehicle: publicFields }, { cache: CACHE });
});

export const config: Config = { path: ["/api/vehicles", "/api/vehicles/:slug"] };
