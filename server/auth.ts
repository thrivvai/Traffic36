import { createClerkClient, verifyToken } from "@clerk/backend";
import { env, requireEnv } from "./env.ts";

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

/** Clerk in production. Keys are read on first use, so routes that never authenticate don't need them. */
export function clerkAuth(): AuthProvider {
  let client: ReturnType<typeof createClerkClient> | null = null;
  return {
    async userIdFrom(req) {
      const token = bearer(req);
      if (!token) return null;
      const { data, errors } = await verifyToken(token, {
        secretKey: requireEnv("CLERK_SECRET_KEY"),
        // Optional: Clerk's PEM public key makes verification networkless.
        jwtKey: env("CLERK_JWT_KEY"),
        // The token must have been issued to this site. The API and the app share one origin.
        authorizedParties: [new URL(req.url).origin],
      });
      const sub = (data as { sub?: unknown } | undefined)?.sub;
      if (errors || typeof sub !== "string") return null;
      return sub;
    },
    async profile(clerkUserId) {
      client ??= createClerkClient({ secretKey: requireEnv("CLERK_SECRET_KEY") });
      const user = await client.users.getUser(clerkUserId);
      return {
        email: user.primaryEmailAddress?.emailAddress ?? null,
        phone: user.primaryPhoneNumber?.phoneNumber ?? null,
        name: user.fullName ?? "",
      };
    },
  };
}
