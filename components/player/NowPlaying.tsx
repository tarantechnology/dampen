'use client';

import { Disc3, ListMusic } from 'lucide-react';
import type { SpotifyTrack } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { Artwork } from '@/components/ui/Artwork';
import { Skeleton } from '@/components/ui/Skeleton';
import { Scrubber } from './Scrubber';

export interface NowPlayingProps {
  track: SpotifyTrack | null;
  position: number;
  durationMs: number;
  isPlaying: boolean;
  /** True until the first playback state arrives. */
  isLoading?: boolean;
  onSeek(ms: number): void;
  /** Where the track is playing from, e.g. "Deep Work". */
  contextLabel?: string | null;
  className?: string;
}

const ART_SIZES =
  '(max-width: 640px) calc(100vw - 3rem), (max-width: 1280px) 420px, 460px';

export function NowPlaying({
  track,
  position,
  durationMs,
  isPlaying,
  isLoading = false,
  onSeek,
  contextLabel,
  className,
}: NowPlayingProps) {
  if (isLoading) return <NowPlayingSkeleton className={className} />;

  if (!track) {
    return (
      <section
        aria-label="Now playing"
        className={cn('flex flex-col items-center gap-6', className)}
      >
        <div className="relative aspect-square w-full max-w-[460px] rounded-2xl border border-dashed border-line-strong bg-white/[0.02]">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <Disc3 className="size-7 text-ink-4" aria-hidden />
            <p className="text-[14px] font-medium text-ink-2">Nothing playing</p>
            <p className="max-w-[28ch] text-[12px] leading-relaxed text-ink-4">
              Start something from your library, or press play in the Spotify desktop app if
              you are running Dampen in capture mode.
            </p>
          </div>
        </div>
        <div className="w-full max-w-[460px] opacity-40">
          <Scrubber position={0} durationMs={0} isPlaying={false} onSeek={onSeek} disabled />
        </div>
      </section>
    );
  }

  const artists = track.artists.map((a) => a.name).join(', ');

  return (
    <section aria-label="Now playing" className={cn('flex flex-col items-center', className)}>
      <Artwork
        images={track.album.images}
        alt={`${track.album.name} by ${artists}`}
        seed={`${track.album.name} ${artists}`}
        sizes={ART_SIZES}
        targetWidth={640}
        eager
        className={cn(
          'aspect-square w-full max-w-[460px] rounded-2xl',
          // The art lifts off the page and catches the accent as a rim light.
          'shadow-[0_28px_80px_-24px_rgba(0,0,0,0.9)]',
        )}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{ boxShadow: 'inset 0 0 70px -20px var(--accent-glow)' }}
        />
      </Artwork>

      <div className="mt-6 w-full max-w-[460px]">
        <h1 className="truncate text-[22px] font-semibold leading-tight tracking-tight text-ink">
          {track.name}
        </h1>
        <p className="mt-1 truncate text-[14px] text-ink-2">{artists}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-ink-4">
          <span className="truncate">{track.album.name}</span>
          {track.album.releaseDate ? (
            <>
              <span aria-hidden>&middot;</span>
              <span className="num">{track.album.releaseDate.slice(0, 4)}</span>
            </>
          ) : null}
          {track.explicit ? (
            <span className="rounded border border-line px-1 text-[9px] font-semibold text-ink-4">
              E
            </span>
          ) : null}
        </p>

        {contextLabel ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-3">
            <ListMusic className="size-3.5" aria-hidden />
            <span className="truncate">Playing from {contextLabel}</span>
          </p>
        ) : null}

        <Scrubber
          className="mt-5"
          position={position}
          durationMs={durationMs}
          isPlaying={isPlaying}
          onSeek={onSeek}
        />
      </div>
    </section>
  );
}

/** Same metrics as the real thing, so nothing moves when the track lands. */
export function NowPlayingSkeleton({ className }: { className?: string }) {
  return (
    <section
      role="status"
      aria-label="Loading the current track"
      className={cn('flex flex-col items-center', className)}
    >
      <Skeleton className="aspect-square w-full max-w-[460px] rounded-2xl" />
      <div className="mt-6 w-full max-w-[460px] space-y-2.5">
        <Skeleton className="h-6 w-[62%] rounded-md" />
        <Skeleton shape="text" className="w-[38%]" delayMs={60} />
        <Skeleton shape="text" className="h-2.5 w-[46%]" delayMs={120} />
        <div className="pt-4">
          <Skeleton className="h-[5px] w-full rounded-full" delayMs={160} />
          <div className="mt-1.5 flex justify-between">
            <Skeleton shape="text" className="h-2.5 w-8" />
            <Skeleton shape="text" className="h-2.5 w-8" />
          </div>
        </div>
      </div>
    </section>
  );
}
