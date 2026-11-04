import type { Config } from "@netlify/functions";
import { identityStartHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default identityStartHandler(services);

export const config: Config = { path: "/api/identity/start" };
