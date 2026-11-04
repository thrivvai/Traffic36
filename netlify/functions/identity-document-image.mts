import type { Config } from "@netlify/functions";
import { idDocumentImageHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default idDocumentImageHandler(services);

export const config: Config = { path: "/api/identity/documents/:id" };
