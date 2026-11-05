'use client';

import type { SpotifyPlaylist } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { MediaRow } from './MediaRow';

export interface PlaylistListProps {
  playlists: SpotifyPlaylist[];
  isLoading: boolean;
  onOpen(id: string): void;
  emptyBody: string;
  className?: string;
}

/**
 * Playlists as rows, not as a grid of cards. A 264px rail has room for one
 * column of anything, and a row carries the name at a readable size.
 */
export function PlaylistList({
  playlists,
  isLoading,
  onOpen,
  emptyBody,
  className,
}: PlaylistListProps) {
  if (isLoading && playlists.length === 0) {
    return (
      <div className={cn('flex flex-col', className)}>
        {Array.from({ length: 7 }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (playlists.length === 0) {
    return <EmptyState title="No playlists" body={emptyBody} className={className} />;
  }

  return (
    <ul className={cn('flex flex-col', className)}>
      {playlists.map((playlist) => (
        <li key={playlist.id}>
          <button
            type="button"
            onClick={() => onOpen(playlist.id)}
            className="w-full rounded-[8px] text-left transition-colors duration-100 hover:bg-fill-1"
          >
            <MediaRow
              images={playlist.images}
              seed={playlist.name}
              title={playlist.name}
              subtitle={`${playlist.trackCount} ${playlist.trackCount === 1 ? 'song' : 'songs'}`}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
