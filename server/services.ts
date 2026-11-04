import { clerkAuth, type AuthProvider } from "./auth.ts";
import { paymentConfigFromEnv, type PaymentConfig } from "./bookings.ts";
import { db, type TxDb } from "./db.ts";
import { env } from "./env.ts";
import { stripeIdentity, type IdentityProvider } from "./identity.ts";
import { idCheckMode } from "./licenseReview.ts";
import { blobIdentityStore, blobProofStore, type ProofStore } from "./proofs.ts";
import type { IdCheckMode } from "../shared/types.ts";
import { parseHostEmails } from "./users.ts";

/** Everything a signed-in route needs. Tests build the same shape from fakes. */
export type Services = {
  db: TxDb;
  auth: AuthProvider;
  identity: IdentityProvider;
  proofs: ProofStore;
  /** License photos, kept apart from payment screenshots. */
  idDocuments: ProofStore;
  /** Who checks licenses: the host from photos ("manual"), or Stripe. */
  idCheck: IdCheckMode;
  payments: PaymentConfig;
  hostEmails: string[];
  now(): Date;
};

let providers: Pick<Services, "auth" | "identity" | "proofs" | "idDocuments"> | null = null;

/** Production wiring. Providers are built once per function instance; settings are read per request. */
export function services(): Services {
  providers ??= { auth: clerkAuth(), identity: stripeIdentity(), proofs: blobProofStore(), idDocuments: blobIdentityStore() };
  return {
    db: db(),
    ...providers,
    idCheck: idCheckMode(),
    payments: paymentConfigFromEnv(),
    hostEmails: parseHostEmails(env("HOST_EMAILS")),
    now: () => new Date(),
  };
}
