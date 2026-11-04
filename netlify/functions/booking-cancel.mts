import type { Config } from "@netlify/functions";
import { bookingCancelHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default bookingCancelHandler(services);

export const config: Config = { path: "/api/bookings/:code/cancel" };
