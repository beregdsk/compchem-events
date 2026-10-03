/** A JSON response that no cache keeps: every API answer is per visitor. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Writes must come from the site's own pages: the visitor cookie alone would
 * let any other site act for a visitor.
 */
export function isSameOriginWrite(request: Request): boolean {
  return request.headers.get('Origin') === new URL(request.url).origin;
}
