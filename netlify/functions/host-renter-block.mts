import type { Config } from "@netlify/functions";
import { hostRenterBlockHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default hostRenterBlockHandler(services);

export const config: Config = { path: "/api/host/renters/:id/block" };
