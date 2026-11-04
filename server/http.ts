import type { ApiError } from "../shared/types.ts";

/** An error the renter can act on. Anything else becomes a generic 500 and is logged. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, field?: string) => new HttpError(400, message, field);
export const notFound = (message = "Not found.") => new HttpError(404, message);

export function json(body: unknown, init: ResponseInit & { cache?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", init.cache ?? "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** Reads a small JSON body. Anything that isn't a JSON object is a 400, never a crash. */
export async function readJson(req: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxBytes) throw badRequest("That request is too large.");
  try {
    const body: unknown = text ? JSON.parse(text) : {};
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw badRequest("We couldn't read that request. Refresh the page and try again.");
}

export type RequestContext = { ip: string | null };

type Handler = (req: Request, params: Record<string, string | undefined>, ctx: RequestContext) => Promise<Response>;

type NetlifyContext = { params?: Record<string, string | undefined>; requestId?: string; ip?: string };

/** Wraps a function body: method check, typed errors, and no stack traces leaked to the browser. */
export function route(methods: string[], handler: Handler) {
  return async (req: Request, context: NetlifyContext = {}) => {
    if (!methods.includes(req.method)) {
      return json({ error: "Method not allowed." } satisfies ApiError, { status: 405, headers: { allow: methods.join(", ") } });
    }
    try {
      return await handler(req, context.params ?? {}, { ip: context.ip ?? null });
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message, field: err.field } satisfies ApiError, { status: err.status });
      }
      console.error(`[${context.requestId ?? "local"}]`, err);
      return json({ error: "Something went wrong on our side. Try again in a moment." } satisfies ApiError, { status: 500 });
    }
  };
}
