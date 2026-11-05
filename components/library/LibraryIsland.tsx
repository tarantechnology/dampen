'use client';

import { useCallback } from 'react';
import { useAuth, useLibrary, usePlaylistTracks, useSearch } from '@/lib/spotify/useSpotify';
import type { SpotifyTrack } from '@/lib/spotify/types';
import { getActions, useUIStore } from '@/components/ui/store';
import { PlaylistList } from './PlaylistList';
import { SearchResults } from './SearchResults';
import { Sidebar } from './Sidebar';
import { TrackList } from './TrackList';

export interface LibraryIslandProps {
  /** False inside the mobile sheet, where the sheet header carries the name. */
  showBrand?: boolean;
  className?: string;
}

/**
 * The library island.
 *
 * Takes no playback subscription: it plays things through the store's action
 * registry, read with `getState()` inside the handler. That is the whole
 * reason dragging the Dampen control cannot re-render a track list.
 */
export function LibraryIsland({ showBrand = true, className }: LibraryIslandProps) {
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

  const playlistTracks = usePlaylistTracks(view === 'playlists' ? selectedPlaylistId : null);
  const search = useSearch(view === 'search' ? query : '');

  const playFrom = useCallback((tracks: SpotifyTrack[], index: number) => {
    getActions().playTrack?.(tracks.slice(index).map((t) => t.uri));
  }, []);

  const openPlaylist = useCallback(
    (id: string) => {
      setView('playlists');
      selectPlaylist(id);
    },
    [selectPlaylist, setView],
  );

  const openPlaylistMeta =
    library.playlists.find((p) => p.id === selectedPlaylistId) ?? null;

  const signedOutBody = 'Connect Spotify to see your library here.';

  return (
    <Sidebar
      className={className}
      showBrand={showBrand}
      view={view}
      onViewChange={(next) => {
        setView(next);
        if (next !== 'playlists') selectPlaylist(null);
      }}
      query={query}
      onQueryChange={(q) => {
        setQuery(q);
        setView(q.length > 0 ? 'search' : 'playlists');
      }}
      focusNonce={focusNonce}
      openTitle={view === 'playlists' && selectedPlaylistId ? openPlaylistMeta?.name ?? 'Playlist' : null}
      onBack={() => selectPlaylist(null)}
      user={auth.user}
      authStatus={auth.status}
      onLogin={auth.login}
    >
      {library.error ? (
        <p className="shrink-0 px-2 py-2 text-[12px] leading-snug text-t3">
          Could not reach Spotify.{' '}
          <button
            type="button"
            onClick={library.refresh}
            className="text-accent underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
      {view === 'playlists' ? (
        selectedPlaylistId ? (
          <TrackList
            label={openPlaylistMeta?.name ?? 'Playlist'}
            tracks={playlistTracks.tracks}
            isLoading={playlistTracks.isLoading}
            currentUri={currentUri}
            onPlay={(_, index) => playFrom(playlistTracks.tracks, index)}
            emptyTitle="This playlist is empty"
            emptyBody="Add something to it in Spotify and it will show up here."
          />
        ) : (
          <PlaylistList
            playlists={library.playlists}
            isLoading={library.isLoading}
            onOpen={openPlaylist}
            emptyBody={
              auth.status === 'authed'
                ? 'Playlists you own or follow in Spotify appear here.'
                : signedOutBody
            }
          />
        )
      ) : null}

      {view === 'liked' ? (
        <TrackList
          label="Liked songs"
          tracks={library.savedTracks}
          isLoading={library.isLoading}
          currentUri={currentUri}
          onPlay={(_, index) => playFrom(library.savedTracks, index)}
          emptyTitle="No liked songs"
          emptyBody={
            auth.status === 'authed'
              ? 'Hit the heart on anything in Spotify and it lands here.'
              : signedOutBody
          }
        />
      ) : null}

      {view === 'recent' ? (
        <TrackList
          label="Recently played"
          tracks={library.recentlyPlayed}
          isLoading={library.isLoading}
          currentUri={currentUri}
          onPlay={(_, index) => playFrom(library.recentlyPlayed, index)}
          emptyTitle="Nothing played yet"
          emptyBody={
            auth.status === 'authed'
              ? 'Play something and the last fifty tracks show up here.'
              : signedOutBody
          }
        />
      ) : null}

      {view === 'top' ? (
        <TrackList
          label="Top tracks"
          tracks={library.topTracks}
          isLoading={library.isLoading}
          currentUri={currentUri}
          onPlay={(_, index) => playFrom(library.topTracks, index)}
          emptyTitle="No top tracks yet"
          emptyBody={
            auth.status === 'authed'
              ? 'Spotify needs a few weeks of listening before it ranks anything.'
              : signedOutBody
          }
        />
      ) : null}

      {view === 'search' ? (
        <div className="scroll-quiet h-full overflow-y-auto">
          <SearchResults
            query={query}
            results={search.results}
            isLoading={search.isLoading}
            currentUri={currentUri}
            onPlayTrack={(_, index) => playFrom(search.results?.tracks ?? [], index)}
            onOpenPlaylist={openPlaylist}
            onOpenArtist={(artist) => {
              setQuery(artist.name);
              setView('search');
            }}
          />
        </div>
      ) : null}
      </div>
    </Sidebar>
  );
}
