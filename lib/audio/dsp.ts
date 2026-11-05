/**
 * Dampen — pure DSP math.
 *
 * Nothing in this file touches the Web Audio API, the DOM or React. That is
 * deliberate: every number the engine ever writes into an `AudioParam` is
 * produced by a function in here, so the interesting arithmetic can be unit
 * tested in Node with no `AudioContext` at all (see `lib/audio/__tests__`).
 *
 * House rules enforced here:
 *  - A `NaN` or `Infinity` that reaches an `AudioParam` silently kills the
 *    *entire* audio graph for the lifetime of the `AudioContext` — the node
 *    starts emitting NaN, NaN propagates through every downstream node, and
 *    there is no error, no warning and no recovery. Every value therefore
 *    passes through {@link num} (or a dB-aware sibling) before it is used.
 *  - dB is the UI's unit; linear amplitude is the engine's. The conversion
 *    lives here once so `-Infinity dB` means *exactly* zero everywhere.
 */

/* ------------------------------------------------------------------ *
 * Numeric safety
 * ------------------------------------------------------------------ */

/** Everything quieter than this is reported as this, so meters never print `-Infinity`. */
export const METER_FLOOR_DB = -120;

/**
 * True only for real, finite numbers. `Number.isFinite` already rejects
 * `NaN`/`±Infinity`, but it also coerces — `Number.isFinite('3')` is `false`
 * yet `isFinite('3')` is `true` — so we use the strict form and narrow.
 */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Clamp without surprises: a `NaN` input would otherwise survive `Math.min/max`. */
export function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

/**
 * The single gate every parameter passes through.
 *
 * @param v        candidate value, from anywhere (UI, JSON, a preset, a bug)
 * @param fallback used when `v` is not a finite number
 * @param min      inclusive lower bound
 * @param max      inclusive upper bound
 */
export function num(v: unknown, fallback: number, min: number, max: number): number {
  if (!isFiniteNumber(v)) return clamp(fallback, min, max);
  return clamp(v, min, max);
}

/**
 * Like {@link num} but `-Infinity` is a *legal* value meaning "true silence".
 * Used for level params where the UI's bottom-of-fader must be real zero and
 * not merely −90 dB. `+Infinity` and `NaN` are still rejected.
 */
export function dbLevel(v: unknown, fallback: number, min: number, max: number): number {
  if (v === -Infinity) return -Infinity;
  return num(v, fallback, min, max);
}

/** Integer-valued parameter, clamped then rounded (bit depth, stage count, …). */
export function intNum(v: unknown, fallback: number, min: number, max: number): number {
  return Math.round(num(v, fallback, min, max));
}

/* ------------------------------------------------------------------ *
 * dB <-> linear
 * ------------------------------------------------------------------ */

/**
 * dB (amplitude, 20·log10) to linear gain.
 *
 * `-Infinity` maps to exactly `0` — not `1e-18` — because a GainNode at
 * literal zero is the only thing that guarantees a branch is truly silent and
 * lets the browser skip work on it.
 */
export function dbToLin(db: number): number {
  if (db === -Infinity) return 0;
  if (!Number.isFinite(db)) return 1; // NaN / +Infinity -> unity, never a NaN gain
  return Math.pow(10, db / 20);
}

/** Linear amplitude to dB. `0` (or negative) maps to `-Infinity`. */
export function linToDb(lin: number): number {
  if (!Number.isFinite(lin) || lin <= 0) return -Infinity;
  return 20 * Math.log10(lin);
}

/** {@link linToDb} with a floor, for meters and UI readouts. */
export function linToDbFloored(lin: number, floorDb: number = METER_FLOOR_DB): number {
  const db = linToDb(lin);
  return db < floorDb ? floorDb : db;
}

/* ------------------------------------------------------------------ *
 * Interpolation + dot paths
 * ------------------------------------------------------------------ */

/** Linear interpolation. `t` is clamped to 0..1 so callers cannot extrapolate. */
export function lerp(a: number, b: number, t: number): number {
  const k = clamp(t, 0, 1);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    // e.g. lerping from -Infinity dB would poison everything; snap instead.
    return k < 0.5 ? a : b;
  }
  // Endpoints are returned verbatim rather than computed. `a + (b-a)*1` is not
  // exactly `b` in binary floating point (lerp(1, 0.15, 1) gives
  // 0.15000000000000002), and the macro dial at amount 1 is contractually
  // required to reproduce a preset *exactly*.
  if (k <= 0) return a;
  if (k >= 1) return b;
  return a + (b - a) * k;
}

/**
 * Exponential (constant-ratio) interpolation — the right curve for frequency
 * and time, where human perception is logarithmic. `lerpLog(20000, 500, 0.5)`
 * gives 3162 Hz (the geometric mean), not 10250 Hz.
 *
 * Falls back to {@link lerp} if either endpoint is non-positive, since the
 * logarithm would be undefined there.
 */
export function lerpLog(a: number, b: number, t: number): number {
  if (a <= 0 || b <= 0 || !Number.isFinite(a) || !Number.isFinite(b)) return lerp(a, b, t);
  const k = clamp(t, 0, 1);
  // Exact endpoints, for the same reason as `lerp`: `20000·(2800/20000)^1`
  // evaluates to 2800.0000000000005.
  if (k <= 0) return a;
  if (k >= 1) return b;
  return a * Math.pow(b / a, k);
}

/** Read `a.b.c` out of a nested object. Returns `undefined` for any bad path. */
export function getPath(root: unknown, path: string): unknown {
  const keys = path.split('.');
  let cur: unknown = root;
  for (const k of keys) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/**
 * Write `a.b.c` into a nested object, mutating it. Unknown intermediate paths
 * are ignored rather than auto-created: a typo'd path must not quietly grow a
 * new branch on `DampenParams` that nothing reads.
 *
 * @returns `true` if the write happened.
 */
export function setPath(root: object, path: string, value: unknown): boolean {
  const keys = path.split('.');
  const leaf = keys[keys.length - 1];
  let cur: Record<string, unknown> = root as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    if (typeof next !== 'object' || next === null) return false;
    cur = next as Record<string, unknown>;
  }
  if (!(leaf in cur)) return false;
  cur[leaf] = value;
  return true;
}

/** Structural clone good enough for `DampenParams` (plain objects + primitives). */
export function cloneParams<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => cloneParams(x)) as unknown as T;
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = cloneParams(val);
    }
    return out as T;
  }
  return v;
}

/* ------------------------------------------------------------------ *
 * Saturation
 * ------------------------------------------------------------------ */

/** Number of points in the WaveShaper transfer table. */
export const SATURATION_CURVE_LENGTH = 4096;

/**
 * Maximum `tanh` gain at `drive = 1`. At k = 8 a half-scale input comes out at
 * ~0.995 of full scale, i.e. heavily squashed and rich in odd harmonics —
 * enough for "distant transistor radio" without sounding like a fuzz pedal.
 */
export const SATURATION_K_MAX = 8;

/**
 * Normalised hyperbolic-tangent soft clipper:
 *
 *     y = tanh(k·x) / tanh(k),   k = drive · SATURATION_K_MAX
 *
 * Properties that made this the choice over the classic
 * `(3+k)x·20·deg / (3 + k·|x|·20)` curve:
 *
 *  - **Odd symmetry** → only odd harmonics (3rd, 5th, …). Even harmonics
 *    would add a hollow octave-down character that fights the "it's just
 *    quieter and further away" illusion.
 *  - **Unity endpoints**: dividing by `tanh(k)` pins `y(±1) = ±1`, so raising
 *    drive adds harmonics without also raising level. No makeup gain needed
 *    and no surprise clipping downstream.
 *  - **Linear limit**: `lim(k→0) tanh(kx)/tanh(k) = x` exactly, so the curve
 *    *continuously* approaches the identity as drive falls to zero. There is
 *    no discontinuity at the bottom of the knob.
 *
 * At `drive = 0` we return the exact identity ramp (the formula would be 0/0),
 * which a WaveShaperNode reproduces bit-for-bit because its own lookup is
 * linear interpolation over a linear table.
 */
export function makeSaturationCurve(
  drive: number,
  length: number = SATURATION_CURVE_LENGTH,
): Float32Array<ArrayBuffer> {
  const n = Math.max(2, Math.floor(num(length, SATURATION_CURVE_LENGTH, 2, 1 << 16)));
  const d = num(drive, 0, 0, 1);
  const curve = new Float32Array(n);
  const k = d * SATURATION_K_MAX;

  // Below this, tanh(k) is small enough that 1/tanh(k) loses precision while
  // the audible difference from the identity is < 0.001 dB. Snap to linear.
  if (k < 1e-4) {
    for (let i = 0; i < n; i++) curve[i] = (i / (n - 1)) * 2 - 1;
    return curve;
  }

  const norm = 1 / Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) * norm;
  }
  return curve;
}

/* ------------------------------------------------------------------ *
 * Mid / Side
 * ------------------------------------------------------------------ */

/**
 * The exact gains used by the M/S width block in `width.ts`.
 *
 *   M = 0.5·L + 0.5·R
 *   S = 0.5·L − 0.5·R
 *   L' = M + width·S
 *   R' = M − width·S
 *
 * Substituting at `width = 1`:
 *   L' = (L+R)/2 + (L−R)/2 = L
 *   R' = (L+R)/2 − (L−R)/2 = R
 * …so unity width is an algebraic identity, not an approximation. At
 * `width = 0`, L' = R' = M, i.e. exact mono. These constants are shared with
 * the GainNode graph so the two can never drift apart.
 */
export const MS_GAINS = {
  midFromL: 0.5,
  midFromR: 0.5,
  sideFromL: 0.5,
  sideFromR: -0.5,
  sideToL: 1,
  sideToR: -1,
} as const;

/** Scalar reference implementation of the M/S matrix, for tests. */
export function msMatrix(l: number, r: number, width: number): [number, number] {
  const w = num(width, 1, 0, 2);
  const mid = MS_GAINS.midFromL * l + MS_GAINS.midFromR * r;
  const side = (MS_GAINS.sideFromL * l + MS_GAINS.sideFromR * r) * w;
  return [mid + MS_GAINS.sideToL * side, mid + MS_GAINS.sideToR * side];
}

/* ------------------------------------------------------------------ *
 * Drift LFO shaping
 * ------------------------------------------------------------------ */

/**
 * Convert a drift depth in dB into the centre + amplitude of a gain LFO.
 *
 * The LFO rides on a GainNode whose intrinsic value is `centre` while an
 * oscillator scaled by `amplitude` is summed into the same param. The window
 * is deliberately **downward only**:
 *
 *     gain ∈ [10^(−depth/20), 1]
 *
 * so drift can only ever duck the music, never boost it into clipping, and
 * `centre − amplitude = 10^(−depth/20) > 0` is strictly positive for any
 * finite depth — the gain can never reach zero (a dropout) or go negative (a
 * polarity flip you would hear as a click).
 */
export function driftWindow(depthDb: number): { centre: number; amplitude: number } {
  const d = num(depthDb, 0, 0, 24);
  const floor = dbToLin(-d); // 0 dB -> 1, 6 dB -> 0.5012, 24 dB -> 0.0631
  return { centre: (1 + floor) / 2, amplitude: (1 - floor) / 2 };
}

/* ------------------------------------------------------------------ *
 * Metering
 * ------------------------------------------------------------------ */

/** Peak and RMS of a block of float samples, in dBFS (floored, never -Infinity). */
export function blockLevels(buf: Float32Array): { peakDb: number; rmsDb: number } {
  let peak = 0;
  let sumSq = 0;
  const n = buf.length;
  for (let i = 0; i < n; i++) {
    const s = buf[i];
    // A NaN sample upstream would make both numbers NaN; drop it instead so
    // the meter reads "silence" rather than painting NaN into the UI.
    if (!Number.isFinite(s)) continue;
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
    sumSq += s * s;
  }
  const rms = n > 0 ? Math.sqrt(sumSq / n) : 0;
  return { peakDb: linToDbFloored(peak), rmsDb: linToDbFloored(rms) };
}

/* ------------------------------------------------------------------ *
 * Output safety guard
 * ------------------------------------------------------------------ */

/**
 * Where the safety guard starts bending, as a linear amplitude.
 * 0.9 is −0.92 dBFS: above any sane playback level, below full scale.
 */
export const OUTPUT_GUARD_KNEE = 0.9;

/** The absolute ceiling the engaged guard imposes (−0.44 dBFS). */
export const OUTPUT_GUARD_CEILING = 0.95;

/**
 * Transfer curve for the final output guard — the last thing before the
 * destination, and the only reason a feedback loop cannot reach full scale.
 *
 * Why a `WaveShaperNode` and not a second `DynamicsCompressorNode`: a
 * compressor's gain computer carries a fixed internal lookahead delay (several
 * ms in every implementation), and the capture path is explicitly a
 * low-latency path. A waveshaper has **zero latency** — it is a memoryless
 * lookup — so the guard costs nothing in the budget it is protecting.
 *
 * `engaged = false` returns the exact identity. That matters: the guard sits
 * in the signal path permanently, and `DEFAULT_PARAMS` is contractually
 * required to be indistinguishable from no processing. (A `WaveShaperNode`
 * clamps inputs beyond ±1 to its endpoint values, so even the identity curve
 * bounds the output at full scale — which is precisely what the output device
 * does anyway.)
 *
 * `engaged = true` is exactly linear up to {@link OUTPUT_GUARD_KNEE} and then
 * bends to {@link OUTPUT_GUARD_CEILING} asymptotically:
 *
 *     y = K + (C − K)·tanh((|x| − K)/(C − K)),  |x| > K
 *
 * `tanh'(0) = 1` and the scale factors cancel, so the slope is continuous at
 * the knee — no corner to generate a sudden burst of harmonics as the signal
 * crosses it.
 */
export function makeOutputGuardCurve(
  engaged: boolean,
  length = 2048,
): Float32Array<ArrayBuffer> {
  const n = Math.max(2, Math.floor(num(length, 2048, 2, 1 << 16)));
  const curve = new Float32Array(n);
  const K = OUTPUT_GUARD_KNEE;
  const C = OUTPUT_GUARD_CEILING;
  const span = C - K;

  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    if (!engaged) {
      curve[i] = x;
      continue;
    }
    const a = Math.abs(x);
    if (a <= K) {
      curve[i] = x;
    } else {
      const y = K + span * Math.tanh((a - K) / span);
      curve[i] = x < 0 ? -y : y;
    }
  }
  return curve;
}

/* ------------------------------------------------------------------ *
 * Biquad Q conventions  —  the single most confusable thing here
 * ------------------------------------------------------------------ */

/**
 * `1/√2 = 0.7071` — the **linear** Q of a maximally-flat (Butterworth)
 * second-order section. This is the convention `DampenParams` uses, as
 * documented in `lib/types.ts` ("Resonance. Keep <= 1.0 or the cutoff
 * whistles").
 */
export const BUTTERWORTH_Q_LINEAR = Math.SQRT1_2;

/**
 * `20·log10(1/√2) = −3.0103` — the same filter expressed the way a Web Audio
 * `BiquadFilterNode` wants it for `lowpass` and `highpass`.
 *
 * ## Read this before touching any Q
 *
 * The Web Audio spec (§1.13.2) says, verbatim: *"For **lowpass** and
 * **highpass** filters the `Q` value is **interpreted to be in dB**… For the
 * bandpass, notch, allpass, and peaking filters, this value is a **linear**
 * value… This is not used for the lowshelf and highshelf filters."*
 *
 * All three engines implement it that way (`resonance = pow10(resonance/20)`
 * before `alpha = sin(w0)/(2·resonance)`), so it is not a Chrome quirk. The
 * identity worth memorising is that **for a lowpass, the magnitude at the
 * cutoff in dB is exactly the `Q` value**: `|H(ω₀)| = 10^(Q_dB/20)`.
 *
 * The consequences all bite:
 *
 *  - `Q.value = 1` — *the node's default* — is `Q_linear = 1.122`, with a
 *    ~2 dB resonant bump below the corner. It is not Butterworth.
 *  - `Q.value = 0` is `Q_linear = 1`, i.e. still peaked by +1.25 dB. "Zero"
 *    does not mean "no resonance", and a floor of 0 makes a clean rolloff
 *    unreachable — four cascaded stages at `Q.value = 0` accumulate a real
 *    bump at the corner.
 *  - `Q.value = 0.0001`, which appears in several published libraries, is
 *    ≈ 0 dB and therefore ≈ `Q_linear = 1` — **not** a critically damped
 *    filter, which is what the author presumably wanted.
 *  - Negative `Q.value` is legal and genuinely useful for lowpass/highpass: it
 *    damps. For peaking/bandpass/notch/allpass a negative Q is nonsense and
 *    Blink clamps it to 0 to avoid an unstable filter.
 *
 * So: **`DampenParams` carries linear Q, and the engine converts** with
 * {@link linearQToDb} for lowpass and highpass only. Peaking filters
 * (`presenceDip`) take the linear value directly; shelves ignore Q entirely.
 */
export const BUTTERWORTH_Q_DB = -3.010299956639812;

/**
 * Linear Q → the dB value a `lowpass`/`highpass` `BiquadFilterNode` expects.
 *
 * **Only for lowpass and highpass.** Passing a peaking filter's Q through
 * this, or assigning a linear Q straight to a lowpass's `Q.value`, are the
 * two halves of the most likely silent bug in a Web Audio filter chain:
 * `Q.value = 0.7071` (unconverted) is `Q_linear = 1.085`, a filter with a
 * resonant bump exactly where maximal flatness was intended.
 */
export function linearQToDb(qLinear: number): number {
  const q = num(qLinear, BUTTERWORTH_Q_LINEAR, 0.05, 40);
  return 20 * Math.log10(q);
}

/** Inverse of {@link linearQToDb}, for UI readouts. */
export function dbQToLinear(qDb: number): number {
  return Math.pow(10, num(qDb, BUTTERWORTH_Q_DB, -60, 60) / 20);
}
