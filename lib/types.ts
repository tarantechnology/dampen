/**
 * Dampen — shared contract types.
 *
 * This file is the interface boundary between the audio engine, the Spotify
 * layer and the UI. Treat it as frozen: if you need a change here, it affects
 * every other module.
 */

/* ------------------------------------------------------------------ *
 * DSP parameters
 * ------------------------------------------------------------------ */

/** Cascaded biquad lowpass — the "wall" between you and the music. */
export interface LowpassParams {
  /** Cutoff in Hz. 20000 = effectively open. */
  freq: number;
  /** Resonance. Keep <= 1.0 or the cutoff whistles. */
  q: number;
  /** Cascade count. Each stage adds ~12 dB/oct. 1..4 => 12..48 dB/oct. */
  stages: 1 | 2 | 3 | 4;
}

export interface HighpassParams {
  freq: number;
  q: number;
}

/** Parametric peaking filter. Negative gain = a dip. */
export interface PeakParams {
  freq: number;
  q: number;
  /** dB. */
  gain: number;
}

export interface ShelfParams {
  freq: number;
  /** dB. */
  gain: number;
}

export interface ReverbParams {
  /** 0..1 wet mix. */
  mix: number;
  /** RT60 in seconds. */
  decay: number;
  /** Pre-delay in ms — distance cue. */
  preDelay: number;
  /** 0..1, how fast highs die inside the tail. 1 = very dark tail. */
  damping: number;
  /** 0..1 perceived room size; shapes early reflections. */
  size: number;
}

export interface CompressorParams {
  /** dBFS. */
  threshold: number;
  ratio: number;
  /** seconds. */
  attack: number;
  /** seconds. */
  release: number;
  /** dB. */
  knee: number;
  /** dB of makeup gain applied after. */
  makeup: number;
}

export interface WowFlutterParams {
  /** Hz, slow pitch drift (tape wow). Typically 0.5–2 Hz. */
  wowRate: number;
  /** 0..1 depth. */
  wowDepth: number;
  /** Hz, fast warble (tape flutter). Typically 6–12 Hz. */
  flutterRate: number;
  /** 0..1 depth. */
  flutterDepth: number;
}

export interface BitcrushParams {
  /** Effective bit depth, 1..16. 16 = transparent. */
  bits: number;
  /** Sample-hold divisor, 1..32. 1 = no downsampling. */
  downsample: number;
  /** 0..1 blend against the clean signal. */
  mix: number;
}

export type AmbienceKind =
  | 'none'
  | 'brown'
  | 'pink'
  | 'white'
  | 'rain'
  | 'vinyl'
  | 'tape'
  | 'cafe'
  | 'river'
  | 'fan';

export interface AmbienceParams {
  kind: AmbienceKind;
  /** Level in dBFS. -Infinity..0. Around -32 dB is a typical masking bed. */
  level: number;
  /** 0..1 spectral tilt applied to the bed. 0 = dark, 1 = bright. */
  tone: number;
}

/** Slow gain breathing, so the music never sits still enough to grab focus. */
export interface DriftParams {
  /** Hz. Very slow — 0.01–0.2 Hz. */
  rate: number;
  /** dB of peak deviation. */
  depth: number;
}

/** The complete DSP state. Every field is always present. */
export interface DampenParams {
  /** Macro 0..1. The UI's single big dial; presets define how it scales. */
  amount: number;
  /** dB of final output trim. */
  outputGain: number;

  highpass: HighpassParams;
  lowShelf: ShelfParams;
  lowpass: LowpassParams;
  presenceDip: PeakParams;
  tilt: ShelfParams;

  reverb: ReverbParams;

  /** 0 = mono, 1 = original stereo, 2 = double-wide. */
  width: number;

  compressor: CompressorParams;

  /** 0..1 soft-clip drive. */
  saturation: number;
  wowFlutter: WowFlutterParams;
  bitcrush: BitcrushParams;

  ambience: AmbienceParams;
  drift: DriftParams;
}

/* ------------------------------------------------------------------ *
 * Presets
 * ------------------------------------------------------------------ */

export interface Preset {
  id: string;
  name: string;
  /** One line, user-facing. What it feels like. */
  blurb: string;
  /** Emoji or short glyph for the preset rack. */
  glyph: string;
  /** Full parameter set at amount = 1. */
  params: DampenParams;
  /**
   * Which params the macro dial interpolates, and toward what neutral value.
   * amount=0 => neutral, amount=1 => params. Paths are dot paths into
   * DampenParams, e.g. "lowpass.freq".
   */
  macro?: Array<{ path: string; neutral: number }>;
}

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */

export type DampenSource =
  | { kind: 'none' }
  | { kind: 'element'; el: HTMLMediaElement }
  | { kind: 'stream'; stream: MediaStream }
  | { kind: 'buffer'; buffer: AudioBuffer; loop?: boolean };

export type EngineStatus = 'idle' | 'initializing' | 'running' | 'suspended' | 'error';

export interface EngineMeters {
  /** Peak level, dBFS, pre-DSP. */
  inputPeak: number;
  /** Peak level, dBFS, post-DSP. */
  outputPeak: number;
  /** RMS, dBFS, post-DSP. */
  outputRms: number;
  /** Gain reduction currently applied by the compressor, dB (negative). */
  reduction: number;
}

/** How the user is feeding audio in. */
export type InputMode = 'spotify' | 'capture' | 'local';
