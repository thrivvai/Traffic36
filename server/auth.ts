import { createPublicKey } from "node:crypto";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { env, requireEnv } from "./env.ts";
import { HttpError } from "./http.ts";

export type ClerkProfile = { email: string | null; phone: string | null; name: string };

/** A checked session: who it is, plus contact details when the token carries them. */
export type Verified = { ok: true; userId: string; profile: ClerkProfile | null };
/** Why a session was refused, as a short code safe to show (it never contains the token). */
export type Refused = { ok: false; reason: string };

/** Who is calling, as Clerk vouches for it. An interface so tests run without Clerk. */
export interface AuthProvider {
  verify(req: Request): Promise<Verified | Refused>;
  /** Contact details from Clerk's API, for tokens that don't carry them. */
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
    const value = env(name);
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
 * The Clerk sign-in host for this app, read from the publishable key. The key is
 * "pk_test_" or "pk_live_" followed by base64 of "<host>$".
 */
export function clerkHostFromPublishableKey(key: string | undefined): string | null {
  const m = /^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/.exec((key ?? "").trim());
  if (!m) return null;
  const decoded = Buffer.from(m[1]!, "base64").toString("utf8");
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1);
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? host : null;
}

type Jwk = import("node:crypto").JsonWebKey & { kid?: string };

function tokenKid(token: string): string | null {
  try {
    const header = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as { kid?: unknown };
    return typeof header.kid === "string" ? header.kid : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Clerk in production.
 *
 * Sessions are checked against the public signing keys of the same Clerk app the sign-in screen
 * uses (found from the publishable key), so a secret key copied from a different Clerk app can't
 * break sign-in. The issuer must be that app, the token must be addressed to this site, and it
 * must be current. Name, email and phone ride in the token (configured in Clerk), so a sign-in
 * needs no extra call to Clerk.
 */
export function clerkAuth(opts: { fetch?: typeof fetch; publishableKey?: string } = {}): AuthProvider {
  const doFetch = opts.fetch ?? fetch;
  let client: ReturnType<typeof createClerkClient> | null = null;
  let jwks: { host: string; at: number; keys: Jwk[] } | null = null;

  async function signingKey(host: string, kid: string): Promise<string | null> {
    const fresh = jwks?.host === host && Date.now() - jwks.at < 10 * 60_000;
    let key = fresh ? jwks!.keys.find((k) => k.kid === kid) : undefined;
    if (!key) {
      const res = await doFetch(`https://${host}/.well-known/jwks.json`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`Clerk signing keys returned ${res.status}`);
      const body = (await res.json()) as { keys?: Jwk[] };
      jwks = { host, at: Date.now(), keys: body.keys ?? [] };
      key = jwks.keys.find((k) => k.kid === kid);
    }
    return key ? createPublicKey({ key, format: "jwk" }).export({ type: "spki", format: "pem" }).toString() : null;
  }

  const refuse = (reason: string, detail = ""): Refused => {
    // Never log the token itself.
    console.error(`Sign-in refused: ${reason}${detail ? `. ${detail}` : ""}`);
    return { ok: false, reason };
  };

  return {
    async verify(req) {
      const token = bearer(req);
      if (!token) return refuse("no-token");
      const host = clerkHostFromPublishableKey(opts.publishableKey ?? env("VITE_CLERK_PUBLISHABLE_KEY"));
      if (!host) return refuse("publishable-key-missing", "Set VITE_CLERK_PUBLISHABLE_KEY in Netlify.");
      const kid = tokenKid(token);
      if (!kid) return refuse("token-malformed");
      let pem: string | null;
      try {
        pem = await signingKey(host, kid);
      } catch (err) {
        return refuse("signing-keys-unreachable", (err as Error).message);
      }
      if (!pem) return refuse("token-from-another-clerk-app", `No signing key ${kid} at ${host}.`);

      // Clerk's exported verifyToken returns the claims and throws on a bad token.
      let claims: Record<string, unknown>;
      try {
        claims = (await verifyToken(token, { jwtKey: pem, authorizedParties: siteOrigins(req) })) as Record<string, unknown>;
      } catch (err) {
        const e = err as { reason?: string; message?: string };
        return refuse(e.reason ?? "token-invalid", e.message);
      }
      if (claims.iss !== `https://${host}`) return refuse("token-wrong-issuer", `Issuer ${String(claims.iss)}.`);
      const userId = str(claims.sub);
      if (!userId) return refuse("token-no-user");
      const hasProfile = "email" in claims || "phone" in claims;
      return {
        ok: true,
        userId,
        profile: hasProfile ? { email: str(claims.email), phone: str(claims.phone), name: str(claims.name) ?? "" } : null,
      };
    },
    async profile(clerkUserId) {
      const secretKey = requireEnv("CLERK_SECRET_KEY");
      if (!secretKey.startsWith("sk_")) {
        console.error('CLERK_SECRET_KEY should start with "sk_". Copy the Secret key (not the Publishable key) from Clerk: Traffic36 > API keys.');
        throw new HttpError(503, "Sign-in is temporarily unavailable. Try again later or message us at admin@traffic36.com.");
      }
      client ??= createClerkClient({ secretKey });
      const user = await client.users.getUser(clerkUserId);
      return {
        email: user.primaryEmailAddress?.emailAddress ?? null,
        phone: user.primaryPhoneNumber?.phoneNumber ?? null,
        name: user.fullName ?? "",
      };
    },
  };
}
