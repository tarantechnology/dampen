/**
 * POST /api/spotify/logout
 *
 * Clears every cookie this feature sets. POST-only on purpose: a GET logout is
 * trivially triggered by a third-party `<img src>` and would let any page sign
 * the user out.
 *
 * Note this only drops *our* session. It does not revoke the grant at Spotify
 * (the Web API has no revocation endpoint); the user does that at
 * https://www.spotify.com/account/apps/.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { ALL_COOKIES, clearCookies, isSecureRequest } from '@/lib/spotify/server/cookies';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearCookies(response.cookies, ALL_COOKIES, isSecureRequest(request));
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'method_not_allowed', message: 'Use POST to log out.' },
    { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store, max-age=0' } },
  );
}
