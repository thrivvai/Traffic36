import type { Config } from "@netlify/functions";
import { db } from "../../server/db.ts";
import { json, route } from "../../server/http.ts";
import { quoteForVehicle } from "../../server/quote.ts";

// GET /api/vehicles/:slug/quote?startDate=2026-11-06&startTime=10:00&endDate=2026-11-09&endTime=10:00
export default route(["GET"], async (req, params) => {
  const q = new URL(req.url).searchParams;
  const quote = await quoteForVehicle(db(), params.slug ?? "", {
    startDate: q.get("startDate"),
    startTime: q.get("startTime"),
    endDate: q.get("endDate"),
    endTime: q.get("endTime"),
  });
  return json({ quote });
});

export const config: Config = { path: "/api/vehicles/:slug/quote" };
