'use client';

import { useEffect, useMemo } from 'react';
import type { SpotifyImage } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { proceduralCover } from '@/components/ui/Artwork';
import { writeAccentVars } from '@/components/ui/accent';
import { useUIStore } from '@/components/ui/store';

/**
 * Pushes the accent ramp into CSS custom properties on <html>.
 *
 * This is the whole colour-feedback loop in six lines: it subscribes to the
 * store *imperatively*, so moving the dial recolours every panel, arc, meter
 * and glow in the app without React rendering anything at all.
 */
export function AccentDriver() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = (amount: number, bypass: boolean) => {
      // Bypassed? Snap the room back to "open" so the A/B is visual too.
      writeAccentVars(root, bypass ? 0 : amount);
      root.dataset.bypass = bypass ? 'true' : 'false';
    };

    const s = useUIStore.getState();
    apply(s.amount, s.bypass);

    let lastAmount = s.amount;
    let lastBypass = s.bypass;
    return useUIStore.subscribe((state) => {
      if (state.amount === lastAmount && state.bypass === lastBypass) return;
      lastAmount = state.amount;
      lastBypass = state.bypass;
      apply(state.amount, state.bypass);
    });
  }, []);

  return null;
}

function smallestAtLeast(images: SpotifyImage[], min: number): string | null {
  if (images.length === 0) return null;
  const sized = images
    .filter((i) => typeof i.width === 'number')
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sized.find((i) => (i.width ?? 0) >= min) ?? sized[sized.length - 1] ?? images[0]).url;
}

export interface AmbientBackdropProps {
  /** Current artwork. Empty array falls back to a procedural wash. */
  images?: SpotifyImage[];
  /** Seeds the procedural wash — the album title. */
  seed: string;
  className?: string;
}

/**
 * Album art as the light source.
 *
 * A heavily blurred, over-scaled copy of the current cover sits behind the
 * whole player. Blur radius, opacity and scale are all CSS variables written
 * by `AccentDriver`, so as the dial closes the artwork physically recedes and
 * smears — the same gesture as the audio, one layer up.
 *
 * Rendered as a CSS background rather than `next/image`: it is blurred to
 * 100 px, so a 300 px source is already more than enough and a full-viewport
 * optimised fetch would be pure waste.
 */
export function AmbientBackdrop({ images = [], seed, className }: AmbientBackdropProps) {
  const published = useUIStore((s) => s.artworkUrl);
  const url = useMemo(() => smallestAtLeast(images, 300) ?? published, [images, published]);

  return (
    <div
      aria-hidden
      className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}
    >
      {/* The art itself. */}
      <div
        className="absolute -inset-[18%] transition-[filter,opacity,transform] duration-700 ease-out"
        style={{
          ...(url
            ? { backgroundImage: `url("${url.replace(/"/g, '%22')}")` }
            : proceduralCover(seed)),
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(var(--art-blur)) saturate(1.25)',
          opacity: 'var(--art-opacity)',
          transform: 'scale(var(--art-scale))',
        }}
      />

      {/* Accent wash — the room light, warming as you close the dial. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 95% at 50% 115%, var(--accent-glow) 0%, transparent 58%)',
          opacity: 0.6,
        }}
      />

      {/* Vignette, so panels keep their edges against the bloom. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(110% 85% at 50% 40%, transparent 20%, var(--ground) 92%)',
        }}
      />
      <div className="absolute inset-0 bg-ground/35" />
    </div>
  );
}
