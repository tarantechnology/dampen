'use client';

/**
 * React bindings for auth, library, playlist contents and search.
 *
 * Signatures are fixed by docs/API_CONTRACT.md. A couple of extra, optional
 * fields are returned beyond the contract (`premiumStatus`, `error` on
 * search) — additive only, nothing renamed or removed.
 *
 * All four hooks read module-level stores from `./store.ts`, so mounting them
 * in five different components costs one set of requests, and unmounting a
 * view does not throw its data away.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import * as api from './client';
import { describeError } from './errors';
import { resetPlayback } from './sdk-controller';
import {
  authStore,
  EMPTY_PLAYLIST_ENTRY,
  LIBRARY_KEYS,
  libraryStore,
  loadAuth,
  loadLibrary,
  loadPlaylistTracks,
  playlistTracksStore,
  premiumStatusOf,
  resetToAnonymous,
  searchCache,
  wireUnauthorizedHandler,
  type PremiumStatus,
} from './store';
import type { AuthStatus, SearchResults, SpotifyArtist, SpotifyPlaylist, SpotifyTrack, SpotifyUser } from './types';

/** How long to sit on a keystroke before asking Spotify. */
const SEARCH_DEBOUNCE_MS = 250;

const EMPTY_RESULTS: SearchResults = { tracks: [], artists: [], playlists: [], albums: [] };

/* ------------------------------------------------------------------ *
 * useAuth
 * ------------------------------------------------------------------ */

export interface UseAuthResult {
  status: AuthStatus;
  user: SpotifyUser | null;
  isPremium: boolean;
  login(): void;
  logout(): void;
  /**
   * Additive. `isPremium` is a boolean because the contract says so, but the
   * honest answer has three values: since February 2026 `GET /me` omits
   * `product` for newly registered client IDs, so `'unknown'` means "we could
   * not find out from the API" — not "free". `usePlayback` still attempts the
   * SDK when it is `'unknown'`, and flips this to `'premium'` or `'free'` once
   * the SDK reports back.
   */
  premiumStatus: PremiumStatus;
  /** Additive. Non-null only when `status === 'error'`. */
  error: string | null;
}

export function useAuth(): UseAuthResult {
  const state = useStore(authStore);

  useEffect(() => {
    wireUnauthorizedHandler();
    void loadAuth();
  }, []);

  const login = useCallback((): void => {
    if (typeof window === 'undefined') return;
    // A real document navigation, not `router.push`. `/api/spotify/login`
    // answers with a 302 to accounts.spotify.com, which the Next router cannot
    // follow — it has to leave the app entirely. Built as an absolute URL so
    // it is unambiguously an external-style navigation.
    const target = new URL('/api/spotify/login', window.location.origin);
    window.location.href = target.toString();
  }, []);

  const logout = useCallback((): void => {
    // Contract returns void, so this is fire-and-forget. The local state is
    // cleared immediately; the cookie clear is confirmed asynchronously.
    resetPlayback();
    resetToAnonymous();
    void api.logout();
  }, []);

  const premiumStatus = premiumStatusOf(state);

  return {
    status: state.status,
    user: state.user,
    isPremium: premiumStatus === 'premium',
    premiumStatus,
    error: state.error,
    login,
    logout,
  };
}

/* ------------------------------------------------------------------ *
 * useLibrary
 * ------------------------------------------------------------------ */

export interface UseLibraryResult {
  playlists: SpotifyPlaylist[];
  savedTracks: SpotifyTrack[];
  recentlyPlayed: SpotifyTrack[];
  topTracks: SpotifyTrack[];
  topArtists: SpotifyArtist[];
  isLoading: boolean;
  error: string | null;
  refresh(): void;
  /**
   * Additive. Per-collection errors, so a sidebar can mark just the one
   * section that failed instead of showing a single global banner.
   */
  errors: Readonly<Record<(typeof LIBRARY_KEYS)[number], string | null>>;
}

/**
 * All five collections load in parallel and land independently, so the UI can
 * render playlists while top-artists is still in flight. A collection that
 * fails sets only its own error — `/me/top/*` returning 403 on a fresh account
 * must not blank the playlists that loaded fine.
 */
export function useLibrary(): UseLibraryResult {
  const authStatus = useStore(authStore, (state) => state.status);
  const library = useStore(libraryStore);

  useEffect(() => {
    wireUnauthorizedHandler();
    void loadAuth();
  }, []);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    void loadLibrary();
  }, [authStatus]);

  const refresh = useCallback((): void => {
    void loadLibrary(true);
  }, []);

  const isLoading = useMemo(
    () => LIBRARY_KEYS.some((key) => library.loading[key]),
    [library.loading],
  );

  // One representative message for the simple case. Collections that loaded
  // are still returned in full alongside it.
  const error = useMemo(() => {
    for (const key of LIBRARY_KEYS) {
      const message = library.errors[key];
      if (message !== null) return message;
    }
    return null;
  }, [library.errors]);

  return {
    playlists: library.playlists,
    savedTracks: library.savedTracks,
    recentlyPlayed: library.recentlyPlayed,
    topTracks: library.topTracks,
    topArtists: library.topArtists,
    isLoading,
    error,
    errors: library.errors,
    refresh,
  };
}

/* ------------------------------------------------------------------ *
 * usePlaylistTracks
 * ------------------------------------------------------------------ */

export interface UsePlaylistTracksResult {
  tracks: SpotifyTrack[];
  isLoading: boolean;
  error: string | null;
}

export function usePlaylistTracks(playlistId: string | null): UsePlaylistTracksResult {
  // Selecting the cached entry object by key: its identity only changes when
  // that playlist's data changes, so this will not loop.
  const entry = useStore(playlistTracksStore, (state) =>
    playlistId === null ? EMPTY_PLAYLIST_ENTRY : state.byId[playlistId] ?? EMPTY_PLAYLIST_ENTRY,
  );

  useEffect(() => {
    if (playlistId === null || playlistId === '') return;
    void loadPlaylistTracks(playlistId);
  }, [playlistId]);

  return { tracks: entry.tracks, isLoading: entry.isLoading, error: entry.error };
}

/* ------------------------------------------------------------------ *
 * useSearch
 * ------------------------------------------------------------------ */

export interface UseSearchResult {
  results: SearchResults | null;
  isLoading: boolean;
  /** Additive. Non-null when the last attempt failed for a real reason. */
  error: string | null;
}

/**
 * Debounced search with real cancellation.
 *
 * Every keystroke replaces the pending timer and aborts the in-flight request,
 * so only the newest query reaches the network and an older, slower response
 * can never overwrite a newer one. Repeats are served from a small module-level
 * LRU — which matters more now that `/search` is capped at `limit=10` and
 * quota is pooled per developer account.
 */
/** The outcome of the most recent completed search, tagged with its query. */
interface SearchOutcome {
  readonly query: string;
  readonly results: SearchResults;
  readonly error: string | null;
}

export function useSearch(query: string): UseSearchResult {
  const trimmed = query.trim();
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);

  // Derived during render, not written from an effect: whatever we return is a
  // pure function of (query, cache, last outcome). That is what makes
  // `isLoading` correct the instant the query changes, with no intermediate
  // render showing stale hits for a query the user has already edited.
  const cached = trimmed === '' ? undefined : searchCache.peek(trimmed);
  const settled = outcome !== null && outcome.query === trimmed ? outcome : null;

  const results: SearchResults | null = trimmed === '' ? null : (cached ?? settled?.results ?? null);
  const error = settled?.error ?? null;
  const isLoading = trimmed !== '' && cached === undefined && settled === null;

  // Guards a late resolution from a generation the user has moved past.
  const generation = useRef(0);

  useEffect(() => {
    if (trimmed === '') return;
    if (searchCache.peek(trimmed) !== undefined) return;

    generation.current += 1;
    const mine = generation.current;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        const result = await api.search(trimmed, { signal: controller.signal });
        if (controller.signal.aborted || generation.current !== mine) return;

        if (result.ok) {
          searchCache.set(trimmed, result.value);
          setOutcome({ query: trimmed, results: result.value, error: null });
          return;
        }
        if (result.error.kind === 'aborted') return;
        // Show "no results" plus a reason rather than a stuck spinner.
        setOutcome({ query: trimmed, results: EMPTY_RESULTS, error: describeError(result.error) });
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      // Cancels the real request, so a superseded query stops consuming quota
      // and can never land after a newer one.
      controller.abort();
    };
  }, [trimmed]);

  return { results, isLoading, error };
}
