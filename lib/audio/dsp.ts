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
): Float32Array {
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
