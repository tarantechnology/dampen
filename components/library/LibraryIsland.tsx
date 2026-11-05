'use client';

import { useCallback, useMemo } from 'react';
import { useAuth, useLibrary, usePlaylistTracks, useSearch } from '@/lib/spotify/useSpotify';
import type { SpotifyTrack } from '@/lib/spotify/types';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { getActions, useUIStore } from '@/components/ui/store';
import { PlaylistGrid } from './PlaylistGrid';
import { SearchResults } from './SearchResults';
import { Sidebar } from './Sidebar';
import { TrackList } from './TrackList';

/**
 * The library island.
 *
 * Takes no playback subscription: it plays things through the store's action
 * registry, which is read with `getState()` inside the handler. That is the
 * whole reason dragging the dampen dial — or a 20 Hz meter tick, or the
 * seek bar advancing — cannot re-render a two-thousand-row track list.
 */
export function LibraryIsland() {
  const auth = useAuth();
  const library = useLibrary();

  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const query = useUIStore((s) => s.query);
  const setQuery = useUIStore((s) => s.setQuery);
  const focusNonce = useUIStore((s) => s.searchFocusNonce);
  const selectedPlaylistId = useUIStore((s) => s.selectedPlaylistId);
  const selectPlaylist = useUIStore((s) => s.selectPlaylist);

  const currentUri = useUIStore((s) => s.currentUri);
  const isPlaying = useUIStore((s) => s.isPlaying);

  const playlistTracks = usePlaylistTracks(view === 'playlists' ? selectedPlaylistId : null);
  const search = useSearch(view === 'search' ? query : '');

  const playTracks = useCallback((tracks: SpotifyTrack[], index: number) => {
    getActions().playTrack?.(tracks.slice(index).map((t) => t.uri));
  }, []);

  const openPlaylist = useCallback(
    (id: string) => {
      setView('playlists');
      selectPlaylist(id);
    },
    [selectPlaylist, setView],
  );

  const openPlaylistContext = useCallback((uri: string) => {
    getActions().playTrack?.([], uri, 0);
  }, []);

  const counts = useMemo(
    () => ({
      playlists: library.playlists.length || undefined,
      liked: library.savedTracks.length || undefined,
      recent: library.recentlyPlayed.length || undefined,
      top: library.topTracks.length || undefined,
    }),
    [library],
  );

  const openPlaylistId = selectedPlaylistId;
  const openPlaylistMeta = library.playlists.find((p) => p.id === openPlaylistId) ?? null;

  return (
    <Sidebar
      className="order-5 min-h-[420px] xl:col-start-1 xl:row-start-2 xl:row-span-2 xl:min-h-0"
      view={view}
      onViewChange={(next) => {
        setView(next);
        if (next !== 'playlists') selectPlaylist(null);
      }}
      query={query}
      onQueryChange={(q) => {
        setQuery(q);
        if (q.length > 0) setView('search');
      }}
      focusNonce={focusNonce}
      user={auth.user}
      authStatus={auth.status}
      onLogin={auth.login}
      onLogout={auth.logout}
      counts={counts}
    >
      <ScrollArea className="p-2.5">
        {view === 'playlists' ? (
          openPlaylistId ? (
            <div className="flex h-full flex-col">
              <button
                type="button"
                onClick={() => selectPlaylist(null)}
                className="mb-2 self-start rounded-lg px-1.5 py-1 text-[11.5px] text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink"
              >
                &larr; All playlists
              </button>
              <h3 className="mb-2 truncate px-1.5 text-[13px] font-semibold text-ink">
                {openPlaylistMeta?.name ?? 'Playlist'}
              </h3>
              <TrackList
                label={openPlaylistMeta?.name ?? 'Playlist tracks'}
                tracks={playlistTracks.tracks}
                isLoading={playlistTracks.isLoading}
                currentUri={currentUri}
                isPlaying={isPlaying}
                onPlay={(_, index) => playTracks(playlistTracks.tracks, index)}
                meta="album"
                emptyTitle="This playlist is empty"
                emptyBody="Add something to it in Spotify and it will show up here."
                className="min-h-[360px] flex-1"
              />
            </div>
          ) : (
            <PlaylistGrid
              label="Your playlists"
              playlists={library.playlists}
              isLoading={library.isLoading}
              selectedId={selectedPlaylistId}
              onOpen={openPlaylist}
              onPlay={openPlaylistContext}
            />
          )
        ) : null}

        {view === 'liked' ? (
          <TrackList
            label="Liked songs"
            tracks={library.savedTracks}
            isLoading={library.isLoading}
            currentUri={currentUri}
            isPlaying={isPlaying}
            onPlay={(_, index) => playTracks(library.savedTracks, index)}
            meta="added"
            emptyTitle="No liked songs"
            emptyBody="Hit the heart on anything in Spotify and it lands here."
            className="min-h-[420px]"
          />
        ) : null}

        {view === 'recent' ? (
          <TrackList
            label="Recently played"
            tracks={library.recentlyPlayed}
            isLoading={library.isLoading}
            currentUri={currentUri}
            isPlaying={isPlaying}
            onPlay={(_, index) => playTracks(library.recentlyPlayed, index)}
            meta="played"
            emptyTitle="Nothing played yet"
            emptyBody="Spotify keeps the last fifty tracks you listened to. Play something and come back."
            className="min-h-[420px]"
          />
        ) : null}

        {view === 'top' ? (
          <TrackList
            label="Top tracks"
            tracks={library.topTracks}
            isLoading={library.isLoading}
            currentUri={currentUri}
            isPlaying={isPlaying}
            onPlay={(_, index) => playTracks(library.topTracks, index)}
            meta="album"
            emptyTitle="No top tracks yet"
            emptyBody="Spotify needs a few weeks of listening before it will rank anything."
            className="min-h-[420px]"
          />
        ) : null}

        {view === 'search' ? (
          <SearchResults
            query={query}
            results={search.results}
            isLoading={search.isLoading}
            currentUri={currentUri}
            isPlaying={isPlaying}
            onPlayTrack={(_, index) => playTracks(search.results?.tracks ?? [], index)}
            onOpenPlaylist={openPlaylist}
            onOpenArtist={(artist) => {
              setQuery(artist.name);
              setView('search');
            }}
          />
        ) : null}

        {library.error ? (
          <p className="mt-3 px-1.5 text-[11.5px] text-ink-4">
            Could not reach Spotify: {library.error}{' '}
            <button
              type="button"
              onClick={library.refresh}
              className="underline decoration-ink-4 underline-offset-2 hover:text-ink"
            >
              Retry
            </button>
          </p>
        ) : null}
      </ScrollArea>
    </Sidebar>
  );
}
