import type { Config } from "@netlify/functions";
import { meHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default meHandler(services);

export const config: Config = { path: "/api/me" };
