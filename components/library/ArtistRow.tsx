'use client';

import { Star } from 'lucide-react';
import type { SpotifyArtist } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { Artwork } from '@/components/ui/Artwork';
import { EmptyState } from '@/components/ui/EmptyState';
import { ArtistRowSkeleton } from '@/components/ui/Skeleton';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export interface ArtistRowProps {
  artists: SpotifyArtist[];
  onOpen(artist: SpotifyArtist): void;
  isLoading?: boolean;
  label: string;
  className?: string;
}

/**
 * A horizontally scrolling shelf of artists. Scrolls with the wheel, drags on
 * touch, and every card is in the tab order — no hidden content behind an
 * arrow button nobody can reach.
 */
export function ArtistRow({ artists, onOpen, isLoading = false, label, className }: ArtistRowProps) {
  if (isLoading) return <ArtistRowSkeleton count={6} />;

  if (artists.length === 0) {
    return (
      <EmptyState
        icon={<Star className="size-5" aria-hidden />}
        title="No top artists yet"
        body="Spotify needs a few weeks of listening before it will tell you who you actually play."
        size="inline"
        className={className}
      />
    );
  }

  return (
    <ul
      aria-label={label}
      className={cn('scroll-slim flex gap-3 overflow-x-auto pb-2', className)}
    >
      {artists.map((artist) => (
        <li key={artist.id} className="shrink-0">
          <button
            type="button"
            onClick={() => onOpen(artist)}
            className="flex w-[92px] flex-col items-center gap-2 rounded-xl p-1.5 transition-colors hover:bg-white/[0.05]"
          >
            <Artwork
              images={artist.images}
              alt={artist.name}
              seed={artist.name}
              sizes="80px"
              targetWidth={160}
              className="size-20 rounded-full"
            />
            <span className="w-full truncate text-center text-[11.5px] font-medium text-ink">
              {artist.name}
            </span>
            <span className="num -mt-1 text-[10px] text-ink-4">
              {artist.followers === null ? '' : `${compact.format(artist.followers)} followers`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
