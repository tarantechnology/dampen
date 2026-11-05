/**
 * The advanced panel's description of `DampenParams`.
 *
 * Ranges mirror `PARAM_RANGES` in lib/audio/params.ts exactly — the engine
 * sanitises everything anyway, but a slider that can reach a value the engine
 * will clamp is a lying slider.
 *
 * Note `highpass.q` / `lowpass.q`: `DampenParams` carries these as *linear*
 * Q, where 0.707 is Butterworth. The engine converts to the decibel figure
 * `BiquadFilterNode` wants; nothing in the UI ever sees that conversion.
 */

import type { AmbienceKind, DampenParams } from '@/lib/types';
import {
  formatDb,
  formatHz,
  formatInt,
  formatMs,
  formatPercent,
  formatRatio,
  formatSeconds,
} from '@/components/ui/format';
import type { SliderScale } from '@/components/ui/Slider';

export type ParamUnit =
  | 'hz'
  | 'lfo'
  | 'db'
  | 'ms'
  | 's'
  | 'ratio'
  | 'pct'
  | 'int'
  | 'div'
  | 'x';

export interface ParamSpec {
  /** Dot path into `DampenParams`, as `setParam` expects it. */
  path: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  scale?: SliderScale;
  unit: ParamUnit;
  /** Fill from the centre — for anything that can be negative or positive. */
  bipolar?: boolean;
  /** Multiplies the stored value for display only (seconds -> ms). */
  factor?: number;
  hint?: string;
}

export interface ParamGroup {
  id: string;
  name: string;
  /** One line explaining what this group does to the sound. */
  blurb: string;
  params: ParamSpec[];
}

export function formatParam(spec: ParamSpec, value: number): string {
  const v = spec.factor ? value * spec.factor : value;
  switch (spec.unit) {
    case 'hz':
      return formatHz(v);
    case 'lfo':
      return `${v.toFixed(2)} Hz`;
    case 'db':
      return formatDb(v);
    case 'ms':
      return formatMs(v);
    case 's':
      return formatSeconds(v);
    case 'ratio':
      return formatRatio(v);
    case 'pct':
      return formatPercent(v);
    case 'int':
      return formatInt(v);
    case 'div':
      return `÷${formatInt(v)}`;
    case 'x':
      return `${v.toFixed(2)}×`;
    default:
      return v.toFixed(2);
  }
}

export const PARAM_GROUPS: ParamGroup[] = [
  {
    id: 'wall',
    name: 'Wall',
    blurb: 'The structure between you and the music. Everything else is decoration.',
    params: [
      {
        path: 'lowpass.freq',
        label: 'Lowpass',
        min: 120,
        max: 20000,
        scale: 'log',
        unit: 'hz',
        hint: 'The wall itself. Below about 800 Hz it stops sounding like music and starts sounding like a room.',
      },
      {
        path: 'lowpass.stages',
        label: 'Stages',
        min: 1,
        max: 4,
        step: 1,
        unit: 'int',
        hint: 'Each stage adds 12 dB/oct. Four is a brick wall.',
      },
      {
        path: 'lowpass.q',
        label: 'Lowpass resonance',
        min: 0.1,
        max: 8,
        step: 0.05,
        unit: 'x',
        hint: 'Linear Q. 0.71 is maximally flat; past about 2 the cutoff whistles.',
      },
      {
        path: 'highpass.freq',
        label: 'Highpass',
        min: 10,
        max: 2000,
        scale: 'log',
        unit: 'hz',
        hint: 'Walls do not pass sub-bass either. Lifting this thins the whole thing out.',
      },
      {
        path: 'highpass.q',
        label: 'Highpass resonance',
        min: 0.1,
        max: 8,
        step: 0.05,
        unit: 'x',
      },
      {
        path: 'lowShelf.freq',
        label: 'Low shelf',
        min: 40,
        max: 600,
        scale: 'log',
        unit: 'hz',
      },
      {
        path: 'lowShelf.gain',
        label: 'Low shelf gain',
        min: -24,
        max: 24,
        step: 0.5,
        unit: 'db',
        bipolar: true,
        hint: 'A little lift here is what makes a muffled mix still feel like it has a floor.',
      },
      {
        path: 'presenceDip.freq',
        label: 'Presence dip',
        min: 400,
        max: 8000,
        scale: 'log',
        unit: 'hz',
        hint: '1–5 kHz is the band your attention lives in. Dipping it is why this works.',
      },
      {
        path: 'presenceDip.q',
        label: 'Dip width',
        min: 0.1,
        max: 10,
        step: 0.1,
        unit: 'x',
      },
      {
        path: 'presenceDip.gain',
        label: 'Dip depth',
        min: -30,
        max: 12,
        step: 0.5,
        unit: 'db',
        bipolar: true,
      },
      { path: 'tilt.freq', label: 'Tilt pivot', min: 500, max: 10000, scale: 'log', unit: 'hz' },
      {
        path: 'tilt.gain',
        label: 'Tilt',
        min: -24,
        max: 12,
        step: 0.5,
        unit: 'db',
        bipolar: true,
        hint: 'Negative darkens everything above the pivot.',
      },
    ],
  },
  {
    id: 'space',
    name: 'Space',
    blurb: 'How far away the room sounds. Distance is a strong cue for "not for me".',
    params: [
      { path: 'reverb.mix', label: 'Mix', min: 0, max: 1, step: 0.01, unit: 'pct' },
      { path: 'reverb.decay', label: 'Decay', min: 0.05, max: 8, step: 0.05, unit: 's' },
      {
        path: 'reverb.preDelay',
        label: 'Pre-delay',
        min: 0,
        max: 250,
        step: 1,
        unit: 'ms',
        hint: 'The gap before the room answers. Longer reads as further away.',
      },
      {
        path: 'reverb.damping',
        label: 'Damping',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'pct',
        hint: 'How fast the highs die inside the tail. High values give a dark room.',
      },
      { path: 'reverb.size', label: 'Size', min: 0, max: 1, step: 0.01, unit: 'pct' },
    ],
  },
  {
    id: 'width',
    name: 'Width',
    blurb: 'Collapsing the stereo image pulls the music into one spot you can ignore.',
    params: [
      {
        path: 'width',
        label: 'Stereo width',
        min: 0,
        max: 2,
        step: 0.01,
        unit: 'x',
        hint: '0 is mono, 1 is as recorded, 2 is double-wide.',
      },
    ],
  },
  {
    id: 'dynamics',
    name: 'Dynamics',
    blurb: 'Flattening the peaks stops a chorus pulling your head up from the page.',
    params: [
      {
        path: 'compressor.threshold',
        label: 'Threshold',
        min: -100,
        max: 0,
        step: 0.5,
        unit: 'db',
      },
      { path: 'compressor.ratio', label: 'Ratio', min: 1, max: 20, step: 0.1, unit: 'ratio' },
      {
        path: 'compressor.attack',
        label: 'Attack',
        min: 0,
        max: 1,
        step: 0.001,
        unit: 'ms',
        factor: 1000,
      },
      {
        path: 'compressor.release',
        label: 'Release',
        min: 0,
        max: 1,
        step: 0.005,
        unit: 'ms',
        factor: 1000,
      },
      { path: 'compressor.knee', label: 'Knee', min: 0, max: 40, step: 0.5, unit: 'db' },
      {
        path: 'compressor.makeup',
        label: 'Makeup',
        min: -12,
        max: 24,
        step: 0.5,
        unit: 'db',
        bipolar: true,
      },
    ],
  },
  {
    id: 'character',
    name: 'Character',
    blurb: 'Wear and tear. Nothing degraded ever sounds urgent.',
    params: [
      {
        path: 'saturation',
        label: 'Saturation',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'pct',
        hint: 'Soft clipping. Rounds transients off before they can startle you.',
      },
      { path: 'wowFlutter.wowRate', label: 'Wow rate', min: 0, max: 8, step: 0.05, unit: 'lfo' },
      { path: 'wowFlutter.wowDepth', label: 'Wow depth', min: 0, max: 1, step: 0.01, unit: 'pct' },
      {
        path: 'wowFlutter.flutterRate',
        label: 'Flutter rate',
        min: 0,
        max: 24,
        step: 0.1,
        unit: 'lfo',
      },
      {
        path: 'wowFlutter.flutterDepth',
        label: 'Flutter depth',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'pct',
      },
      { path: 'bitcrush.bits', label: 'Bit depth', min: 1, max: 16, step: 1, unit: 'int' },
      {
        path: 'bitcrush.downsample',
        label: 'Downsample',
        min: 1,
        max: 32,
        step: 1,
        unit: 'div',
        hint: 'Sample-and-hold divisor. 1 is off.',
      },
      { path: 'bitcrush.mix', label: 'Crush mix', min: 0, max: 1, step: 0.01, unit: 'pct' },
    ],
  },
  {
    id: 'ambience',
    name: 'Ambience',
    blurb: 'A bed of noise that masks whatever is left poking through.',
    params: [
      {
        path: 'ambience.level',
        label: 'Level',
        min: -90,
        max: 0,
        step: 0.5,
        unit: 'db',
        hint: 'Around −32 dB is a typical masking bed. Below −90 dB it is off.',
      },
      {
        path: 'ambience.tone',
        label: 'Tone',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'pct',
        hint: '0 is dark, 1 is bright.',
      },
    ],
  },
  {
    id: 'drift',
    name: 'Drift',
    blurb: 'A very slow breathe, so the music never sits still enough to grab you.',
    params: [
      { path: 'drift.rate', label: 'Rate', min: 0, max: 2, step: 0.01, unit: 'lfo' },
      {
        path: 'drift.depth',
        label: 'Depth',
        min: 0,
        max: 12,
        step: 0.1,
        unit: 'db',
        hint: 'Peak deviation. Over about 3 dB you start to notice it.',
      },
    ],
  },
];

export const AMBIENCE_OPTIONS: ReadonlyArray<{ value: AmbienceKind; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'brown', label: 'Brown noise' },
  { value: 'pink', label: 'Pink noise' },
  { value: 'white', label: 'White noise' },
  { value: 'rain', label: 'Rain' },
  { value: 'vinyl', label: 'Vinyl surface' },
  { value: 'tape', label: 'Tape hiss' },
  { value: 'cafe', label: 'Café' },
  { value: 'river', label: 'River' },
  { value: 'fan', label: 'Fan' },
];

/**
 * Write a leaf into a copy of `DampenParams` by dot path.
 *
 * The engine owns this operation for real (`setParamPath` in
 * lib/audio/params.ts); this version exists so the /design route can drive
 * the same controls against fixtures without importing the engine.
 */
export function writeParam(
  params: DampenParams,
  path: string,
  value: number | string,
): DampenParams {
  const parts = path.split('.');
  const next: Record<string, unknown> = { ...(params as unknown as Record<string, unknown>) };
  let node = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const child = node[parts[i]];
    if (typeof child !== 'object' || child === null) return params;
    const copy = { ...(child as Record<string, unknown>) };
    node[parts[i]] = copy;
    node = copy;
  }
  node[parts[parts.length - 1]] = value;
  return next as unknown as DampenParams;
}

/** Read a numeric leaf out of `DampenParams` by dot path. */
export function readParam(params: DampenParams, path: string): number {
  const parts = path.split('.');
  let node: unknown = params;
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return 0;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'number' && Number.isFinite(node) ? node : 0;
}

/** Headline summary for the collapsed Advanced row. */
export function summariseParams(params: DampenParams): string {
  const stages = params.lowpass.stages;
  const bits = [`${formatHz(params.lowpass.freq)} ×${stages}`];
  if (params.reverb.mix > 0.02) bits.push(`${formatPercent(params.reverb.mix)} space`);
  if (params.ambience.kind !== 'none' && params.ambience.level > -89) {
    bits.push(`${params.ambience.kind} ${formatDb(params.ambience.level)}`);
  }
  return bits.join('  ·  ');
}
