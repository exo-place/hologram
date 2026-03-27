/**
 * Shared helpers for API route handlers.
 */

/** A route handler returns a Response or null (pass-through to next handler). */
export type RouteHandler = (req: Request, url: URL) => Promise<Response | null> | Response | null;

/** Return a 200 JSON success response */
export function ok(data: unknown, status = 200): Response {
  return Response.json({ ok: true, data }, { status });
}

/** Return a JSON error response */
export function err(message: string, status = 400): Response {
  return Response.json({ ok: false, error: message }, { status });
}

/** Parse an integer path param — returns null if invalid */
export function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Parse JSON request body — returns null on parse failure */
export async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
