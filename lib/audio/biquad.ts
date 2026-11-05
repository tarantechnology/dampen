/**
 * Dampen — the cascaded lowpass "wall".
 *
 * Four `BiquadFilterNode`s in permanent series. `lowpass.stages` chooses how
 * many are *active*; the rest are **neutralised in place**, never unwired.
 *
 * ## Why not rewire
 *
 * `connect`/`disconnect` take effect at a render-quantum boundary and the
 * nodes being bypassed still hold state. Removing a filter mid-signal
 * therefore jumps the output from "filtered" to "unfiltered" in one sample —
 * an audible click, every time the stage count changes. Since the stage count
 * is reachable from the macro dial and from a slider, that would be a click
 * per pixel of drag. So the graph is built once and never touched again.
 *
 * ## Why neutral means `allpass`, not `20 kHz`
 *
 * The obvious neutralisation is to park the inactive stage at 20 kHz with a
 * negligible Q. That is *nearly* transparent, but not transparent: four
 * cascaded Butterworth lowpasses with a 20 kHz corner still cost about
 * −3.4 dB at 15 kHz, and `DEFAULT_PARAMS` is contractually required to sound
 * identical to no processing at all.
 *
 * A second-order **allpass** has a magnitude response of *exactly* 1 at every
 * frequency — only the phase changes. So a neutralised stage is switched to
 * `allpass`, which is magnitude-transparent by construction and also reports
 * 0 dB from `getFrequencyResponse`, so the UI's response curve is correct for
 * free.
 *
 * Two details make that safe:
 *
 *  - **The corner is parked just under Nyquist with a high Q.** A biquad
 *    allpass rotates phase from 0° at DC to −360° at Nyquist, passing −180° at
 *    its corner; a high Q concentrates all of that rotation into a narrow band
 *    around the corner. With the corner at 0.499·fs and Q = 8, the phase shift
 *    anywhere in the audible band is a couple of degrees, so cascading four of
 *    them is phase-benign and — critically — does **not** invert polarity,
 *    which would cancel against the dry path during a bypass crossfade.
 *  - **The type is only switched while the filter is already transparent.**
 *    Changing `type` swaps the coefficients instantly while the filter's state
 *    variables keep their old values, which can click. So going neutral first
 *    *ramps the cutoff up* to the open frequency and only switches to
 *    `allpass` once that ramp has finished (by which point lowpass-at-Nyquist
 *    and allpass-at-Nyquist are indistinguishable). Coming back, the type is
 *    restored first — still at the open frequency, still transparent — and
 *    only then does the cutoff ramp down.
 *
 * ## Why the cascade is staggered-Q, not identical sections
 *
 * `N` *identical* Butterworth sections give 12N dB/oct, but each one
 * contributes its own −3 dB at `f₀`, so the real corner slides down (×0.66 for
 * N = 4) and the stated cutoff stops meaning anything. Four identical sections
 * at a nominal 800 Hz are already −12 dB at 800 Hz and −3 dB at ~530 Hz.
 *
 * Instead each active section gets its own **Butterworth pole Q** from
 * {@link BUTTER_Q}, which is what makes `n` biquads a genuine order-`2n`
 * Butterworth filter: flat passband, and the −3 dB point exactly at the
 * requested frequency. That matters here specifically because
 * `docs/EFFECTS_RESEARCH.md` §8.2 specifies preset cutoffs (800 Hz for
 * `next-room`, 700 Hz for `deep-focus`) derived from *measured* wall
 * transmission data — numbers that are only meaningful if the filter's corner
 * is where it says it is.
 *
 * The alternative was considered and rejected: identical sections give a
 * softer, droopier knee, which for a "muffle" is arguably pleasant, but it
 * makes `stages` change the *character* of the filter as well as its slope,
 * and it silently moves every documented cutoff. Deliberate choice, not an
 * oversight.
 *
 */

import { BUTTERWORTH_Q_DB, BUTTERWORTH_Q_LINEAR, clamp, linearQToDb, num } from './dsp';
import { rampSmooth } from './ramp';

/**
 * Butterworth pole Qs (linear), indexed by filter **order**.
 *
 * `Q_k = 1 / (2·cos θ_k)` with `θ_k = (2k+1)π/(2·order)`. Cascading `order/2`
 * second-order sections at these Qs is a maximally-flat filter of that order:
 * verified at f₀ = 1 kHz, two sections → −0.017 dB @ 500 Hz, −3.010 dB @
 * 1 kHz, −24.25 dB @ 2 kHz, −48.92 dB @ 4 kHz.
 *
 * Note the last entry of each row is above unity — the high-Q section is what
 * squares off the knee, and on its own it would look like a resonant filter
 * rather than a flat one. It is only Butterworth in combination with the rest
 * of its row, which is why {@link cascadeStageQsDb} always takes a whole row
 * for the requested order and never mixes rows.
 */
export const BUTTER_Q: Readonly<Record<number, readonly number[]>> = {
  2: [0.707107],
  4: [0.541196, 1.306563],
  6: [0.517638, 0.707107, 1.931852],
  8: [0.509796, 0.601345, 0.899976, 2.562915],
} as const;

/** Per-stage Q in dB can never exceed this, however much resonance is asked for. */
const MAX_STAGE_Q_DB = 12;
/** …nor fall below this. */
const MIN_STAGE_Q_DB = -24;

/**
 * The `Q` values (in **dB**, ready for a lowpass `BiquadFilterNode`) for an
 * `n`-stage cascade with a requested linear resonance of `qLinear`.
 *
 * `qLinear === BUTTERWORTH_Q_LINEAR` (0.7071, the documented neutral) returns
 * the exact Butterworth alignment for order `2n`.
 *
 * Higher values add resonance. The extra is applied **only to the
 * highest-Q section** — the one that already forms the knee — rather than
 * spread across all of them. Scaling every section would multiply the
 * alignment out of shape and, for `underwater`'s `q = 3.0` on two stages,
 * would stack a 7 dB and a 15 dB peak into a ~22 dB whistle. Concentrating it
 * keeps the rest of the cascade flat so the resonance reads as a single
 * resonant corner, which is the intended "water" sound, and the per-stage
 * clamp bounds the worst case.
 *
 * Values below the neutral damp the knee by the same mechanism.
 */
export function cascadeStageQsDb(stages: number, qLinear: number): number[] {
  const n = Math.min(Math.max(Math.round(num(stages, 1, 1, 4)), 1), 4);
  const table = BUTTER_Q[n * 2] ?? BUTTER_Q[2];
  const scale = num(qLinear, BUTTERWORTH_Q_LINEAR, 0.05, 40) / BUTTERWORTH_Q_LINEAR;

  return table.map((q, i) => {
    // The top section carries the whole resonance adjustment.
    const linear = i === table.length - 1 ? q * scale : q;
    return clamp(linearQToDb(linear), MIN_STAGE_Q_DB, MAX_STAGE_Q_DB);
  });
}

/**
 * Q of the neutralising allpass. High on purpose: it concentrates the phase
 * rotation at the corner (just under Nyquist) and leaves the audible band
 * essentially untouched.
 */
const NEUTRAL_ALLPASS_Q = 8;

/** Extra delay beyond the ramp before the type is switched, ms. */
const TYPE_SWITCH_SLACK_MS = 30;

export class LowpassStage {
  readonly node: BiquadFilterNode;

  private readonly ctx: BaseAudioContext;
  /** Cutoff used when the stage is open: as high as the sample rate allows. */
  private readonly openFreq: number;
  /** True while `node.type === 'allpass'`. */
  private isAllpass = false;
  private pendingSwitch: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    // Just under Nyquist. The biquad design formulae degenerate exactly at
    // Nyquist, and browsers clamp there anyway, so leave a little room.
    this.openFreq = ctx.sampleRate * 0.499;

    const node = ctx.createBiquadFilter();
    node.type = 'lowpass';
    node.frequency.value = this.openFreq;
    // For `lowpass`/`highpass` the spec treats Q as a resonance in *decibels*,
    // so maximal flatness is -3.0103 dB, not 0 (which is a +1.25 dB bump).
    node.Q.value = BUTTERWORTH_Q_DB;
    this.node = node;

    // Start neutral: a freshly built graph with DEFAULT_PARAMS must be
    // transparent from its very first sample.
    node.type = 'allpass';
    node.Q.value = NEUTRAL_ALLPASS_Q;
    this.isAllpass = true;
  }

  /**
   * Set the stage's target.
   *
   * @param active true if this stage should filter
   * @param freq   cutoff in Hz (ignored when `active` is false)
   * @param qDb    resonance **in decibels**, already converted by
   *               {@link cascadeStageQsDb} (ignored when `active` is false)
   * @param rampMs ramp time for the cutoff
   */
  setTarget(active: boolean, freq: number, qDb: number, rampMs: number): void {
    if (this.disposed) return;
    const node = this.node;
    const ms = clamp(rampMs, 0, 10000);

    if (active) {
      // Cancel any queued neutralisation: the stage is wanted again.
      if (this.pendingSwitch !== null) {
        clearTimeout(this.pendingSwitch);
        this.pendingSwitch = null;
      }
      if (this.isAllpass) {
        // Safe to flip now: the cutoff is still parked at the open frequency,
        // where both responses are flat across the audible band. The type is
        // changed *before* Q is lowered — see the note in the neutral branch
        // about why Q must never approach zero while the type is `allpass`.
        node.type = 'lowpass';
        this.isAllpass = false;
      }
      rampSmooth(this.ctx, node.frequency, clamp(freq, 10, this.openFreq), ms);
      rampSmooth(this.ctx, node.Q, clamp(qDb, MIN_STAGE_Q_DB, MAX_STAGE_Q_DB), ms);
      return;
    }

    /*
     * Neutralise. Already neutral means there is nothing to do: the cutoff is
     * parked at the open frequency and Q is at NEUTRAL_ALLPASS_Q.
     *
     * The early return is load-bearing, not an optimisation. The `allpass`
     * coefficients are built from `alpha = sin(w0) / (2Q)`, so ramping Q
     * towards zero while the type is `allpass` sends alpha to infinity and the
     * normalised coefficients to `(1 - ∞)/(1 + ∞)` — **NaN**, which this node
     * would then emit forever, silencing every downstream node with no error.
     * Q is only ever taken down while the type is `lowpass`, where the spec
     * interprets it as a resonance in dB and the target is the finite
     * BUTTERWORTH_Q_DB (-3.0103), never zero.
     */
    if (this.isAllpass) return;

    rampSmooth(this.ctx, node.frequency, this.openFreq, ms);
    rampSmooth(this.ctx, node.Q, BUTTERWORTH_Q_DB, ms);

    if (this.pendingSwitch !== null) return;

    this.pendingSwitch = setTimeout(
      () => {
        this.pendingSwitch = null;
        if (this.disposed) return;
        // Raise Q first, then change the type: the allpass reads Q as a true Q
        // and must never see it near zero. Both writes land in the same task,
        // so the render thread only ever observes the finished pair; the
        // momentary +8 dB lowpass resonance sits just under Nyquist anyway.
        rampSmooth(this.ctx, node.Q, NEUTRAL_ALLPASS_Q, 0);
        node.type = 'allpass';
        this.isAllpass = true;
      },
      ms + TYPE_SWITCH_SLACK_MS,
    );
  }

  /** True if this stage is currently magnitude-transparent. */
  get neutral(): boolean {
    return this.isAllpass;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pendingSwitch !== null) {
      clearTimeout(this.pendingSwitch);
      this.pendingSwitch = null;
    }
    try {
      this.node.disconnect();
    } catch {
      /* already detached */
    }
  }
}

/** Number of lowpass stages built. `lowpass.stages` indexes into these. */
export const LOWPASS_STAGE_COUNT = 4;
