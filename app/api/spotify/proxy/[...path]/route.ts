/**
 * ALL /api/spotify/proxy/[...path]  ->  https://api.spotify.com/v1/<path>
 *
 * An authenticated passthrough. The browser never holds a refresh token, and
 * never holds an access token for Web API calls either — it just calls this.
 *
 * Because this route attaches the user's bearer token server-side, an
 * unrestricted version would be an open, authenticated proxy onto the whole
 * Spotify API for anyone who can reach the page. Two defences:
 *
 *   1. Path segments must be `[A-Za-z0-9_-]+` — no dots, no slashes, so `..`,
 *      `%2e%2e` and encoded separators are rejected before anything is joined.
 *   2. The joined path + method must match an anchored allowlist of the exact
 *      endpoints `lib/spotify/client.ts` calls (see `lib/spotify/endpoints.ts`).
 *
 * It also: refreshes-and-retries once on a 401, surfaces 429 `Retry-After`
 * verbatim, returns Spotify's status codes unchanged, and passes 204 through
 * without trying to parse a body (several player endpoints answer 204).
 */

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { describeError, parseRetryAfterMs } from '@/lib/spotify/errors';
import { checkProxyPath, SPOTIFY_API_BASE } from '@/lib/spotify/endpoints';
import { isSecureRequest } from '@/lib/spotify/server/cookies';
import { UPSTREAM_TIMEOUT_MS } from '@/lib/spotify/server/config';
import { resolveSession, unauthenticatedBody } from '@/lib/spotify/server/session';

interface RouteParams {
  readonly params: Promise<{ readonly path?: string[] }>;
}

const NO_STORE = 'no-store, max-age=0';

/** Player mutations send tiny JSON bodies; anything larger is not ours. */
const MAX_BODY_BYTES = 64 * 1024;

/** Query strings we forward are short (`limit`, `offset`, `q`, `market`, `ids`). */
const MAX_QUERY_CHARS = 2_048;

async function handle(request: NextRequest, context: RouteParams): Promise<NextResponse> {
  const resolved = await context.params;
  const segments = resolved.path ?? [];

  const check = checkProxyPath(segments, request.method);
  if (!check.ok) {
    // Deliberately uniform: don't tell a prober which rule it tripped.
    const status = check.reason === 'method_not_allowed' ? 405 : 404;
    return json({ error: 'not_proxyable', message: 'That Spotify endpoint is not proxied by this app.' }, status);
  }

  const search = request.nextUrl.search;
  if (search.length > MAX_QUERY_CHARS) {
    return json({ error: 'bad_request', message: 'Query string too long.' }, 400);
  }

  // Read the body once, up front, so the 401 retry can replay it.
  const bodyResult = await readBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;

  const secure = isSecureRequest(request);
  const jar = await cookies();

  const first = await resolveSession(request.cookies, jar, secure);
  if (first.state === 'unauthenticated') {
    return json(unauthenticatedBody(first.error), 401);
  }
  if (first.state === 'error') {
    return json(
      { error: 'upstream', message: describeError(first.error) },
      first.error.kind === 'rate_limited' ? 429 : 503,
    );
  }

  const target = `${SPOTIFY_API_BASE}/${check.path}${search}`;

  let upstream = await callSpotify(target, request.method, first.session.accessToken, body);
  if (upstream === null) {
    return json({ error: 'offline', message: 'Could not reach Spotify.' }, 502);
  }

  // A 401 here means the token was rejected despite our expiry bookkeeping —
  // revoked grant, password change, or clock skew. Force one refresh and retry
  // exactly once. Never loop.
  if (upstream.status === 401) {
    const retryAuth = await resolveSession(request.cookies, jar, secure, { force: true });
    if (retryAuth.state === 'unauthenticated') {
      return json(unauthenticatedBody(retryAuth.error), 401);
    }
    if (retryAuth.state === 'error') {
      return json({ error: 'upstream', message: describeError(retryAuth.error) }, 503);
    }
    const second = await callSpotify(target, request.method, retryAuth.session.accessToken, body);
    if (second === null) {
      return json({ error: 'offline', message: 'Could not reach Spotify.' }, 502);
    }
    upstream = second;
  }

  return await relay(upstream);
}

type BodyResult =
  | { readonly ok: true; readonly body: string | null }
  | { readonly ok: false; readonly response: NextResponse };

async function readBody(request: NextRequest): Promise<BodyResult> {
  if (request.method === 'GET' || request.method === 'HEAD') return { ok: true, body: null };

  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number.parseInt(declared, 10);
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return { ok: false, response: json({ error: 'bad_request', message: 'Request body too large.' }, 413) };
    }
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: json({ error: 'bad_request', message: 'Could not read request body.' }, 400) };
  }

  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, response: json({ error: 'bad_request', message: 'Request body too large.' }, 413) };
  }
  return { ok: true, body: text === '' ? null : text };
}

/**
 * One call out to Spotify. Returns null only when `fetch` itself failed
 * (offline / DNS / timeout) — every HTTP status, including 4xx and 5xx, comes
 * back as a Response for faithful relay.
 *
 * Note which headers are forwarded: none of the client's. Only our
 * Authorization, Accept and (when there is a body) Content-Type. The incoming
 * Cookie header in particular must never reach api.spotify.com.
 */
async function callSpotify(
  target: string,
  method: string,
  accessToken: string,
  body: string | null,
): Promise<Response | null> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  if (body !== null) headers['Content-Type'] = 'application/json';

  try {
    return await fetch(target, {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (thrown) {
    console.error('[spotify/proxy] upstream fetch failed:', thrown instanceof Error ? thrown.message : thrown);
    return null;
  }
}

/**
 * Relay Spotify's response. Status is passed through unchanged so the client's
 * error classification is Spotify's, not ours.
 */
async function relay(upstream: Response): Promise<NextResponse> {
  const headers = new Headers({ 'Cache-Control': NO_STORE });

  // 429 is the one header value the client genuinely needs.
  const retryAfter = upstream.headers.get('retry-after');
  if (upstream.status === 429) {
    headers.set('Retry-After', retryAfter ?? '1');
    // Also expose it in ms, because `Retry-After` is not readable from a
    // cross-origin fetch in every browser configuration and the client should
    // not have to guess.
    headers.set('X-Dampen-Retry-After-Ms', String(parseRetryAfterMs(retryAfter)));
  }

  // 204 (pause/play/seek/volume/shuffle/repeat/transfer all answer 204) and
  // 304 must not carry a body at all — constructing one throws in undici.
  if (upstream.status === 204 || upstream.status === 304 || upstream.status === 205) {
    return new NextResponse(null, { status: upstream.status, headers });
  }

  let text: string;
  try {
    text = await upstream.text();
  } catch {
    return json({ error: 'malformed', message: 'Spotify sent an unreadable response body.' }, 502);
  }

  if (text === '') {
    // Some Spotify 200s have an empty body. Give the client valid JSON rather
    // than letting `response.json()` blow up.
    headers.set('Content-Type', 'application/json');
    return new NextResponse('null', { status: upstream.status, headers });
  }

  const contentType = upstream.headers.get('content-type');
  headers.set('Content-Type', contentType ?? 'application/json');
  return new NextResponse(text, { status: upstream.status, headers });
}

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE } });
}

export async function GET(request: NextRequest, context: RouteParams): Promise<NextResponse> {
  return handle(request, context);
}
export async function POST(request: NextRequest, context: RouteParams): Promise<NextResponse> {
  return handle(request, context);
}
export async function PUT(request: NextRequest, context: RouteParams): Promise<NextResponse> {
  return handle(request, context);
}
export async function DELETE(request: NextRequest, context: RouteParams): Promise<NextResponse> {
  return handle(request, context);
}
