import type { Config } from "@netlify/functions";
import { hostRentersHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default hostRentersHandler(services);

export const config: Config = { path: ["/api/host/renters", "/api/host/renters/:id"] };
