/**
 * components/viz/theme.ts
 *
 * The shared colour system for every Dampen visualiser.
 *
 * Design rule: ONE accent, and its *temperature* tracks the dampen amount.
 * At amount 0 the music is untouched and the instrument reads cold and
 * clinical (ice cyan). As the wall closes the accent walks down a blackbody
 * ramp — cyan, cool white, warm white, straw, amber, ember. That path is
 * deliberately chosen: adjacent stops are near-neighbours in hue, so
 * interpolating between them never passes through mud or through green, and
 * the result never reads as a rainbow. It reads as something cooling down.
 *
 * Interpolation happens in Oklab, not sRGB. sRGB lerps between saturated
 * colours dip in perceived lightness and go chalky in the middle; Oklab is
 * perceptually uniform so the ramp keeps an even brightness as it sweeps,
 * which matters because the user drags the dial slowly and will see every
 * intermediate value.
 *
 * The *ghost* (unprocessed) spectrum is deliberately NOT part of the ramp.
 * It stays a fixed cool neutral grey-blue at every amount, so the only thing
 * that changes colour on screen is the dampened signal. That is what makes
 * the gap between the two layers read as a story rather than as two bars.
 */

/* ------------------------------------------------------------------ *
 * Oklab colour maths
 * ------------------------------------------------------------------ */

interface Rgb {
  /** 0..255 */
  r: number;
  g: number;
  b: number;
}

interface Oklab {
  L: number;
  a: number;
  b: number;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function rgbToOklab(c: Rgb): Oklab {
  const r = srgbToLinear(c.r / 255);
  const g = srgbToLinear(c.g / 255);
  const b = srgbToLinear(c.b / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToRgb(c: Oklab): Rgb {
  const l_ = c.L + 0.3963377774 * c.a + 0.2158037573 * c.b;
  const m_ = c.L - 0.1055613458 * c.a - 0.0638541728 * c.b;
  const s_ = c.L - 0.0894841775 * c.a - 1.291485548 * c.b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const to8 = (v: number): number => Math.max(0, Math.min(255, Math.round(linearToSrgb(v) * 255)));
  return { r: to8(r), g: to8(g), b: to8(b) };
}

function hex(h: string): Rgb {
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Perceptual blend. t = 0 -> a, t = 1 -> b. */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const A = rgbToOklab(a);
  const B = rgbToOklab(b);
  return oklabToRgb({
    L: A.L + (B.L - A.L) * t,
    a: A.a + (B.a - A.a) * t,
    b: A.b + (B.b - A.b) * t,
  });
}

/** CSS colour string. Legacy rgba() form — universally accepted by canvas. */
function rgba(c: Rgb, alpha: number): string {
  return alpha >= 1
    ? `rgb(${c.r}, ${c.g}, ${c.b})`
    : `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(alpha * 1000) / 1000})`;
}

/* ------------------------------------------------------------------ *
 * The ramp
 * ------------------------------------------------------------------ */

/**
 * Accent stops, evenly spaced over amount 0..1. A colour-temperature walk:
 * ice cyan -> cool white -> warm white -> straw -> ember.
 */
const ACCENT_STOPS: readonly Rgb[] = [
  hex('#7FE1FF'), // 0.00  open, clinical, cold
  hex('#C3ECF9'), // 0.25  cooling
  hex('#FBEBD2'), // 0.50  neutral warm white — the hinge
  hex('#FFB75F'), // 0.75  straw
  hex('#E85F1C'), // 1.00  deep ember
];

const WHITE = hex('#FFFFFF');
const INK = hex('#07080B');
const GHOST = hex('#9FB6CE'); // fixed cool neutral — never follows the ramp
const BONE = hex('#F4EFE6'); // the filter-response line: paper, not accent

function sampleRamp(stops: readonly Rgb[], t: number): Rgb {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const span = stops.length - 1;
  const pos = clamped * span;
  const i = Math.min(span - 1, Math.floor(pos));
  return mix(stops[i], stops[i + 1], pos - i);
}

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

export interface VizPalette {
  /** The quantised amount this palette was built for. */
  readonly amount: number;

  /** Instrument body. */
  bg: string;
  hairline: string;

  /** Chrome — kept deliberately faint. */
  grid: string;
  gridOctave: string;
  gridZero: string;
  label: string;
  labelBright: string;

  /** Layer 1 — the unprocessed signal. Amount-independent by design. */
  ghostStroke: string;
  ghostFillTop: string;
  ghostFillBottom: string;

  /** Layer 2 — the dampened signal. Follows the ramp. */
  liveStroke: string;
  liveGlow: string;
  liveFillTop: string;
  liveFillMid: string;
  liveFillBottom: string;

  /** Layer 3 — the filter magnitude response. */
  curve: string;
  curveGlow: string;

  /** Shared accent, for the waveform and the meter. */
  accent: string;
  accentSoft: string;
  accentDim: string;

  /** Meter specifics. */
  meterBody: string;
  meterFillLow: string;
  meterFillHigh: string;
  meterPeak: string;
  meterOver: string;

  /** The no-signal breathing baseline. */
  idle: string;
  idleFill: string;
}

/** Shared monospace stack for all in-canvas labels. */
export const VIZ_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Quantisation step for `amount`. The palette and the cached canvas gradients
 * are rebuilt only when the quantised value changes, so a slow dial drag does
 * not allocate a new gradient every frame. 1/48 is far finer than the eye can
 * resolve across the full sweep but coarse enough that a frame-to-frame jitter
 * of the derived amount does not thrash the cache.
 */
export const AMOUNT_STEP = 1 / 48;

export function quantizeAmount(amount: number): number {
  const a = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
  return Math.round(a / AMOUNT_STEP) * AMOUNT_STEP;
}

const cache = new Map<number, VizPalette>();

/**
 * The colour ramp, parameterised by dampen amount.
 *
 * @param amount 0 = untouched (bright cyan/white), 1 = fully dampened
 *               (deep ember/amber). Clamped; non-finite input is treated as 0.
 *
 * Results are memoised on the quantised amount, so this is cheap to call per
 * frame — but callers should still key their gradient caches on
 * `palette.amount` rather than rebuilding gradients unconditionally.
 */
export function vizColors(amount: number): VizPalette {
  const q = quantizeAmount(amount);
  const hit = cache.get(q);
  if (hit) return hit;

  const accent = sampleRamp(ACCENT_STOPS, q);
  // The stroke is the accent pushed toward white: a hot filament over a
  // cooler body. At high amount the accent is already dark, so the push has
  // to be stronger or the line disappears into its own fill.
  const filament = mix(accent, WHITE, 0.30 + 0.18 * q);
  const deep = mix(accent, INK, 0.45);

  const palette: VizPalette = {
    amount: q,

    bg: rgba(INK, 1),
    hairline: 'rgba(255, 255, 255, 0.055)',

    grid: 'rgba(255, 255, 255, 0.042)',
    gridOctave: 'rgba(255, 255, 255, 0.072)',
    gridZero: 'rgba(255, 255, 255, 0.145)',
    label: 'rgba(255, 255, 255, 0.30)',
    labelBright: 'rgba(255, 255, 255, 0.46)',

    ghostStroke: rgba(GHOST, 0.34),
    ghostFillTop: rgba(GHOST, 0.17),
    ghostFillBottom: rgba(GHOST, 0.012),

    liveStroke: rgba(filament, 0.95),
    liveGlow: rgba(accent, 0.22),
    liveFillTop: rgba(accent, 0.44),
    liveFillMid: rgba(accent, 0.17),
    liveFillBottom: rgba(deep, 0),

    curve: rgba(BONE, 0.88),
    curveGlow: rgba(BONE, 0.1),

    accent: rgba(accent, 1),
    accentSoft: rgba(accent, 0.5),
    accentDim: rgba(accent, 0.2),

    meterBody: 'rgba(255, 255, 255, 0.05)',
    meterFillLow: rgba(mix(accent, INK, 0.22), 0.9),
    meterFillHigh: rgba(filament, 0.95),
    meterPeak: rgba(BONE, 0.85),
    meterOver: rgba(hex('#FF5A36'), 0.95),

    idle: rgba(accent, 0.26),
    idleFill: rgba(accent, 0.035),
  };

  // Bounded cache: there are only 1/AMOUNT_STEP + 1 reachable keys, so this
  // never grows beyond ~49 entries. No eviction needed.
  cache.set(q, palette);
  return palette;
}
