/**
 * Dampen — default parameters, presets and the macro dial.
 *
 * **Every preset value in this file comes from `docs/EFFECTS_RESEARCH.md` §8.2,
 * which is the authoritative table.** Where a number looks surprising there is
 * a research citation for it, and the per-preset comments say which. Do not
 * "tidy" them by ear without reading §8.3 first — several of them are
 * deliberately counter-intuitive (see `next-room`'s *positive* presence gain).
 *
 * ## Two conventions that will bite if you forget them
 *
 * 1. **`lowpass.q` and `highpass.q` are LINEAR here**, matching the contract
 *    in `lib/types.ts` ("Resonance. Keep <= 1.0 or the cutoff whistles").
 *    Web Audio wants *decibels* for those two filter types, and the engine
 *    converts (`linearQToDb`). `presenceDip.q` is linear in both worlds and is
 *    assigned directly. See `BUTTERWORTH_Q_DB` in `dsp.ts`.
 * 2. **`lowpass.stages = n` is a Butterworth filter of order 2n**, built from
 *    `n` biquads at staggered pole Qs — not `n` identical sections. That is
 *    what keeps the −3 dB corner exactly at `lowpass.freq`, which matters
 *    because these cutoffs were derived from measured wall transmission data.
 *    See `biquad.ts`.
 *
 * ## `DEFAULT_PARAMS` is a hard contract
 *
 * Running the engine with `DEFAULT_PARAMS` must be *indistinguishable* from no
 * processing at all. Not aspirational: it is what makes the bypass toggle
 * trustworthy and "amount = 0" mean something. So every value below is the
 * exact identity of its stage, not merely a small amount of it:
 *
 *  - `lowpass.freq = 20000` and `highpass.freq = 20` hit the engine's "fully
 *    open" sentinels, which neutralise those biquads to magnitude-flat allpass
 *    rather than leaving four cascaded 20 kHz lowpasses in the path.
 *  - Every shelf and peak gain is `0` dB, where a biquad shelf/peak is
 *    algebraically unity.
 *  - `width = 1` is an exact identity through the M/S matrix (see `MS_GAINS`).
 *  - `reverb.mix = 0`, `saturation = 0`, `bitcrush.mix = 0` and both
 *    wow/flutter depths are `0`, each a true bypass in its own stage.
 *  - `compressor.ratio = 1` with `threshold = 0` does nothing.
 *  - `ambience.level = -Infinity` is literal zero gain, not −90 dB.
 *
 * ## The macro dial
 *
 * Each preset carries a `macro` list of dot paths with the *neutral* value for
 * that path. `resolveParams(preset, amount)` interpolates each listed path
 * from its neutral towards the preset's value, so one knob takes you from
 * "untouched" to the full character of the preset. Frequencies and times
 * interpolate **geometrically** and gains interpolate **in dB** (§8.5): a
 * linear-in-Hz sweep from 20 kHz to 700 Hz spends about 95 % of the dial above
 * 1 kHz and feels broken.
 */

import type { DampenParams, Preset } from '@/lib/types';
import { BUTTERWORTH_Q_LINEAR, cloneParams, getPath, lerp, lerpLog } from './dsp';
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

  highpass: { freq: HIGHPASS_OPEN_HZ, q: BUTTERWORTH_Q_LINEAR },
  lowShelf: { freq: 120, gain: 0 },
  lowpass: { freq: LOWPASS_OPEN_HZ, q: BUTTERWORTH_Q_LINEAR, stages: 1 },
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
 * The shared macro map, verbatim from `docs/EFFECTS_RESEARCH.md` §8.4, plus
 * two additions the research's shared list leaves to individual presets:
 *
 *  - **`highpass.freq`** (neutral 20 Hz). Without it `distant-radio` would
 *    keep its 300 Hz highpass at `amount = 0`, which is emphatically not
 *    neutral — and "amount 0 is transparent" is a contract this engine
 *    enforces with a test.
 *  - **`lowpass.q`** (neutral 0.7071 linear = Butterworth). Same reason:
 *    `underwater`'s resonant `q = 3.0` should arrive with the filter, not sit
 *    there while the cutoff is still wide open.
 *
 * `lowpass.stages` is deliberately absent: at `amount = 0` the cutoff is
 * already at the open sentinel, which neutralises *all* stages, so the stage
 * count can stay fixed and the cascade's slope never changes discontinuously
 * mid-drag.
 */
const COMMON_MACRO: readonly MacroEntry[] = [
  { path: 'lowpass.freq', neutral: LOWPASS_OPEN_HZ },
  { path: 'lowpass.q', neutral: BUTTERWORTH_Q_LINEAR },
  { path: 'highpass.freq', neutral: HIGHPASS_OPEN_HZ },
  { path: 'presenceDip.gain', neutral: 0 },
  { path: 'tilt.gain', neutral: 0 },
  { path: 'lowShelf.gain', neutral: 0 },
  { path: 'reverb.mix', neutral: 0 },
  { path: 'width', neutral: 1 },
  { path: 'compressor.ratio', neutral: 1 },
  { path: 'compressor.makeup', neutral: 0 },
  { path: 'saturation', neutral: 0 },
  { path: 'drift.depth', neutral: 0 },
  { path: 'outputGain', neutral: 0 },
] as const;

/** Only for presets that actually use the tape transport. */
const TAPE_MACRO: readonly MacroEntry[] = [
  { path: 'wowFlutter.wowDepth', neutral: 0 },
  { path: 'wowFlutter.flutterDepth', neutral: 0 },
] as const;

/** Only for presets that actually use the bitcrusher. */
const CRUSH_MACRO: readonly MacroEntry[] = [
  { path: 'bitcrush.mix', neutral: 0 },
  { path: 'bitcrush.bits', neutral: 16 },
  { path: 'bitcrush.downsample', neutral: 1 },
] as const;

/**
 * `ambience.level` needs a *finite* neutral: interpolating from `-Infinity`
 * would pin every intermediate amount at `-Infinity`. −90 dB is 3.2e-5 linear
 * — far below anything audible on real hardware — so it behaves as silence
 * while remaining a usable interpolation endpoint. §8.4 specifies this value.
 */
const AMBIENCE_MACRO: readonly MacroEntry[] = [
  { path: 'ambience.level', neutral: AMBIENCE_SILENT_DB },
] as const;

function macro(...groups: readonly MacroEntry[][]): MacroEntry[] {
  return groups.flat().map((e) => ({ ...e }));
}

/** Build a complete `DampenParams` from `DEFAULT_PARAMS` plus overrides. */
function preset(over: Partial<DampenParams>): DampenParams {
  return sanitizeParams(
    { ...cloneParams(DEFAULT_PARAMS), ...cloneParams(over), amount: 1 },
    DEFAULT_PARAMS,
  );
}

/* ------------------------------------------------------------------ *
 * The presets
 * ------------------------------------------------------------------ */

/**
 * Eight presets, values from `docs/EFFECTS_RESEARCH.md` §8.2.
 *
 * The physical and psychoacoustic anchors behind the numbers, in brief:
 *
 *  - **Measured wall transmission** (ASTM E90, STC 57) tilts about
 *    **10.5 dB/octave**, not 6 and not 24 — so the "through a wall" presets
 *    use 12–24 dB/oct, and the research explicitly warns that a steeper filter
 *    "behaves like no real wall". The same data shows a **−10 dB coincidence
 *    notch at 1.6–2.5 kHz**, i.e. a *passband leak* exactly where vocals live.
 *  - **A wall does not highpass.** It is a lowpass with a resonance bump; bass
 *    is attenuated far *less*, not boosted. The 30–55 Hz highpasses below are
 *    mix hygiene (headroom, small speakers), not realism.
 *  - **1–5 kHz is the attention band.** A lowpass at 1 kHz drops syllable
 *    articulation from ~98 % to 27 %, and 1.6–3.15 kHz alone carries 34.9 % of
 *    intelligibility while the ear canal adds +15 to +20 dB of its own gain
 *    there. Every `presenceDip` is centred to *cover* 1.6–4 kHz rather than
 *    sitting above it.
 *  - **Dynamics are what capture attention**, not level: the irrelevant-sound
 *    effect is largely level-independent above threshold, so the "deep"
 *    presets run ratios of 6–12:1 with 2 ms attacks to remove the transients
 *    the orienting reflex responds to.
 *  - **Saturation is kept low throughout.** Roughness carries more weight than
 *    fluctuation in the Zwicker annoyance model, and lo-fi processing can make
 *    a bed *more* annoying rather than less.
 *  - **`drift.rate` stays far below 0.5 Hz** and `drift.depth` at or under
 *    ~2.5 dB: fluctuation strength peaks at 4 Hz and AM becomes noticeable
 *    above 2–3 dB. Never raise the rate toward 4 Hz.
 */
export const PRESETS: Preset[] = [
  {
    id: 'next-room',
    name: 'Next Room',
    blurb: 'Your music through a closed bedroom door, down the hall, with the party already over.',
    glyph: '🚪',
    params: preset({
      outputGain: -8,
      // 30 Hz is headroom protection only. A real wall does not highpass.
      highpass: { freq: 30, q: BUTTERWORTH_Q_LINEAR },
      // Doubles as the mass-air-mass partition resonance and the ISO 226
      // loudness compensator for the -8 dB output trim.
      lowShelf: { freq: 350, gain: 4 },
      // 800 Hz / 12 dB per octave: the honest slope for a measured partition.
      lowpass: { freq: 800, q: BUTTERWORTH_Q_LINEAR, stages: 1 },
      /*
       * POSITIVE, and deliberately so. This models the measured coincidence
       * leak of a gypsum partition at 1.6-2.5 kHz — a passband hole in the
       * wall's transmission loss, right where vocal presence lives. The
       * 800 Hz filter has already dropped 2.2 kHz by ~17 dB, so the net level
       * there is still about -14 dB; this restores the *shape* of a real wall,
       * not its level. It is a realism-over-focus trade, and `deep-focus`
       * makes the opposite choice at almost the same frequency.
       */
      presenceDip: { freq: 2200, q: 2, gain: 3 },
      tilt: { freq: 2000, gain: -6 },
      // Short pre-delay with a high wet mix: the direct path is occluded, so
      // what reaches you is the far room's reflection field, not a long
      // free-field path.
      reverb: { mix: 0.5, decay: 0.5, preDelay: 8, damping: 0.75, size: 0.45 },
      width: 0.2,
      compressor: { threshold: -32, ratio: 8, attack: 0.002, release: 0.08, knee: 6, makeup: 6 },
      saturation: 0.1,
      ambience: { kind: 'none', level: -60, tone: 0.5 },
      drift: { rate: 0.03, depth: 1.2 },
    }),
    macro: macro([...COMMON_MACRO]),
  },

  {
    id: 'underwater',
    name: 'Underwater',
    blurb: 'Submerged and slow — the song reaching you through a few feet of water.',
    glyph: '🌊',
    params: preset({
      outputGain: -9,
      highpass: { freq: 40, q: BUTTERWORTH_Q_LINEAR },
      lowShelf: { freq: 300, gain: 5 },
      /*
       * An artistic convention, not acoustics: water absorption at musical
       * frequencies is negligible (under 1 dB/km below 10 kHz), and real
       * underwater muffling is a flat -30 dB boundary loss plus your ear not
       * working. Published recipes span 300 Hz to 5 kHz, so the cutoff is
       * chosen by ear. **The q = 3.0 resonance is what reads as "water"**,
       * not the cutoff.
       */
      lowpass: { freq: 500, q: 3, stages: 2 },
      presenceDip: { freq: 900, q: 1.2, gain: -8 },
      tilt: { freq: 1500, gain: -10 },
      reverb: { mix: 0.62, decay: 1.8, preDelay: 20, damping: 0.85, size: 0.7 },
      width: 0.5,
      compressor: { threshold: -30, ratio: 6, attack: 0.005, release: 0.15, knee: 9, makeup: 5 },
      saturation: 0.08,
      // Doing double duty: a 0.25 Hz sway plus a 3 Hz vibrato.
      wowFlutter: { wowRate: 0.25, wowDepth: 0.5, flutterRate: 3, flutterDepth: 0.12 },
      ambience: { kind: 'river', level: -34, tone: 0.3 },
      drift: { rate: 0.06, depth: 2 },
    }),
    macro: macro([...COMMON_MACRO], [...TAPE_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'rainy-window',
    name: 'Rainy Window',
    blurb: 'A record playing in the next flat while rain runs down the glass.',
    glyph: '🌧️',
    params: preset({
      outputGain: -7,
      highpass: { freq: 50, q: BUTTERWORTH_Q_LINEAR },
      lowShelf: { freq: 350, gain: 3 },
      // 24 dB/oct is defensible here where it is not for `next-room`: window
      // glass is far stiffer than drywall.
      lowpass: { freq: 1200, q: BUTTERWORTH_Q_LINEAR, stages: 2 },
      presenceDip: { freq: 2800, q: 1.4, gain: -7 },
      tilt: { freq: 2500, gain: -5 },
      reverb: { mix: 0.34, decay: 0.55, preDelay: 14, damping: 0.6, size: 0.4 },
      width: 0.45,
      compressor: { threshold: -30, ratio: 6, attack: 0.003, release: 0.12, knee: 8, makeup: 5 },
      saturation: 0.05,
      // The best *masking* preset in the set. Rain is HF-weighted, which makes
      // it the most efficient masker of the 2-5 kHz presence region per dB of
      // added loudness — hence the highest level and tone here.
      ambience: { kind: 'rain', level: -30, tone: 0.72 },
      drift: { rate: 0.025, depth: 1 },
    }),
    macro: macro([...COMMON_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'tape-memory',
    name: 'Tape Memory',
    blurb: 'A cassette you taped off the radio in 1994, found in a drawer.',
    glyph: '📼',
    params: preset({
      outputGain: -8,
      highpass: { freq: 55, q: BUTTERWORTH_Q_LINEAR },
      // 120 Hz is the 30 ips tape head bump, not a partition resonance.
      lowShelf: { freq: 120, gain: 3 },
      lowpass: { freq: 1800, q: BUTTERWORTH_Q_LINEAR, stages: 1 },
      presenceDip: { freq: 3000, q: 1.2, gain: -6 },
      tilt: { freq: 3000, gain: -7 },
      reverb: { mix: 0.3, decay: 1.1, preDelay: 25, damping: 0.55, size: 0.5 },
      width: 0.55,
      compressor: { threshold: -26, ratio: 4, attack: 0.01, release: 0.25, knee: 12, makeup: 4 },
      // The highest saturation in the set, and the one place the research
      // recommends accepting added roughness for character.
      saturation: 0.3,
      /*
       * 0.9 Hz at depth 0.35 is about 0.5 % speed deviation, i.e. ~8.7 cents —
       * roughly 10x a real cassette's 0.08 % spec. That is the point: real
       * machine specs are inaudible by design (the audibility threshold is
       * ~0.1 % WRMS), so a *characterful* wow needs 0.3-1.5 %.
       * 8 Hz is above the 6 Hz wow/flutter boundary.
       */
      wowFlutter: { wowRate: 0.9, wowDepth: 0.35, flutterRate: 8, flutterDepth: 0.14 },
      // 12 bits / 2x decimation is E-mu SP-1200 territory. Note the post-crush
      // lowpass is standard practice, not optional — the `tilt` above is it.
      bitcrush: { bits: 12, downsample: 2, mix: 0.25 },
      ambience: { kind: 'tape', level: -38, tone: 0.45 },
      drift: { rate: 0.04, depth: 1.6 },
    }),
    macro: macro([...COMMON_MACRO], [...TAPE_MACRO], [...CRUSH_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'library',
    name: 'Library',
    blurb: 'Barely touched — the song two desks away in a quiet reading room.',
    glyph: '📚',
    params: preset({
      outputGain: -6,
      highpass: { freq: 40, q: BUTTERWORTH_Q_LINEAR },
      lowShelf: { freq: 320, gain: 2 },
      lowpass: { freq: 3200, q: BUTTERWORTH_Q_LINEAR, stages: 1 },
      // The BBC / Gundry dip, exactly: 3 kHz, Q 3.0, -4.2 dB.
      presenceDip: { freq: 3000, q: 3, gain: -4.2 },
      // The SMPTE X-curve start point: flat to 2 kHz, then rolling off. The
      // film industry's codified "distance" EQ, and far more musical than a
      // brick-wall lowpass.
      tilt: { freq: 2000, gain: -4 },
      reverb: { mix: 0.22, decay: 0.8, preDelay: 12, damping: 0.45, size: 0.55 },
      width: 0.7,
      compressor: { threshold: -24, ratio: 3, attack: 0.02, release: 0.2, knee: 12, makeup: 2.5 },
      saturation: 0.02,
      // HVAC noise is LF-dominant: the weakest masker, but the lowest fatigue,
      // which is the right trade for an eight-hour preset. This should be the
      // default for first-time users.
      ambience: { kind: 'fan', level: -40, tone: 0.2 },
      drift: { rate: 0.02, depth: 0.8 },
    }),
    macro: macro([...COMMON_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'deep-focus',
    name: 'Deep Focus',
    blurb: 'The evidence-maximal setting. Nearly unrecognisable as music, maximally ignorable.',
    glyph: '🧠',
    params: preset({
      outputGain: -10,
      highpass: { freq: 45, q: BUTTERWORTH_Q_LINEAR },
      lowShelf: { freq: 380, gain: 6 },
      /*
       * Built from the four highest-confidence psychoacoustic targets rather
       * than from any sonic reference. 700 Hz at 36 dB/oct plus a -12 dB
       * presence dip plus a -12 dB tilt collapses the speech band toward the
       * <= 2 effective spectral channels shown to produce no irrelevant-sound
       * effect versus silence.
       */
      lowpass: { freq: 700, q: BUTTERWORTH_Q_LINEAR, stages: 3 },
      presenceDip: { freq: 2400, q: 1, gain: -12 },
      tilt: { freq: 1600, gain: -12 },
      reverb: { mix: 0.4, decay: 0.7, preDelay: 6, damping: 0.9, size: 0.35 },
      // True mono: removes up to 12 dB of spatial release from masking.
      width: 0,
      compressor: { threshold: -34, ratio: 10, attack: 0.002, release: 0.09, knee: 4, makeup: 7 },
      // Zero, not low: added roughness works against the goal.
      saturation: 0,
      wowFlutter: { wowRate: 0, wowDepth: 0, flutterRate: 0, flutterDepth: 0 },
      // Pink, approximating the NRC optimum masking contour — *not* brown,
      // which the research notes has zero supporting studies.
      ambience: { kind: 'pink', level: -30, tone: 0.3 },
      drift: { rate: 0.013, depth: 0.5 },
    }),
    macro: macro([...COMMON_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'distant-radio',
    name: 'Distant Radio',
    blurb: 'An AM station drifting in and out two rooms away.',
    glyph: '📻',
    params: preset({
      outputGain: -9,
      /*
       * WARNING, and it should reach the UI: this is a *stylistic* preset, not
       * a focus preset. Its 300-2700 Hz bandpass is almost exactly the
       * telephone band, which is the speech band — 500 Hz to 4 kHz carries
       * 78.7 % of intelligibility — so it *maximises* verbal interference.
       * Label it honestly and do not surface it as a focus option.
       *
       * This is also the one preset where a highpass is physically right: a
       * 50 mm transistor speaker genuinely cannot move air below ~300 Hz.
       */
      highpass: { freq: 300, q: BUTTERWORTH_Q_LINEAR },
      lowShelf: { freq: 400, gain: 0 },
      lowpass: { freq: 2700, q: BUTTERWORTH_Q_LINEAR, stages: 2 },
      presenceDip: { freq: 1800, q: 1, gain: -3 },
      tilt: { freq: 2000, gain: -3 },
      reverb: { mix: 0.4, decay: 1.3, preDelay: 35, damping: 0.5, size: 0.75 },
      width: 0.1,
      // Ratio 12 with a 0.3 s release mimics radio AGC.
      compressor: { threshold: -22, ratio: 12, attack: 0.004, release: 0.3, knee: 3, makeup: 8 },
      saturation: 0.22,
      wowFlutter: { wowRate: 0.7, wowDepth: 0.1, flutterRate: 11, flutterDepth: 0.08 },
      bitcrush: { bits: 10, downsample: 3, mix: 0.18 },
      ambience: { kind: 'white', level: -36, tone: 0.55 },
      // 2.5 dB is signal fading, and the only preset at the edge of the 2-3 dB
      // noticeability threshold — deliberately, because being noticed is the
      // point here.
      drift: { rate: 0.07, depth: 2.5 },
    }),
    macro: macro([...COMMON_MACRO], [...TAPE_MACRO], [...CRUSH_MACRO], [...AMBIENCE_MACRO]),
  },

  {
    id: 'dream',
    name: 'Dream',
    blurb: 'Vast, slow and slightly out of tune, like remembering the song rather than hearing it.',
    glyph: '☁️',
    params: preset({
      outputGain: -9,
      highpass: { freq: 45, q: BUTTERWORTH_Q_LINEAR },
      lowShelf: { freq: 300, gain: 4 },
      lowpass: { freq: 1400, q: 1.1, stages: 2 },
      presenceDip: { freq: 2600, q: 1.3, gain: -8 },
      tilt: { freq: 2000, gain: -8 },
      reverb: { mix: 0.6, decay: 4, preDelay: 60, damping: 0.5, size: 0.9 },
      // The only preset wider than the source, and therefore the *least*
      // effective at reducing attentional salience. It is an aesthetic preset
      // and the research is honest about that.
      width: 1.4,
      compressor: { threshold: -28, ratio: 5, attack: 0.008, release: 0.4, knee: 12, makeup: 5 },
      saturation: 0.12,
      // 0.15 Hz at depth 0.40 is about +/-20 cents.
      wowFlutter: { wowRate: 0.15, wowDepth: 0.4, flutterRate: 4.5, flutterDepth: 0.06 },
      ambience: { kind: 'pink', level: -42, tone: 0.5 },
      drift: { rate: 0.05, depth: 2 },
    }),
    macro: macro([...COMMON_MACRO], [...TAPE_MACRO], [...AMBIENCE_MACRO]),
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
 * Paths whose interpolation must be **geometric** rather than linear.
 *
 * Frequency is perceived logarithmically: morphing `lowpass.freq` from
 * 20000 Hz to 800 Hz linearly spends the first half of the dial travelling
 * from 20 kHz to 10.4 kHz — almost inaudible — and then dumps nearly four
 * octaves into the second half. Geometric interpolation makes the dial feel
 * like a constant rate of muffling, which is the entire purpose of a macro.
 * §8.5 is explicit about this.
 *
 * `reverb.decay` is in the same family (doubling time is one perceptual step),
 * and so are `lowpass.q` and `bitcrush.downsample`, which are ratios.
 *
 * Every *gain* is already stored in dB in `DampenParams`, so interpolating
 * those linearly is already interpolating in dB — which is what §8.5 asks for.
 */
const GEOMETRIC_PATHS: ReadonlySet<string> = new Set([
  'lowpass.freq',
  'lowpass.q',
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
 * slot and goes through the generic dot-path walk below.
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
