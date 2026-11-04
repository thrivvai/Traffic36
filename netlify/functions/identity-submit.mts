import type { Config } from "@netlify/functions";
import { licenseSubmitHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default licenseSubmitHandler(services);

export const config: Config = { path: "/api/identity/submit" };
