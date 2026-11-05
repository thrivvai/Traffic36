/**
 * Session checks with real RS256 tokens, signed here with a throwaway key and served from a fake
 * Clerk key endpoint. Exercises Clerk's own verifier exactly as production calls it.
 */
import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import { clerkAuth, clerkHostFromPublishableKey } from "../server/auth.ts";

const HOST = "quiet-katydid-3948.clerk.accounts.dev";
const PUBLISHABLE_KEY = "pk_test_cXVpZXQta2F0eWRpZC0zOTQ4LmNsZXJrLmFjY291bnRzLmRldiQ"; // the real Traffic36 dev key
const SITE = "https://traffic36.test";

const pair = () => generateKeyPairSync("rsa", { modulusLength: 2048 });
const ours = pair();
const theirs = pair();
const jwk = { ...ours.publicKey.export({ format: "jwk" }), kid: "ins_traffic36", alg: "RS256", use: "sig" };

function sign(claims: Record<string, unknown>, opts: { kid?: string; key?: typeof ours.privateKey } = {}) {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = part({ alg: "RS256", typ: "JWT", kid: opts.kid ?? "ins_traffic36" });
  const body = part(claims);
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(opts.key ?? ours.privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

const now = () => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({
  sub: "user_123",
  sid: "sess_123",
  iss: `https://${HOST}`,
  azp: SITE,
  iat: now() - 5,
  nbf: now() - 5,
  exp: now() + 60,
  email: "jordan@example.com",
  phone: "+14705550123",
  name: "Jordan Ellis",
  ...over,
});

function setup() {
  const calls: string[] = [];
  const fakeFetch = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const auth = clerkAuth({ fetch: fakeFetch, publishableKey: PUBLISHABLE_KEY });
  const verify = (token?: string) =>
    auth.verify(new Request(`${SITE}/api/me`, token ? { headers: { authorization: `Bearer ${token}` } } : {}));
  return { calls, verify };
}

describe("Clerk session checks", () => {
  test("the sign-in host comes from the publishable key", () => {
    expect(clerkHostFromPublishableKey(PUBLISHABLE_KEY)).toBe(HOST);
    expect(clerkHostFromPublishableKey("sk_test_abc")).toBeNull();
    expect(clerkHostFromPublishableKey(undefined)).toBeNull();
  });

  test("a valid token passes, carries the profile, and the signing keys are fetched once", async () => {
    const { calls, verify } = setup();
    const first = await verify(sign(claims()));
    expect(first).toEqual({ ok: true, userId: "user_123", profile: { email: "jordan@example.com", phone: "+14705550123", name: "Jordan Ellis" } });
    expect((await verify(sign(claims()))).ok).toBe(true);
    expect(calls).toEqual([`https://${HOST}/.well-known/jwks.json`]);
  });

  test("a token without profile claims still passes, and the profile is looked up instead", async () => {
    const { verify } = setup();
    const { email: _e, phone: _p, name: _n, ...bare } = claims();
    expect(await verify(sign(bare))).toEqual({ ok: true, userId: "user_123", profile: null });
  });

  test("each kind of bad token is refused with a reason", async () => {
    const { verify } = setup();
    expect(await verify()).toEqual({ ok: false, reason: "no-token" });
    expect(await verify("not-a-token")).toEqual({ ok: false, reason: "token-malformed" });
    expect(await verify(sign(claims(), { kid: "ins_other", key: theirs.privateKey }))).toEqual({ ok: false, reason: "token-from-another-clerk-app" });
    expect((await verify(sign(claims(), { key: theirs.privateKey }))).ok).toBe(false);
    expect(await verify(sign(claims({ exp: now() - 120, iat: now() - 200, nbf: now() - 200 })))).toMatchObject({ ok: false, reason: "token-expired" });
    expect(await verify(sign(claims({ azp: "https://evil.example" })))).toMatchObject({ ok: false, reason: "token-invalid-authorized-parties" });
    expect(await verify(sign(claims({ iss: "https://other.clerk.accounts.dev" })))).toEqual({ ok: false, reason: "token-wrong-issuer" });
  });
});
