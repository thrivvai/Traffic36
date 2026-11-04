import type { Config } from "@netlify/functions";
import { idDocumentUploadHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default idDocumentUploadHandler(services);

export const config: Config = { path: "/api/identity/documents" };
