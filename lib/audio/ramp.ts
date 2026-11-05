/**
 * Dampen — AudioParam ramping.
 *
 * **The single most important correctness rule in the engine lives here:**
 * nothing ever writes `param.value = x` on a live parameter.
 *
 * `AudioParam.value` is a *step* change applied at the start of the next
 * render quantum. A filter cutoff or a gain that steps produces a
 * discontinuity in the output waveform, and a slider dragged across its range
 * produces one of those per mouse event — which is the buzzing, grainy
 * "zipper noise" that makes a web audio toy sound like a web audio toy.
 * `setTargetAtTime` and `linearRampToValueAtTime` interpolate at audio rate
 * instead, and they are the only two primitives used.
 *
 * Two flavours, for two different jobs:
 *
 *  - {@link rampSmooth} — exponential approach. Stateless from the caller's
 *    point of view: it starts from wherever the parameter currently is, needs
 *    no cancellation, is continuous by construction, and can be called at
 *    mouse-move rate forever without the scheduled-value list growing. This is
 *    the default for every continuous parameter.
 *  - {@link rampLinear} — linear ramp to an *exact* value in an exact time.
 *    Needed where the endpoint matters: a bypass crossfade that must reach
 *    unity, or a level that must reach true zero. Costs a cancel-and-hold.
 */

import { clamp } from './dsp';

/**
 * Exponential-approach ramp.
 *
 * `setTargetAtTime(v, t, τ)` follows `x(t) = v + (x0 − v)·exp(−t/τ)`, i.e. a
 * one-pole glide. `τ = ms/3000` means the parameter covers ~95 % of the
 * distance in `ms` milliseconds (three time constants), which is what a user
 * perceives as "took that long". It never arrives exactly, which is fine for
 * frequencies and gains and is precisely why {@link rampLinear} exists for the
 * cases where it is not.
 *
 * @param rampMs 0 (or under 1 ms) schedules an immediate step at `currentTime`
 *               — used only during graph construction, before audio flows.
 */
export function rampSmooth(
  ctx: BaseAudioContext,
  param: AudioParam,
  target: number,
  rampMs: number,
): void {
  const now = ctx.currentTime;

  // Last line of defence. A NaN or Infinity written to an AudioParam makes the
  // node emit NaN forever, which propagates downstream, silences the graph and
  // reports nothing. Clamp to the param's own declared range.
  let v = target;
  if (!Number.isFinite(v)) v = clamp(param.defaultValue, param.minValue, param.maxValue);
  v = clamp(v, param.minValue, param.maxValue);

  const ms = clamp(rampMs, 0, 10000);
  if (ms < 1) {
    // Still not `.value =`: an explicit event keeps the automation timeline
    // authoritative, so a later ramp interpolates from the right place.
    param.setValueAtTime(v, now);
    return;
  }
  param.setTargetAtTime(v, now, ms / 3000);
}

type CancelAndHold = (cancelTime: number) => void;

/**
 * `cancelAndHoldAtTime` with a fallback.
 *
 * It truncates any automation in flight *at its current value*, which is the
 * only way to start a new linear ramp from wherever an exponential glide
 * happens to have got to. Firefox has historically not implemented it, so we
 * feature-detect and fall back to cancel + pin-to-current-value, which is the
 * same thing minus sub-quantum accuracy.
 */
function cancelAndHold(param: AudioParam, when: number): void {
  const fn = (param as unknown as { cancelAndHoldAtTime?: CancelAndHold }).cancelAndHoldAtTime;
  if (typeof fn === 'function') {
    fn.call(param, when);
    return;
  }
  param.cancelScheduledValues(when);
  // Reading `.value` is fine — it is *writing* it that steps the signal.
  param.setValueAtTime(param.value, when);
}

/**
 * Linear ramp that lands on `target` exactly, `rampMs` from now.
 *
 * Use where the endpoint is load-bearing: crossfades that must sum to unity,
 * and levels that must reach a true zero (an exponential approach to zero
 * never gets there, so a "silent" branch would keep leaking at −80 dB).
 */
export function rampLinear(
  ctx: BaseAudioContext,
  param: AudioParam,
  target: number,
  rampMs: number,
): void {
  const now = ctx.currentTime;

  let v = target;
  if (!Number.isFinite(v)) v = clamp(param.defaultValue, param.minValue, param.maxValue);
  v = clamp(v, param.minValue, param.maxValue);

  const ms = clamp(rampMs, 0, 10000);
  cancelAndHold(param, now);
  if (ms < 1) {
    param.setValueAtTime(v, now);
    return;
  }
  param.linearRampToValueAtTime(v, now + ms / 1000);
}

/**
 * Set a parameter during graph construction, before anything is audible.
 * Still an automation event rather than a `.value` write, so the timeline is
 * consistent from the first sample.
 */
export function setInitial(ctx: BaseAudioContext, param: AudioParam, value: number): void {
  rampSmooth(ctx, param, value, 0);
}
