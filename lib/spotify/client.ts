/**
 * The browser-side Spotify client.
 *
 * Everything goes through `/api/spotify/proxy/...`, so this file never sees a
 * token of any kind. It is responsible for four things:
 *
 *   1. turning HTTP into `Result<T>` (see `./errors.ts`) — nothing throws
 *   2. mapping Spotify's wire shapes to `./types.ts` (see `./map.ts`)
 *   3. following `next` cursors, with a hard cap
 *   4. collapsing concurrent identical GETs into one request
 *
 * It is plain async functions, not React. The hooks in `useSpotify.ts` and
 * `usePlayback.ts` are the only consumers.
 */

import {
  err,
  errorFromThrown,
  kindForStatus,
  ok,
  parseRetryAfterMs,
  QUOTA_EXCEEDED_REASON,
  type Result,
  type SpotifyError,
} from './errors';
import { proxyPathFromSpotifyUrl, type HttpMethod } from './endpoints';
import { extractApiMessage, isRecord, parseJson, str } from './guards';
import {
  mapCursorPage,
  mapDevices,
  mapPage,
  mapPlaybackState,
  mapPlaylist,
  mapRecentlyPlayedRow,
  mapSearchResults,
  mapTrack,
  mapTrackRowWithAddedAt,
  mapUser,
  type Page,
  type RepeatMode,
} from './map';
import type {
  PlaybackState,
  SearchResults,
  SpotifyArtist,
  SpotifyDevice,
  SpotifyPlaylist,
  SpotifyTrack,
  SpotifyUser,
} from './types';
import { mapArtist } from './map';

const PROXY_BASE = '/api/spotify/proxy';

export type QueryValue = string | number | boolean | undefined | null;
export type Query = Readonly<Record<string, QueryValue>>;

export interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly query?: Query;
}

/* ------------------------------------------------------------------ *
 * 401 notification
 * ------------------------------------------------------------------ *
 * A single place for "the session is gone". `useSpotify` subscribes so one
 * failed request anywhere flips the whole app to anonymous, instead of every
 * hook discovering it independently.
 */

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function notifyUnauthorized(): void {
  for (const listener of [...unauthorizedListeners]) {
    try {
      listener();
    } catch (thrown) {
      console.error('[spotify] onUnauthorized listener threw:', thrown);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Low-level request
 * ------------------------------------------------------------------ */

function buildUrl(path: string, query: Query | undefined): string {
  const url = `${PROXY_BASE}/${path.replace(/^\/+/, '')}`;
  if (query === undefined) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const serialised = search.toString();
  return serialised === '' ? url : `${url}?${serialised}`;
}

/** Stable key for de-duplication: query params sorted so order can't split the cache. */
function requestKey(method: HttpMethod, path: string, query: Query | undefined): string {
  if (query === undefined) return `${method} ${path}`;
  const pairs = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort();
  return `${method} ${path}?${pairs.join('&')}`;
}

/**
 * Classify a non-2xx proxy response. Spotify's status codes come through the
 * proxy unchanged, so this is Spotify's semantics, not ours.
 */
function classify(status: number, body: unknown, headers: Headers): SpotifyError {
  const message = extractApiMessage(body) ?? `Spotify returned HTTP ${status}.`;
  // Our own route handlers put a machine-readable code in `error`; Spotify's
  // own envelope nests the prose under `error.message`. `str` only matches the
  // former (a string value), which is exactly what we want here.
  const code = str(body, 'error') ?? undefined;

  if (status === 429) {
    // Since July 2026 a quota breach and a rate-limit breach are both 429 but
    // need different handling: backing off does not refill a spent quota.
    const reason = str(body, 'reason');
    const retryAfterMs = retryAfterFromHeaders(headers);
    if (reason === QUOTA_EXCEEDED_REASON) {
      return { kind: 'quota_exceeded', status, message, retryAfterMs, code };
    }
    return { kind: 'rate_limited', status, message, retryAfterMs, code };
  }

  if (status === 403) {
    // Spotify answers 403 for free accounts on playback endpoints, with
    // messages like "Player command failed: Premium required".
    if (/premium/i.test(message)) return { kind: 'premium_required', status, message, code };
    return { kind: 'forbidden', status, message, code };
  }

  return { kind: kindForStatus(status), status, message, code };
}

function retryAfterFromHeaders(headers: Headers): number {
  const explicit = headers.get('x-dampen-retry-after-ms');
  if (explicit !== null) {
    const parsed = Number.parseInt(explicit, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.min(300_000, parsed);
  }
  return parseRetryAfterMs(headers.get('retry-after'));
}

interface RawResponse {
  readonly status: number;
  /** Parsed JSON, or null for 204 / empty bodies. */
  readonly body: unknown;
  readonly headers: Headers;
}

async function rawRequest(
  method: HttpMethod,
  path: string,
  query: Query | undefined,
  jsonBody: unknown,
  signal: AbortSignal | undefined,
): Promise<Result<RawResponse>> {
  // Cheap pre-flight: the browser already knows it has no network. Saves a
  // guaranteed-failing request and gives a precise error instead of a
  // generic TypeError.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return err('offline', 'You appear to be offline.');
  }

  const init: RequestInit = {
    method,
    // Session cookies are httpOnly and same-origin; this is what sends them.
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  };

  if (jsonBody !== undefined) {
    init.body = JSON.stringify(jsonBody);
    init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), init);
  } catch (thrown) {
    return errorFromThrown<RawResponse>(thrown);
  }

  // 204 is normal: every playback mutation answers with it.
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return ok({ status: response.status, body: null, headers: response.headers });
  }

  let text: string;
  try {
    text = await response.text();
  } catch (thrown) {
    // An abort during body read surfaces here, not at fetch().
    const classified = errorFromThrown<RawResponse>(thrown);
    if (!classified.ok && classified.error.kind === 'aborted') return classified;
    return err('malformed', 'Could not read the response body.', response.status);
  }

  const parsed = parseJson(text);
  if (!parsed.ok) {
    // Malformed JSON on a failure is still a failure — report the status.
    if (!response.ok) {
      return { ok: false, error: classify(response.status, text, response.headers) };
    }
    return err('malformed', 'Spotify returned a body that is not valid JSON.', response.status);
  }

  if (!response.ok) {
    const error = classify(response.status, parsed.value, response.headers);
    if (error.kind === 'unauthorized') notifyUnauthorized();
    return { ok: false, error };
  }

  return ok({ status: response.status, body: parsed.value, headers: response.headers });
}

/* ------------------------------------------------------------------ *
 * De-duplication
 * ------------------------------------------------------------------ */

/**
 * In-flight GETs, keyed by method+path+query.
 *
 * Only GETs without a caller `AbortSignal` are shared: if a shared request
 * carried one caller's signal, that caller aborting would cancel it for
 * everyone. Callers that pass a signal (search) get a private request and real
 * cancellation. Callers that don't (library loads, device refreshes) get
 * collapsing, which is what matters when three components mount at once.
 */
const inFlight = new Map<string, Promise<Result<RawResponse>>>();

function dedupedGet(path: string, query: Query | undefined): Promise<Result<RawResponse>> {
  const key = requestKey('GET', path, query);
  const existing = inFlight.get(key);
  if (existing !== undefined) return existing;

  const pending = rawRequest('GET', path, query, undefined, undefined).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

async function get(path: string, options: RequestOptions = {}): Promise<Result<RawResponse>> {
  if (options.signal !== undefined) {
    if (options.signal.aborted) return err('aborted', 'Request cancelled.');
    return rawRequest('GET', path, options.query, undefined, options.signal);
  }
  return dedupedGet(path, options.query);
}

/** For mutations: 204 and 200 both mean success, and there is nothing to map. */
async function mutate(
  method: Exclude<HttpMethod, 'GET'>,
  path: string,
  options: { query?: Query; body?: unknown; signal?: AbortSignal } = {},
): Promise<Result<void>> {
  const result = await rawRequest(method, path, options.query, options.body, options.signal);
  return result.ok ? ok(undefined) : result;
}

/** Map a successful raw body, turning an unusable shape into a `malformed` error. */
function mapped<T>(raw: Result<RawResponse>, map: (body: unknown) => T | null, what: string): Result<T> {
  if (!raw.ok) return raw;
  const value = map(raw.value.body);
  if (value === null) return err('malformed', `Could not read ${what} from Spotify's response.`, raw.value.status);
  return ok(value);
}

/* ------------------------------------------------------------------ *
 * Pagination
 * ------------------------------------------------------------------ */

export interface PaginationLimits {
  /** Hard stop on requests, so a runaway `next` chain cannot loop forever. */
  readonly maxPages?: number;
  /** Hard stop on rows, to keep a 10k-track library from blowing out memory. */
  readonly maxItems?: number;
  readonly signal?: AbortSignal;
}

export interface Collected<T> {
  readonly items: T[];
  /** True when a cap stopped us before Spotify ran out of pages. */
  readonly truncated: boolean;
  readonly total: number | null;
}

const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_ITEMS = 1_000;

/**
 * Follow `next` cursors from a paging endpoint.
 *
 * Spotify's `next` is an absolute `https://api.spotify.com/v1/...` URL, which
 * we re-point at the proxy via `proxyPathFromSpotifyUrl`. That function
 * rejects anything that is not exactly that host and prefix, so a tampered or
 * surprising `next` cannot redirect our authenticated proxy somewhere else;
 * the proxy allowlist is the second gate.
 *
 * Partial results are *kept*: if page 4 of 7 fails we return the first three
 * pages with `truncated: true` rather than discarding everything. Only a
 * failure on the very first page is an error.
 */
export async function collectPages<T>(
  path: string,
  query: Query,
  mapItem: (item: unknown) => T | null,
  limits: PaginationLimits = {},
): Promise<Result<Collected<T>>> {
  const maxPages = Math.max(1, limits.maxPages ?? DEFAULT_MAX_PAGES);
  const maxItems = Math.max(1, limits.maxItems ?? DEFAULT_MAX_ITEMS);

  const items: T[] = [];
  let total: number | null = null;
  let nextPath: string = path;
  let nextQuery: Query | undefined = query;
  let pages = 0;
  let truncated = false;

  while (pages < maxPages) {
    const raw = await get(nextPath, { query: nextQuery, signal: limits.signal });
    if (!raw.ok) {
      if (pages === 0) return raw;
      // Keep what we have; the UI shows a short list rather than nothing.
      return ok({ items: items.slice(0, maxItems), truncated: true, total });
    }
    pages += 1;

    const page: Page<T> = mapPage(raw.value.body, mapItem);
    if (total === null) total = page.total;
    items.push(...page.items);

    if (items.length >= maxItems) {
      truncated = page.next !== null || items.length > maxItems;
      break;
    }
    if (page.next === null) break;

    const followed = proxyPathFromSpotifyUrl(page.next);
    if (followed === null) {
      // Unrecognised `next`. Stop rather than guess.
      truncated = true;
      break;
    }
    nextPath = followed.path;
    nextQuery = followed.query;

    if (pages >= maxPages) truncated = true;
  }

  return ok({ items: items.slice(0, maxItems), truncated, total });
}

/* ------------------------------------------------------------------ *
 * Profile
 * ------------------------------------------------------------------ */

/**
 * `GET /me`.
 *
 * Heads-up for callers: for client IDs registered on or after 2026-02-11,
 * Spotify no longer returns `product`, `email`, `country` or `followers` on
 * this endpoint. `user.product` will be `null` there, which is *not* the same
 * as "free" — see `isPremiumKnown` in `useSpotify.ts`.
 */
export async function getMe(options: RequestOptions = {}): Promise<Result<SpotifyUser>> {
  return mapped(await get('me', options), mapUser, 'your profile');
}

/* ------------------------------------------------------------------ *
 * Library
 * ------------------------------------------------------------------ */

export async function getMyPlaylists(limits: PaginationLimits = {}): Promise<Result<SpotifyPlaylist[]>> {
  const collected = await collectPages('me/playlists', { limit: 50 }, mapPlaylist, {
    maxPages: 8,
    maxItems: 400,
    ...limits,
  });
  return collected.ok ? ok(collected.value.items) : collected;
}

/**
 * Playlist contents.
 *
 * The February 2026 API changes renamed `GET /playlists/{id}/tracks` to
 * `GET /playlists/{id}/items` and removed the old path for client IDs created
 * from 2026-02-11 (it now 403s), while apps registered earlier still use
 * `/tracks`. There is no way to know which applies from the client, so: try
 * `/items`, fall back to `/tracks` on a 403/404, and remember which one worked
 * so the fallback is paid at most once per page load.
 *
 * The row key changed too (`item` vs `track`) — `mapTrackRowWithAddedAt`
 * accepts either.
 */
type PlaylistVariant = 'items' | 'tracks';
let playlistVariant: PlaylistVariant | null = null;

export async function getPlaylistTracks(
  playlistId: string,
  limits: PaginationLimits = {},
): Promise<Result<SpotifyTrack[]>> {
  if (playlistId.trim() === '') return err('bad_request', 'No playlist id given.');

  const order: PlaylistVariant[] = playlistVariant === null ? ['items', 'tracks'] : [playlistVariant];

  let lastError: SpotifyError | null = null;
  for (const variant of order) {
    const collected = await collectPages(
      `playlists/${playlistId}/${variant}`,
      { limit: 50 },
      mapTrackRowWithAddedAt,
      { maxPages: 20, maxItems: 1_000, ...limits },
    );
    if (collected.ok) {
      playlistVariant = variant;
      return ok(collected.value.items);
    }
    lastError = collected.error;
    // Only the endpoint-shape errors are worth retrying on the other path.
    if (collected.error.kind !== 'forbidden' && collected.error.kind !== 'not_found') break;
  }

  return { ok: false, error: lastError ?? { kind: 'unknown', status: null, message: 'Playlist request failed.' } };
}

export async function getSavedTracks(limits: PaginationLimits = {}): Promise<Result<SpotifyTrack[]>> {
  const collected = await collectPages('me/tracks', { limit: 50 }, mapTrackRowWithAddedAt, {
    maxPages: 10,
    maxItems: 500,
    ...limits,
  });
  return collected.ok ? ok(collected.value.items) : collected;
}

/**
 * `GET /me/player/recently-played` is cursor-paged and caps at 50 rows total,
 * so there is nothing to follow — one request is the whole answer.
 */
export async function getRecentlyPlayed(options: RequestOptions = {}): Promise<Result<SpotifyTrack[]>> {
  const raw = await get('me/player/recently-played', { ...options, query: { limit: 50, ...options.query } });
  if (!raw.ok) return raw;
  return ok(mapCursorPage(raw.value.body, mapRecentlyPlayedRow).items);
}

export type TopTimeRange = 'short_term' | 'medium_term' | 'long_term';

export async function getTopTracks(
  timeRange: TopTimeRange = 'medium_term',
  options: RequestOptions = {},
): Promise<Result<SpotifyTrack[]>> {
  const raw = await get('me/top/tracks', { ...options, query: { limit: 50, time_range: timeRange } });
  if (!raw.ok) return raw;
  return ok(mapPage(raw.value.body, mapTrack).items);
}

export async function getTopArtists(
  timeRange: TopTimeRange = 'medium_term',
  options: RequestOptions = {},
): Promise<Result<SpotifyArtist[]>> {
  const raw = await get('me/top/artists', { ...options, query: { limit: 50, time_range: timeRange } });
  if (!raw.ok) return raw;
  return ok(mapPage(raw.value.body, mapArtist).items);
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/**
 * Spotify reduced `/search`'s `limit` maximum from 50 to 10 (and its default
 * from 20 to 5) in the February 2026 changes. Asking for more is a 400, so the
 * cap is enforced here rather than discovered at runtime.
 */
export const SEARCH_LIMIT_MAX = 10;

export async function search(
  query: string,
  options: { limit?: number; signal?: AbortSignal; market?: string } = {},
): Promise<Result<SearchResults>> {
  const trimmed = query.trim();
  if (trimmed === '') {
    return ok({ tracks: [], artists: [], playlists: [], albums: [] });
  }

  const raw = await get('search', {
    signal: options.signal,
    query: {
      q: trimmed,
      type: 'track,artist,playlist,album',
      limit: Math.min(SEARCH_LIMIT_MAX, Math.max(1, options.limit ?? SEARCH_LIMIT_MAX)),
      // `from_token` resolves to the authenticated user's market, which keeps
      // unplayable results out of the list.
      market: options.market ?? 'from_token',
    },
  });
  if (!raw.ok) return raw;
  // `mapSearchResults` always returns a full object, so no null case.
  return ok(mapSearchResults(raw.value.body));
}

/* ------------------------------------------------------------------ *
 * Playback: read
 * ------------------------------------------------------------------ */

/**
 * `GET /me/player`. Answers **204 No Content** when nothing is playing
 * anywhere, which is a success, not an error — hence `PlaybackState | null`.
 */
export async function getPlaybackState(options: RequestOptions = {}): Promise<Result<PlaybackState | null>> {
  const raw = await get('me/player', { ...options, query: { additional_types: 'track,episode' } });
  if (!raw.ok) return raw;
  if (raw.value.status === 204 || raw.value.body === null) return ok(null);
  const state = mapPlaybackState(raw.value.body);
  // A 200 whose body we can't read is malformed; a 204 is just "nothing on".
  if (state === null) return err('malformed', 'Could not read the playback state.', raw.value.status);
  return ok(state);
}

export async function getDevices(options: RequestOptions = {}): Promise<Result<SpotifyDevice[]>> {
  const raw = await get('me/player/devices', options);
  if (!raw.ok) return raw;
  if (raw.value.body === null) return ok([]);
  return ok(mapDevices(raw.value.body));
}

/* ------------------------------------------------------------------ *
 * Playback: mutate
 * ------------------------------------------------------------------ */

export interface PlayOptions {
  /** Explicit track URIs. Mutually exclusive with `contextUri`. */
  readonly uris?: readonly string[];
  /** A playlist/album/artist URI to play from. */
  readonly contextUri?: string;
  /** Zero-based index into the context. Ignored without a context. */
  readonly offset?: number;
  /** Start this many ms in. */
  readonly positionMs?: number;
  /** Target device. Omit to use whatever is active. */
  readonly deviceId?: string;
}

/**
 * `PUT /me/player/play`.
 *
 * Calling it with no body resumes whatever is loaded, which is what `toggle`
 * wants. With `uris` or `contextUri` it starts something new. Sending both at
 * once is a 400 from Spotify, so `uris` wins and `contextUri` is dropped.
 */
export async function play(options: PlayOptions = {}): Promise<Result<void>> {
  const body: Record<string, unknown> = {};

  if (options.uris !== undefined && options.uris.length > 0) {
    body.uris = [...options.uris];
  } else if (options.contextUri !== undefined && options.contextUri !== '') {
    body.context_uri = options.contextUri;
    if (options.offset !== undefined && Number.isFinite(options.offset) && options.offset >= 0) {
      body.offset = { position: Math.floor(options.offset) };
    }
  }

  if (options.positionMs !== undefined && Number.isFinite(options.positionMs) && options.positionMs >= 0) {
    body.position_ms = Math.floor(options.positionMs);
  }

  return mutate('PUT', 'me/player/play', {
    query: deviceQuery(options.deviceId),
    // An empty object body means "resume"; sending `undefined` would send no
    // Content-Type and Spotify is happier with the explicit `{}`.
    body,
  });
}

export async function pause(deviceId?: string): Promise<Result<void>> {
  return mutate('PUT', 'me/player/pause', { query: deviceQuery(deviceId) });
}

export async function skipNext(deviceId?: string): Promise<Result<void>> {
  return mutate('POST', 'me/player/next', { query: deviceQuery(deviceId) });
}

export async function skipPrevious(deviceId?: string): Promise<Result<void>> {
  return mutate('POST', 'me/player/previous', { query: deviceQuery(deviceId) });
}

export async function seek(positionMs: number, deviceId?: string): Promise<Result<void>> {
  if (!Number.isFinite(positionMs) || positionMs < 0) {
    return err('bad_request', 'Seek position must be a non-negative number of milliseconds.');
  }
  return mutate('PUT', 'me/player/seek', {
    query: { position_ms: Math.floor(positionMs), ...deviceQuery(deviceId) },
  });
}

/** `volume` is 0..1 here; Spotify wants an integer percent. */
export async function setVolume(volume: number, deviceId?: string): Promise<Result<void>> {
  if (!Number.isFinite(volume)) return err('bad_request', 'Volume must be a number between 0 and 1.');
  const percent = Math.round(Math.min(1, Math.max(0, volume)) * 100);
  return mutate('PUT', 'me/player/volume', {
    query: { volume_percent: percent, ...deviceQuery(deviceId) },
  });
}

export async function setShuffle(on: boolean, deviceId?: string): Promise<Result<void>> {
  return mutate('PUT', 'me/player/shuffle', { query: { state: on, ...deviceQuery(deviceId) } });
}

export async function setRepeat(mode: RepeatMode, deviceId?: string): Promise<Result<void>> {
  return mutate('PUT', 'me/player/repeat', { query: { state: mode, ...deviceQuery(deviceId) } });
}

/**
 * `PUT /me/player` — move playback to another device.
 *
 * `play: true` keeps audio going across the handover; `false` lands paused.
 * Spotify documents `device_ids` as an array but only honours the first entry.
 */
export async function transferPlayback(deviceId: string, play = true): Promise<Result<void>> {
  if (deviceId.trim() === '') return err('bad_request', 'No device id given.');
  return mutate('PUT', 'me/player', { body: { device_ids: [deviceId], play } });
}

function deviceQuery(deviceId: string | undefined): Query {
  return deviceId === undefined || deviceId === '' ? {} : { device_id: deviceId };
}

/* ------------------------------------------------------------------ *
 * Token (for the Web Playback SDK)
 * ------------------------------------------------------------------ */

export interface AccessToken {
  readonly accessToken: string;
  /** ms since epoch. */
  readonly expiresAt: number;
}

/**
 * `GET /api/spotify/token`. The only endpoint outside the proxy the browser
 * calls, and the only place an access token enters client memory. 401 here
 * means "re-login", and is broadcast to `onUnauthorized` subscribers.
 */
export async function fetchAccessToken(signal?: AbortSignal): Promise<Result<AccessToken>> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return err('offline', 'You appear to be offline.');
  }

  let response: Response;
  try {
    response = await fetch('/api/spotify/token', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (thrown) {
    return errorFromThrown<AccessToken>(thrown);
  }

  let body: unknown = null;
  try {
    const parsed = parseJson(await response.text());
    body = parsed.ok ? parsed.value : null;
  } catch {
    body = null;
  }

  if (response.status === 401) {
    notifyUnauthorized();
    return err('unauthorized', extractApiMessage(body) ?? 'Not signed in to Spotify.', 401);
  }
  if (!response.ok) {
    return { ok: false, error: classify(response.status, body, response.headers) };
  }

  if (!isRecord(body)) return err('malformed', 'Token endpoint returned an unexpected body.', response.status);
  const accessToken = str(body, 'accessToken');
  const expiresAtRaw = body.expiresAt;
  const expiresAt = typeof expiresAtRaw === 'number' && Number.isFinite(expiresAtRaw) ? expiresAtRaw : 0;
  if (accessToken === null) return err('malformed', 'Token endpoint returned no accessToken.', response.status);

  return ok({ accessToken, expiresAt });
}

/** POST /api/spotify/logout. Resolves even if the request fails — logout is best-effort. */
export async function logout(): Promise<Result<void>> {
  try {
    const response = await fetch('/api/spotify/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return err('unknown', `Logout failed with HTTP ${response.status}.`, response.status);
    return ok(undefined);
  } catch (thrown) {
    return errorFromThrown<void>(thrown);
  }
}
