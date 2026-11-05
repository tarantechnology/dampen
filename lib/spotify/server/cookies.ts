/**
 * Cookie names, options and the read/write/clear helpers.
 *
 * SERVER ONLY. Every cookie here is httpOnly: the browser can neither read nor
 * write any of them from JavaScript. The only token that ever crosses to the
 * client is the short-lived access token, handed out by `GET /api/spotify/token`
 * as a JSON body — never as a cookie the page can read.
 */

import type { NextRequest } from 'next/server';

if (typeof window !== 'undefined') {
  throw new Error('lib/spotify/server/cookies.ts was imported into a browser bundle. This must never happen.');
}

export const COOKIE = {
  accessToken: 'dampen_sp_at',
  refreshToken: 'dampen_sp_rt',
  /** ms-since-epoch, as a decimal string. */
  expiresAt: 'dampen_sp_exp',
  /** PKCE code_verifier, only alive between /login and /callback. */
  verifier: 'dampen_sp_pkce',
  /** Anti-CSRF state, only alive between /login and /callback. */
  state: 'dampen_sp_state',
} as const;

export const SESSION_COOKIES: readonly string[] = [COOKIE.accessToken, COOKIE.refreshToken, COOKIE.expiresAt];
export const HANDSHAKE_COOKIES: readonly string[] = [COOKIE.verifier, COOKIE.state];
export const ALL_COOKIES: readonly string[] = [...SESSION_COOKIES, ...HANDSHAKE_COOKIES];

/** The authorize round-trip should take seconds; give it ten minutes. */
const HANDSHAKE_MAX_AGE_S = 600;

/**
 * Since June/July 2026 Spotify refresh tokens expire 6 months after the
 * *original* authorization, and refreshing does not extend that. Matching the
 * cookie lifetime to it means a stale session self-clears instead of sitting
 * there failing. Slightly under 6 months so the cookie dies first.
 */
const SESSION_MAX_AGE_S = 175 * 24 * 60 * 60;

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge?: number;
}

/**
 * Minimal structural interface satisfied by both `ResponseCookies` (from
 * `NextResponse`) and the awaited `cookies()` store, so the session code can
 * write to either without caring which.
 */
export interface CookieJar {
  set(name: string, value: string, options: CookieOptions): unknown;
  delete(name: string): unknown;
}

/**
 * `Secure` cookies are only sent over https. In production that is exactly
 * what we want. On `http://127.0.0.1` it is a liability: Chrome and Firefox
 * treat loopback as a trustworthy origin and accept Secure cookies there, but
 * Safari historically does not, and silently dropping the session cookie in
 * dev is a miserable bug to chase. So: Secure whenever the request is https,
 * off only for a plaintext loopback request.
 *
 * `sameSite=lax` (not strict) is required — the OAuth callback is a top-level
 * cross-site GET navigation from accounts.spotify.com, and `strict` would mean
 * the verifier/state cookies are not sent with it.
 */
export function isSecureRequest(request: NextRequest): boolean {
  const url = request.nextUrl;
  if (url.protocol === 'https:') return true;
  // Honour a proxy terminating TLS in front of us (Vercel, nginx).
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto !== null && forwardedProto.split(',')[0]?.trim() === 'https') return true;
  return false;
}

export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE_S };
}

export function handshakeCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: HANDSHAKE_MAX_AGE_S };
}

/** Expire a cookie explicitly as well as deleting it, for stubborn clients. */
export function clearCookies(jar: CookieJar, names: readonly string[], secure: boolean): void {
  for (const name of names) {
    jar.set(name, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 });
  }
}

export interface StoredSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** ms since epoch. */
  readonly expiresAt: number;
}

/** Anything that can read request cookies: `NextRequest['cookies']` or the `cookies()` store. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/**
 * Read the session. Returns null when it is not usable — which includes
 * "access token present but refresh token missing", because such a session
 * cannot be renewed and would 401 a minute later anyway.
 */
export function readSession(reader: CookieReader): StoredSession | null {
  const refreshToken = reader.get(COOKIE.refreshToken)?.value;
  if (refreshToken === undefined || refreshToken === '') return null;

  const accessToken = reader.get(COOKIE.accessToken)?.value ?? '';
  const expiresRaw = reader.get(COOKIE.expiresAt)?.value ?? '';
  const parsed = Number.parseInt(expiresRaw, 10);
  // A missing/garbled expiry is treated as "expired", not as "valid forever".
  const expiresAt = Number.isFinite(parsed) ? parsed : 0;

  return { accessToken, refreshToken, expiresAt };
}

export function writeSession(
  jar: CookieJar,
  session: StoredSession,
  secure: boolean,
): void {
  const options = sessionCookieOptions(secure);
  jar.set(COOKIE.accessToken, session.accessToken, options);
  jar.set(COOKIE.refreshToken, session.refreshToken, options);
  jar.set(COOKIE.expiresAt, String(session.expiresAt), options);
}
