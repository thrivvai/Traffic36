import type { Config } from "@netlify/functions";
import { hostLicenseHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default hostLicenseHandler(services);

export const config: Config = { path: "/api/host/licenses/:userId/:action" };
