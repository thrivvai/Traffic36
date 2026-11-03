import { clerkAuth, type AuthProvider } from "./auth.ts";
import { paymentConfigFromEnv, type PaymentConfig } from "./bookings.ts";
import { db, type TxDb } from "./db.ts";
import { env } from "./env.ts";
import { stripeIdentity, type IdentityProvider } from "./identity.ts";
import { blobProofStore, type ProofStore } from "./proofs.ts";
import { parseHostEmails } from "./users.ts";

/** Everything a signed-in route needs. Tests build the same shape from fakes. */
export type Services = {
  db: TxDb;
  auth: AuthProvider;
  identity: IdentityProvider;
  proofs: ProofStore;
  payments: PaymentConfig;
  hostEmails: string[];
  now(): Date;
};

let providers: Pick<Services, "auth" | "identity" | "proofs"> | null = null;

/** Production wiring. Providers are built once per function instance; settings are read per request. */
export function services(): Services {
  providers ??= { auth: clerkAuth(), identity: stripeIdentity(), proofs: blobProofStore() };
  return {
    db: db(),
    ...providers,
    payments: paymentConfigFromEnv(),
    hostEmails: parseHostEmails(env("HOST_EMAILS")),
    now: () => new Date(),
  };
}
