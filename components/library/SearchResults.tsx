'use client';

import type {
  SearchResults as SearchResultsData,
  SpotifyArtist,
  SpotifyTrack,
} from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { formatTime } from '@/components/ui/format';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { MediaRow } from './MediaRow';

export interface SearchResultsProps {
  query: string;
  results: SearchResultsData | null;
  isLoading: boolean;
  currentUri: string | null;
  onPlayTrack(track: SpotifyTrack, index: number): void;
  onOpenPlaylist(id: string): void;
  onOpenArtist(artist: SpotifyArtist): void;
  className?: string;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-2 pb-1 pt-3 text-[12.5px] font-medium text-t3">{children}</h3>
  );
}

/** Three short sections, each capped. Search is for finding, not browsing. */
export function SearchResults({
  query,
  results,
  isLoading,
  currentUri,
  onPlayTrack,
  onOpenPlaylist,
  onOpenArtist,
  className,
}: SearchResultsProps) {
  if (query.trim().length === 0) {
    return (
      <EmptyState
        title="Search your library"
        body="Tracks, artists and playlists from Spotify."
        className={className}
      />
    );
  }

  if (isLoading && !results) {
    return (
      <div className={cn('flex flex-col', className)}>
        {Array.from({ length: 6 }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  const tracks = results?.tracks.slice(0, 8) ?? [];
  const artists = results?.artists.slice(0, 4) ?? [];
  const playlists = results?.playlists.slice(0, 4) ?? [];

  if (tracks.length + artists.length + playlists.length === 0) {
    return (
      <EmptyState
        title={`Nothing for “${query}”`}
        body="Try an artist, an album or a few words of the title."
        className={className}
      />
    );
  }

  return (
    <div className={cn('flex flex-col pb-4', className)}>
      {tracks.length > 0 ? (
        <>
          <SectionLabel>Songs</SectionLabel>
          {tracks.map((track, index) => (
            <button
              key={track.id}
              type="button"
              onClick={() => onPlayTrack(track, index)}
              className="rounded-[8px] text-left transition-colors duration-100 hover:bg-fill-1"
            >
              <MediaRow
                images={track.album.images}
                seed={`${track.album.name} ${track.artists[0]?.name ?? ''}`}
                title={track.name}
                subtitle={track.artists.map((a) => a.name).join(', ')}
                trailing={formatTime(track.durationMs)}
                current={track.uri === currentUri}
              />
            </button>
          ))}
        </>
      ) : null}

      {artists.length > 0 ? (
        <>
          <SectionLabel>Artists</SectionLabel>
          {artists.map((artist) => (
            <button
              key={artist.id}
              type="button"
              onClick={() => onOpenArtist(artist)}
              className="rounded-[8px] text-left transition-colors duration-100 hover:bg-fill-1"
            >
              <MediaRow
                images={artist.images}
                seed={artist.name}
                title={artist.name}
                subtitle={artist.genres[0] ?? 'Artist'}
                round
              />
            </button>
          ))}
        </>
      ) : null}

      {playlists.length > 0 ? (
        <>
          <SectionLabel>Playlists</SectionLabel>
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              onClick={() => onOpenPlaylist(playlist.id)}
              className="rounded-[8px] text-left transition-colors duration-100 hover:bg-fill-1"
            >
              <MediaRow
                images={playlist.images}
                seed={playlist.name}
                title={playlist.name}
                subtitle={`${playlist.trackCount} songs`}
              />
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}
