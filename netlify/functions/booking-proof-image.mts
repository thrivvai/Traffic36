import type { Config } from "@netlify/functions";
import { proofImageHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default proofImageHandler(services);

export const config: Config = { path: "/api/bookings/:code/proofs/:proofId" };
