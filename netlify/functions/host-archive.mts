import type { Config } from "@netlify/functions";
import { hostArchiveHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default hostArchiveHandler(services);

export const config: Config = { path: "/api/host/archive" };
