/** The cookie that ties saved preferences to one browser. Set only when a visitor saves something. */
export const VISITOR_COOKIE = 'visitor';
const ONE_YEAR = 60 * 60 * 24 * 365;

/** 128 random bits as hex: unguessable, and safe in a cookie or a path. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function readVisitor(request: Request): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === VISITOR_COOKIE && value && /^[0-9a-f]{32}$/.test(value)) return value;
  }
  return null;
}

export function visitorCookie(id: string): string {
  return `${VISITOR_COOKIE}=${id}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; Secure; SameSite=Lax`;
}
