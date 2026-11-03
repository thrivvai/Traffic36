import type { Config } from "@netlify/functions";
import { db } from "../../server/db.ts";
import { json, route } from "../../server/http.ts";
import { listLocations } from "../../server/locations.ts";

export default route(["GET"], async () => {
  return json({ locations: await listLocations(db()) }, { cache: "public, max-age=60, stale-while-revalidate=300" });
});

export const config: Config = { path: "/api/locations" };
