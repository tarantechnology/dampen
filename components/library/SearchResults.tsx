'use client';

import { Search } from 'lucide-react';
import type {
  SearchResults as SearchResultsData,
  SpotifyArtist,
  SpotifyTrack,
} from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { Artwork } from '@/components/ui/Artwork';
import { EmptyState } from '@/components/ui/EmptyState';
import { CardGridSkeleton, TrackListSkeleton } from '@/components/ui/Skeleton';
import { ArtistRow } from './ArtistRow';
import { PlaylistGrid } from './PlaylistGrid';
import { TrackList } from './TrackList';

export interface SearchResultsProps {
  query: string;
  results: SearchResultsData | null;
  isLoading?: boolean;
  currentUri?: string | null;
  isPlaying?: boolean;
  onPlayTrack(track: SpotifyTrack, index: number): void;
  onOpenPlaylist(id: string): void;
  onOpenArtist(artist: SpotifyArtist): void;
  className?: string;
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <h3 className="legend">{title}</h3>
        <span className="num text-[10px] text-ink-4">{count}</span>
      </div>
      {children}
    </section>
  );
}

export function SearchResults({
  query,
  results,
  isLoading = false,
  currentUri = null,
  isPlaying = false,
  onPlayTrack,
  onOpenPlaylist,
  onOpenArtist,
  className,
}: SearchResultsProps) {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return (
      <EmptyState
        icon={<Search className="size-5" aria-hidden />}
        title="Search your Spotify"
        body="Tracks, artists, albums and playlists. Press / from anywhere to jump straight here."
        className={className}
      />
    );
  }

  if (isLoading) {
    return (
      <div className={cn('space-y-6', className)}>
        <div className="space-y-2.5">
          <div className="legend">Tracks</div>
          <TrackListSkeleton rows={4} />
        </div>
        <div className="space-y-2.5">
          <div className="legend">Playlists</div>
          <CardGridSkeleton count={4} />
        </div>
      </div>
    );
  }

  const total =
    (results?.tracks.length ?? 0) +
    (results?.artists.length ?? 0) +
    (results?.playlists.length ?? 0) +
    (results?.albums.length ?? 0);

  if (!results || total === 0) {
    return (
      <EmptyState
        icon={<Search className="size-5" aria-hidden />}
        title={`Nothing for “${trimmed}”`}
        body="Check the spelling, or try the artist on its own. Search covers your whole Spotify catalogue, not just your library."
        className={className}
      />
    );
  }

  return (
    <div className={cn('space-y-7', className)}>
      <Section title="Tracks" count={results.tracks.length}>
        <TrackList
          label={`Track results for ${trimmed}`}
          tracks={results.tracks}
          currentUri={currentUri}
          isPlaying={isPlaying}
          onPlay={onPlayTrack}
          meta="album"
          className="max-h-[280px]"
        />
      </Section>

      <Section title="Artists" count={results.artists.length}>
        <ArtistRow
          label={`Artist results for ${trimmed}`}
          artists={results.artists}
          onOpen={onOpenArtist}
        />
      </Section>

      <Section title="Playlists" count={results.playlists.length}>
        <PlaylistGrid
          label={`Playlist results for ${trimmed}`}
          playlists={results.playlists}
          onOpen={onOpenPlaylist}
        />
      </Section>

      <Section title="Albums" count={results.albums.length}>
        <ul
          aria-label={`Album results for ${trimmed}`}
          className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1.5"
        >
          {results.albums.map((album) => (
            <li key={album.id} className="flex flex-col gap-2.5 p-2">
              <Artwork
                images={album.images}
                alt={`${album.name} cover`}
                seed={album.name}
                sizes="(max-width: 640px) 44vw, 170px"
                targetWidth={320}
                className="aspect-square w-full rounded-lg"
              />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {album.name}
                </span>
                {album.releaseDate ? (
                  <span className="num mt-0.5 block text-[11px] text-ink-4">
                    {album.releaseDate.slice(0, 4)}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
