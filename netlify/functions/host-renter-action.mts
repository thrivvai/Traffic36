import type { Config } from "@netlify/functions";
import { hostRenterActionHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default hostRenterActionHandler(services);

export const config: Config = { path: "/api/host/renters/:id/:action" };
