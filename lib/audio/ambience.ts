/**
 * Dampen — the ambience bed.
 *
 * ```
 *  noise worklet ─▶ kind shaping (HP + LP) ─▶ tilt (lo shelf + hi shelf) ─▶ level ─▶ out
 * ```
 *
 * The bed is a masker, not a sound effect. Its job is to raise the listener's
 * detection threshold across the band where the music's remaining detail
 * lives, so that the brain's "is there information here?" process returns no
 * and gives up. A few dB of broadband bed does more for unobtrusiveness than
 * another 6 dB of lowpass, and it does it without making the music sound
 * broken.
 *
 * Three design decisions worth stating:
 *
 *  1. **The bed sits inside the dampen (wet) path**, so toggling bypass takes
 *     the bed with it. Bypass means "let me hear the music properly", and
 *     leaving a rain loop running under it would be absurd.
 *  2. **`kind: 'none'` disconnects the branch.** Not "sets gain to zero" —
 *     disconnects. An unreachable source node stops being pulled by the
 *     rendering graph, so a bed that is switched off costs literally nothing.
 *     The processor is *also* told, so if it somehow stays reachable it fills
 *     zeros instead of running a generator.
 *  3. **`level: -Infinity` is exact silence.** `dbToLin(-Infinity)` is `0`, and
 *     the level gain is ramped to a true zero rather than to −90 dB.
 */

import type { AmbienceKind, AmbienceParams } from '@/lib/types';
import { BUTTERWORTH_Q_DB, clamp, dbToLin, num } from './dsp';
import { canUse, type WorkletStatus } from './worklets';

/* ------------------------------------------------------------------ *
 * Per-kind shaping
 * ------------------------------------------------------------------ */

interface KindShape {
  /** Post-generator highpass corner, Hz. Removes rumble the kind should not have. */
  readonly hp: number;
  /** Post-generator lowpass corner, Hz. Sets how "close" the bed sits. */
  readonly lp: number;
}

/**
 * The generators already carry most of the character; these are the final
 * placement filters. The numbers say where in the room the bed is:
 * a high `hp` pushes it away from the body of the mix, a low `lp` puts it
 * behind you rather than in front.
 */
const SHAPES: Readonly<Record<AmbienceKind, KindShape>> = {
  none: { hp: 20, lp: 20000 },
  // Pure colours stay essentially unshaped so they remain reference signals.
  white: { hp: 30, lp: 18000 },
  pink: { hp: 25, lp: 18000 },
  // Brown is the deep-focus bed: anything above 2 kHz in it is just hiss.
  brown: { hp: 22, lp: 2500 },
  // Rain is almost all mid/high; cutting below 300 Hz stops it muddying bass.
  rain: { hp: 300, lp: 11000 },
  // Vinyl surface noise lives in a narrow dull band.
  vinyl: { hp: 60, lp: 6000 },
  tape: { hp: 90, lp: 12000 },
  // Café: keep the speech band, lose the rumble of an imaginary HVAC.
  cafe: { hp: 120, lp: 4500 },
  river: { hp: 180, lp: 13000 },
  // A fan is felt more than heard.
  fan: { hp: 30, lp: 1800 },
} as const;

/**
 * Tilt range, in dB, at the extremes of `tone`.
 *
 * `tone` is a single knob that must go from "distant and dark" to "close and
 * bright" without changing perceived loudness, so it is implemented as a true
 * *tilt*: a low shelf and a high shelf hinged at 900 Hz moving in opposite
 * directions. ±9 dB is enough to take rain from "behind double glazing" to
 * "window open" while keeping the broadband energy roughly constant, which a
 * single shelf could not do.
 */
const TILT_RANGE_DB = 9;
const TILT_HINGE_HZ = 900;

/* ------------------------------------------------------------------ *
 * The bed
 * ------------------------------------------------------------------ */

export interface AmbienceBed {
  /** Connect this into the wet bus. */
  readonly output: AudioNode;
  /** True if the noise worklet loaded; false means the bed is permanently silent. */
  readonly available: boolean;
  /**
   * Apply parameters. Every gain and filter frequency is ramped, so changing
   * `kind` mid-listen crossfades instead of cutting.
   */
  setParams(p: AmbienceParams, rampMs: number): void;
  /** Disconnect and release the generator. Safe to call twice. */
  dispose(): void;
}

/** A silent stand-in used when the noise worklet is unavailable. */
function createSilentBed(ctx: BaseAudioContext): AmbienceBed {
  const output = ctx.createGain();
  output.gain.value = 0;
  return {
    output,
    available: false,
    setParams(): void {
      /* nothing to do: there is no generator to drive */
    },
    dispose(): void {
      try {
        output.disconnect();
      } catch {
        /* already detached */
      }
    },
  };
}

/**
 * Build the ambience bed for `ctx`.
 *
 * @param status the resolved {@link WorkletStatus}; if `dampen-noise` is not
 *               loaded, a silent stand-in is returned so that the caller's
 *               graph wiring and `setParams` calls stay unconditional.
 */
export function createAmbienceBed(ctx: BaseAudioContext, status: WorkletStatus): AmbienceBed {
  if (!canUse(status, 'dampen-noise')) return createSilentBed(ctx);

  let noise: AudioWorkletNode;
  try {
    noise = new AudioWorkletNode(ctx, 'dampen-noise', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      // A generator has no input, so the output channel count must be stated.
      outputChannelCount: [2],
    });
  } catch {
    // Registered-but-unconstructible should not happen, but a thrown
    // constructor here would take the whole engine down with it.
    return createSilentBed(ctx);
  }

  const nyquist = ctx.sampleRate / 2;

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  // Decibels, not a linear Q — see BUTTERWORTH_Q_DB. 0 here would be a
  // +1.25 dB bump at the corner, which a masking bed must not have.
  hp.Q.value = BUTTERWORTH_Q_DB;
  hp.frequency.value = SHAPES.none.hp;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = BUTTERWORTH_Q_DB;
  lp.frequency.value = Math.min(SHAPES.none.lp, nyquist * 0.98);

  const tiltLow = ctx.createBiquadFilter();
  tiltLow.type = 'lowshelf';
  tiltLow.frequency.value = TILT_HINGE_HZ;
  tiltLow.gain.value = 0;

  const tiltHigh = ctx.createBiquadFilter();
  tiltHigh.type = 'highshelf';
  tiltHigh.frequency.value = TILT_HINGE_HZ;
  tiltHigh.gain.value = 0;

  const level = ctx.createGain();
  level.gain.value = 0; // start silent; never pop in on connect

  // The generator is deliberately left *detached* at construction. `kind` is
  // 'none' until something asks for a bed, and an unreachable source node is
  // never pulled by the rendering graph — so an unused ambience bed costs
  // nothing at all, not even a block of zeros per quantum.
  hp.connect(lp);
  lp.connect(tiltLow);
  tiltLow.connect(tiltHigh);
  tiltHigh.connect(level);

  let connected = false;
  let currentKind: AmbienceKind = 'none';
  let disposed = false;
  /** Latest requested parameters; read by `transition`'s deferred half. */
  let desired: AmbienceParams = { kind: 'none', level: -Infinity, tone: 0.5 };
  /** Timer for the second half of a kind change (see `transition`). */
  let pending: ReturnType<typeof setTimeout> | null = null;

  /** Minimum time for half of a kind crossfade. */
  const MIN_HALF_MS = 40;

  /** Target level for the current parameters, as a linear gain. */
  const levelFor = (p: AmbienceParams): number =>
    // `dbToLin` maps -Infinity to exactly 0, so the fader bottom is silence.
    clamp(p.kind === 'none' ? 0 : dbToLin(p.level), 0, 4);

  /**
   * Linear ramp to an exact endpoint.
   *
   * The level gain must be able to reach a *true* zero — an exponential
   * approach never arrives, so a "silent" bed would keep leaking at −80 dB
   * forever and the branch could never be disconnected honestly. The filter
   * frequencies use the same helper for consistency; they are never driven to
   * a boundary where exactness matters.
   */
  const ramp = (param: AudioParam, target: number, rampMs: number): void => {
    const t = ctx.currentTime;
    let v = Number.isFinite(target) ? target : 0;
    v = Math.min(Math.max(v, param.minValue), param.maxValue);
    const ms = clamp(rampMs, 0, 10000);
    if (ms < 1) {
      param.setValueAtTime(v, t);
      return;
    }
    // Truncate anything in flight at its current value, then ramp from there.
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(v, t + ms / 1000);
  };

  /** Apply the shaping filters and tilt for a kind. */
  const shapeFor = (p: AmbienceParams, rampMs: number): void => {
    if (p.kind === 'none') return;
    const shape = SHAPES[p.kind];
    ramp(hp.frequency, clamp(shape.hp, 10, nyquist * 0.98), rampMs);
    ramp(lp.frequency, clamp(shape.lp, 100, nyquist * 0.98), rampMs);
    // tone 0 -> +9 dB low / -9 dB high (dark); 1 -> the reverse (bright).
    const tilt = (num(p.tone, 0.5, 0, 1) - 0.5) * 2 * TILT_RANGE_DB;
    ramp(tiltHigh.gain, tilt, rampMs);
    ramp(tiltLow.gain, -tilt, rampMs);
  };

  /**
   * Switch generator kind, crossfading **through silence**.
   *
   * A generator change is instantaneous inside the worklet — one sample it is
   * rain, the next it is a fan — so there is nothing to interpolate between.
   * Fading the bed out, switching, and fading back in is the only way to make
   * it inaudible, and it is also the only correct moment to connect or
   * disconnect the branch: doing that while the bed is audible is a hard cut
   * no matter how carefully the gain is ramped afterwards.
   */
  const transition = (rampMs: number): void => {
    const half = Math.max(rampMs / 2, MIN_HALF_MS);

    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }

    const land = (): void => {
      pending = null;
      if (disposed) return;
      // `desired` rather than a captured parameter: the user may have moved
      // the level or tone slider during the fade, and this is the first moment
      // those values can be applied.
      const p = desired;

      if (p.kind === 'none') {
        // Unreachable source nodes stop being pulled by the rendering graph,
        // so a bed that is switched off costs literally nothing.
        noise.port.postMessage({ kind: 'none' });
        if (connected) {
          try {
            noise.disconnect(hp);
          } catch {
            /* already detached */
          }
          connected = false;
        }
        return;
      }

      if (!connected) {
        noise.connect(hp);
        connected = true;
      }
      noise.port.postMessage({ kind: p.kind });
      // Jump the shaping filters while silent, then fade the bed back in.
      shapeFor(p, 0);
      ramp(level.gain, levelFor(p), half);
    };

    // Nothing audible yet (graph construction, or an already-silent bed):
    // switch immediately rather than scheduling a pointless fade.
    if (rampMs < 1 || level.gain.value <= 0) {
      ramp(level.gain, 0, 0);
      land();
      return;
    }

    ramp(level.gain, 0, half);
    pending = setTimeout(land, half + 15);
  };

  return {
    output: level,
    available: true,

    setParams(p: AmbienceParams, rampMs: number): void {
      if (disposed) return;

      const kindChanged = p.kind !== currentKind;
      desired = p;
      // Claim the new kind immediately so that repeated calls during the fade
      // (a slider drag, a 20 Hz UI loop) do not restart the transition.
      currentKind = p.kind;

      if (kindChanged) {
        transition(rampMs);
        return;
      }

      // Mid-transition: `land` will pick up `desired` when it fires.
      if (pending !== null) return;

      shapeFor(p, rampMs);
      ramp(level.gain, levelFor(p), rampMs);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (pending !== null) {
        clearTimeout(pending);
        pending = null;
      }
      noise.port.postMessage({ type: 'release' });
      for (const n of [noise, hp, lp, tiltLow, tiltHigh, level]) {
        try {
          n.disconnect();
        } catch {
          /* already detached */
        }
      }
    },
  };
}
