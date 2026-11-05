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
 */

import { clamp } from './dsp';
import { rampSmooth } from './ramp';

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
    // For `lowpass`/`highpass` the Web Audio spec treats Q as a *resonance in
    // decibels*, so 0 is Butterworth (maximally flat), not a degenerate Q.
    node.Q.value = 0;
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
   * @param q      resonance in dB (ignored when `active` is false)
   * @param rampMs ramp time for the cutoff
   */
  setTarget(active: boolean, freq: number, q: number, rampMs: number): void {
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
      rampSmooth(this.ctx, node.Q, clamp(q, 0, 12), ms);
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
     * Q is only ever taken to 0 while the type is `lowpass`, where the spec
     * interprets it as a resonance in dB and 0 simply means Butterworth.
     */
    if (this.isAllpass) return;

    rampSmooth(this.ctx, node.frequency, this.openFreq, ms);
    rampSmooth(this.ctx, node.Q, 0, ms);

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
