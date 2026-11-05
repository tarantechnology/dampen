'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { SpotifyTrack } from '@/lib/spotify/types';
import { Artwork } from '@/components/ui/Artwork';
import { cn } from '@/lib/cn';

export interface NowPlayingProps {
  track: SpotifyTrack | null;
  /** Shown instead of the artist line before anything is playing. */
  idleLine?: string;
  className?: string;
}

/**
 * Artwork, title, artist. Nothing else.
 *
 * The art sits inside `.art-recede`, which blurs and desaturates it as the
 * `--dampen` custom property rises. That single declaration is the entire
 * product metaphor: the music visibly withdraws as you push it away.
 */
export function NowPlaying({ track, idleLine, className }: NowPlayingProps) {
  const reduce = useReducedMotion();
  const title = track?.name ?? 'Nothing playing';
  const artists = track?.artists.map((a) => a.name).join(', ') ?? idleLine ?? '';
  const seed = track ? `${track.album.name} ${track.artists[0]?.name ?? ''}` : 'dampen';
  const key = track?.id ?? 'empty';

  return (
    <div className={cn('flex w-full flex-col items-center', className)}>
      <div className="relative w-[min(340px,72vw)] max-w-full">
        {/* A very soft halo in the artwork's own colour. Apple Music does
            this; it is what keeps a square on black from looking pasted on. */}
        <div
          aria-hidden
          className="absolute -inset-8 -z-10 rounded-[48px] bg-[var(--accent-tint)] blur-3xl"
        />
        <div className="relative aspect-square w-full overflow-hidden rounded-[10px] shadow-[0_20px_60px_-24px_rgba(0,0,0,0.6)]">
          <div className="art-recede absolute inset-0">
            <AnimatePresence initial={false} mode="sync">
              <motion.div
                key={key}
                initial={{ opacity: reduce ? 1 : 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.35, ease: 'easeOut' }}
                className="absolute inset-0"
              >
                <Artwork
                  images={track?.album.images ?? []}
                  alt={track ? `${track.album.name} by ${artists}` : 'No album artwork'}
                  seed={seed}
                  sizes="(max-width: 640px) 72vw, 340px"
                  targetWidth={680}
                  eager
                  className="size-full"
                />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="mt-7 w-full max-w-[380px] text-center">
        <h1
          title={title}
          className="line-clamp-2 text-[25px] font-semibold leading-[1.18] tracking-[-0.02em] text-t1"
        >
          {title}
        </h1>
        {artists ? (
          <p title={artists} className="mt-1.5 truncate text-[15.5px] text-t2">
            {artists}
          </p>
        ) : null}
      </div>
    </div>
  );
}
