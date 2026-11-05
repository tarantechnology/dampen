/**
 * GET /api/spotify/callback
 *
 * Spotify redirects the browser here. Three things have to happen, in order:
 *   1. verify `state` against the cookie (CSRF), constant-time
 *   2. exchange the code for tokens using the stored `code_verifier`
 *   3. set the session cookies, burn the handshake cookies, 302 back to `/`
 *
 * Every failure path ends in a redirect to `/?auth_error=<code>`. This handler
 * never renders an error body — the user is mid-navigation and would just see
 * raw JSON.
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  clearCookies,
  COOKIE,
  HANDSHAKE_COOKIES,
  isSecureRequest,
  writeSession,
} from '@/lib/spotify/server/cookies';
import { timingSafeEqual } from '@/lib/spotify/server/pkce';
import { exchangeCode } from '@/lib/spotify/server/session';

/** Codes the UI can switch on. Kept short and stable. */
type AuthErrorCode =
  | 'access_denied'
  | 'spotify_error'
  | 'missing_code'
  | 'state_mismatch'
  | 'session_expired'
  | 'exchange_failed'
  | 'configuration';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secure = isSecureRequest(request);
  const params = request.nextUrl.searchParams;

  const fail = (code: AuthErrorCode): NextResponse => {
    const home = new URL('/', request.nextUrl.origin);
    home.searchParams.set('auth_error', code);
    const response = NextResponse.redirect(home, 302);
    // Always burn the handshake cookies; a verifier is single-use whether or
    // not the exchange worked.
    clearCookies(response.cookies, HANDSHAKE_COOKIES, secure);
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    return response;
  };

  // 1. Spotify's own error path. `access_denied` is the user pressing Cancel on
  //    the consent screen — entirely routine, and must not look like a crash.
  const spotifyError = params.get('error');
  if (spotifyError !== null && spotifyError !== '') {
    return fail(spotifyError === 'access_denied' ? 'access_denied' : 'spotify_error');
  }

  const code = params.get('code');
  if (code === null || code === '') return fail('missing_code');

  // 2. CSRF. A missing cookie is as fatal as a mismatched one: it means this
  //    callback did not originate from a /login we issued (or it took longer
  //    than the 10-minute handshake window).
  const expectedState = request.cookies.get(COOKIE.state)?.value;
  const receivedState = params.get('state');
  if (
    expectedState === undefined ||
    expectedState === '' ||
    receivedState === null ||
    !timingSafeEqual(expectedState, receivedState)
  ) {
    return fail('state_mismatch');
  }

  const verifier = request.cookies.get(COOKIE.verifier)?.value;
  if (verifier === undefined || verifier === '') return fail('session_expired');

  // 3. Exchange.
  const exchanged = await exchangeCode(code, verifier);
  if (!exchanged.ok) {
    console.error('[spotify/callback] token exchange failed:', exchanged.error.kind, exchanged.error.message);
    return fail(exchanged.error.status === 500 ? 'configuration' : 'exchange_failed');
  }

  const home = new URL('/', request.nextUrl.origin);
  const response = NextResponse.redirect(home, 302);
  writeSession(response.cookies, exchanged.value, secure);
  clearCookies(response.cookies, HANDSHAKE_COOKIES, secure);
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}

/**
 * The callback is a GET-only navigation target. Declaring the others keeps
 * Next from auto-implementing an OPTIONS that advertises more than exists.
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'GET' } });
}
