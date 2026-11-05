/**
 * The accent ramp — Dampen's single most important piece of visual feedback.
 *
 * As the macro dial travels 0 -> 1 the whole interface cools down and sinks:
 * a bright cyan "open window" becomes a deep ember glow behind a wall. The
 * ramp is authored in OKLCH so the interpolation is perceptually even and
 * never passes through a muddy or over-saturated hue.
 *
 * These values are written to CSS custom properties on <html> by
 * `AccentDriver` (components/player/AmbientBackdrop.tsx), so changing the dial
 * restyles the entire app without re-rendering a single React component.
 */

export interface Oklch {
  /** Lightness, 0..1 */
  l: number;
  /** Chroma, ~0..0.37 */
  c: number;
  /** Hue, degrees */
  h: number;
}

/** cyan -> seafoam -> gold -> amber -> ember */
const RAMP: Array<{ at: number; color: Oklch }> = [
  { at: 0.0, color: { l: 0.845, c: 0.12, h: 196 } },
  { at: 0.3, color: { l: 0.83, c: 0.095, h: 168 } },
  { at: 0.6, color: { l: 0.79, c: 0.11, h: 92 } },
  { at: 0.85, color: { l: 0.7, c: 0.145, h: 62 } },
  { at: 1.0, color: { l: 0.6, c: 0.15, h: 44 } },
];

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Sample the ramp. `amount` is the macro dial, 0..1. */
export function accentAt(amount: number): Oklch {
  const a = clamp(amount, 0, 1);
  for (let i = 1; i < RAMP.length; i += 1) {
    const prev = RAMP[i - 1];
    const next = RAMP[i];
    if (a <= next.at) {
      const span = next.at - prev.at;
      const t = span === 0 ? 0 : (a - prev.at) / span;
      return {
        l: lerp(prev.color.l, next.color.l, t),
        c: lerp(prev.color.c, next.color.c, t),
        h: lerp(prev.color.h, next.color.h, t),
      };
    }
  }
  return RAMP[RAMP.length - 1].color;
}

export function oklch({ l, c, h }: Oklch, alpha = 1): string {
  const base = `${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)}`;
  return alpha >= 1 ? `oklch(${base})` : `oklch(${base} / ${alpha})`;
}

export interface AccentVars {
  /** The accent itself. */
  '--accent': string;
  /** Hotter, darker end — the far stop of the dial's arc gradient. */
  '--accent-hot': string;
  /** Muted, for hairlines and inactive marks. */
  '--accent-dim': string;
  /** Wide, soft glow for shadows and bloom. */
  '--accent-glow': string;
  /** Faint wash for selected surfaces. */
  '--accent-wash': string;
  /** Backdrop blur radius, in px, as a bare number string with unit. */
  '--art-blur': string;
  /** Backdrop opacity. */
  '--art-opacity': string;
  /** Backdrop scale. */
  '--art-scale': string;
}

/**
 * Every derived value the UI needs for a given dial position.
 * Pure: safe to call in render, in a rAF loop, or on the server.
 */
export function accentVars(amount: number): AccentVars {
  const a = clamp(amount, 0, 1);
  const base = accentAt(a);
  const hot: Oklch = { l: base.l - 0.11, c: base.c + 0.02, h: base.h - 16 };
  const dim: Oklch = { l: base.l - 0.2, c: base.c * 0.55, h: base.h };

  return {
    '--accent': oklch(base),
    '--accent-hot': oklch(hot),
    '--accent-dim': oklch(dim),
    '--accent-glow': oklch({ ...base, l: base.l - 0.05 }, 0.3 + a * 0.22),
    '--accent-wash': oklch(base, 0.07 + a * 0.07),
    // The artwork behind the player blurs as the audio muffles. Same metaphor,
    // two senses. 14px open -> 110px walled-off.
    '--art-blur': `${(14 + a * 96).toFixed(1)}px`,
    '--art-opacity': (0.4 - a * 0.19).toFixed(3),
    '--art-scale': (1.06 + a * 0.16).toFixed(3),
  };
}

/** Apply the ramp to an element's inline style. One write, no re-render. */
export function writeAccentVars(el: HTMLElement | null, amount: number): void {
  if (!el) return;
  const vars = accentVars(amount);
  for (const [key, value] of Object.entries(vars)) {
    el.style.setProperty(key, value);
  }
}
