/**
 * The accent, derived from the album artwork.
 *
 * Apple Music tints its Now Playing screen with a colour pulled out of the
 * cover, which is why every screen looks designed for that one song. This
 * module does the same thing, in three steps:
 *
 *   1. Draw the cover into a 16x16 canvas — 256 pixels is plenty, and the
 *      browser's own downscale is a free box blur.
 *   2. Bin those pixels by hue, weighted by saturation, and take the heaviest
 *      bin's circular mean. Near-greys, near-blacks and near-whites are
 *      excluded, so a photo of a dark room does not yield "dark grey".
 *   3. Clamp saturation and lightness into a band that is guaranteed to read
 *      on the current ground, and pick black or white for text sitting on
 *      top of it by actual relative luminance.
 *
 * With no artwork (a local file, a procedural cover, the /design route) the
 * hue comes from a hash of the title instead, so the result is still stable
 * and still specific to the thing playing.
 */

export interface Accent {
  /** `hsl(...)`, ready for a CSS value. */
  css: string;
  /** Black or white — whichever actually reads on `css`. */
  ink: string;
  /** The accent at low alpha, for selected-chip and hover fills. */
  soft: string;
  /** Fainter still, for the halo behind the artwork. */
  tint: string;
  h: number;
  s: number;
  l: number;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ------------------------------------------------------------------ *
 * Colour conversion
 * ------------------------------------------------------------------ */

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** sRGB bytes -> HSL with s,l in 0..1 and h in degrees. */
export function rgbToHsl(r8: number, g8: number, b8: number): Hsl {
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

function srgbChannel(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ];
}

/** WCAG relative luminance, 0..1. */
function luminance(r: number, g: number, b: number): number {
  return (
    0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b)
  );
}

function contrastWith(lum: number, otherLum: number): number {
  const hi = Math.max(lum, otherLum);
  const lo = Math.min(lum, otherLum);
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ *
 * The safe band
 * ------------------------------------------------------------------ */

/**
 * Artwork colours cannot be trusted: a cover is routinely near-black,
 * fluorescent, or a single flat pastel. Clamping into these bands is what
 * keeps the slider fill legible against #000 and against #fff alike — and
 * the saturation ceiling is deliberately low, because a hot fill reads as a
 * warning, not as a colour borrowed from the cover.
 */
const BAND = {
  dark: { sMin: 0.26, sMax: 0.58, lMin: 0.6, lMax: 0.74 },
  light: { sMin: 0.3, sMax: 0.62, lMin: 0.34, lMax: 0.46 },
} as const;

export function makeAccent(h: number, s: number, l: number, dark: boolean): Accent {
  const band = dark ? BAND.dark : BAND.light;
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, band.sMin, band.sMax);
  const light = clamp(l, band.lMin, band.lMax);

  const [r, g, b] = hslToRgb({ h: hue, s: sat, l: light });
  const lum = luminance(r, g, b);
  const onWhite = contrastWith(lum, 1);
  const onBlack = contrastWith(lum, 0);
  const ink = onBlack >= onWhite ? '#000000' : '#ffffff';

  const base = `${hue.toFixed(1)} ${(sat * 100).toFixed(1)}% ${(light * 100).toFixed(1)}%`;
  return {
    css: `hsl(${base})`,
    ink,
    soft: `hsl(${base} / ${dark ? 0.18 : 0.15})`,
    tint: `hsl(${base} / ${dark ? 0.1 : 0.08})`,
    h: hue,
    s: sat,
    l: light,
  };
}

/** The "no artwork, no title" accent: a desaturated neutral that never clashes. */
export function neutralAccent(dark: boolean): Accent {
  return dark
    ? {
        css: 'hsl(222 10% 72%)',
        ink: '#000000',
        soft: 'hsl(222 10% 72% / 0.16)',
        tint: 'hsl(222 10% 72% / 0.08)',
        h: 222,
        s: 0.1,
        l: 0.72,
      }
    : {
        css: 'hsl(222 14% 42%)',
        ink: '#ffffff',
        soft: 'hsl(222 14% 42% / 0.14)',
        tint: 'hsl(222 14% 42% / 0.07)',
        h: 222,
        s: 0.14,
        l: 0.42,
      };
}

/* ------------------------------------------------------------------ *
 * Sources
 * ------------------------------------------------------------------ */

export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** A stable accent for anything without a cover image. */
export function accentFromSeed(seed: string, dark: boolean): Accent {
  if (!seed) return neutralAccent(dark);
  const h = hashString(seed);
  return makeAccent(h % 360, 0.34 + ((h >> 9) % 16) / 100, dark ? 0.66 : 0.4, dark);
}

const HUE_BINS = 24;

/**
 * The dominant colour of an image, from raw RGBA bytes.
 *
 * Returns `null` when the image carries no usable colour at all — an
 * all-grey cover — so the caller can fall back to the title hash rather than
 * tint the whole screen battleship grey.
 */
export function accentFromPixels(
  data: Uint8ClampedArray | Uint8Array,
  dark: boolean,
): Accent | null {
  const weight = new Float64Array(HUE_BINS);
  const sumSin = new Float64Array(HUE_BINS);
  const sumCos = new Float64Array(HUE_BINS);
  const sumS = new Float64Array(HUE_BINS);
  const sumL = new Float64Array(HUE_BINS);

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 128) continue;
    const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    // Greys carry no hue; the extremes are blown out and unreliable.
    if (s < 0.14 || l < 0.1 || l > 0.93) continue;

    // Favour colour that is both saturated and mid-toned.
    const w = s * s * (1 - Math.abs(l - 0.5) * 1.1);
    if (w <= 0) continue;

    const bin = Math.min(HUE_BINS - 1, Math.floor((h / 360) * HUE_BINS));
    const rad = (h * Math.PI) / 180;
    weight[bin] += w;
    sumSin[bin] += Math.sin(rad) * w;
    sumCos[bin] += Math.cos(rad) * w;
    sumS[bin] += s * w;
    sumL[bin] += l * w;
  }

  let best = -1;
  let bestWeight = 0;
  for (let i = 0; i < HUE_BINS; i += 1) {
    if (weight[i] > bestWeight) {
      bestWeight = weight[i];
      best = i;
    }
  }
  if (best < 0 || bestWeight <= 0) return null;

  const hue = (Math.atan2(sumSin[best], sumCos[best]) * 180) / Math.PI;
  return makeAccent(hue, sumS[best] / bestWeight, sumL[best] / bestWeight, dark);
}

/* ------------------------------------------------------------------ *
 * Writing it out
 * ------------------------------------------------------------------ */

/**
 * One write to <html>, no React render anywhere. Everything that uses the
 * accent reads these four properties.
 */
export function writeAccent(el: HTMLElement | null, accent: Accent): void {
  if (!el) return;
  el.style.setProperty('--accent', accent.css);
  el.style.setProperty('--accent-ink', accent.ink);
  el.style.setProperty('--accent-soft', accent.soft);
  el.style.setProperty('--accent-tint', accent.tint);
}

/** Same deal for the macro. Drives the artwork's blur without a re-render. */
export function writeDampen(el: HTMLElement | null, amount: number): void {
  if (!el) return;
  el.style.setProperty('--dampen', clamp(amount, 0, 1).toFixed(4));
}
