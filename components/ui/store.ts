'use client';

import { create } from 'zustand';

/**
 * UI store — the thin seam between Dampen's client islands.
 *
 * `app/page.tsx` is a Server Component that renders three *separate* client
 * islands: the library, the player and the dampen console. Each island calls
 * its own hooks, so a 20 Hz meter tick or a dial drag inside the console can
 * never re-render the track list.
 *
 * Anything genuinely cross-island goes through here, and always via a
 * selector so a subscriber only wakes for the slice it asked for:
 *
 *  - `amount` / `bypass`  — mirrored out of the engine purely so the ambient
 *    backdrop and the accent ramp can follow the dial. `AccentDriver`
 *    subscribes *imperatively* (store.subscribe) and writes CSS variables, so
 *    the whole app recolours with zero React renders.
 *  - `actions`            — a registry the islands fill in on mount. The
 *    global keyboard layer reads it with `getState()`, never subscribes, and
 *    therefore never re-renders.
 */

export type LibraryView = 'playlists' | 'liked' | 'recent' | 'top' | 'search';

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
  shortcutsOpen: boolean;
  setShortcutsOpen(open: boolean): void;

  /* mirrored engine state, for ambience + accent only */
  amount: number;
  bypass: boolean;
  publishDampen(next: { amount?: number; bypass?: boolean }): void;

  /* mirrored now-playing artwork, for the backdrop */
  artworkUrl: string | null;
  setArtworkUrl(url: string | null): void;

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
    set((s) => ({ view: 'search', searchFocusNonce: s.searchFocusNonce + 1 })),

  selectedPlaylistId: null,
  selectPlaylist: (selectedPlaylistId) => set({ selectedPlaylistId }),

  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  amount: 0,
  bypass: false,
  publishDampen: (next) => set((s) => ({ amount: next.amount ?? s.amount, bypass: next.bypass ?? s.bypass })),

  artworkUrl: null,
  setArtworkUrl: (artworkUrl) => set({ artworkUrl }),

  actions: {},
  registerActions: (next) => set((s) => ({ actions: { ...s.actions, ...next } })),
}));

/** Non-reactive read, for event handlers that must not subscribe. */
export const getActions = (): AppActions => useUIStore.getState().actions;
