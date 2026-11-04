/**
 * Signed-in API routes, as plain handlers. Each Netlify function passes in the production
 * services; tests pass fakes, so the full request-to-database path is tested without Clerk,
 * Stripe or Blobs.
 */
import {
  cancelByHost,
  cancelUnpaid,
  confirmPayment,
  createBooking,
  enabledMethods,
  getBooking,
  hostDashboard,
  listBookings,
  readProof,
  rejectPayment,
  returnDeposit,
  submitProof,
} from "./bookings.ts";
import { HttpError, badRequest, json, readJson, route } from "./http.ts";
import { identityWebhook, refreshIdentity, startIdentity } from "./identity.ts";
import { approveLicense, readIdDocument, rejectLicense, submitLicense, uploadIdDocument } from "./licenseReview.ts";
import type { Services } from "./services.ts";
import { publicMe, requireHost, requireUser } from "./users.ts";

type Get = () => Services;

const deps = (s: Services) => ({ db: s.db, auth: s.auth, hostEmails: s.hostEmails });

/** GET /api/me. `?sync=1` refreshes name, email, phone and role from Clerk (the app does this once per visit). */
export const meHandler = (get: Get) =>
  route(["GET"], async (req) => {
    const s = get();
    const sync = new URL(req.url).searchParams.get("sync") === "1";
    let user = await requireUser(req, deps(s), { refresh: sync });
    if (user.identityStatus === "pending" && user.identityMethod === "stripe") user = await refreshIdentity(s.db, s.identity, user, s.now());
    return json({ me: publicMe(user, s.now()), paymentMethods: enabledMethods(s.payments), idCheck: s.idCheck });
  });

/** POST /api/identity/documents, multipart: kind (license_front, license_back or selfie) and file. */
export const idDocumentUploadHandler = (get: Get) =>
  route(["POST"], async (req) => {
    const s = get();
    const user = await requireUser(req, deps(s));
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw badRequest("We couldn't read that upload. Try again.");
    }
    return json(await uploadIdDocument(s.db, s.idDocuments, user, { kind: form.get("kind"), file: form.get("file") }, s.now()), { status: 201 });
  });

/** POST /api/identity/submit { legalName, dob, licenseState, licenseExpiresOn, documents: { license_front, license_back, selfie } } */
export const licenseSubmitHandler = (get: Get) =>
  route(["POST"], async (req) => {
    const s = get();
    if (s.idCheck !== "manual") throw new HttpError(409, "License checks run through Stripe right now. Refresh the page.");
    const user = await requireUser(req, deps(s));
    await submitLicense(s.db, user, await readJson(req), s.hostEmails, s.now());
    const updated = await requireUser(req, deps(s));
    return json({ me: publicMe(updated, s.now()) }, { status: 201 });
  });

/** GET /api/identity/documents/:id returns a license photo, to the host only. */
export const idDocumentImageHandler = (get: Get) =>
  route(["GET"], async (req, params) => {
    const s = get();
    const user = await requireUser(req, deps(s));
    const doc = await readIdDocument(s.db, s.idDocuments, user, params.id ?? "");
    return new Response(doc.data, {
      headers: {
        "content-type": doc.contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  });

/** POST /api/host/licenses/:userId/:action where action is approve (with corrected details) or reject (with a reason). */
export const hostLicenseHandler = (get: Get) =>
  route(["POST"], async (req, params) => {
    const s = get();
    const host = await requireHost(req, deps(s));
    const body = await readJson(req);
    if (params.action === "approve") await approveLicense(s.db, host, params.userId ?? "", body, s.now());
    else if (params.action === "reject") await rejectLicense(s.db, host, params.userId ?? "", body, s.now());
    else throw new HttpError(404, "Unknown action.");
    return json({ dashboard: await hostDashboard(s.db, s.payments, s.now()) });
  });

/** POST /api/identity/start { returnPath } -> { url } to send the renter to Stripe, or { done: true }. */
export const identityStartHandler = (get: Get) =>
  route(["POST"], async (req) => {
    const s = get();
    if (s.idCheck !== "stripe") throw new HttpError(409, "Licenses are checked from photos right now. Refresh the page.");
    const user = await requireUser(req, deps(s));
    const body = await readJson(req);
    const path = typeof body.returnPath === "string" ? body.returnPath : "/";
    // Only paths on this site: never let a crafted link bounce renters elsewhere after Stripe.
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw badRequest("Invalid return address.");
    const returnUrl = new URL(path, new URL(req.url).origin).toString();
    return json(await startIdentity(s.db, s.identity, user, returnUrl, s.now()));
  });

/** POST /api/webhooks/stripe. Stripe signs every call; anything unsigned is refused. */
export const stripeWebhookHandler = (get: Get) =>
  route(["POST"], async (req) => {
    const s = get();
    const signature = req.headers.get("stripe-signature");
    if (!signature) throw new HttpError(400, "Missing signature.");
    let sessionId: string | null;
    try {
      sessionId = await s.identity.webhookSession(await req.text(), signature);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "Invalid signature.");
    }
    if (sessionId) await identityWebhook(s.db, s.identity, sessionId, s.now());
    return json({ received: true });
  });

/** GET /api/bookings lists the renter's trips. POST /api/bookings holds dates for a new one. */
export const bookingsHandler = (get: Get) =>
  route(["GET", "POST"], async (req, _params, ctx) => {
    const s = get();
    const user = await requireUser(req, deps(s));
    if (req.method === "GET") return json({ bookings: await listBookings(s.db, s.payments, user, s.now()) });
    const body = await readJson(req);
    const slug = typeof body.slug === "string" ? body.slug : "";
    const result = await createBooking(s.db, s.payments, user, slug, body, { ip: ctx.ip, now: s.now() });
    return json(result, { status: 201 });
  });

/** GET /api/bookings/:code */
export const bookingHandler = (get: Get) =>
  route(["GET"], async (req, params) => {
    const s = get();
    const user = await requireUser(req, deps(s));
    return json({ booking: await getBooking(s.db, s.payments, user, params.code ?? "", s.now()) });
  });

/** POST /api/bookings/:code/cancel, for unpaid bookings. */
export const bookingCancelHandler = (get: Get) =>
  route(["POST"], async (req, params) => {
    const s = get();
    const user = await requireUser(req, deps(s));
    await cancelUnpaid(s.db, user, params.code ?? "", s.now());
    return json({ ok: true });
  });

/** POST /api/bookings/:code/proofs, multipart: method, senderName, file. */
export const proofUploadHandler = (get: Get) =>
  route(["POST"], async (req, params) => {
    const s = get();
    const user = await requireUser(req, deps(s));
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw badRequest("We couldn't read that upload. Try again.");
    }
    await submitProof(
      s.db,
      s.proofs,
      s.payments,
      user,
      params.code ?? "",
      { method: form.get("method"), senderName: form.get("senderName"), file: form.get("file") },
      s.hostEmails,
      s.now(),
    );
    return json({ booking: await getBooking(s.db, s.payments, user, params.code ?? "", s.now()) }, { status: 201 });
  });

/** GET /api/bookings/:code/proofs/:proofId returns the image itself. */
export const proofImageHandler = (get: Get) =>
  route(["GET"], async (req, params) => {
    const s = get();
    const user = await requireUser(req, deps(s));
    const proof = await readProof(s.db, s.proofs, user, params.code ?? "", params.proofId ?? "");
    return new Response(proof.data, {
      headers: {
        "content-type": proof.contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  });

/** GET /api/host: everything the host acts on, in one call. */
export const hostDashboardHandler = (get: Get) =>
  route(["GET"], async (req) => {
    const s = get();
    await requireHost(req, deps(s));
    return json({ dashboard: await hostDashboard(s.db, s.payments, s.now()) });
  });

/** POST /api/host/bookings/:code/:action where action is confirm, reject, cancel or deposit. */
export const hostActionHandler = (get: Get) =>
  route(["POST"], async (req, params) => {
    const s = get();
    const host = await requireHost(req, deps(s));
    const code = params.code ?? "";
    const body = await readJson(req);
    const now = s.now();
    switch (params.action) {
      case "confirm":
        await confirmPayment(s.db, host, code, body, now);
        break;
      case "reject":
        await rejectPayment(s.db, host, code, body, now);
        break;
      case "cancel":
        await cancelByHost(s.db, host, code, body, now);
        break;
      case "deposit":
        await returnDeposit(s.db, host, code, body, now);
        break;
      default:
        throw new HttpError(404, "Unknown action.");
    }
    return json({ dashboard: await hostDashboard(s.db, s.payments, now) });
  });
