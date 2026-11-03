import type { Config } from "@netlify/functions";
import { stripeWebhookHandler } from "../../server/api.ts";
import { services } from "../../server/services.ts";

export default stripeWebhookHandler(services);

export const config: Config = { path: "/api/webhooks/stripe" };
