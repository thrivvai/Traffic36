import type { Config } from "@netlify/functions";
import { hostActionHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default hostActionHandler(services);

export const config: Config = { path: "/api/host/bookings/:code/:action" };
