/**
 * Server-only Spotify configuration.
 *
 * SERVER ONLY. Nothing in `lib/spotify/server/**` may be imported from a
 * client component — `SPOTIFY_CLIENT_SECRET` is read here. The guard below is
 * belt-and-braces: these modules are only ever imported by route handlers,
 * which Next never bundles for the browser.
 */

import { err, ok, type Result } from '../errors';

if (typeof window !== 'undefined') {
  throw new Error('lib/spotify/server/config.ts was imported into a browser bundle. This must never happen.');
}

/**
 * Exactly the scopes Dampen uses, in the order the setup doc lists them.
 *
 *  - user-read-private / user-read-email  -> GET /me, and required by the SDK
 *  - user-read-playback-state             -> GET /me/player, /devices
 *  - user-modify-playback-state           -> all playback mutations + transfer
 *  - user-read-currently-playing          -> now-playing when no full state
 *  - streaming                            -> Web Playback SDK (Premium only)
 *  - playlist-read-private/-collaborative -> GET /me/playlists
 *  - user-library-read                    -> GET /me/tracks
 *  - user-read-recently-played            -> GET /me/player/recently-played
 *  - user-top-read                        -> GET /me/top/{tracks,artists}
 */
export const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-read-recently-played',
  'user-top-read',
] as const;

export const SPOTIFY_SCOPE_STRING = SPOTIFY_SCOPES.join(' ');

export const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export interface SpotifyConfig {
  readonly clientId: string;
  /**
   * Null when `SPOTIFY_CLIENT_SECRET` is unset. The token exchange then runs
   * as a pure public PKCE client. See `exchangeCode` for how both are handled.
   */
  readonly clientSecret: string | null;
  readonly redirectUri: string;
}

/**
 * Read and validate env. Returns a `Result` rather than throwing so a
 * misconfigured deployment produces a clean 500 with an actionable message
 * instead of an unhandled rejection in a route handler.
 */
export function readConfig(): Result<SpotifyConfig> {
  const clientId = nonEmpty(process.env.SPOTIFY_CLIENT_ID);
  if (clientId === null) {
    return err('unknown', 'SPOTIFY_CLIENT_ID is not set. See docs/SPOTIFY_SETUP.md.', 500);
  }

  const redirectUriRaw = nonEmpty(process.env.SPOTIFY_REDIRECT_URI);
  if (redirectUriRaw === null) {
    return err('unknown', 'SPOTIFY_REDIRECT_URI is not set. See docs/SPOTIFY_SETUP.md.', 500);
  }

  let redirect: URL;
  try {
    redirect = new URL(redirectUriRaw);
  } catch {
    return err('unknown', `SPOTIFY_REDIRECT_URI is not a valid absolute URL: ${redirectUriRaw}`, 500);
  }

  // Spotify requires https for anything that is not an http loopback address,
  // and rejects `localhost` outright. Fail loudly here rather than at the
  // Spotify redirect, where the error is much harder to read.
  const isLoopback = redirect.hostname === '127.0.0.1' || redirect.hostname === '[::1]' || redirect.hostname === '::1';
  if (redirect.hostname === 'localhost') {
    return err(
      'unknown',
      'SPOTIFY_REDIRECT_URI uses `localhost`, which Spotify rejects. Use http://127.0.0.1:3000/api/spotify/callback.',
      500,
    );
  }
  if (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && isLoopback)) {
    return err(
      'unknown',
      'SPOTIFY_REDIRECT_URI must use https, or http with the 127.0.0.1 loopback address.',
      500,
    );
  }

  return ok({
    clientId,
    clientSecret: nonEmpty(process.env.SPOTIFY_CLIENT_SECRET),
    redirectUri: redirect.toString(),
  });
}

function nonEmpty(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** How long before expiry we proactively refresh. */
export const REFRESH_SKEW_MS = 60_000;

/** Hard ceiling on any single call out to Spotify, so a hung socket can't pin a lambda. */
export const UPSTREAM_TIMEOUT_MS = 10_000;
