'use client';

import { memo } from 'react';
import { Library, Play } from 'lucide-react';
import type { SpotifyPlaylist } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { Artwork } from '@/components/ui/Artwork';
import { EmptyState } from '@/components/ui/EmptyState';
import { CardGridSkeleton } from '@/components/ui/Skeleton';

const CARD_SIZES = '(max-width: 640px) 44vw, (max-width: 1280px) 22vw, 170px';

const PlaylistCard = memo(function PlaylistCard({
  playlist,
  selected,
  onOpen,
  onPlay,
}: {
  playlist: SpotifyPlaylist;
  selected: boolean;
  onOpen(id: string): void;
  onPlay?(uri: string): void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onOpen(playlist.id)}
        aria-current={selected || undefined}
        className={cn(
          'flex w-full flex-col gap-2.5 rounded-xl border p-2 text-left transition-colors duration-150',
          selected
            ? 'border-accent/45 bg-accent/[0.07]'
            : 'border-transparent hover:border-line hover:bg-white/[0.045]',
        )}
      >
        <Artwork
          images={playlist.images}
          alt={`${playlist.name} cover`}
          seed={`${playlist.name} ${playlist.ownerName}`}
          sizes={CARD_SIZES}
          targetWidth={320}
          className="aspect-square w-full rounded-lg"
        />
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-medium text-ink">
            {playlist.name}
          </span>
          <span className="num mt-0.5 block truncate text-[11px] text-ink-4">
            {playlist.trackCount} tracks &middot; {playlist.ownerName}
          </span>
        </span>
      </button>

      {onPlay ? (
        <button
          type="button"
          aria-label={`Play ${playlist.name}`}
          onClick={() => onPlay(playlist.uri)}
          className={cn(
            'absolute right-3.5 top-[38%] flex size-9 items-center justify-center rounded-full',
            'text-ground opacity-0 shadow-lg transition-[opacity,transform] duration-150',
            'translate-y-1 group-hover:translate-y-0 group-hover:opacity-100',
            'focus-visible:translate-y-0 focus-visible:opacity-100',
          )}
          style={{ background: 'var(--accent)' }}
        >
          <Play className="size-4 translate-x-[1px]" strokeWidth={2.6} aria-hidden />
        </button>
      ) : null}
    </div>
  );
});

export interface PlaylistGridProps {
  playlists: SpotifyPlaylist[];
  selectedId?: string | null;
  onOpen(id: string): void;
  onPlay?(uri: string): void;
  isLoading?: boolean;
  label: string;
  className?: string;
}

export function PlaylistGrid({
  playlists,
  selectedId = null,
  onOpen,
  onPlay,
  isLoading = false,
  label,
  className,
}: PlaylistGridProps) {
  if (isLoading) return <CardGridSkeleton count={8} />;

  if (playlists.length === 0) {
    return (
      <EmptyState
        icon={<Library className="size-5" aria-hidden />}
        title="No playlists"
        body="Playlists you own or follow in Spotify will appear here. Make one and hit rescan."
        className={className}
      />
    );
  }

  return (
    <div
      role="list"
      aria-label={label}
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1.5',
        className,
      )}
    >
      {playlists.map((playlist) => (
        <div role="listitem" key={playlist.id}>
          <PlaylistCard
            playlist={playlist}
            selected={playlist.id === selectedId}
            onOpen={onOpen}
            onPlay={onPlay}
          />
        </div>
      ))}
    </div>
  );
}
