import type { Config } from "@netlify/functions";
import { bookingsHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default bookingsHandler(services);

export const config: Config = { path: "/api/bookings" };
