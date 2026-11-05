/**
 * Dampen — procedural impulse responses.
 *
 * No IR asset files. Everything the convolver ever plays is synthesised here,
 * which keeps the bundle small, makes the reverb fully parametric, and means
 * `reverb.size` can genuinely change the *geometry* of the early reflections
 * rather than just crossfading between two canned halls.
 *
 * The model is deliberately not a concert hall. Dampen's reverb has one job:
 * sell the idea that the music is happening *somewhere else* — through a wall,
 * down a corridor, in the next room. That sound is characterised by
 *
 *   1. a short pre-delay (tens of ms — the extra path length),
 *   2. a **sparse** set of **strong, lowpassed** early reflections (the facing
 *      wall, the floor, the door frame) rather than a smooth diffuse wash, and
 *   3. a diffuse tail that gets *darker* as it decays, because every extra
 *      bounce costs the signal more high frequency than low.
 *
 * `renderRoomIR` is pure: `(options, sampleRate) -> Float32Array[]`. That is
 * what makes the envelope and normalisation testable in Node with no
 * `AudioContext`. `buildRoomIR` is the thin Web Audio wrapper.
 */

import type { ReverbParams } from '@/lib/types';
import { clamp, lerp, num } from './dsp';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/**
 * `ln(1000) = 6.907755…`
 *
 * RT60 is defined as the time for the tail to fall by 60 dB, i.e. to 1/1000 of
 * its initial amplitude. An exponential envelope `exp(-t·k/decay)` reaches
 * `exp(-k)` at `t = decay`, so `k = ln(1000)` makes `t = decay` land on
 * exactly −60 dB. Every reverb that claims an RT60 in seconds is using this
 * number somewhere.
 */
export const LN1000 = 6.907755278982137;

/**
 * Render a little past RT60 so the truncation happens below −60 dB rather than
 * exactly at it. 1.12 puts the cut at about −67 dB, inaudible under the tail.
 */
const TAIL_OVERSHOOT = 1.12;

/** Hard ceiling on IR length. A 3 s stereo IR at 48 kHz is already ~1.1 MB. */
const MAX_IR_SECONDS = 9;

/** Raised-cosine fade applied to the very end, so the cut is not a step. */
const END_FADE_SECONDS = 0.006;

/**
 * Irrational-ish multipliers for the early-reflection arrival times.
 *
 * These must not be small-integer ratios: integer ratios make the reflections
 * line up into a periodic comb, which the ear hears as a metallic pitched
 * ring ("flutter echo") instead of a room. The values below are mutually
 * non-commensurate to within the precision that matters.
 */
const ER_RATIOS = [1.0, 1.61, 2.37, 3.11, 4.29, 5.53, 7.01, 8.73, 10.9] as const;

/** Deterministic ±1 pattern for reflection polarity (see `renderRoomIR`). */
const ER_SIGNS = [1, -1, 1, 1, -1, -1, 1, -1, 1] as const;

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

/** The subset of `ReverbParams` that actually shapes the impulse response. */
export type RoomIROptions = Pick<ReverbParams, 'decay' | 'preDelay' | 'damping' | 'size'>;

/** Clamp IR options into the range the renderer is designed for. */
export function normalizeIROptions(o: Partial<RoomIROptions>): RoomIROptions {
  return {
    decay: num(o.decay, 1.2, 0.05, 8),
    preDelay: num(o.preDelay, 20, 0, 250),
    damping: num(o.damping, 0.5, 0, 1),
    size: num(o.size, 0.5, 0, 1),
  };
}

/**
 * Cache key with the parameters quantised to just-noticeable steps.
 *
 * Rebuilding a 3 s stereo IR costs a few hundred thousand `Math.random()`
 * calls plus a filter pass per channel — single-digit milliseconds, but on the
 * main thread and triggered by a slider drag, which would be dozens of
 * rebuilds per second. Quantising first means a drag across the whole decay
 * range produces ~160 distinct keys instead of thousands, and a one-pixel
 * wiggle produces none at all. The sample rate is part of the key because an
 * `AudioBuffer` is only valid for the rate it was rendered at.
 */
export function irCacheKey(o: RoomIROptions, sampleRate: number): string {
  const q = (v: number, step: number) => Math.round(v / step) * step;
  return [
    Math.round(sampleRate),
    q(o.decay, 0.05).toFixed(2),
    q(o.preDelay, 1).toFixed(0),
    q(o.damping, 0.02).toFixed(2),
    q(o.size, 0.02).toFixed(2),
  ].join('/');
}

/* ------------------------------------------------------------------ *
 * The renderer
 * ------------------------------------------------------------------ */

/**
 * The exponential decay envelope, exposed for tests.
 *
 * `envelopeAt(decay, decay) === 0.001` (−60 dB) by construction.
 */
export function envelopeAt(decay: number, t: number): number {
  if (t <= 0) return 1;
  return Math.exp((-t * LN1000) / decay);
}

/**
 * One-pole lowpass coefficient for a given corner frequency.
 *
 *   y[n] = y[n-1] + a·(x[n] − y[n-1]),   a = 1 − exp(−2π·fc/fs)
 *
 * This is the standard RC-equivalent form: `a` is the fraction of the gap the
 * filter closes per sample, and the exponential makes the mapping exact rather
 * than the usual `a ≈ 2π·fc/fs` small-angle approximation (which goes badly
 * wrong once fc approaches fs/4, as it does at the bright end of the tail).
 */
function onePoleCoeff(fc: number, sampleRate: number): number {
  const f = clamp(fc, 20, sampleRate * 0.49);
  return 1 - Math.exp((-2 * Math.PI * f) / sampleRate);
}

/**
 * Render a stereo room impulse response.
 *
 * @param opts       decay (RT60, s), preDelay (ms), damping 0..1, size 0..1
 * @param sampleRate target context sample rate
 * @param rng        injectable uniform [0,1) source; defaults to `Math.random`.
 *                   Tests pass a seeded generator so assertions are stable.
 * @returns          `[left, right]`, energy-normalised, pre-delay included
 */
export function renderRoomIR(
  opts: Partial<RoomIROptions>,
  sampleRate: number,
  rng: () => number = Math.random,
): Float32Array<ArrayBuffer>[] {
  const { decay, preDelay, damping, size } = normalizeIROptions(opts);
  const fs = num(sampleRate, 48000, 8000, 192000);

  const preSamples = Math.round((preDelay / 1000) * fs);
  const tailSeconds = Math.min(decay * TAIL_OVERSHOOT, MAX_IR_SECONDS);
  const tailSamples = Math.max(1, Math.round(tailSeconds * fs));
  const total = preSamples + tailSamples;

  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const channels = [left, right];

  /*
   * Tail brightness. `damping` slides both ends of a glide down:
   *   damping 0 -> 16 kHz decaying to 8 kHz    (a tiled bathroom)
   *   damping 1 ->  5 kHz decaying to 350 Hz   (through a closed door)
   *
   * The glide itself is geometric in frequency (constant octaves per second),
   * because that is how the ear measures "getting darker"; a linear-in-Hz
   * sweep spends almost all its time in a range you cannot hear changing.
   */
  const fcStart = lerp(16000, 5000, damping);
  const fcEnd = lerp(8000, 350, damping);
  const fcRatio = fcEnd / fcStart;

  for (let ch = 0; ch < channels.length; ch++) {
    const buf = channels[ch];
    let lp = 0;

    for (let i = 0; i < tailSamples; i++) {
      const t = i / fs;
      const frac = i / tailSamples;

      // Independent noise per channel. Two uncorrelated noise tails is the
      // whole trick for a wide, non-point-source reverb: a shared tail would
      // image hard in the centre of the head.
      const white = rng() * 2 - 1;

      // Progressive damping: the corner walks from fcStart to fcEnd across the
      // tail, so sample 0 is bright and the last sample is as dark as
      // `damping` asks for.
      const a = onePoleCoeff(fcStart * Math.pow(fcRatio, frac), fs);
      lp += a * (white - lp);

      /*
       * A one-pole lowpass at corner fc has a passband gain of 1 but an
       * *output RMS* on white noise of roughly sqrt(a/(2-a)) — i.e. the darker
       * the filter, the quieter it gets. Left uncompensated the tail would
       * fade faster than the envelope says it should, and heavily damped
       * rooms would come out far too short. Dividing by that factor restores
       * unit-variance noise before the envelope is applied.
       */
      const lpNorm = Math.sqrt((2 - a) / a);

      buf[i + preSamples] = lp * lpNorm * envelopeAt(decay, t);
    }
  }

  injectEarlyReflections(channels, { fs, preSamples, tailSamples, decay, size, damping });
  applyEndFade(channels, fs);
  normalizeEnergy(channels);

  return channels;
}

/**
 * Stamp discrete early reflections on top of the diffuse tail.
 *
 * An adjacent room does not sound diffuse. You hear a handful of distinct,
 * strong, dull slaps — and that sparseness is exactly what tells the listener
 * "small space, over there" rather than "large hall, all around". So each
 * reflection is a short exponential burst (not a bare Dirac, which would be
 * full-bandwidth and read as a click rather than as a surface), arriving at a
 * time proportional to `size`, with slightly different delays in L and R so
 * the room has a direction.
 */
function injectEarlyReflections(
  channels: Float32Array[],
  cfg: {
    fs: number;
    preSamples: number;
    tailSamples: number;
    decay: number;
    size: number;
    damping: number;
  },
): void {
  const { fs, preSamples, tailSamples, decay, size, damping } = cfg;

  /*
   * Base path difference. Sound travels ~34 cm per ms, so:
   *   size 0 ->  4 ms  (~1.4 m round trip: a cupboard, a stairwell)
   *   size 1 -> 45 ms  (~15 m round trip: a hall beyond the door)
   */
  const spacingMs = lerp(4, 45, size);

  /*
   * Burst length — how dull each slap is. 0.25 ms is a bright, hard surface;
   * 1.6 ms puts the energy below ~600 Hz, which is what a plaster wall with a
   * door in front of it actually returns.
   */
  const burstSamples = Math.max(2, Math.round((lerp(0.25, 1.6, damping) / 1000) * fs));
  const tau = burstSamples / 3; // 3 time constants inside the burst -> -26 dB

  /* Larger rooms absorb proportionally more per bounce, so reflections in a
   * big space are individually weaker relative to the tail. */
  const baseAmp = lerp(0.95, 0.5, size);

  for (let ch = 0; ch < channels.length; ch++) {
    const buf = channels[ch];
    // ±7 % path-length asymmetry between ears. Enough for a direction, small
    // enough that it never reads as two separate rooms.
    const skew = ch === 0 ? 0.93 : 1.07;

    for (let r = 0; r < ER_RATIOS.length; r++) {
      const tSec = (spacingMs * ER_RATIOS[r] * skew) / 1000;
      const start = preSamples + Math.round(tSec * fs);
      if (start >= preSamples + tailSamples - 2) break;

      // Each successive bounce loses energy; combine the per-bounce loss with
      // the room's own RT60 envelope so reflections never outlive the tail.
      const amp = baseAmp * (1 / (1 + r * 0.55)) * envelopeAt(decay, tSec) * ER_SIGNS[r];

      for (let k = 0; k < burstSamples; k++) {
        const idx = start + k;
        if (idx >= buf.length) break;
        buf[idx] += amp * Math.exp(-k / tau);
      }
    }
  }
}

/** Raised-cosine fade on the last few ms so truncation is not a step edge. */
function applyEndFade(channels: Float32Array[], fs: number): void {
  const n = Math.min(Math.round(END_FADE_SECONDS * fs), channels[0].length);
  if (n < 2) return;
  for (const buf of channels) {
    const off = buf.length - n;
    for (let i = 0; i < n; i++) {
      buf[off + i] *= 0.5 * (1 + Math.cos((Math.PI * i) / (n - 1)));
    }
  }
}

/**
 * Energy-normalise so that **changing `decay` does not change loudness**.
 *
 * For a noise-like impulse response `h`, convolving a signal of RMS `x` yields
 * an output of RMS `x·sqrt(Σh²)`. Scaling every channel by `1/sqrt(mean(Σh²))`
 * therefore pins the convolver at unity RMS gain, independent of how long or
 * how bright the tail is — which is what makes `reverb.mix` a meaningful
 * crossfade instead of a volume control that happens to add reverb.
 *
 * The mean is taken *across* channels rather than per channel so the L/R
 * balance that the decorrelated noise and skewed reflections created is
 * preserved; normalising each channel separately would force both to the same
 * energy and squash the image back towards the centre.
 *
 * Note that the engine sets `ConvolverNode.normalize = false` precisely so
 * that this normalisation is the only one in play. The browser's own
 * normalisation is a different (loudness-ish, spec-defined) scheme and would
 * fight this one.
 */
export function normalizeEnergy(channels: Float32Array[]): number {
  let sumSq = 0;
  let count = 0;
  for (const buf of channels) {
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      if (!Number.isFinite(v)) {
        buf[i] = 0;
        continue;
      }
      sumSq += v * v;
      count++;
    }
  }
  if (sumSq <= 0 || count === 0) return 0;

  const meanEnergyPerChannel = sumSq / channels.length;
  const gain = 1 / Math.sqrt(meanEnergyPerChannel);
  if (!Number.isFinite(gain)) return 0;

  for (const buf of channels) {
    for (let i = 0; i < buf.length; i++) buf[i] *= gain;
  }
  return gain;
}

/* ------------------------------------------------------------------ *
 * Web Audio wrapper
 * ------------------------------------------------------------------ */

/**
 * Build a stereo `AudioBuffer` room impulse response for `ctx`.
 *
 * Synchronous and main-thread: it is debounced and cached by the engine (see
 * `irCacheKey`), never called per-frame.
 */
export function buildRoomIR(ctx: BaseAudioContext, opts: Partial<RoomIROptions>): AudioBuffer {
  const channels = renderRoomIR(opts, ctx.sampleRate);
  const buffer = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
  for (let ch = 0; ch < channels.length; ch++) {
    buffer.copyToChannel(channels[ch], ch);
  }
  return buffer;
}
