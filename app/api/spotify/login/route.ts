/**
 * GET /api/spotify/login
 *
 * Starts Authorization Code + PKCE. The `code_verifier` and anti-CSRF `state`
 * are generated here and parked in httpOnly cookies, so neither is ever
 * readable by page JavaScript. Then a 302 to Spotify's authorize endpoint.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { AUTHORIZE_URL, readConfig, SPOTIFY_SCOPE_STRING } from '@/lib/spotify/server/config';
import {
  clearCookies,
  COOKIE,
  handshakeCookieOptions,
  isSecureRequest,
  SESSION_COOKIES,
} from '@/lib/spotify/server/cookies';
import { createCodeChallenge, createCodeVerifier, createState } from '@/lib/spotify/server/pkce';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secure = isSecureRequest(request);
  const home = new URL('/', request.nextUrl.origin);

  const configResult = readConfig();
  if (!configResult.ok) {
    // A misconfigured server must not dump its message into a top-level
    // navigation as raw JSON; send the user home with a code the UI can show,
    // and put the detail in the server log where it belongs.
    console.error('[spotify/login] configuration error:', configResult.error.message);
    home.searchParams.set('auth_error', 'configuration');
    return NextResponse.redirect(home, 302);
  }
  const config = configResult.value;

  const verifier = createCodeVerifier();
  const state = createState();
  const challenge = await createCodeChallenge(verifier);

  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', config.redirectUri);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', SPOTIFY_SCOPE_STRING);

  const response = NextResponse.redirect(authorize, 302);

  const options = handshakeCookieOptions(secure);
  response.cookies.set(COOKIE.verifier, verifier, options);
  response.cookies.set(COOKIE.state, state, options);

  // Starting a fresh login invalidates any half-dead session we were holding,
  // so the callback cannot accidentally mix old and new tokens.
  clearCookies(response.cookies, SESSION_COOKIES, secure);

  // Never let a CDN or the browser cache a redirect that carries a one-time
  // challenge — a replay would reuse a verifier we have already discarded.
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}
