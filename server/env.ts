import { HttpError } from "./http.ts";

type NetlifyGlobal = { Netlify?: { env: { get(name: string): string | undefined } } };

/** Reads a setting from Netlify's environment when deployed, or process.env locally and in tests. */
export function env(name: string): string | undefined {
  const value = (globalThis as NetlifyGlobal).Netlify?.env.get(name) ?? process.env[name];
  return value?.trim() || undefined;
}

/**
 * A setting the feature can't run without. A missing one is a setup problem, not the renter's:
 * the log names the variable, the renter gets a calm message.
 */
export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) {
    console.error(`Missing environment variable ${name}. Add it in Netlify: Project configuration > Environment variables.`);
    throw new HttpError(503, "Booking is temporarily unavailable. Try again later or message us at admin@traffic36.com.");
  }
  return value;
}
