import type { Config } from "@netlify/functions";
import { hostDashboardHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default hostDashboardHandler(services);

export const config: Config = { path: "/api/host" };
