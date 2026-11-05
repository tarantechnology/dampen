/**
 * Module-level caches for auth, library and search.
 *
 * These are vanilla zustand stores created at module scope, so they outlive
 * every component. That is the point: switching from Playlists to Saved Tracks
 * and back must not refetch. React reads them through `useStore`.
 *
 * Shapes are deliberately *flat*. zustand v5 on React 19 will spin forever if
 * a selector builds a new object each render, so every field here is either a
 * primitive or a reference that only changes when its contents actually do.
 */

import { createStore } from 'zustand/vanilla';

import * as api from './client';
import { describeError } from './errors';
import type { AuthStatus, SearchResults, SpotifyArtist, SpotifyPlaylist, SpotifyTrack, SpotifyUser } from './types';

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

/**
 * What we actually know about the subscription tier.
 *
 * `GET /me` stopped returning `product` for client IDs registered on or after
 * 2026-02-11, and Spotify published no replacement. So a null `product` means
 * "withheld", not "free" — and the only remaining way to find out is to try
 * the Web Playback SDK and see whether it raises `account_error`. The SDK
 * controller writes its verdict back here.
 */
export type PremiumStatus = 'premium' | 'free' | 'unknown';

export interface AuthStoreState {
  readonly status: AuthStatus;
  readonly user: SpotifyUser | null;
  readonly error: string | null;
  /** True once a `/me` attempt has resolved, successfully or not. */
  readonly settled: boolean;
  /** Set by the Web Playback SDK once it either connects or reports account_error. */
  readonly sdkVerdict: PremiumStatus;
}

export const authStore = createStore<AuthStoreState>(() => ({
  status: 'loading',
  user: null,
  error: null,
  settled: false,
  sdkVerdict: 'unknown',
}));

/** Combine what `/me` said with what the SDK proved. */
export function premiumStatusOf(state: AuthStoreState): PremiumStatus {
  const product = state.user?.product ?? null;
  if (product === 'premium') return 'premium';
  // `free` and `open` are both non-Premium tiers.
  if (product === 'free' || product === 'open') return 'free';
  return state.sdkVerdict;
}

/** Called by the SDK controller. Never downgrades a known-good `/me` answer. */
export function recordSdkVerdict(verdict: PremiumStatus): void {
  if (authStore.getState().sdkVerdict === verdict) return;
  authStore.setState({ sdkVerdict: verdict });
}

let authLoad: Promise<void> | null = null;

/**
 * Resolve the session by asking for the profile. One in-flight attempt at a
 * time; later callers join the existing promise.
 */
export function loadAuth(force = false): Promise<void> {
  if (!force && authStore.getState().settled) return Promise.resolve();
  if (authLoad !== null) return authLoad;

  authLoad = (async () => {
    const result = await api.getMe();
    if (result.ok) {
      authStore.setState({ status: 'authed', user: result.value, error: null, settled: true });
      return;
    }
    // 401 is the normal "not signed in yet" case, not an error state.
    if (result.error.kind === 'unauthorized') {
      authStore.setState({ status: 'anon', user: null, error: null, settled: true, sdkVerdict: 'unknown' });
      return;
    }
    authStore.setState({
      status: 'error',
      user: null,
      error: describeError(result.error),
      settled: true,
    });
  })().finally(() => {
    authLoad = null;
  });

  return authLoad;
}

/** Called by `client.onUnauthorized` and by `logout()`. Wipes every cache. */
export function resetToAnonymous(): void {
  authStore.setState({ status: 'anon', user: null, error: null, settled: true, sdkVerdict: 'unknown' });
  clearLibrary();
  clearPlaylistTracks();
  searchCache.clear();
}

/* ------------------------------------------------------------------ *
 * Library
 * ------------------------------------------------------------------ */

export const LIBRARY_KEYS = ['playlists', 'savedTracks', 'recentlyPlayed', 'topTracks', 'topArtists'] as const;
export type LibraryKey = (typeof LIBRARY_KEYS)[number];

type LoadingFlags = Readonly<Record<LibraryKey, boolean>>;
type ErrorFlags = Readonly<Record<LibraryKey, string | null>>;

export interface LibraryStoreState {
  readonly playlists: SpotifyPlaylist[];
  readonly savedTracks: SpotifyTrack[];
  readonly recentlyPlayed: SpotifyTrack[];
  readonly topTracks: SpotifyTrack[];
  readonly topArtists: SpotifyArtist[];
  readonly loading: LoadingFlags;
  readonly errors: ErrorFlags;
  /** ms since epoch of the last completed load, or null if never loaded. */
  readonly loadedAt: number | null;
}

const NO_LOADING: LoadingFlags = {
  playlists: false,
  savedTracks: false,
  recentlyPlayed: false,
  topTracks: false,
  topArtists: false,
};

const NO_ERRORS: ErrorFlags = {
  playlists: null,
  savedTracks: null,
  recentlyPlayed: null,
  topTracks: null,
  topArtists: null,
};

const EMPTY_LIBRARY: LibraryStoreState = {
  playlists: [],
  savedTracks: [],
  recentlyPlayed: [],
  topTracks: [],
  topArtists: [],
  loading: NO_LOADING,
  errors: NO_ERRORS,
  loadedAt: null,
};

export const libraryStore = createStore<LibraryStoreState>(() => EMPTY_LIBRARY);

export function clearLibrary(): void {
  libraryStore.setState(EMPTY_LIBRARY, true);
}

/** Treat a load older than this as stale when a component remounts. */
const LIBRARY_TTL_MS = 5 * 60_000;

let libraryLoad: Promise<void> | null = null;

/**
 * Load all five collections **in parallel**, writing each into the store the
 * moment it lands rather than waiting for the slowest. A collection that fails
 * records its own error and leaves the other four alone — one dead endpoint
 * (e.g. `/me/top/*` on a brand-new account, which can 403) must never blank
 * the library.
 */
export function loadLibrary(force = false): Promise<void> {
  const state = libraryStore.getState();
  const fresh = state.loadedAt !== null && Date.now() - state.loadedAt < LIBRARY_TTL_MS;
  if (!force && fresh) return Promise.resolve();
  if (libraryLoad !== null) return libraryLoad;

  libraryStore.setState({
    loading: {
      playlists: true,
      savedTracks: true,
      recentlyPlayed: true,
      topTracks: true,
      topArtists: true,
    },
    errors: NO_ERRORS,
  });

  libraryLoad = (async () => {
    await Promise.all([
      settle('playlists', api.getMyPlaylists(), (value) => ({ playlists: value })),
      settle('savedTracks', api.getSavedTracks(), (value) => ({ savedTracks: value })),
      settle('recentlyPlayed', api.getRecentlyPlayed(), (value) => ({ recentlyPlayed: value })),
      settle('topTracks', api.getTopTracks(), (value) => ({ topTracks: value })),
      settle('topArtists', api.getTopArtists(), (value) => ({ topArtists: value })),
    ]);
    libraryStore.setState({ loadedAt: Date.now() });
  })().finally(() => {
    libraryLoad = null;
  });

  return libraryLoad;
}

async function settle<T>(
  key: LibraryKey,
  pending: Promise<import('./errors').Result<T>>,
  write: (value: T) => Partial<LibraryStoreState>,
): Promise<void> {
  const result = await pending;
  libraryStore.setState((current) => {
    const loading: LoadingFlags = { ...current.loading, [key]: false };
    if (result.ok) {
      return { ...write(result.value), loading, errors: { ...current.errors, [key]: null } };
    }
    // Aborts are not user-visible failures.
    const message = result.error.kind === 'aborted' ? null : describeError(result.error);
    return { loading, errors: { ...current.errors, [key]: message } };
  });
}

/* ------------------------------------------------------------------ *
 * Playlist tracks
 * ------------------------------------------------------------------ */

export interface PlaylistTracksEntry {
  readonly tracks: SpotifyTrack[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly loadedAt: number | null;
}

export interface PlaylistTracksStoreState {
  readonly byId: Readonly<Record<string, PlaylistTracksEntry>>;
}

export const playlistTracksStore = createStore<PlaylistTracksStoreState>(() => ({ byId: {} }));

export const EMPTY_PLAYLIST_ENTRY: PlaylistTracksEntry = {
  tracks: [],
  isLoading: false,
  error: null,
  loadedAt: null,
};

export function clearPlaylistTracks(): void {
  playlistTracksStore.setState({ byId: {} }, true);
}

const playlistLoads = new Map<string, Promise<void>>();

export function loadPlaylistTracks(playlistId: string, force = false): Promise<void> {
  const existing = playlistTracksStore.getState().byId[playlistId];
  if (!force && existing !== undefined && existing.loadedAt !== null) return Promise.resolve();

  const inFlight = playlistLoads.get(playlistId);
  if (inFlight !== undefined) return inFlight;

  patchPlaylist(playlistId, { isLoading: true, error: null });

  const pending = (async () => {
    const result = await api.getPlaylistTracks(playlistId);
    if (result.ok) {
      patchPlaylist(playlistId, {
        tracks: result.value,
        isLoading: false,
        error: null,
        loadedAt: Date.now(),
      });
      return;
    }
    patchPlaylist(playlistId, {
      isLoading: false,
      error: result.error.kind === 'aborted' ? null : describeError(result.error),
    });
  })().finally(() => {
    playlistLoads.delete(playlistId);
  });

  playlistLoads.set(playlistId, pending);
  return pending;
}

function patchPlaylist(playlistId: string, patch: Partial<PlaylistTracksEntry>): void {
  playlistTracksStore.setState((current) => {
    const previous = current.byId[playlistId] ?? EMPTY_PLAYLIST_ENTRY;
    return { byId: { ...current.byId, [playlistId]: { ...previous, ...patch } } };
  });
}

/* ------------------------------------------------------------------ *
 * Search cache
 * ------------------------------------------------------------------ */

/**
 * Tiny LRU keyed by the trimmed, lower-cased query. Typing "radiohead", then
 * backspacing to "radio", then retyping should not re-hit the network — and
 * since Spotify's search quota is now shared per developer account, repeat
 * requests are worth avoiding.
 */
class SearchCache {
  private readonly entries = new Map<string, SearchResults>();
  private readonly limit = 32;

  /** Read and promote to most-recent. Not safe to call during render. */
  get(query: string): SearchResults | undefined {
    const key = query.trim().toLowerCase();
    const hit = this.entries.get(key);
    if (hit === undefined) return undefined;
    // Touch for recency.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  /**
   * Read without reordering. `useSearch` derives its return value during
   * render, and a render must not mutate shared state — even LRU recency.
   */
  peek(query: string): SearchResults | undefined {
    return this.entries.get(query.trim().toLowerCase());
  }

  set(query: string, results: SearchResults): void {
    const key = query.trim().toLowerCase();
    if (key === '') return;
    this.entries.delete(key);
    this.entries.set(key, results);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export const searchCache = new SearchCache();

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

let unauthorizedWired = false;

/**
 * Subscribe the stores to the client's 401 broadcast, exactly once. Called
 * from the hooks rather than at import time so this module stays inert if it
 * is ever pulled into a server bundle.
 */
export function wireUnauthorizedHandler(): void {
  if (unauthorizedWired) return;
  unauthorizedWired = true;
  api.onUnauthorized(() => {
    if (authStore.getState().status !== 'anon') resetToAnonymous();
  });
}
