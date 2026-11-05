'use client';

/**
 * components/viz/SpectrumScope.tsx
 *
 * The signature visual. Three layers on one canvas, log-frequency 20 Hz..20 kHz:
 *
 *   1. input spectrum   — the unprocessed music, a dim ghosted fill.
 *                         "This is what you would have heard."
 *   2. output spectrum  — the dampened music, bright and solid on top.
 *   3. filter response  — `filterResponse(freqs)` in dB, a crisp line against a
 *                         right-hand dB scale.
 *
 * The *gap* between layers 1 and 2 is the product. Everything here is in
 * service of making that gap legible: the ghost is a fixed cool neutral so it
 * never competes, the live layer owns the only accent on screen, and the
 * response curve is paper-coloured so it reads as a different quantity (a
 * transfer function, not a level) rather than as a third spectrum.
 *
 * Rendering is Canvas 2D: a few hundred points per layer per frame rules out
 * SVG, and nothing here needs a GPU.
 */

import { useCallback, useEffect, useRef, type JSX } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { VIZ_FONT, vizColors, type VizPalette } from './theme';
import { useAnimationLoop } from './useAnimationLoop';
import {
  createLayer,
  hairline,
  snap,
  syncCanvasSize,
  useCanvasMetrics,
  type CanvasMetrics,
} from './canvas';

/* ------------------------------------------------------------------ *
 * Axes
 * ------------------------------------------------------------------ */

const F_MIN = 20;
const F_MAX = 20_000;
/** log10(20000 / 20) === 3. Precomputed because it is in the inner loop. */
const LOG_SPAN = Math.log10(F_MAX / F_MIN);

/**
 * Level axis, dBFS per FFT bin. Music bins live roughly -30..-75 dBFS, so a
 * -92..-6 window puts a typical track in the middle two thirds of the height
 * without the peaks ever clipping the top edge.
 */
const SPEC_MIN_DB = -92;
const SPEC_MAX_DB = -6;
/** Anything at or below this is treated as silence (also catches -Infinity). */
const SPEC_FLOOR = SPEC_MIN_DB;

/**
 * Response axis, dB. Dampen's cascaded lowpass can reach -48 dB inside the
 * window, and the low shelf lifts a few dB, so +12..-60 contains the whole
 * useful range with 12 dB gridlines landing exactly on the bottom edge.
 */
const RESP_MAX_DB = 12;
const RESP_MIN_DB = -60;
const RESP_TICKS: readonly number[] = [12, 0, -12, -24, -36, -48, -60];

const OCTAVES: readonly { f: number; label: string }[] = [
  { f: 31.5, label: '31.5' },
  { f: 63, label: '63' },
  { f: 125, label: '125' },
  { f: 250, label: '250' },
  { f: 500, label: '500' },
  { f: 1000, label: '1k' },
  { f: 2000, label: '2k' },
  { f: 4000, label: '4k' },
  { f: 8000, label: '8k' },
  { f: 16_000, label: '16k' },
];

/* ------------------------------------------------------------------ *
 * Tuning constants
 * ------------------------------------------------------------------ */

/**
 * Per-bin display envelope, on top of whatever `smoothingTimeConstant` the
 * engine set on the analyser (the engine owns those nodes; we never mutate
 * them). Time constants, not per-frame coefficients, so the look is identical
 * at 60 fps and at the 10 fps reduced-motion rate.
 *
 * 30 ms attack: fast enough that a kick or a hi-hat reads as a transient
 * rather than a bulge, slow enough to stop single-frame FFT noise from making
 * the top edge fizz.
 *
 * 320 ms release: a peak-decay fall. Long enough that the eye can follow a
 * note down (and so that the *gap* against the ghost layer stays readable
 * between transients), short enough that the display never feels laggy. Below
 * ~200 ms the whole thing starts to strobe; above ~500 ms it turns to soup.
 */
const ATTACK_TAU = 0.030;
const RELEASE_TAU = 0.320;

/**
 * `filterResponse` walks every biquad in the chain, so it is the single most
 * expensive thing we could do per frame. Call it at 10 Hz and linearly
 * interpolate the displayed curve between consecutive results: a 100 ms
 * crossfade is below the threshold at which a dial drag looks stepped, and it
 * costs 1/6 of the calls.
 */
const RESPONSE_PERIOD_MS = 100;

/**
 * Smoothing for the *derived* dampen amount (see `deriveAmount`). 250 ms so
 * the colour temperature glides behind the dial instead of snapping with it.
 */
const AMOUNT_TAU = 0.25;

/** Idle "breathing" baseline period, seconds. Slow enough to read as calm. */
const IDLE_PERIOD = 5.5;
/** Idle curve level at 40 Hz, dBFS, falling 3 dB/octave above that. */
const IDLE_BASE_DB = -58;

const LABEL_FONT = `9px ${VIZ_FONT}`;
const LEGEND_FONT = `8px ${VIZ_FONT}`;

/* ------------------------------------------------------------------ *
 * Geometry + resampling
 * ------------------------------------------------------------------ */

/**
 * The log-frequency mapping. This is the whole reason the visual reads like
 * music rather than like a physics plot: every octave gets equal width.
 *
 *   x = x0 + (log10(f / 20) / log10(20000 / 20)) * plotW
 */
function xOfFreq(f: number, x0: number, plotW: number): number {
  return x0 + (Math.log10(f / F_MIN) / LOG_SPAN) * plotW;
}

/** Inverse of `xOfFreq`. */
function freqOfX(x: number, x0: number, plotW: number): number {
  return F_MIN * Math.pow(10, ((x - x0) / plotW) * LOG_SPAN);
}

/**
 * Maps pixel columns to analyser bins.
 *
 * The analyser hands us *linearly* spaced bins (bin i is centred at
 * i * sampleRate / fftSize) but the display is logarithmic, so the two ends of
 * the axis need opposite treatment:
 *
 *   - High frequencies: one column covers many bins. Take the MAX over the
 *     range, never the mean. A mean divides a narrow peak by the width of the
 *     column it landed in, which flattens exactly the detail that makes a
 *     spectrum look alive; a max keeps the peak at full height and lets the
 *     column width read as the peak's bandwidth.
 *
 *   - Low frequencies: one bin covers many columns (at 48 kHz / 2048 bins a
 *     bin is ~11.7 Hz, and 20..30 Hz is less than one bin wide while being
 *     ~6% of the display width). Taking the nearest bin there produces visible
 *     stair-steps, so those columns linearly interpolate between the two
 *     neighbouring bins in the dB domain instead.
 *
 * Which branch a column takes is decided once, at layout time, and stored.
 */
interface ResampleTable {
  binCount: number;
  binHz: number;
  cols: number;
  /** First bin for this column; -1 when the column sits above Nyquist. */
  start: Int32Array;
  /** Last bin (inclusive) for max mode; -1 selects interpolation mode. */
  end: Int32Array;
  /** Interpolation weight between `start` and `start + 1`. */
  frac: Float32Array;
}

function buildResampleTable(
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

    // Bin centres strictly inside [fLo, fHi].
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
    const p = fMid / binHz;
    let k = Math.floor(p);
    if (k < 0) k = 0;
    if (k > binCount - 2) k = binCount - 2;
    if (k < 0) {
      // Pathological: fewer than two bins. Nothing sensible to draw.
      start[c] = -1;
      end[c] = -1;
      frac[c] = 0;
      continue;
    }
    start[c] = k;
    end[c] = -1;
    frac[c] = Math.max(0, Math.min(1, p - k));
  }

  return { binCount, binHz, cols, start, end, frac };
}

interface Layout {
  /** CanvasMetrics.version this was built from. */
  version: number;
  showCurve: boolean;
  cssW: number;
  cssH: number;
  dpr: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  plotW: number;
  plotH: number;
  cols: number;
  step: number;
  /** Centre frequency of each column — the argument to `filterResponse`. */
  colFreq: Float32Array;
  /** Scratch copy handed to `filterResponse`, in case the callee writes to it. */
  callFreq: Float32Array;
  /** Static idle shape, dBFS per column. */
  idleDb: Float32Array;
  ghostY: Float32Array;
  liveY: Float32Array;
  respY: Float32Array;
  respFrom: Float32Array;
  respTo: Float32Array;
  respDisplay: Float32Array;
  /** Columns nearest 1k / 2k / 4k — the probe band for the derived amount. */
  probe: Int32Array;
  grid: HTMLCanvasElement | null;
}

function buildLayout(m: CanvasMetrics, showCurve: boolean): Layout | null {
  const padL = 1;
  // The right gutter only exists to hold the response dB labels.
  const padR = showCurve ? 29 : 5;
  const padT = 4;
  const padB = 13;

  const x0 = padL;
  const x1 = m.cssW - padR;
  const y0 = padT;
  const y1 = m.cssH - padB;
  const plotW = x1 - x0;
  const plotH = y1 - y0;
  if (plotW < 16 || plotH < 16) return null;

  // One sample column per CSS pixel is already past the point of visible
  // return; the cap keeps a very wide window from ballooning the inner loops.
  const cols = Math.max(2, Math.min(1600, Math.round(plotW)));
  const step = plotW / cols;

  const colFreq = new Float32Array(cols);
  const idleDb = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    const f = freqOfX(x0 + (c + 0.5) * step, x0, plotW);
    colFreq[c] = f;
    // A pink-ish -3 dB/octave fall above 40 Hz, flat below. Reads as "a room
    // with nothing playing in it" rather than as data.
    idleDb[c] = IDLE_BASE_DB - 3 * Math.log2(Math.max(40, f) / 40);
  }

  const probe = new Int32Array(3);
  const probeFreqs = [1000, 2000, 4000];
  for (let i = 0; i < 3; i++) {
    const x = xOfFreq(probeFreqs[i], x0, plotW);
    probe[i] = Math.max(0, Math.min(cols - 1, Math.round((x - x0) / step - 0.5)));
  }

  return {
    version: m.version,
    showCurve,
    cssW: m.cssW,
    cssH: m.cssH,
    dpr: m.dpr,
    x0,
    x1,
    y0,
    y1,
    plotW,
    plotH,
    cols,
    step,
    colFreq,
    callFreq: new Float32Array(cols),
    idleDb,
    ghostY: new Float32Array(cols),
    liveY: new Float32Array(cols),
    respY: new Float32Array(cols),
    respFrom: new Float32Array(cols),
    respTo: new Float32Array(cols),
    respDisplay: new Float32Array(cols),
    probe,
    grid: null,
  };
}

function levelToY(db: number, L: Layout): number {
  const clamped = db < SPEC_MIN_DB ? SPEC_MIN_DB : db > SPEC_MAX_DB ? SPEC_MAX_DB : db;
  return L.y1 - ((clamped - SPEC_MIN_DB) / (SPEC_MAX_DB - SPEC_MIN_DB)) * L.plotH;
}

function respToY(db: number, L: Layout): number {
  const clamped = db < RESP_MIN_DB ? RESP_MIN_DB : db > RESP_MAX_DB ? RESP_MAX_DB : db;
  return L.y1 - ((clamped - RESP_MIN_DB) / (RESP_MAX_DB - RESP_MIN_DB)) * L.plotH;
}

/* ------------------------------------------------------------------ *
 * Analyser plumbing
 * ------------------------------------------------------------------ */

interface AnalyserState {
  node: AnalyserNode | null;
  bins: Float32Array;
  /** Smoothed dB per bin. Kept per *bin*, not per column, so a resize does
   *  not throw away the envelope state. */
  env: Float32Array;
  table: ResampleTable | null;
  /** True once at least one frame of real data has landed. */
  primed: boolean;
}

function makeAnalyserState(): AnalyserState {
  return { node: null, bins: new Float32Array(0), env: new Float32Array(0), table: null, primed: false };
}

/** Pull one frame and run the attack/release envelope. No allocation. */
function readSpectrum(st: AnalyserState, dt: number): void {
  const node = st.node;
  if (!node) return;

  const n = node.frequencyBinCount;
  if (st.bins.length !== n) {
    // Only on first use or an fftSize change by the engine — never per frame.
    st.bins = new Float32Array(n);
    st.env = new Float32Array(n).fill(SPEC_FLOOR);
    st.table = null;
    st.primed = false;
  }

  node.getFloatFrequencyData(st.bins);

  // dt === 0 means "first frame after a resume" or a one-shot paint: snap
  // straight to the data instead of easing up from the floor.
  const kA = dt > 0 && st.primed ? 1 - Math.exp(-dt / ATTACK_TAU) : 1;
  const kR = dt > 0 && st.primed ? 1 - Math.exp(-dt / RELEASE_TAU) : 1;

  const bins = st.bins;
  const env = st.env;
  for (let i = 0; i < n; i++) {
    const raw = bins[i];
    // Rejects -Infinity (digital silence) and NaN in one comparison pair.
    const v = raw > SPEC_FLOOR && raw < 24 ? raw : SPEC_FLOOR;
    const e = env[i];
    env[i] = e + (v - e) * (v > e ? kA : kR);
  }
  st.primed = true;
}

/** Resample the smoothed bins onto pixel columns and convert to y. */
function resampleToY(st: AnalyserState, L: Layout, out: Float32Array): void {
  const table = st.table;
  const env = st.env;
  if (!table) {
    for (let c = 0; c < L.cols; c++) out[c] = L.y1;
    return;
  }
  const { start, end, frac } = table;
  for (let c = 0; c < L.cols; c++) {
    const s = start[c];
    let db: number;
    if (s < 0) {
      db = SPEC_FLOOR;
    } else if (end[c] >= 0) {
      let m = env[s];
      for (let i = s + 1, e = end[c]; i <= e; i++) {
        const v = env[i];
        if (v > m) m = v;
      }
      db = m;
    } else {
      const a = env[s];
      const b = env[s + 1];
      db = a + (b - a) * frac[c];
    }
    out[c] = levelToY(db, L);
  }
}

function ensureTable(st: AnalyserState, L: Layout): void {
  const node = st.node;
  if (!node) return;
  const binCount = node.frequencyBinCount;
  const binHz = node.context.sampleRate / (binCount * 2);
  const t = st.table;
  if (t && t.cols === L.cols && t.binCount === binCount && t.binHz === binHz) return;
  st.table = buildResampleTable(L.cols, L.x0, L.plotW, binCount, binHz);
}

/* ------------------------------------------------------------------ *
 * Cached layers + gradients
 * ------------------------------------------------------------------ */

interface GradientCache {
  key: string;
  ghost: CanvasGradient;
  live: CanvasGradient;
}

function buildGradients(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  p: VizPalette,
  key: string,
): GradientCache {
  const ghost = ctx.createLinearGradient(0, L.y0, 0, L.y1);
  ghost.addColorStop(0, p.ghostFillTop);
  ghost.addColorStop(1, p.ghostFillBottom);

  const live = ctx.createLinearGradient(0, L.y0, 0, L.y1);
  live.addColorStop(0, p.liveFillTop);
  live.addColorStop(0.45, p.liveFillMid);
  live.addColorStop(1, p.liveFillBottom);

  return { key, ghost, live };
}

/**
 * The grid, the labels and the background, rendered once into a detached
 * canvas and blitted with a single `drawImage` per frame. Two reasons: text
 * layout is the most expensive thing on the canvas API, and keeping the chrome
 * out of the per-frame path means the hairlines are rasterised exactly once at
 * known device-pixel positions, so they stay crisp instead of being re-aliased
 * every frame. The cache is keyed on geometry only — the chrome colours are
 * deliberately amount-independent, so dragging the dial never invalidates it.
 */
function buildGridLayer(L: Layout, p: VizPalette): HTMLCanvasElement | null {
  const layer = createLayer(L.cssW, L.cssH, L.dpr);
  if (!layer) return null;
  const { canvas, ctx } = layer;

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, L.cssW, L.cssH);

  // A barely-there warm lift at the top: stops the large dark field from
  // looking like a dead rectangle in a screenshot.
  const wash = ctx.createLinearGradient(0, 0, 0, L.cssH);
  wash.addColorStop(0, p.bgTop);
  wash.addColorStop(0.65, p.bg);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, L.cssW, L.cssH);
  ctx.globalAlpha = 1;

  const hw = hairline(L.dpr);
  ctx.lineWidth = hw;
  ctx.font = LABEL_FONT;

  // Horizontal dB gridlines (response axis).
  for (const db of RESP_TICKS) {
    const y = snap(respToY(db, L), L.dpr);
    ctx.strokeStyle = db === 0 ? p.gridZero : p.grid;
    ctx.beginPath();
    ctx.moveTo(L.x0, y);
    ctx.lineTo(L.x1, y);
    ctx.stroke();

    if (L.showCurve) {
      ctx.fillStyle = db === 0 ? p.labelBright : p.label;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const label = db > 0 ? `+${db}` : `${db}`;
      ctx.fillText(label, L.x1 + 4, y);
    }
  }

  // Vertical octave gridlines + frequency labels.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const o of OCTAVES) {
    const x = snap(xOfFreq(o.f, L.x0, L.plotW), L.dpr);
    ctx.strokeStyle = p.gridOctave;
    ctx.beginPath();
    ctx.moveTo(x, L.y0);
    ctx.lineTo(x, L.y1);
    ctx.stroke();

    ctx.fillStyle = p.label;
    // Keep the outermost labels inside the frame.
    const lx = Math.max(L.x0 + 10, Math.min(L.x1 - 10, x));
    ctx.fillText(o.label, lx, L.cssH - 3.5);
  }

  // Baseline + right edge of the plot, slightly stronger than the grid.
  ctx.strokeStyle = p.hairline;
  ctx.beginPath();
  const yb = snap(L.y1, L.dpr);
  ctx.moveTo(L.x0, yb);
  ctx.lineTo(L.x1, yb);
  const xr = snap(L.x1, L.dpr);
  ctx.moveTo(xr, L.y0);
  ctx.lineTo(xr, L.y1);
  ctx.stroke();

  return canvas;
}

/* ------------------------------------------------------------------ *
 * Path helpers
 * ------------------------------------------------------------------ */

/** Open polyline across the full plot width. Leaves the path current so the
 *  caller can stroke it more than once without rebuilding it. */
function tracePolyline(
  ctx: CanvasRenderingContext2D,
  ys: Float32Array,
  L: Layout,
): void {
  ctx.beginPath();
  ctx.moveTo(L.x0, ys[0]);
  for (let c = 0; c < L.cols; c++) ctx.lineTo(L.x0 + (c + 0.5) * L.step, ys[c]);
  ctx.lineTo(L.x1, ys[L.cols - 1]);
}

/** Closed area from the polyline down to the baseline. */
function traceArea(ctx: CanvasRenderingContext2D, ys: Float32Array, L: Layout): void {
  tracePolyline(ctx, ys, L);
  ctx.lineTo(L.x1, L.y1);
  ctx.lineTo(L.x0, L.y1);
  ctx.closePath();
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface SpectrumScopeProps {
  /** Input/output taps from the engine. Null until the engine has started. */
  analysers: { input: AnalyserNode; output: AnalyserNode } | null;
  /** Magnitude response of the EQ/filter section, in dB, for the given freqs. */
  filterResponse?: (freqs: Float32Array) => Float32Array;
  className?: string;
  /** Default true. False hides layer 3 and reclaims the dB gutter. */
  showCurve?: boolean;
  /**
   * Optional override for the colour temperature, 0..1. Additive to the
   * contract: when omitted, the amount is *derived* from the filter response
   * itself (see `deriveAmount`), so the visual temperature tracks the audible
   * dampening with no extra wiring.
   */
  amount?: number;
}

/**
 * How much is this thing dampening? Average the attenuation the filter section
 * is applying across 1k/2k/4k — the attention band Dampen exists to remove —
 * and read 24 dB of loss there as "fully dampened". Deriving it from the
 * response rather than taking it as a prop means the colour cannot disagree
 * with the curve on screen.
 */
function deriveAmount(L: Layout): number {
  const d = L.respDisplay;
  const att = (d[L.probe[0]] + d[L.probe[1]] + d[L.probe[2]]) / 3;
  const a = -att / 24;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

export function SpectrumScope({
  analysers,
  filterResponse,
  className,
  showCurve = true,
  amount,
}: SpectrumScopeProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const layoutRef = useRef<Layout | null>(null);
  const gradRef = useRef<GradientCache | null>(null);
  const inRef = useRef<AnalyserState>(makeAnalyserState());
  const outRef = useRef<AnalyserState>(makeAnalyserState());

  const respCallRef = useRef<number>(Number.NEGATIVE_INFINITY);
  const respPrimedRef = useRef<boolean>(false);
  const amountRef = useRef<number>(0);

  // Props the draw loop reads. Held in refs as well as closed over, so that
  // the frame callback never has to be rebuilt mid-flight.
  const propsRef = useRef({ analysers, filterResponse, showCurve, amount });
  propsRef.current = { analysers, filterResponse, showCurve, amount };

  const reducedRef = useRef(false);

  const draw = useCallback((nowMs: number, dt: number) => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    let ctx = ctxRef.current;
    if (!ctx || ctx.canvas !== canvas) {
      // Opaque context: we always paint our own background, and skipping the
      // alpha channel measurably cheapens compositing on large canvases.
      ctx = canvas.getContext('2d', { alpha: false });
      ctxRef.current = ctx;
    }
    // A null 2D context is a real possibility (blocked canvas, lost context).
    // There is nothing honest to draw in that case, so bail quietly.
    if (!ctx) return;

    const m = metricsRef.current;
    if (m.cssW <= 0 || m.cssH <= 0) return;

    const { analysers: an, filterResponse: fr, showCurve: curveOn, amount: amtProp } =
      propsRef.current;

    const resized = syncCanvasSize(canvas, ctx, m);
    let L = layoutRef.current;
    if (resized || !L || L.version !== m.version || L.showCurve !== curveOn) {
      L = buildLayout(m, curveOn);
      layoutRef.current = L;
      gradRef.current = null;
      inRef.current.table = null;
      outRef.current.table = null;
      respPrimedRef.current = false;
      respCallRef.current = Number.NEGATIVE_INFINITY;
    }
    if (!L) return;

    /* ---- data ------------------------------------------------------ */

    if (an) {
      if (inRef.current.node !== an.input) {
        inRef.current = makeAnalyserState();
        inRef.current.node = an.input;
      }
      if (outRef.current.node !== an.output) {
        outRef.current = makeAnalyserState();
        outRef.current.node = an.output;
      }
      ensureTable(inRef.current, L);
      ensureTable(outRef.current, L);
      readSpectrum(inRef.current, dt);
      readSpectrum(outRef.current, dt);
      resampleToY(inRef.current, L, L.ghostY);
      resampleToY(outRef.current, L, L.liveY);
    } else if (inRef.current.node) {
      inRef.current = makeAnalyserState();
      outRef.current = makeAnalyserState();
    }

    /* ---- filter response (throttled to 10 Hz, interpolated) -------- */

    if (fr) {
      if (nowMs - respCallRef.current >= RESPONSE_PERIOD_MS) {
        // Hand over a scratch copy: a callee that writes into its argument
        // must not be able to corrupt our column frequencies.
        L.callFreq.set(L.colFreq);
        const res = fr(L.callFreq);
        const n = Math.min(res.length, L.cols);
        L.respFrom.set(L.respDisplay);
        for (let c = 0; c < n; c++) {
          const v = res[c];
          L.respTo[c] = Number.isFinite(v) ? v : RESP_MIN_DB;
        }
        // Short result: hold the last valid value rather than drawing a cliff.
        for (let c = n; c < L.cols; c++) L.respTo[c] = n > 0 ? L.respTo[n - 1] : 0;
        if (!respPrimedRef.current) {
          L.respFrom.set(L.respTo);
          respPrimedRef.current = true;
        }
        respCallRef.current = nowMs;
      }
      const t = Math.max(0, Math.min(1, (nowMs - respCallRef.current) / RESPONSE_PERIOD_MS));
      for (let c = 0; c < L.cols; c++) {
        const a = L.respFrom[c];
        L.respDisplay[c] = a + (L.respTo[c] - a) * t;
        L.respY[c] = respToY(L.respDisplay[c], L);
      }
    } else if (respPrimedRef.current) {
      respPrimedRef.current = false;
      L.respDisplay.fill(0);
      L.respFrom.fill(0);
      L.respTo.fill(0);
    }

    /* ---- colour temperature ---------------------------------------- */

    const target =
      amtProp !== undefined && Number.isFinite(amtProp)
        ? Math.max(0, Math.min(1, amtProp))
        : fr
          ? deriveAmount(L)
          : 0;
    const kAmt = dt > 0 ? 1 - Math.exp(-dt / AMOUNT_TAU) : 1;
    amountRef.current += (target - amountRef.current) * kAmt;
    const p = vizColors(amountRef.current);

    /* ---- cached layers --------------------------------------------- */

    if (!L.grid) L.grid = buildGridLayer(L, p);

    const gKey = `${L.cssW}x${L.cssH}@${L.dpr}:${p.amount.toFixed(4)}`;
    let grad = gradRef.current;
    if (!grad || grad.key !== gKey) {
      grad = buildGradients(ctx, L, p, gKey);
      gradRef.current = grad;
    }

    /* ---- paint ----------------------------------------------------- */

    if (L.grid) {
      // One blit: background + grid + labels. Also serves as the clear.
      ctx.drawImage(L.grid, 0, 0, L.cssW, L.cssH);
    } else {
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, L.cssW, L.cssH);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x0, 0, L.plotW, L.y1);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (an) {
      // Layer 1 — what you would have heard.
      traceArea(ctx, L.ghostY, L);
      ctx.fillStyle = grad.ghost;
      ctx.fill();
      tracePolyline(ctx, L.ghostY, L);
      ctx.lineWidth = Math.max(hairline(L.dpr), 0.9);
      ctx.strokeStyle = p.ghostStroke;
      ctx.stroke();

      // Layer 2 — what you actually hear.
      traceArea(ctx, L.liveY, L);
      ctx.fillStyle = grad.live;
      ctx.fill();
      tracePolyline(ctx, L.liveY, L);
      // Two strokes over one path: a wide soft pass reads as bloom, a thin
      // bright pass gives the filament. Cheaper and more controllable than
      // shadowBlur, which is re-rasterised from scratch every frame.
      ctx.lineWidth = 3;
      ctx.strokeStyle = p.liveGlow;
      ctx.stroke();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = p.liveStroke;
      ctx.stroke();
    } else {
      // Empty state — a calm, slow-breathing baseline. No error, no blank box.
      const breath = reducedRef.current
        ? 0
        : Math.sin((nowMs / 1000) * ((Math.PI * 2) / IDLE_PERIOD));
      const lift = breath * 2.5;
      for (let c = 0; c < L.cols; c++) L.ghostY[c] = levelToY(L.idleDb[c] + lift, L);
      traceArea(ctx, L.ghostY, L);
      ctx.fillStyle = p.idleFill;
      ctx.fill();
      tracePolyline(ctx, L.ghostY, L);
      ctx.lineWidth = Math.max(hairline(L.dpr), 1);
      ctx.strokeStyle = p.idle;
      ctx.stroke();
    }

    // Layer 3 — the filter response. Drawn last so it stays readable over the
    // spectra, and drawn even with no audio so the dial is explorable before
    // playback starts.
    if (curveOn && fr) {
      const zeroY = respToY(0, L);
      // Faint shade between 0 dB and the curve: makes "the curve swept down"
      // land as an area of loss, not just a moved line.
      traceArea(ctx, L.respY, L);
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.x0, Math.min(zeroY, L.y1), L.plotW, Math.abs(L.y1 - zeroY));
      ctx.clip();
      traceArea(ctx, L.respY, L);
      ctx.fillStyle = p.curveShade;
      ctx.fill();
      ctx.restore();

      tracePolyline(ctx, L.respY, L);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = p.curveGlow;
      ctx.stroke();
      ctx.lineWidth = 1.15;
      ctx.strokeStyle = p.curve;
      ctx.stroke();
    }

    ctx.restore();

    /* ---- legend ---------------------------------------------------- */

    ctx.font = LEGEND_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const ly = L.y0 + 6;
    let lx = L.x0 + 8;
    const swatch = (color: string, label: string): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(hairline(L.dpr), 1.1);
      ctx.beginPath();
      const sy = snap(ly, L.dpr);
      ctx.moveTo(lx, sy);
      ctx.lineTo(lx + 7, sy);
      ctx.stroke();
      ctx.fillStyle = p.label;
      ctx.fillText(label, lx + 11, ly);
      lx += 11 + ctx.measureText(label).width + 12;
    };
    if (an) {
      swatch(p.ghostStroke, 'input');
      swatch(p.liveStroke, 'dampened');
    } else {
      swatch(p.idle, 'no signal');
    }
    if (curveOn && fr) swatch(p.curve, 'response');
  }, []);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  const onFrame = useCallback((nowMs: number, dt: number) => {
    drawRef.current(nowMs, dt);
  }, []);

  // The loop keeps running for the idle breath and for live response updates;
  // it only truly parks when there is genuinely nothing that can change.
  const hasData = analysers !== null || filterResponse !== undefined;

  const { reducedMotion, requestFrame } = useAnimationLoop({
    onFrame,
    target: hostRef,
    // With reduced motion and no data there is nothing to animate at all, so
    // the loop parks entirely and the hook paints a single static frame.
    enabled: hasData || true,
    // No analysers means the only moving things are the idle breath and the
    // response crossfade; neither needs display refresh rate.
    fps: analysers ? 0 : 30,
    reducedFps: 10,
  });

  reducedRef.current = reducedMotion;

  const metricsRef = useCanvasMetrics(hostRef, requestFrame);

  // Geometry-affecting props changed while the loop may be parked.
  useEffect(() => {
    requestFrame();
  }, [requestFrame, showCurve, analysers, filterResponse, amount, reducedMotion]);

  return (
    <div
      ref={hostRef}
      className={twMerge(
        clsx('relative block h-48 min-h-20 w-full overflow-hidden rounded-md'),
        className,
      )}
    >
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden="true" />
      <span className="sr-only">
        Live spectrum analyser comparing the original audio with the dampened output, with the
        filter response curve overlaid.
      </span>
    </div>
  );
}

export default SpectrumScope;
