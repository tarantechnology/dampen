'use client';

import { create } from 'zustand';

/**
 * UI store — the thin seam between Dampen's client islands.
 *
 * `app/page.tsx` is a Server Component that renders separate client islands:
 * the library, the player and the engine. Each calls its own hooks, so a
 * 20 Hz meter tick or a drag on the Dampen control can never re-render a
 * two-thousand-row track list.
 *
 * Anything genuinely cross-island goes through here, always via a selector so
 * a subscriber only wakes for the slice it asked for. `AccentDriver`
 * subscribes *imperatively* and writes CSS custom properties, so recolouring
 * the whole app costs zero React renders.
 */

export type LibraryView = 'playlists' | 'liked' | 'recent' | 'top' | 'search';

export type ThemePreference = 'system' | 'light' | 'dark';

/** Filled in by whichever island owns the capability. */
export interface AppActions {
  togglePlay?(): void;
  next?(): void;
  previous?(): void;
  seekBy?(ms: number): void;
  toggleMute?(): void;
  nudgeAmount?(delta: number): void;
  toggleBypass?(): void;
  selectPresetIndex?(index: number): void;
  /**
   * Registered by the player island. The library calls it through the registry
   * rather than taking its own `usePlayback()` subscription — one island owns
   * playback, so a position tick can never re-render a track list.
   */
  playTrack?(uris: string[], contextUri?: string, offset?: number): void;
}

interface UIState {
  /* library navigation */
  view: LibraryView;
  setView(view: LibraryView): void;

  query: string;
  setQuery(query: string): void;
  /** Bumped by the `/` shortcut; the search input focuses on change. */
  searchFocusNonce: number;
  focusSearch(): void;

  selectedPlaylistId: string | null;
  selectPlaylist(id: string | null): void;

  /* overlays */
  settingsOpen: boolean;
  setSettingsOpen(open: boolean): void;
  /** The sidebar as a sheet, below the two-column breakpoint. */
  libraryOpen: boolean;
  setLibraryOpen(open: boolean): void;
  shortcutsOpen: boolean;
  setShortcutsOpen(open: boolean): void;

  /* appearance */
  theme: ThemePreference;
  setTheme(theme: ThemePreference): void;

  /* mirrored engine state, for the artwork filter only */
  amount: number;
  bypass: boolean;
  publishDampen(next: { amount?: number; bypass?: boolean }): void;

  /* mirrored now-playing, for the accent and the library's row states */
  artworkUrl: string | null;
  /** Seeds the accent when there is no cover image. Usually "Album Artist". */
  accentSeed: string;
  currentUri: string | null;
  isPlaying: boolean;
  publishPlayback(next: {
    artworkUrl?: string | null;
    accentSeed?: string;
    currentUri?: string | null;
    isPlaying?: boolean;
  }): void;

  /* cross-island command registry */
  actions: AppActions;
  registerActions(next: AppActions): void;
}

export const useUIStore = create<UIState>()((set) => ({
  view: 'playlists',
  setView: (view) => set({ view }),

  query: '',
  setQuery: (query) => set({ query }),
  searchFocusNonce: 0,
  focusSearch: () =>
    set((s) => ({
      view: 'search',
      libraryOpen: true,
      searchFocusNonce: s.searchFocusNonce + 1,
    })),

  selectedPlaylistId: null,
  selectPlaylist: (selectedPlaylistId) => set({ selectedPlaylistId }),

  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  libraryOpen: false,
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  theme: 'system',
  setTheme: (theme) => set({ theme }),

  amount: 0,
  bypass: false,
  publishDampen: (next) =>
    set((s) => ({ amount: next.amount ?? s.amount, bypass: next.bypass ?? s.bypass })),

  artworkUrl: null,
  accentSeed: '',
  currentUri: null,
  isPlaying: false,
  publishPlayback: (next) =>
    set((s) => ({
      artworkUrl: next.artworkUrl === undefined ? s.artworkUrl : next.artworkUrl,
      accentSeed: next.accentSeed ?? s.accentSeed,
      currentUri: next.currentUri === undefined ? s.currentUri : next.currentUri,
      isPlaying: next.isPlaying ?? s.isPlaying,
    })),

  actions: {},
  registerActions: (next) => set((s) => ({ actions: { ...s.actions, ...next } })),
}));

/** Non-reactive read, for event handlers that must not subscribe. */
export const getActions = (): AppActions => useUIStore.getState().actions;
