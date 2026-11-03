import type { Config } from "@netlify/functions";
import { bookingHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default bookingHandler(services);

export const config: Config = { path: "/api/bookings/:code" };
