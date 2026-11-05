/**
 * Dampen — parameter ranges, sanitisation and dot-path editing.
 *
 * `DampenParams` arrives from untrusted places: sliders mid-drag, presets,
 * `localStorage`, URL state, another agent's code. Before any of it reaches an
 * `AudioParam` it goes through {@link sanitizeParams}, which is total: it
 * always returns a complete, finite, in-range `DampenParams`, whatever it was
 * handed. There is no code path from the UI to an `AudioParam` that skips it.
 */

import type {
  AmbienceKind,
  AmbienceParams,
  BitcrushParams,
  CompressorParams,
  DampenParams,
  DriftParams,
  HighpassParams,
  LowpassParams,
  PeakParams,
  ReverbParams,
  ShelfParams,
  WowFlutterParams,
} from '@/lib/types';
import { cloneParams, dbLevel, getPath, intNum, isFiniteNumber, num, setPath } from './dsp';

/* ------------------------------------------------------------------ *
 * Sentinels
 * ------------------------------------------------------------------ */

/**
 * A lowpass cutoff at or above this is treated as "fully open" and the stage
 * is neutralised entirely (see `ManagedBiquad` in `engine.ts`) rather than
 * left running at 20 kHz. Four cascaded Butterworth lowpasses at 20 kHz would
 * still cost about −3.4 dB at 15 kHz, which is audible on cymbals and would
 * break the promise that `DEFAULT_PARAMS` sounds identical to no processing.
 */
export const LOWPASS_OPEN_HZ = 20000;

/** A highpass at or below this is treated as "fully open" and neutralised. */
export const HIGHPASS_OPEN_HZ = 20;

/**
 * Ambience level at or below this counts as silence. The macro interpolator
 * needs a *finite* neutral for `ambience.level` (lerping from `-Infinity`
 * would pin the result at `-Infinity` for every amount > 0), so −90 dB is the
 * agreed stand-in: 3.2e-5 linear, about 30 dB below the noise floor of any
 * real playback system.
 */
export const AMBIENCE_SILENT_DB = -90;

/* ------------------------------------------------------------------ *
 * Ranges
 * ------------------------------------------------------------------ */

/** Inclusive `[min, max]` for every scalar parameter, keyed by dot path. */
export const PARAM_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  amount: [0, 1],
  outputGain: [-60, 12],

  'highpass.freq': [10, 2000],
  /*
   * `highpass.q` and `lowpass.q` are **linear** Q in `DampenParams`, as
   * `lib/types.ts` documents ("Resonance. Keep <= 1.0 or the cutoff
   * whistles"). Web Audio's `BiquadFilterNode` wants *decibels* for lowpass
   * and highpass, so the engine converts with `linearQToDb`. Keeping the
   * public contract linear means presets read the way the research tables
   * write them (0.707 = Butterworth, 3.0 = the "underwater" resonance) and
   * the one dangerous conversion lives in exactly one place.
   *
   * The ceiling of 8 is well past "whistles"; it exists so the resonant
   * `underwater` setting (3.0) is comfortably inside the range rather than
   * pinned at the top of it.
   */
  'highpass.q': [0.1, 8],

  'lowShelf.freq': [40, 600],
  'lowShelf.gain': [-24, 24],

  'lowpass.freq': [120, LOWPASS_OPEN_HZ],
  'lowpass.q': [0.1, 8],
  'lowpass.stages': [1, 4],

  'presenceDip.freq': [400, 8000],
  'presenceDip.q': [0.1, 10], // a true Q for `peaking`
  'presenceDip.gain': [-30, 12],

  'tilt.freq': [500, 10000],
  'tilt.gain': [-24, 12],

  'reverb.mix': [0, 1],
  'reverb.decay': [0.05, 8],
  'reverb.preDelay': [0, 250],
  'reverb.damping': [0, 1],
  'reverb.size': [0, 1],

  width: [0, 2],

  'compressor.threshold': [-100, 0],
  'compressor.ratio': [1, 20],
  'compressor.attack': [0, 1],
  'compressor.release': [0, 1],
  'compressor.knee': [0, 40],
  'compressor.makeup': [-12, 24],

  saturation: [0, 1],

  // Zero is a legal rate: the research tables use 0/0 for every preset that
  // wants no transport wobble at all, and a zero-rate LFO is a flat DC of
  // sin(0) = 0, i.e. exactly no modulation.
  'wowFlutter.wowRate': [0, 8],
  'wowFlutter.wowDepth': [0, 1],
  'wowFlutter.flutterRate': [0, 24],
  'wowFlutter.flutterDepth': [0, 1],

  'bitcrush.bits': [1, 16],
  'bitcrush.downsample': [1, 32],
  'bitcrush.mix': [0, 1],

  'ambience.level': [AMBIENCE_SILENT_DB, 0],
  'ambience.tone': [0, 1],

  'drift.rate': [0, 2],
  'drift.depth': [0, 12],
} as const;

/** Paths whose value must be an integer. */
export const INTEGER_PARAM_PATHS: ReadonlySet<string> = new Set([
  'lowpass.stages',
  'bitcrush.bits',
  'bitcrush.downsample',
]);

export const AMBIENCE_KINDS: readonly AmbienceKind[] = [
  'none',
  'brown',
  'pink',
  'white',
  'rain',
  'vinyl',
  'tape',
  'cafe',
  'river',
  'fan',
] as const;

export function isAmbienceKind(v: unknown): v is AmbienceKind {
  return typeof v === 'string' && (AMBIENCE_KINDS as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Clamp a single value against {@link PARAM_RANGES}, by dot path. */
export function clampParamPath(path: string, value: number, fallback: number): number {
  const range = PARAM_RANGES[path];
  if (!range) return isFiniteNumber(value) ? value : fallback;
  const [min, max] = range;
  if (INTEGER_PARAM_PATHS.has(path)) return intNum(value, fallback, min, max);
  if (path === 'ambience.level') return dbLevel(value, fallback, min, max);
  return num(value, fallback, min, max);
}

/** Narrow an arbitrary number to the `1 | 2 | 3 | 4` cascade count. */
export function asStages(v: unknown): 1 | 2 | 3 | 4 {
  const n = intNum(v, 1, 1, 4);
  return n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 4;
}

/* ------------------------------------------------------------------ *
 * Sanitisation
 * ------------------------------------------------------------------ */

type Src = Partial<Record<string, unknown>>;

function pick(src: unknown): Src {
  return typeof src === 'object' && src !== null ? (src as Src) : {};
}

function f(src: Src, key: string, path: string, fallback: number): number {
  return clampParamPath(path, src[key] as number, fallback);
}

function sanitizeHighpass(src: unknown, d: HighpassParams): HighpassParams {
  const s = pick(src);
  return { freq: f(s, 'freq', 'highpass.freq', d.freq), q: f(s, 'q', 'highpass.q', d.q) };
}

function sanitizeShelf(src: unknown, d: ShelfParams, prefix: string): ShelfParams {
  const s = pick(src);
  return {
    freq: f(s, 'freq', `${prefix}.freq`, d.freq),
    gain: f(s, 'gain', `${prefix}.gain`, d.gain),
  };
}

function sanitizeLowpass(src: unknown, d: LowpassParams): LowpassParams {
  const s = pick(src);
  return {
    freq: f(s, 'freq', 'lowpass.freq', d.freq),
    q: f(s, 'q', 'lowpass.q', d.q),
    stages: asStages(s.stages ?? d.stages),
  };
}

function sanitizePeak(src: unknown, d: PeakParams): PeakParams {
  const s = pick(src);
  return {
    freq: f(s, 'freq', 'presenceDip.freq', d.freq),
    q: f(s, 'q', 'presenceDip.q', d.q),
    gain: f(s, 'gain', 'presenceDip.gain', d.gain),
  };
}

function sanitizeReverb(src: unknown, d: ReverbParams): ReverbParams {
  const s = pick(src);
  return {
    mix: f(s, 'mix', 'reverb.mix', d.mix),
    decay: f(s, 'decay', 'reverb.decay', d.decay),
    preDelay: f(s, 'preDelay', 'reverb.preDelay', d.preDelay),
    damping: f(s, 'damping', 'reverb.damping', d.damping),
    size: f(s, 'size', 'reverb.size', d.size),
  };
}

function sanitizeCompressor(src: unknown, d: CompressorParams): CompressorParams {
  const s = pick(src);
  return {
    threshold: f(s, 'threshold', 'compressor.threshold', d.threshold),
    ratio: f(s, 'ratio', 'compressor.ratio', d.ratio),
    attack: f(s, 'attack', 'compressor.attack', d.attack),
    release: f(s, 'release', 'compressor.release', d.release),
    knee: f(s, 'knee', 'compressor.knee', d.knee),
    makeup: f(s, 'makeup', 'compressor.makeup', d.makeup),
  };
}

function sanitizeWowFlutter(src: unknown, d: WowFlutterParams): WowFlutterParams {
  const s = pick(src);
  return {
    wowRate: f(s, 'wowRate', 'wowFlutter.wowRate', d.wowRate),
    wowDepth: f(s, 'wowDepth', 'wowFlutter.wowDepth', d.wowDepth),
    flutterRate: f(s, 'flutterRate', 'wowFlutter.flutterRate', d.flutterRate),
    flutterDepth: f(s, 'flutterDepth', 'wowFlutter.flutterDepth', d.flutterDepth),
  };
}

function sanitizeBitcrush(src: unknown, d: BitcrushParams): BitcrushParams {
  const s = pick(src);
  return {
    bits: f(s, 'bits', 'bitcrush.bits', d.bits),
    downsample: f(s, 'downsample', 'bitcrush.downsample', d.downsample),
    mix: f(s, 'mix', 'bitcrush.mix', d.mix),
  };
}

function sanitizeAmbience(src: unknown, d: AmbienceParams): AmbienceParams {
  const s = pick(src);
  return {
    kind: isAmbienceKind(s.kind) ? s.kind : d.kind,
    level: clampParamPath('ambience.level', s.level as number, d.level),
    tone: f(s, 'tone', 'ambience.tone', d.tone),
  };
}

function sanitizeDrift(src: unknown, d: DriftParams): DriftParams {
  const s = pick(src);
  return {
    rate: f(s, 'rate', 'drift.rate', d.rate),
    depth: f(s, 'depth', 'drift.depth', d.depth),
  };
}

/**
 * Total, defensive normalisation of a (possibly partial, possibly hostile)
 * parameter object against a known-good set of defaults.
 *
 * Every missing field is filled from `defaults`; every present field is
 * clamped to {@link PARAM_RANGES}; `NaN`, `Infinity`, strings and objects in
 * numeric slots all fall back to the default. The result is always safe to
 * hand to the engine.
 */
export function sanitizeParams(src: unknown, defaults: DampenParams): DampenParams {
  const s = pick(src);
  return {
    amount: f(s, 'amount', 'amount', defaults.amount),
    outputGain: f(s, 'outputGain', 'outputGain', defaults.outputGain),
    highpass: sanitizeHighpass(s.highpass, defaults.highpass),
    lowShelf: sanitizeShelf(s.lowShelf, defaults.lowShelf, 'lowShelf'),
    lowpass: sanitizeLowpass(s.lowpass, defaults.lowpass),
    presenceDip: sanitizePeak(s.presenceDip, defaults.presenceDip),
    tilt: sanitizeShelf(s.tilt, defaults.tilt, 'tilt'),
    reverb: sanitizeReverb(s.reverb, defaults.reverb),
    width: f(s, 'width', 'width', defaults.width),
    compressor: sanitizeCompressor(s.compressor, defaults.compressor),
    saturation: f(s, 'saturation', 'saturation', defaults.saturation),
    wowFlutter: sanitizeWowFlutter(s.wowFlutter, defaults.wowFlutter),
    bitcrush: sanitizeBitcrush(s.bitcrush, defaults.bitcrush),
    ambience: sanitizeAmbience(s.ambience, defaults.ambience),
    drift: sanitizeDrift(s.drift, defaults.drift),
  };
}

/* ------------------------------------------------------------------ *
 * Patching
 * ------------------------------------------------------------------ */

/** Recursively-optional view of a parameter tree. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** A partial `DampenParams` patch, as accepted by `DampenEngine.setParams`. */
export type DampenParamsPatch = DeepPartial<DampenParams>;

/**
 * Merge a patch onto a base and sanitise the result in one pass.
 * `sanitizeParams` is doing the merge for us: it reads each field from the
 * patch and falls back to the base, which is exactly "shallow-merge per leaf".
 */
export function mergeParams(base: DampenParams, patch: DampenParamsPatch): DampenParams {
  return sanitizeParams(patch, base);
}

/**
 * Apply one dot-path edit, e.g. `setParamPath(p, 'lowpass.freq', 800)` or
 * `setParamPath(p, 'ambience.kind', 'rain')`.
 *
 * Unknown paths, wrong value types and out-of-range numbers are all rejected
 * or clamped rather than written blindly. Returns a *new* object; the input is
 * never mutated, so React state transitions stay sane.
 */
export function setParamPath(
  base: DampenParams,
  path: string,
  value: number | string,
): DampenParams {
  const next = cloneParams(base);
  if (getPath(next, path) === undefined) return base;

  if (path === 'ambience.kind') {
    if (!isAmbienceKind(value)) return base;
    next.ambience.kind = value;
    return next;
  }

  if (typeof value === 'number') {
    // A NaN or Infinity edit is a bug upstream, not a request. Returning the
    // original object (rather than clamping to the current value) lets callers
    // detect the rejection by identity and skip a pointless state update.
    if (!Number.isFinite(value)) return base;
  } else {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return base;
    value = parsed;
  }

  if (path === 'lowpass.stages') {
    next.lowpass.stages = asStages(value);
    return next;
  }

  const current = getPath(next, path);
  const fallback = typeof current === 'number' ? current : 0;
  if (!setPath(next, path, clampParamPath(path, value, fallback))) return base;
  return next;
}
