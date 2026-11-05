/**
 * Token exchange, transparent refresh and session resolution.
 *
 * SERVER ONLY. This is the only module that holds a refresh token.
 *
 * ## Which OAuth flow, and why
 *
 * Authorization Code + PKCE (S256), with the `code_verifier` kept in an
 * httpOnly cookie rather than in the browser. The token exchange is attempted
 * as a *public* client — `client_id` in the body, no `client_secret`, no Basic
 * header — because that is the only form Spotify documents for PKCE, and
 * mixing a secret into a PKCE exchange is reported to produce `invalid_client`.
 *
 * `SPOTIFY_CLIENT_SECRET` is therefore OPTIONAL. If it is set and the public
 * exchange is rejected with a client-authentication error, we retry once as a
 * confidential client (HTTP Basic). That single fallback is what makes the same
 * code work whether the secret is present or absent, and whether the app is
 * registered expecting a public or a confidential client.
 */

import {
  describeError,
  err,
  errorFromThrown,
  ok,
  parseRetryAfterMs,
  type Result,
  type SpotifyError,
} from '../errors';
import { extractApiMessage, num, parseJson, str } from '../guards';
import { readConfig, REFRESH_SKEW_MS, TOKEN_URL, UPSTREAM_TIMEOUT_MS, type SpotifyConfig } from './config';
import {
  clearCookies,
  readSession,
  SESSION_COOKIES,
  writeSession,
  type CookieJar,
  type CookieReader,
  type StoredSession,
} from './cookies';

if (typeof window !== 'undefined') {
  throw new Error('lib/spotify/server/session.ts was imported into a browser bundle. This must never happen.');
}

/* ------------------------------------------------------------------ *
 * The token endpoint
 * ------------------------------------------------------------------ */

interface TokenResponse {
  readonly accessToken: string;
  /** Spotify may omit this on refresh; the caller keeps the existing one. */
  readonly refreshToken: string | null;
  readonly expiresAt: number;
}

/** Spotify OAuth error codes that mean "the grant is dead, re-authorize". */
const DEAD_GRANT_CODES = new Set(['invalid_grant', 'unauthorized_client']);
/** Codes that mean "your client authentication was wrong", worth one retry. */
const CLIENT_AUTH_CODES = new Set(['invalid_client', 'unsupported_grant_type', 'invalid_request']);

type AuthMode = 'public' | 'basic';

async function postToken(
  config: SpotifyConfig,
  params: Record<string, string>,
  mode: AuthMode,
): Promise<Result<TokenResponse>> {
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };

  if (mode === 'basic' && config.clientSecret !== null) {
    headers.Authorization = `Basic ${toBase64(`${config.clientId}:${config.clientSecret}`)}`;
    // RFC 6749 §2.3.1: do not also send client_id in the body when using Basic.
    body.delete('client_id');
  } else {
    body.set('client_id', config.clientId);
  }

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers,
      body: body.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (thrown) {
    return errorFromThrown<TokenResponse>(thrown);
  }

  // Read as text first: the accounts service occasionally answers with an HTML
  // error page, and `response.json()` would throw on it.
  let text: string;
  try {
    text = await response.text();
  } catch {
    return err('malformed', 'Could not read the token response body.', response.status);
  }

  const parsed = parseJson(text);
  const payload: unknown = parsed.ok ? parsed.value : null;

  if (!response.ok) {
    if (response.status === 429) {
      return err('rate_limited', 'Spotify rate-limited the token endpoint.', 429, {
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      });
    }
    const code = str(payload, 'error');
    const message = extractApiMessage(payload) ?? `Token request failed with HTTP ${response.status}.`;
    if (code !== null && DEAD_GRANT_CODES.has(code)) {
      // Since mid-2026 refresh tokens expire 6 months after the original
      // authorization and refreshing does not extend that lifetime, so this is
      // now a routine end-of-life, not an anomaly.
      return err('unauthorized', 'Your Spotify session has expired. Please sign in again.', response.status, {
        code,
      });
    }
    if (code !== null && CLIENT_AUTH_CODES.has(code)) {
      // OUR credentials are wrong, not anything the user did. The detail goes
      // to the server log; the caller gets a generic message so Spotify's
      // client-auth text never lands in a browser response.
      console.error(`[spotify/token] client authentication rejected (${code}): ${message}`);
      return err('server', 'Spotify rejected this app\u2019s credentials. Check SPOTIFY_CLIENT_ID.', response.status, {
        code,
      });
    }
    if (response.status >= 500) return err('server', message, response.status, { code: code ?? undefined });
    return err('bad_request', message, response.status, { code: code ?? undefined });
  }

  if (!parsed.ok) return err('malformed', 'Token endpoint returned a body that is not JSON.', response.status);

  const accessToken = str(payload, 'access_token');
  if (accessToken === null) {
    return err('malformed', 'Token endpoint returned no access_token.', response.status);
  }

  const expiresIn = num(payload, 'expires_in');
  // Spotify sends 3600. If it ever stops, assume a conservative 5 minutes
  // rather than treating the token as immortal.
  const lifetimeMs = expiresIn !== null && expiresIn > 0 ? Math.floor(expiresIn) * 1_000 : 300_000;

  return ok({
    accessToken,
    refreshToken: str(payload, 'refresh_token'),
    expiresAt: Date.now() + lifetimeMs,
  });
}

/** True when the failure specifically looks like bad client authentication. */
function isClientAuthFailure(error: SpotifyError): boolean {
  return error.code !== undefined && CLIENT_AUTH_CODES.has(error.code);
}

/**
 * Run the token request as a public PKCE client, falling back once to Basic
 * auth if a secret is configured and the public attempt was rejected on
 * client-authentication grounds.
 */
async function postTokenWithFallback(
  config: SpotifyConfig,
  params: Record<string, string>,
): Promise<Result<TokenResponse>> {
  const first = await postToken(config, params, 'public');
  if (first.ok) return first;
  if (config.clientSecret === null || !isClientAuthFailure(first.error)) return first;

  const second = await postToken(config, params, 'basic');
  if (second.ok) return second;
  // Report the Basic failure — it is the more specific of the two.
  return second;
}

function toBase64(value: string): string {
  // Node's Buffer is available in the Node runtime; btoa covers the rest.
  // Both are latin1-safe for the ASCII client id/secret pair.
  return typeof Buffer === 'undefined' ? btoa(value) : Buffer.from(value, 'utf8').toString('base64');
}

/* ------------------------------------------------------------------ *
 * Public operations
 * ------------------------------------------------------------------ */

/** `/callback`: swap the authorization code for a session. */
export async function exchangeCode(code: string, verifier: string): Promise<Result<StoredSession>> {
  const configResult = readConfig();
  if (!configResult.ok) return configResult;
  const config = configResult.value;

  const result = await postTokenWithFallback(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });
  if (!result.ok) return result;

  if (result.value.refreshToken === null) {
    return err(
      'malformed',
      'Spotify returned no refresh_token for the authorization code. Check that the app is registered for the Authorization Code flow.',
      502,
    );
  }

  return ok({
    accessToken: result.value.accessToken,
    refreshToken: result.value.refreshToken,
    expiresAt: result.value.expiresAt,
  });
}

/**
 * In-flight refresh de-duplication.
 *
 * The SDK's `getOAuthToken`, a library load and a playback poll can all land
 * in the same instant on an expired token. Without this they would each burn a
 * refresh, and with rotation enabled the losers would be left holding a token
 * Spotify has already retired. Keyed by refresh token so two different users
 * never share an entry.
 */
const inFlightRefresh = new Map<string, Promise<Result<StoredSession>>>();

export async function refreshSession(previous: StoredSession): Promise<Result<StoredSession>> {
  const existing = inFlightRefresh.get(previous.refreshToken);
  if (existing !== undefined) return existing;

  const pending = performRefresh(previous).finally(() => {
    inFlightRefresh.delete(previous.refreshToken);
  });
  inFlightRefresh.set(previous.refreshToken, pending);
  return pending;
}

async function performRefresh(previous: StoredSession): Promise<Result<StoredSession>> {
  const configResult = readConfig();
  if (!configResult.ok) return configResult;

  const result = await postTokenWithFallback(configResult.value, {
    grant_type: 'refresh_token',
    refresh_token: previous.refreshToken,
  });
  if (!result.ok) return result;

  return ok({
    accessToken: result.value.accessToken,
    // Spotify documents that a refresh response may omit refresh_token; when
    // it does, keep using the one we have.
    refreshToken: result.value.refreshToken ?? previous.refreshToken,
    expiresAt: result.value.expiresAt,
  });
}

export interface ResolvedSession {
  readonly accessToken: string;
  readonly expiresAt: number;
  /** True if this call performed a refresh (and therefore rewrote cookies). */
  readonly refreshed: boolean;
}

export type SessionOutcome =
  | { readonly state: 'ok'; readonly session: ResolvedSession }
  /** No session at all, or the refresh token is dead. Cookies have been cleared. */
  | { readonly state: 'unauthenticated'; readonly error: SpotifyError | null }
  /** Transient: offline, 5xx, rate-limited. Cookies left alone. */
  | { readonly state: 'error'; readonly error: SpotifyError };

/**
 * The single entry point every authenticated route uses.
 *
 * Returns a usable access token, refreshing first if it expires within
 * `REFRESH_SKEW_MS`. `force` skips the expiry check — the proxy uses it after a
 * surprise 401, where the stored expiry says "fine" but Spotify disagrees
 * (token revoked from the user's account page, password change, etc.).
 *
 * On a dead grant it clears the session cookies itself, so the caller only has
 * to decide what status to return.
 */
export async function resolveSession(
  reader: CookieReader,
  jar: CookieJar,
  secure: boolean,
  options: { force?: boolean } = {},
): Promise<SessionOutcome> {
  const stored = readSession(reader);
  if (stored === null) return { state: 'unauthenticated', error: null };

  const expiringSoon = stored.expiresAt - Date.now() <= REFRESH_SKEW_MS;
  const needsRefresh = options.force === true || expiringSoon || stored.accessToken === '';

  if (!needsRefresh) {
    return {
      state: 'ok',
      session: { accessToken: stored.accessToken, expiresAt: stored.expiresAt, refreshed: false },
    };
  }

  const refreshed = await refreshSession(stored);
  if (!refreshed.ok) {
    if (refreshed.error.kind === 'unauthorized') {
      clearCookies(jar, SESSION_COOKIES, secure);
      return { state: 'unauthenticated', error: refreshed.error };
    }
    // Transient failure. If the token we still hold has life left, use it
    // rather than logging the user out over a blip.
    if (stored.accessToken !== '' && stored.expiresAt > Date.now()) {
      return {
        state: 'ok',
        session: { accessToken: stored.accessToken, expiresAt: stored.expiresAt, refreshed: false },
      };
    }
    return { state: 'error', error: refreshed.error };
  }

  writeSession(jar, refreshed.value, secure);
  return {
    state: 'ok',
    session: { accessToken: refreshed.value.accessToken, expiresAt: refreshed.value.expiresAt, refreshed: true },
  };
}

/** Shared JSON shape for an auth failure, so the client can key off it. */
export function unauthenticatedBody(error: SpotifyError | null): { error: string; message: string } {
  return {
    error: 'unauthenticated',
    message: error === null ? 'No Spotify session.' : describeError(error),
  };
}
