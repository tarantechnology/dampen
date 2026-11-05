/**
 * components/viz/mapping.ts
 *
 * The log-frequency axis and the linear-bin -> log-column resampling table.
 *
 * Pure, React-free and framework-free on purpose: this is the part of the
 * visualiser that is actually easy to get wrong, so it lives where it can be
 * reasoned about and exercised on its own.
 */

export const F_MIN = 20;
export const F_MAX = 20_000;
/** log10(20000 / 20) === 3. Precomputed; it sits in the inner loop. */
export const LOG_SPAN = Math.log10(F_MAX / F_MIN);

/**
 * The log-frequency mapping. This single line is why the visual reads like
 * music rather than like a physics plot: every octave gets equal width.
 *
 *   x = x0 + (log10(f / 20) / log10(20000 / 20)) * plotW
 */
export function xOfFreq(f: number, x0: number, plotW: number): number {
  return x0 + (Math.log10(f / F_MIN) / LOG_SPAN) * plotW;
}

/** Inverse of `xOfFreq`. */
export function freqOfX(x: number, x0: number, plotW: number): number {
  return F_MIN * Math.pow(10, ((x - x0) / plotW) * LOG_SPAN);
}

/**
 * Maps pixel columns to analyser bins.
 *
 * The analyser hands us *linearly* spaced bins (bin i is centred at
 * i * sampleRate / fftSize) while the display is logarithmic, so the two ends
 * of the axis need opposite treatment:
 *
 *   - High frequencies: one column covers many bins. Take the MAX over the
 *     range, never the mean. A mean divides a narrow peak by the width of the
 *     column it happened to land in, flattening exactly the detail that makes
 *     a spectrum look alive; a max keeps the peak at full height and lets the
 *     column width read as its bandwidth.
 *
 *   - Low frequencies: one bin covers many columns (at 48 kHz with 2048 bins a
 *     bin is ~11.7 Hz, so 20..30 Hz is under one bin wide while occupying ~6%
 *     of the display). Snapping to the nearest bin there gives visible
 *     stair-steps, so those columns linearly interpolate between the two
 *     neighbouring bins in the dB domain instead.
 *
 * Which branch a column takes is decided once, at layout time, and stored.
 */
export interface ResampleTable {
  binCount: number;
  binHz: number;
  cols: number;
  /** First bin for this column; -1 when there is no usable bin data. */
  start: Int32Array;
  /** Last bin (inclusive) in max mode; -1 selects interpolation mode. */
  end: Int32Array;
  /** Interpolation weight between `start` and `start + 1`. */
  frac: Float32Array;
}

export function buildResampleTable(
  cols: number,
  x0: number,
  plotW: number,
  binCount: number,
  binHz: number,
): ResampleTable {
  const start = new Int32Array(cols);
  const end = new Int32Array(cols);
  const frac = new Float32Array(cols);
  const step = plotW / cols;

  for (let c = 0; c < cols; c++) {
    const fLo = freqOfX(x0 + c * step, x0, plotW);
    const fHi = freqOfX(x0 + (c + 1) * step, x0, plotW);
    const fMid = freqOfX(x0 + (c + 0.5) * step, x0, plotW);

    // Bin centres that fall inside [fLo, fHi].
    let lo = Math.ceil(fLo / binHz);
    let hi = Math.floor(fHi / binHz);
    if (lo < 0) lo = 0;
    if (hi > binCount - 1) hi = binCount - 1;

    if (hi >= lo && lo <= binCount - 1) {
      start[c] = lo;
      end[c] = hi;
      frac[c] = 0;
      continue;
    }

    // No bin centre inside this column -> interpolate across the gap.
    if (binCount < 2) {
      start[c] = -1;
      end[c] = -1;
      frac[c] = 0;
      continue;
    }
    const p = fMid / binHz;
    let k = Math.floor(p);
    if (k < 0) k = 0;
    if (k > binCount - 2) k = binCount - 2;
    start[c] = k;
    end[c] = -1;
    frac[c] = Math.max(0, Math.min(1, p - k));
  }

  return { binCount, binHz, cols, start, end, frac };
}
