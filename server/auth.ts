import { createClerkClient, verifyToken } from "@clerk/backend";
import { env, requireEnv } from "./env.ts";
import { HttpError } from "./http.ts";

export type ClerkProfile = { email: string | null; phone: string | null; name: string };

/** Who is calling, as Clerk vouches for it. An interface so tests run without Clerk. */
export interface AuthProvider {
  /** The Clerk user id behind a valid session token, or null when signed out or the token is bad. */
  userIdFrom(req: Request): Promise<string | null>;
  /** Verified contact details from Clerk. Clerk confirms the email and phone at sign-up. */
  profile(clerkUserId: string): Promise<ClerkProfile>;
}

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token || null;
}

/** Every address this deploy answers on. Netlify sets URL, DEPLOY_PRIME_URL and DEPLOY_URL. */
function siteOrigins(req: Request): string[] {
  const origins = new Set([new URL(req.url).origin]);
  for (const name of ["URL", "DEPLOY_PRIME_URL", "DEPLOY_URL"]) {
    const value = env(name) ?? process.env[name];
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // ignore a malformed value
    }
  }
  return [...origins];
}

/**
 * The Clerk secret key, checked for the most common setup slip: pasting the publishable key
 * (pk_...) where the secret key (sk_...) belongs. The log says exactly what to fix.
 */
function clerkSecretKey(): string {
  const key = requireEnv("CLERK_SECRET_KEY");
  if (!key.startsWith("sk_")) {
    console.error(
      `CLERK_SECRET_KEY should start with "sk_" but starts with "${key.slice(0, 3)}". ` +
        "Copy the Secret key (not the Publishable key) from Clerk: Traffic36 > API keys.",
    );
    throw new HttpError(503, "Sign-in is temporarily unavailable. Try again later or message us at admin@traffic36.com.");
  }
  return key;
}

/** Clerk in production. Keys are read on first use, so routes that never authenticate don't need them. */
export function clerkAuth(): AuthProvider {
  let client: ReturnType<typeof createClerkClient> | null = null;
  return {
    async userIdFrom(req) {
      const token = bearer(req);
      if (!token) {
        console.error("Signed-in call arrived without a session token.");
        return null;
      }
      const { data, errors } = await verifyToken(token, {
        secretKey: clerkSecretKey(),
        // Optional: Clerk's PEM public key makes verification networkless.
        jwtKey: env("CLERK_JWT_KEY"),
        // The token must have been issued to this site: the address the request came in on, or
        // one of this deploy's own addresses as Netlify reports them.
        authorizedParties: siteOrigins(req),
      });
      if (errors) {
        // Never log the token itself. The reason says which setting to fix.
        const [e] = errors as [{ reason?: string; message?: string }];
        console.error(`Clerk rejected a session token: ${e.reason ?? "unknown"}. ${e.message ?? ""}`);
        return null;
      }
      const sub = (data as { sub?: unknown } | undefined)?.sub;
      return typeof sub === "string" ? sub : null;
    },
    async profile(clerkUserId) {
      client ??= createClerkClient({ secretKey: clerkSecretKey() });
      const user = await client.users.getUser(clerkUserId);
      return {
        email: user.primaryEmailAddress?.emailAddress ?? null,
        phone: user.primaryPhoneNumber?.phoneNumber ?? null,
        name: user.fullName ?? "",
      };
    },
  };
}
