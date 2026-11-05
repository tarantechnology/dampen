/**
 * The proxy allowlist.
 *
 * `/api/spotify/proxy/[...path]` injects a bearer token server-side, so if it
 * forwarded arbitrary paths it would be an open, authenticated proxy onto the
 * whole Spotify API with the user's token. It forwards only the exact
 * (method, path) pairs below — the ones `client.ts` actually calls.
 *
 * Isomorphic: imported by the route handler and (for `buildProxyPath`) by the
 * browser client. No secrets, no env, no `window`.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Spotify base-62 resource ids are 22 chars, but don't hard-code the length. */
const ID = '[A-Za-z0-9]{1,64}';

interface AllowRule {
  /** Anchored against the full path *below* `/v1/`, with no leading slash. */
  readonly pattern: RegExp;
  readonly methods: readonly HttpMethod[];
}

const RULES: readonly AllowRule[] = [
  // ---- profile ----
  { pattern: /^me$/, methods: ['GET'] },

  // ---- library ----
  { pattern: /^me\/playlists$/, methods: ['GET'] },
  { pattern: new RegExp(`^playlists\\/${ID}\\/tracks$`), methods: ['GET'] },
  { pattern: /^me\/tracks$/, methods: ['GET'] },
  { pattern: /^me\/player\/recently-played$/, methods: ['GET'] },
  { pattern: /^me\/top\/(?:tracks|artists)$/, methods: ['GET'] },

  // ---- search ----
  { pattern: /^search$/, methods: ['GET'] },

  // ---- playback: read ----
  { pattern: /^me\/player$/, methods: ['GET', 'PUT'] }, // PUT = transfer playback
  { pattern: /^me\/player\/devices$/, methods: ['GET'] },

  // ---- playback: mutate ----
  { pattern: /^me\/player\/play$/, methods: ['PUT'] },
  { pattern: /^me\/player\/pause$/, methods: ['PUT'] },
  { pattern: /^me\/player\/next$/, methods: ['POST'] },
  { pattern: /^me\/player\/previous$/, methods: ['POST'] },
  { pattern: /^me\/player\/seek$/, methods: ['PUT'] },
  { pattern: /^me\/player\/volume$/, methods: ['PUT'] },
  { pattern: /^me\/player\/shuffle$/, methods: ['PUT'] },
  { pattern: /^me\/player\/repeat$/, methods: ['PUT'] },
];

/** Single path segment: base-62, plus the `-` in `recently-played`. No dots. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

export type PathCheck =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: 'empty' | 'unsafe_segment' | 'too_deep' | 'not_allowed' | 'method_not_allowed' };

/**
 * Validate decoded path segments and the method against the allowlist.
 *
 * Rejects traversal two ways: no segment may contain `.` or `/` (so `..`,
 * `.`, `%2e%2e` once decoded, and encoded slashes are all out), and the
 * resulting path must still match an anchored allowlist pattern.
 */
export function checkProxyPath(segments: readonly string[], method: string): PathCheck {
  if (segments.length === 0) return { ok: false, reason: 'empty' };
  if (segments.length > 6) return { ok: false, reason: 'too_deep' };

  for (const segment of segments) {
    if (segment.length === 0 || segment.length > 128) return { ok: false, reason: 'unsafe_segment' };
    if (!SAFE_SEGMENT.test(segment)) return { ok: false, reason: 'unsafe_segment' };
  }

  const path = segments.join('/');
  const matched = RULES.filter((rule) => rule.pattern.test(path));
  if (matched.length === 0) return { ok: false, reason: 'not_allowed' };

  const upper = method.toUpperCase();
  if (!isHttpMethod(upper)) return { ok: false, reason: 'method_not_allowed' };
  if (!matched.some((rule) => rule.methods.includes(upper))) {
    return { ok: false, reason: 'method_not_allowed' };
  }

  return { ok: true, path };
}

export function isHttpMethod(value: string): value is HttpMethod {
  return value === 'GET' || value === 'POST' || value === 'PUT' || value === 'DELETE';
}

export const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

/**
 * Turn an absolute Spotify pagination `next` URL into a path + query we can
 * feed back through the proxy. Returns null if it is not a well-formed
 * `https://api.spotify.com/v1/...` URL, which is the only thing we follow.
 */
export function proxyPathFromSpotifyUrl(next: string): { path: string; query: Record<string, string> } | null {
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'api.spotify.com') return null;
  if (!url.pathname.startsWith('/v1/')) return null;

  const path = url.pathname.slice('/v1/'.length).replace(/\/+$/, '');
  if (path === '') return null;

  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) query[key] = value;
  return { path, query };
}
