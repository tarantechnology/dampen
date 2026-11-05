/**
 * GET /api/spotify/token
 *
 * The *only* thing that crosses to the browser: a short-lived access token for
 * the Web Playback SDK's `getOAuthToken` callback.
 *
 *   200 -> { accessToken, expiresAt }
 *   401 -> { error: 'unauthenticated', message }   (cookies cleared; re-login)
 *   503 -> { error: 'upstream', message }          (transient; retry)
 *
 * The refresh token is never in the response. Refreshing happens here,
 * transparently, when the stored token expires within 60 s.
 */

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { describeError } from '@/lib/spotify/errors';
import { clearCookies, isSecureRequest, SESSION_COOKIES } from '@/lib/spotify/server/cookies';
import { resolveSession, unauthenticatedBody } from '@/lib/spotify/server/session';

export interface TokenResponseBody {
  readonly accessToken: string;
  /** ms since epoch. */
  readonly expiresAt: number;
}

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secure = isSecureRequest(request);
  const jar = await cookies();

  const outcome = await resolveSession(request.cookies, jar, secure);

  if (outcome.state === 'unauthenticated') {
    // `resolveSession` already cleared cookies on a dead grant; do it again for
    // the "no session at all" case so a stale partial cookie set cannot linger.
    clearCookies(jar, SESSION_COOKIES, secure);
    return NextResponse.json(unauthenticatedBody(outcome.error), { status: 401, headers: NO_STORE });
  }

  if (outcome.state === 'error') {
    return NextResponse.json(
      { error: 'upstream', message: describeError(outcome.error) },
      { status: outcome.error.kind === 'rate_limited' ? 429 : 503, headers: NO_STORE },
    );
  }

  const body: TokenResponseBody = {
    accessToken: outcome.session.accessToken,
    expiresAt: outcome.session.expiresAt,
  };
  return NextResponse.json(body, { status: 200, headers: NO_STORE });
}
