import type { Config } from "@netlify/functions";
import { proofUploadHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default proofUploadHandler(services);

export const config: Config = { path: "/api/bookings/:code/proofs" };
