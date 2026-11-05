/**
 * Dampen — default parameters, presets and the macro dial.
 *
 * ## `DEFAULT_PARAMS` is a hard contract
 *
 * Running the engine with `DEFAULT_PARAMS` must be *indistinguishable* from no
 * processing at all. That is not aspirational: it is what makes the bypass
 * toggle trustworthy and what makes "amount = 0" mean something. So every
 * value below is chosen to be the exact identity of its stage, not merely a
 * small amount of it:
 *
 *  - `lowpass.freq = 20000` and `highpass.freq = 20` hit the engine's "fully
 *    open" sentinels, which neutralise those biquads to magnitude-flat allpass
 *    rather than leaving four cascaded 20 kHz lowpasses in the path (which
 *    would still cost ~3.4 dB at 15 kHz).
 *  - Every shelf and peak gain is `0` dB, where a biquad shelf/peak is
 *    algebraically unity.
 *  - `width = 1` is an exact identity through the M/S matrix (see `MS_GAINS`).
 *  - `reverb.mix = 0`, `saturation = 0`, `bitcrush.mix = 0` and both
 *    wow/flutter depths are `0`, each of which is a true bypass in its stage.
 *  - `compressor.ratio = 1` with `threshold = 0` does nothing.
 *  - `ambience.level = -Infinity` is literal zero gain, not −90 dB.
 *
 * ## The macro dial
 *
 * Each preset carries a `macro` list of dot paths with the *neutral* value for
 * that path. `resolveParams(preset, amount)` interpolates each listed path
 * from its neutral towards the preset's value, so one knob takes you from
 * "untouched" to the full character of the preset. Paths that are not listed
 * (filter corner frequencies that only matter once a gain is non-zero, the
 * cascade count, the ambience *kind*) stay at the preset value at every
 * amount, which is safe precisely because the parameter that gates them *is*
 * in the macro list.
 */

import type { DampenParams, Preset } from '@/lib/types';
import { cloneParams, getPath, lerp, lerpLog } from './dsp';
import {
  AMBIENCE_SILENT_DB,
  HIGHPASS_OPEN_HZ,
  LOWPASS_OPEN_HZ,
  asStages,
  clampParamPath,
  INTEGER_PARAM_PATHS,
  sanitizeParams,
} from './params';

/* ------------------------------------------------------------------ *
 * Neutral
 * ------------------------------------------------------------------ */

/** Fully transparent. See the file header for why each value is what it is. */
export const DEFAULT_PARAMS: DampenParams = {
  amount: 0,
  outputGain: 0,

  highpass: { freq: HIGHPASS_OPEN_HZ, q: 0 },
  lowShelf: { freq: 120, gain: 0 },
  lowpass: { freq: LOWPASS_OPEN_HZ, q: 0, stages: 1 },
  presenceDip: { freq: 3000, q: 1, gain: 0 },
  tilt: { freq: 2500, gain: 0 },

  reverb: { mix: 0, decay: 1.2, preDelay: 20, damping: 0.5, size: 0.5 },

  width: 1,

  compressor: { threshold: 0, ratio: 1, attack: 0.003, release: 0.25, knee: 0, makeup: 0 },

  saturation: 0,
  wowFlutter: { wowRate: 0.8, wowDepth: 0, flutterRate: 8, flutterDepth: 0 },
  bitcrush: { bits: 16, downsample: 1, mix: 0 },

  ambience: { kind: 'none', level: -Infinity, tone: 0.5 },
  drift: { rate: 0.05, depth: 0 },
};

/* ------------------------------------------------------------------ *
 * Macro helpers
 * ------------------------------------------------------------------ */

type MacroEntry = { path: string; neutral: number };

/**
 * The paths almost every preset wants to morph, with their neutral values
 * pulled from `DEFAULT_PARAMS`. Presets spread this and add their own.
 *
 * `lowpass.stages` is deliberately absent: at amount 0 the cutoff is already
 * at the open sentinel, which neutralises *all* stages, so the stage count can
 * stay fixed and the cascade slope never changes discontinuously mid-drag.
 */
const COMMON_MACRO: readonly MacroEntry[] = [
  { path: 'lowpass.freq', neutral: LOWPASS_OPEN_HZ },
  { path: 'lowpass.q', neutral: 0 },
  { path: 'highpass.freq', neutral: HIGHPASS_OPEN_HZ },
  { path: 'lowShelf.gain', neutral: 0 },
  { path: 'presenceDip.gain', neutral: 0 },
  { path: 'tilt.gain', neutral: 0 },
  { path: 'reverb.mix', neutral: 0 },
  { path: 'width', neutral: 1 },
  { path: 'compressor.threshold', neutral: 0 },
  { path: 'compressor.ratio', neutral: 1 },
  { path: 'compressor.makeup', neutral: 0 },
  { path: 'saturation', neutral: 0 },
  { path: 'drift.depth', neutral: 0 },
  { path: 'outputGain', neutral: 0 },
] as const;

const TAPE_MACRO: readonly MacroEntry[] = [
  { path: 'wowFlutter.wowDepth', neutral: 0 },
  { path: 'wowFlutter.flutterDepth', neutral: 0 },
] as const;

const CRUSH_MACRO: readonly MacroEntry[] = [
  { path: 'bitcrush.mix', neutral: 0 },
  { path: 'bitcrush.bits', neutral: 16 },
  { path: 'bitcrush.downsample', neutral: 1 },
] as const;

/**
 * `ambience.level` needs a finite neutral: interpolating from `-Infinity`
 * would pin every intermediate amount at `-Infinity`. −90 dB is 3.2e-5 linear
 * — comfortably below anything audible on real hardware — so it behaves as
 * silence while remaining a usable interpolation endpoint.
 */
const AMBIENCE_MACRO: readonly MacroEntry[] = [
  { path: 'ambience.level', neutral: AMBIENCE_SILENT_DB },
] as const;

function macro(...groups: readonly MacroEntry[][]): MacroEntry[] {
  return groups.flat().map((e) => ({ ...e }));
}

/** Build a complete `DampenParams` from `DEFAULT_PARAMS` plus overrides. */
function preset(over: Partial<DampenParams>): DampenParams {
  return sanitizeParams({ ...cloneParams(DEFAULT_PARAMS), ...cloneParams(over), amount: 1 }, DEFAULT_PARAMS);
}

/* ------------------------------------------------------------------ *
 * The presets
 * ------------------------------------------------------------------ */

/**
 * Eight characters. The numbers are chosen around a few physical anchors:
 *
 *  - A domestic stud wall or a closed interior door gives roughly 25–35 dB of
 *    transmission loss above 1 kHz and almost none below 150 Hz. That is why
 *    the "through a wall" presets pair a low cutoff with a *lift* in the low
 *    shelf: structure-borne bass genuinely does get through louder, relatively
 *    speaking.
 *  - Human attention capture peaks in the 1–5 kHz band (where speech
 *    intelligibility and transient detail live, and where the ear canal's own
 *    resonance adds ~10 dB of sensitivity around 3 kHz). The `presenceDip` is
 *    parked there in every preset, because removing that band is the single
 *    most effective way to make music stop demanding to be listened to.
 *  - Heavy, slow compression removes the dynamic contrast the orienting
 *    reflex responds to. A track with no surprises in it is a track you can
 *    ignore, so the "deep" presets run ratios of 4–6:1 with long releases.
 */
export const PRESETS: Preset[] = [
  {
    id: 'next-room',
    name: 'Next Room',
    blurb: 'Someone left the door ajar and the music is happening in there.',
    glyph: '🚪',
    params: preset({
      outputGain: 2,
      highpass: { freq: 45, q: 0 },
      lowShelf: { freq: 140, gain: 3 },
      lowpass: { freq: 900, q: 0.3, stages: 2 },
      presenceDip: { freq: 2800, q: 1.1, gain: -7 },
      tilt: { freq: 2500, gain: -6 },
      reverb: { mix: 0.3, decay: 0.9, preDelay: 28, damping: 0.7, size: 0.45 },
      width: 0.7,
      compressor: { threshold: -24, ratio: 2.5, attack: 0.02, release: 0.35, knee: 12, makeup: 3 },
      saturation: 0.05,
      drift: { rate: 0.06, depth: 0.8 },
    }),
    macro: macro([...COMMON_MACRO]),
  },

  {
    id: 'underwater',
    name: 'Underwater',
    blurb: 'Submerged. The highs never make it to the surface.',
    glyph: '🌊',
    params: preset({
      outputGain: 3,
      highpass: { freq: 90, q: 0.5 },
      lowShelf: { freq: 120, gain: 2 },
      lowpass: { freq: 420, q: 0.8, stages: 3 },
      presenceDip: { freq: 1800, q: 0.8, gain: -5 },
      tilt: { freq: 2000, gain: -10 },
      reverb: { mix: 0.45, decay: 2.2, preDelay: 8, damping: 0.85, size: 0.7 },
      width: 0.35,
      compressor: { threshold: -28, ratio: 3, attack: 0.05, release: 0.5, knee: 14, makeup: 5 },
      saturation: 0.1,
      // Slow, deep wobble reads as the swaying of water rather than as tape.
      wowFlutter: { wowRate: 0.35, wowDepth: 0.45, flutterRate: 5, flutterDepth: 0.1 },
      ambience: { kind: 'brown', level: -30, tone: 0.1 },
      drift: { rate: 0.09, depth: 2.5 },
    }),
    macro: macro([...COMMON_MACRO], [...TAPE_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'rainy-window',
    name: 'Rainy Window',
    blurb: 'The record is indoors. You are not.',
    glyph: '🌧️',
    params: preset({
      outputGain: 1,
      highpass: { freq: 55, q: 0 },
      lowShelf: { freq: 150, gain: 1.5 },
      lowpass: { freq: 1600, q: 0.4, stages: 2 },
      presenceDip: { freq: 3200, q: 1.2, gain: -5 },
      tilt: { freq: 3000, gain: -4 },
      reverb: { mix: 0.22, decay: 1.1, preDelay: 22, damping: 0.6, size: 0.4 },
      width: 0.85,
      compressor: { threshold: -22, ratio: 2, attack: 0.02, release: 0.3, knee: 10, makeup: 2 },
      saturation: 0.05,
      ambience: { kind: 'rain', level: -26, tone: 0.6 },
      drift: { rate: 0.05, depth: 0.6 },
    }),
    macro: macro([...COMMON_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'tape-memory',
    name: 'Tape Memory',
    blurb: 'A cassette you dubbed in 1994 and have played too many times.',
    glyph: '📼',
    params: preset({
      outputGain: 1,
      highpass: { freq: 70, q: 0 },
      lowShelf: { freq: 110, gain: 2 },
      // Barely muffled: this preset is about degradation, not distance.
      lowpass: { freq: 5200, q: 0.2, stages: 1 },
      presenceDip: { freq: 4000, q: 0.9, gain: -3 },
      tilt: { freq: 4000, gain: -3 },
      reverb: { mix: 0.15, decay: 0.8, preDelay: 12, damping: 0.5, size: 0.3 },
      width: 0.9,
      compressor: { threshold: -18, ratio: 2.5, attack: 0.01, release: 0.25, knee: 8, makeup: 2 },
      saturation: 0.3,
      wowFlutter: { wowRate: 0.7, wowDepth: 0.3, flutterRate: 7.5, flutterDepth: 0.22 },
      bitcrush: { bits: 12, downsample: 1, mix: 0.15 },
      ambience: { kind: 'tape', level: -34, tone: 0.45 },
      drift: { rate: 0.07, depth: 1.2 },
    }),
    macro: macro([...COMMON_MACRO], [...TAPE_MACRO], [...CRUSH_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'library',
    name: 'Library',
    blurb: 'Quiet enough that nobody looks up. Including you.',
    glyph: '📚',
    params: preset({
      outputGain: -2,
      highpass: { freq: 90, q: 0.3 },
      lowShelf: { freq: 130, gain: -1 },
      lowpass: { freq: 3200, q: 0.2, stages: 2 },
      presenceDip: { freq: 2600, q: 1.4, gain: -6 },
      tilt: { freq: 3000, gain: -5 },
      reverb: { mix: 0.18, decay: 1.6, preDelay: 35, damping: 0.45, size: 0.6 },
      width: 0.6,
      // 4:1 with a wide knee and a long release: no transient survives to
      // startle you, but nothing audibly pumps either.
      compressor: { threshold: -30, ratio: 4, attack: 0.03, release: 0.4, knee: 16, makeup: 6 },
      saturation: 0.03,
      ambience: { kind: 'fan', level: -42, tone: 0.2 },
      drift: { rate: 0.04, depth: 0.5 },
    }),
    macro: macro([...COMMON_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'deep-focus',
    name: 'Deep Focus',
    blurb: 'Almost a drone. Melody becomes weather.',
    glyph: '🧠',
    params: preset({
      outputGain: 2,
      highpass: { freq: 110, q: 0.4 },
      lowShelf: { freq: 140, gain: 0 },
      lowpass: { freq: 650, q: 0.3, stages: 3 },
      presenceDip: { freq: 2200, q: 0.7, gain: -9 },
      tilt: { freq: 1800, gain: -9 },
      reverb: { mix: 0.35, decay: 2.8, preDelay: 18, damping: 0.75, size: 0.75 },
      width: 0.4,
      compressor: { threshold: -32, ratio: 6, attack: 0.05, release: 0.6, knee: 18, makeup: 8 },
      saturation: 0.08,
      ambience: { kind: 'brown', level: -28, tone: 0.3 },
      drift: { rate: 0.03, depth: 1.5 },
    }),
    macro: macro([...COMMON_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'distant-radio',
    name: 'Distant Radio',
    blurb: 'A small transistor speaker, two rooms away, slightly off-station.',
    glyph: '📻',
    params: preset({
      outputGain: 0,
      // A 320 Hz highpass is the single biggest cue for "tiny speaker": real
      // 50 mm drivers simply cannot move enough air below it.
      highpass: { freq: 320, q: 0.7 },
      lowShelf: { freq: 400, gain: 0 },
      lowpass: { freq: 2800, q: 1, stages: 2 },
      presenceDip: { freq: 1200, q: 1, gain: -3 },
      tilt: { freq: 2500, gain: -2 },
      reverb: { mix: 0.2, decay: 0.6, preDelay: 10, damping: 0.55, size: 0.25 },
      // Near-mono: an AM radio has one speaker.
      width: 0.15,
      compressor: { threshold: -16, ratio: 5, attack: 0.005, release: 0.15, knee: 6, makeup: 6 },
      saturation: 0.45,
      wowFlutter: { wowRate: 1.4, wowDepth: 0.12, flutterRate: 10, flutterDepth: 0.3 },
      bitcrush: { bits: 9, downsample: 3, mix: 0.35 },
      ambience: { kind: 'white', level: -38, tone: 0.75 },
      drift: { rate: 0.12, depth: 2 },
    }),
    macro: macro([...COMMON_MACRO], [...TAPE_MACRO], [...CRUSH_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'dream',
    name: 'Dream',
    blurb: 'Unmoored. Everything is reverb and the reverb is enormous.',
    glyph: '☁️',
    params: preset({
      outputGain: 2,
      highpass: { freq: 45, q: 0 },
      lowShelf: { freq: 120, gain: 2.5 },
      lowpass: { freq: 1100, q: 0.3, stages: 2 },
      presenceDip: { freq: 2400, q: 0.8, gain: -6 },
      tilt: { freq: 2200, gain: -7 },
      reverb: { mix: 0.6, decay: 4.5, preDelay: 45, damping: 0.65, size: 0.9 },
      // The only preset wider than the source: the image should feel like it
      // has no edges.
      width: 1.4,
      compressor: { threshold: -26, ratio: 3, attack: 0.08, release: 0.8, knee: 18, makeup: 5 },
      saturation: 0.12,
      wowFlutter: { wowRate: 0.25, wowDepth: 0.25, flutterRate: 4, flutterDepth: 0.06 },
      drift: { rate: 0.025, depth: 2.2 },
    }),
    macro: macro([...COMMON_MACRO], [...TAPE_MACRO]),
  },
];

/* ------------------------------------------------------------------ *
 * Lookup + macro interpolation
 * ------------------------------------------------------------------ */

/** Find a preset by id. */
export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/**
 * Paths whose interpolation should be **geometric** rather than linear.
 *
 * Frequency is perceived logarithmically: morphing `lowpass.freq` from
 * 20000 Hz to 900 Hz linearly spends the first half of the dial travelling
 * from 20 kHz to 10.5 kHz — which is almost inaudible — and then dumps six
 * octaves into the second half. Geometric interpolation makes the dial feel
 * like a constant rate of muffling, which is the whole point of a macro.
 *
 * `reverb.decay` is in the same family (doubling time is one perceptual step).
 */
const GEOMETRIC_PATHS: ReadonlySet<string> = new Set([
  'lowpass.freq',
  'highpass.freq',
  'lowShelf.freq',
  'presenceDip.freq',
  'tilt.freq',
  'reverb.decay',
  'bitcrush.downsample',
]);

/**
 * Resolve a preset at a given macro amount.
 *
 * `amount = 0` yields (effectively) `DEFAULT_PARAMS` for every path the preset
 * lists in its `macro`; `amount = 1` yields the preset exactly. Values are
 * clamped and sanitised on the way out, so the result is always safe to hand
 * to the engine.
 *
 * @param preset a `Preset` or a preset id. An unknown id resolves to
 *               `DEFAULT_PARAMS` with the requested amount, which is the
 *               safe (silent-failure-free) interpretation.
 */
export function resolveParams(preset: Preset | string, amount: number): DampenParams {
  const p = typeof preset === 'string' ? getPreset(preset) : preset;
  const a = clampParamPath('amount', amount, 0);

  if (!p) {
    const fallback = cloneParams(DEFAULT_PARAMS);
    fallback.amount = a;
    return fallback;
  }

  // Start from the preset's full parameter set: anything not under macro
  // control (filter corners, cascade count, ambience kind, LFO rates) keeps
  // the preset's character at every amount.
  const out = cloneParams(p.params);
  out.amount = a;

  for (const entry of p.macro ?? []) {
    const target = getPath(p.params, entry.path);
    if (typeof target !== 'number') continue; // unknown or non-numeric path

    const neutral = entry.neutral;
    const useGeometric = GEOMETRIC_PATHS.has(entry.path) && neutral > 0 && target > 0;
    let value = useGeometric ? lerpLog(neutral, target, a) : lerp(neutral, target, a);

    if (INTEGER_PARAM_PATHS.has(entry.path)) value = Math.round(value);

    writeMacroPath(out, entry.path, value);
  }

  // One final pass so clamping, integer narrowing and `-Infinity` handling are
  // all applied consistently.
  return sanitizeParams(out, DEFAULT_PARAMS);
}

/**
 * Write one interpolated macro value.
 *
 * `lowpass.stages` is the only path whose type is a literal union, so it is
 * narrowed explicitly rather than cast; everything else is a plain `number`
 * slot and goes through the generic dot-path writer in `setParamPath`'s
 * sibling helper.
 */
function writeMacroPath(target: DampenParams, path: string, value: number): void {
  if (path === 'lowpass.stages') {
    target.lowpass.stages = asStages(value);
    return;
  }
  const keys = path.split('.');
  const leaf = keys[keys.length - 1];
  let cur: Record<string, unknown> = target as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    if (typeof next !== 'object' || next === null) return;
    cur = next as Record<string, unknown>;
  }
  if (typeof cur[leaf] !== 'number') return;
  cur[leaf] = clampParamPath(path, value, cur[leaf] as number);
}
