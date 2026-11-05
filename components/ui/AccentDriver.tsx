'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  accentFromPixels,
  accentFromSeed,
  writeAccent,
  writeDampen,
  type Accent,
} from './accent';
import { useUIStore } from './store';

const THEME_KEY = 'dampen.theme';

/**
 * Route a remote cover through Next's image optimiser so the canvas read is
 * same-origin and can never taint. A relative URL is already ours.
 */
function sampleUrl(url: string): string {
  if (!/^https?:/i.test(url)) return url;
  return `/_next/image?url=${encodeURIComponent(url)}&w=64&q=75`;
}

function loadImage(src: string, crossOrigin?: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/** 16x16 is 256 pixels — enough to find a dominant hue, and free to process. */
function readPixels(img: HTMLImageElement): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, 16, 16);
    return ctx.getImageData(0, 0, 16, 16).data;
  } catch {
    // Tainted canvas. The seed fallback is still a good answer.
    return null;
  }
}

async function deriveAccent(
  url: string | null,
  seed: string,
  dark: boolean,
): Promise<Accent> {
  const fallback = accentFromSeed(seed, dark);
  if (!url) return fallback;

  for (const attempt of [
    () => loadImage(sampleUrl(url)),
    () => loadImage(url, 'anonymous'),
  ]) {
    try {
      const img = await attempt();
      const pixels = readPixels(img);
      const found = pixels ? accentFromPixels(pixels, dark) : null;
      if (found) return found;
    } catch {
      // Try the next strategy.
    }
  }
  return fallback;
}

/**
 * Resolve the effective colour scheme, following the OS unless the user has
 * explicitly overridden it in Settings.
 */
const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeToScheme(onChange: () => void): () => void {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function useIsDark(): boolean {
  const theme = useUIStore((s) => s.theme);
  const systemDark = useSyncExternalStore(
    subscribeToScheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  return theme === 'system' ? systemDark : theme === 'dark';
}

/**
 * Renders nothing. Owns three imperative writes onto <html>:
 *
 *  - `data-theme`, from the user's preference (persisted);
 *  - `--accent` / `--accent-ink` / `--accent-soft` / `--accent-tint`,
 *    sampled from the current artwork;
 *  - `--dampen`, mirrored from the macro at drag rate.
 *
 * None of them re-render a single component.
 */
export function AccentDriver() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const artworkUrl = useUIStore((s) => s.artworkUrl);
  const accentSeed = useUIStore((s) => s.accentSeed);
  const dark = useIsDark();

  /* Adopt whatever the boot script already applied. */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') setTheme(stored);
    } catch {
      // Private mode. System default it is.
    }
  }, [setTheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Nothing to do; the choice simply will not survive a reload.
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    void deriveAccent(artworkUrl, accentSeed, dark).then((accent) => {
      if (!cancelled) writeAccent(document.documentElement, accent);
    });
    return () => {
      cancelled = true;
    };
  }, [artworkUrl, accentSeed, dark]);

  /* Imperative, so dragging the control does not re-render this tree. */
  useEffect(() => {
    writeDampen(document.documentElement, useUIStore.getState().amount);
    return useUIStore.subscribe((state, prev) => {
      if (state.amount !== prev.amount) {
        writeDampen(document.documentElement, state.amount);
      }
    });
  }, []);

  return null;
}
