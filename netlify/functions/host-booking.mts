import type { Config } from "@netlify/functions";
import { hostBookingHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default hostBookingHandler(services);

export const config: Config = { path: "/api/host/bookings/:code" };
