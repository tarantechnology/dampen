/**
 * Dampen — pure DSP tests. No `AudioContext` required, so these run in Node.
 *
 * The priority is the arithmetic that is both easy to get subtly wrong and
 * impossible to notice by ear until it is too late:
 *
 *  - macro interpolation (a wrong neutral silently makes a preset un-neutral),
 *  - dB ↔ linear (an off-by-20-vs-10 bug is a 2× level error),
 *  - the M/S matrix (a wrong sign is a collapsed or inverted image),
 *  - the saturation curve's linearity at drive 0 (the transparency promise),
 *  - the IR envelope hitting −60 dB at exactly `decay`,
 *  - parameter clamping rejecting `NaN`, which is the bug class that kills an
 *    entire audio graph with no error message.
 */

import {
  blockLevels,
  cloneParams,
  dbToLin,
  driftWindow,
  getPath,
  lerp,
  lerpLog,
  linToDb,
  makeSaturationCurve,
  msMatrix,
  num,
  SATURATION_K_MAX,
  setPath,
} from '../dsp';
import { envelopeAt, irCacheKey, normalizeEnergy, renderRoomIR } from '../ir';
import { DEFAULT_PARAMS, PRESETS, getPreset, resolveParams } from '../presets';
import { sanitizeParams, setParamPath, PARAM_RANGES } from '../params';
import { assert, assertClose, assertEqual, mulberry32, type TestCase } from './harness';

/* ------------------------------------------------------------------ *
 * dB <-> linear
 * ------------------------------------------------------------------ */

const dbTests: TestCase[] = [
  {
    name: 'dbToLin: 0 dB is unity, -6.0206 dB is exactly a half',
    run: () => {
      assertClose(dbToLin(0), 1, 1e-12, 'dbToLin(0)');
      assertClose(dbToLin(-6.020599913279624), 0.5, 1e-12, 'dbToLin(-6.02)');
      assertClose(dbToLin(6.020599913279624), 2, 1e-12, 'dbToLin(+6.02)');
      assertClose(dbToLin(-20), 0.1, 1e-12, 'dbToLin(-20)');
    },
  },
  {
    name: 'dbToLin: -Infinity is exactly zero (true silence, not -90 dB)',
    run: () => {
      assertEqual(dbToLin(-Infinity), 0, 'dbToLin(-Infinity)');
      // A branch at 1e-18 is not silent in the sense that matters: it still
      // forces the browser to render the branch and still sums into the bus.
      assert(dbToLin(-Infinity) === 0, 'must be the integer zero');
    },
  },
  {
    name: 'dbToLin: NaN and +Infinity degrade to unity, never to NaN',
    run: () => {
      assertEqual(dbToLin(Number.NaN), 1, 'dbToLin(NaN)');
      assertEqual(dbToLin(Infinity), 1, 'dbToLin(+Infinity)');
    },
  },
  {
    name: 'linToDb: inverse of dbToLin, and 0 maps to -Infinity',
    run: () => {
      for (const db of [-60, -24, -12, -6, -1, 0, 3, 6]) {
        assertClose(linToDb(dbToLin(db)), db, 1e-9, `roundtrip ${db} dB`);
      }
      assertEqual(linToDb(0), -Infinity, 'linToDb(0)');
      assertEqual(linToDb(-1), -Infinity, 'linToDb(negative)');
      assertEqual(linToDb(Number.NaN), -Infinity, 'linToDb(NaN)');
    },
  },
  {
    name: 'blockLevels: peak and RMS of a full-scale sine are 0 dB and -3.01 dB',
    run: () => {
      const n = 4096;
      const buf = new Float32Array(n);
      // Exactly 8 whole cycles, so the RMS of the window is the true RMS.
      for (let i = 0; i < n; i++) buf[i] = Math.sin((2 * Math.PI * 8 * i) / n);
      const { peakDb, rmsDb } = blockLevels(buf);
      assertClose(peakDb, 0, 0.01, 'sine peak');
      assertClose(rmsDb, -3.0103, 0.02, 'sine RMS (1/sqrt(2))');
    },
  },
  {
    name: 'blockLevels: a NaN sample is dropped, not propagated into the meter',
    run: () => {
      const buf = new Float32Array([0.5, Number.NaN, -0.5, 0.25]);
      const { peakDb, rmsDb } = blockLevels(buf);
      assert(Number.isFinite(peakDb), 'peak must stay finite');
      assert(Number.isFinite(rmsDb), 'rms must stay finite');
      assertClose(peakDb, linToDb(0.5), 1e-9, 'peak ignores the NaN');
    },
  },
];

/* ------------------------------------------------------------------ *
 * Interpolation
 * ------------------------------------------------------------------ */

const lerpTests: TestCase[] = [
  {
    name: 'lerp: endpoints exact, t clamped, non-finite endpoints snap',
    run: () => {
      assertEqual(lerp(2, 10, 0), 2, 'lerp t=0');
      assertEqual(lerp(2, 10, 1), 10, 'lerp t=1');
      assertClose(lerp(2, 10, 0.25), 4, 1e-12, 'lerp t=0.25');
      assertEqual(lerp(2, 10, -5), 2, 'lerp clamps below 0');
      assertEqual(lerp(2, 10, 5), 10, 'lerp clamps above 1');
      // Lerping from -Infinity (an ambience level) must not poison the result.
      assertEqual(lerp(-Infinity, -20, 0.9), -20, 'non-finite endpoint snaps');
    },
  },
  {
    name: 'lerpLog: the midpoint is the geometric mean, not the arithmetic one',
    run: () => {
      // 20 kHz -> 500 Hz. Arithmetic midpoint would be 10250 Hz, which is
      // perceptually nothing; the geometric midpoint is 3162 Hz.
      assertClose(lerpLog(20000, 500, 0.5), Math.sqrt(20000 * 500), 1e-6, 'geometric midpoint');
      assertClose(lerpLog(20000, 500, 0), 20000, 1e-6, 'lerpLog t=0');
      assertClose(lerpLog(20000, 500, 1), 500, 1e-6, 'lerpLog t=1');
      // Non-positive endpoints fall back to linear rather than producing NaN.
      assertEqual(lerpLog(0, 10, 0.5), 5, 'lerpLog falls back to linear at 0');
    },
  },
];

/* ------------------------------------------------------------------ *
 * M/S matrix
 * ------------------------------------------------------------------ */

const msTests: TestCase[] = [
  {
    name: 'M/S: width = 1 is a bit-exact identity for arbitrary L/R',
    run: () => {
      const rng = mulberry32(7);
      for (let i = 0; i < 500; i++) {
        const l = rng() * 2 - 1;
        const r = rng() * 2 - 1;
        const [ol, or] = msMatrix(l, r, 1);
        // The matrix is (L+R)/2 ± (L-R)/2; in float64 that is exact for these
        // magnitudes, so a tight tolerance is correct and catches sign errors.
        assertClose(ol, l, 1e-15, 'L through width=1');
        assertClose(or, r, 1e-15, 'R through width=1');
      }
    },
  },
  {
    name: 'M/S: width = 0 is exact mono',
    run: () => {
      const [ol, or] = msMatrix(0.8, -0.2, 0);
      assertClose(ol, 0.3, 1e-15, 'mono L');
      assertClose(or, 0.3, 1e-15, 'mono R');
      assertEqual(ol, or, 'mono channels identical');
    },
  },
  {
    name: 'M/S: width = 2 doubles the side signal without touching the mid',
    run: () => {
      const l = 1;
      const r = 0;
      const [ol, or] = msMatrix(l, r, 2);
      // M = 0.5, S = 0.5 -> L' = 0.5 + 1.0, R' = 0.5 - 1.0
      assertClose(ol, 1.5, 1e-15, 'wide L');
      assertClose(or, -0.5, 1e-15, 'wide R');
      // Mid is preserved at every width: (L'+R')/2 must equal (L+R)/2.
      assertClose((ol + or) / 2, (l + r) / 2, 1e-15, 'mid invariant');
    },
  },
  {
    name: 'M/S: a mono input stays centred at every width',
    run: () => {
      for (const w of [0, 0.25, 0.5, 1, 1.5, 2]) {
        const [ol, or] = msMatrix(0.6, 0.6, w);
        assertClose(ol, 0.6, 1e-15, `mono L at width ${w}`);
        assertClose(or, 0.6, 1e-15, `mono R at width ${w}`);
      }
    },
  },
  {
    name: 'M/S: a NaN width degrades to unity rather than destroying the signal',
    run: () => {
      const [ol, or] = msMatrix(0.3, -0.7, Number.NaN);
      assertClose(ol, 0.3, 1e-15, 'NaN width L');
      assertClose(or, -0.7, 1e-15, 'NaN width R');
    },
  },
];

/* ------------------------------------------------------------------ *
 * Saturation
 * ------------------------------------------------------------------ */

const satTests: TestCase[] = [
  {
    name: 'saturation: drive = 0 is a perfectly linear table',
    run: () => {
      const n = 4096;
      const curve = makeSaturationCurve(0, n);
      assertEqual(curve.length, n, 'curve length');
      for (let i = 0; i < n; i++) {
        const expected = (i / (n - 1)) * 2 - 1;
        // float32 storage, so compare at float32 precision.
        assertClose(curve[i], expected, 1e-6, `identity at index ${i}`);
      }
      assertClose(curve[0], -1, 1e-7, 'curve starts at -1');
      assertClose(curve[n - 1], 1, 1e-7, 'curve ends at +1');
    },
  },
  {
    name: 'saturation: NaN / out-of-range drive is treated as 0 (linear)',
    run: () => {
      for (const bad of [Number.NaN, Infinity, -Infinity, -5]) {
        const curve = makeSaturationCurve(bad, 256);
        assertClose(curve[64], (64 / 255) * 2 - 1, 1e-6, `linear for drive=${bad}`);
      }
    },
  },
  {
    name: 'saturation: unity endpoints at every drive, so drive is not a volume knob',
    run: () => {
      for (const d of [0, 0.01, 0.1, 0.5, 1]) {
        const curve = makeSaturationCurve(d, 1024);
        assertClose(curve[1023], 1, 1e-6, `y(+1) at drive ${d}`);
        assertClose(curve[0], -1, 1e-6, `y(-1) at drive ${d}`);
      }
    },
  },
  {
    name: 'saturation: odd symmetry (odd harmonics only, no DC offset)',
    run: () => {
      const n = 1025; // odd length so index 512 is exactly x = 0
      const curve = makeSaturationCurve(0.8, n);
      assertClose(curve[(n - 1) / 2], 0, 1e-6, 'y(0) = 0');
      for (let i = 0; i < n; i++) {
        assertClose(curve[i], -curve[n - 1 - i], 1e-6, `odd symmetry at ${i}`);
      }
    },
  },
  {
    name: 'saturation: monotonic and compressive at full drive',
    run: () => {
      const n = 2048;
      const curve = makeSaturationCurve(1, n);
      for (let i = 1; i < n; i++) {
        assert(curve[i] >= curve[i - 1] - 1e-7, `monotonic at ${i}`);
      }
      // Half scale in must come out louder than half scale (that is the
      // compression), and full drive must actually be doing something.
      const half = curve[Math.floor(n * 0.75)]; // x = +0.5
      const expected = Math.tanh(SATURATION_K_MAX * 0.5) / Math.tanh(SATURATION_K_MAX);
      assertClose(half, expected, 1e-5, 'tanh value at x = 0.5');
      assert(half > 0.9, `expected heavy compression at full drive, got ${half}`);
    },
  },
  {
    name: 'saturation: the curve tends continuously to the identity as drive -> 0',
    run: () => {
      const n = 512;
      const tiny = makeSaturationCurve(1e-3, n);
      for (let i = 0; i < n; i++) {
        const linear = (i / (n - 1)) * 2 - 1;
        assertClose(tiny[i], linear, 1e-3, `near-identity at ${i}`);
      }
    },
  },
];

/* ------------------------------------------------------------------ *
 * Drift LFO window
 * ------------------------------------------------------------------ */

const driftTests: TestCase[] = [
  {
    name: 'drift: the gain window is (0, 1] — never zero, never boosting',
    run: () => {
      for (const depth of [0, 0.5, 1, 3, 6, 12]) {
        const { centre, amplitude } = driftWindow(depth);
        const min = centre - amplitude;
        const max = centre + amplitude;
        assert(min > 0, `depth ${depth}: minimum gain ${min} must be > 0`);
        assertClose(max, 1, 1e-12, `depth ${depth}: maximum gain is unity`);
        assertClose(min, dbToLin(-depth), 1e-12, `depth ${depth}: trough is -${depth} dB`);
      }
    },
  },
  {
    name: 'drift: depth 0 is exactly no modulation',
    run: () => {
      const { centre, amplitude } = driftWindow(0);
      assertEqual(centre, 1, 'centre');
      assertEqual(amplitude, 0, 'amplitude');
    },
  },
  {
    name: 'drift: NaN depth is treated as zero',
    run: () => {
      const { centre, amplitude } = driftWindow(Number.NaN);
      assertEqual(centre, 1, 'centre');
      assertEqual(amplitude, 0, 'amplitude');
    },
  },
];

/* ------------------------------------------------------------------ *
 * Clamping and NaN safety
 * ------------------------------------------------------------------ */

const clampTests: TestCase[] = [
  {
    name: 'num: rejects NaN, Infinity, strings and objects; clamps the rest',
    run: () => {
      assertEqual(num(Number.NaN, 5, 0, 10), 5, 'NaN -> fallback');
      assertEqual(num(Infinity, 5, 0, 10), 5, '+Infinity -> fallback');
      assertEqual(num(-Infinity, 5, 0, 10), 5, '-Infinity -> fallback');
      assertEqual(num('7', 5, 0, 10), 5, 'string -> fallback (no coercion)');
      assertEqual(num({}, 5, 0, 10), 5, 'object -> fallback');
      assertEqual(num(undefined, 5, 0, 10), 5, 'undefined -> fallback');
      assertEqual(num(-3, 5, 0, 10), 0, 'below range clamps to min');
      assertEqual(num(99, 5, 0, 10), 10, 'above range clamps to max');
      assertEqual(num(7, 5, 0, 10), 7, 'in range passes through');
      // A fallback that is itself out of range must still be clamped.
      assertEqual(num(Number.NaN, 999, 0, 10), 10, 'fallback is clamped too');
    },
  },
  {
    name: 'sanitizeParams: a wholly hostile object yields valid defaults',
    run: () => {
      const hostile = {
        amount: Number.NaN,
        outputGain: 'loud',
        lowpass: { freq: -1, q: Infinity, stages: 99 },
        highpass: null,
        reverb: { mix: 2, decay: -4, preDelay: Number.NaN, damping: 'x', size: {} },
        width: Number.NaN,
        compressor: { threshold: 40, ratio: 0, attack: -1, release: 99, knee: -5, makeup: 1e9 },
        saturation: Number.NaN,
        bitcrush: { bits: 0.5, downsample: 1e9, mix: -2 },
        ambience: { kind: 'nonsense', level: Number.NaN, tone: 4 },
        drift: { rate: Infinity, depth: Number.NaN },
      };
      const p = sanitizeParams(hostile, DEFAULT_PARAMS);

      const walk = (v: unknown, path: string): void => {
        if (typeof v === 'number') {
          assert(
            Number.isFinite(v) || v === -Infinity,
            `${path} must be finite (or -Infinity for a level), got ${v}`,
          );
          const range = PARAM_RANGES[path];
          if (range && v !== -Infinity) {
            assert(v >= range[0] && v <= range[1], `${path} = ${v} outside [${range[0]}, ${range[1]}]`);
          }
          return;
        }
        if (typeof v === 'object' && v !== null) {
          for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
            walk(child, path ? `${path}.${k}` : k);
          }
        }
      };
      walk(p, '');

      assertEqual(p.lowpass.stages, 4, 'stages clamped to 4');
      assertEqual(p.ambience.kind, DEFAULT_PARAMS.ambience.kind, 'bad kind -> default');
      assertEqual(p.compressor.ratio, 1, 'ratio clamped to >= 1');
      assertEqual(p.bitcrush.bits, 1, 'bits clamped to >= 1 and integral');
      assert(Number.isInteger(p.bitcrush.downsample), 'downsample is integral');
    },
  },
  {
    name: 'sanitizeParams: -Infinity survives as an ambience level',
    run: () => {
      const p = sanitizeParams({ ambience: { kind: 'rain', level: -Infinity, tone: 0.5 } }, DEFAULT_PARAMS);
      assertEqual(p.ambience.level, -Infinity, 'level stays -Infinity');
      assertEqual(dbToLin(p.ambience.level), 0, 'and therefore is true silence');
    },
  },
  {
    name: 'setParamPath: valid edits apply, invalid ones are rejected without mutating',
    run: () => {
      const base = cloneParams(DEFAULT_PARAMS);

      const ok = setParamPath(base, 'lowpass.freq', 800);
      assertEqual(ok.lowpass.freq, 800, 'valid numeric edit');
      assertEqual(base.lowpass.freq, DEFAULT_PARAMS.lowpass.freq, 'input not mutated');

      assertEqual(setParamPath(base, 'nope.nothing', 1), base, 'unknown path rejected');
      assertEqual(setParamPath(base, 'lowpass.freq', Number.NaN), base, 'NaN rejected');
      assertEqual(setParamPath(base, 'lowpass.freq', 'abc'), base, 'unparseable string rejected');

      const clamped = setParamPath(base, 'lowpass.freq', 1e9);
      assertEqual(clamped.lowpass.freq, PARAM_RANGES['lowpass.freq'][1], 'out of range clamps');

      const kind = setParamPath(base, 'ambience.kind', 'rain');
      assertEqual(kind.ambience.kind, 'rain', 'string enum edit');
      assertEqual(setParamPath(base, 'ambience.kind', 'wrong'), base, 'bad enum rejected');

      const stages = setParamPath(base, 'lowpass.stages', 2.6);
      assertEqual(stages.lowpass.stages, 3, 'stages rounded and narrowed');

      // Numeric strings from a range input's `value` are accepted.
      const fromInput = setParamPath(base, 'width', '0.5');
      assertEqual(fromInput.width, 0.5, 'numeric string accepted');
    },
  },
  {
    name: 'getPath / setPath: dot paths resolve and refuse to invent branches',
    run: () => {
      const p = cloneParams(DEFAULT_PARAMS);
      assertEqual(getPath(p, 'lowpass.freq'), DEFAULT_PARAMS.lowpass.freq, 'read leaf');
      assertEqual(getPath(p, 'lowpass.nope'), undefined, 'unknown leaf is undefined');
      assertEqual(getPath(p, 'a.b.c'), undefined, 'unknown branch is undefined');
      assertEqual(setPath(p, 'lowpass.freq', 1234), true, 'write existing leaf');
      assertEqual(p.lowpass.freq, 1234, 'value written');
      assertEqual(setPath(p, 'lowpass.invented', 1), false, 'refuses to create a leaf');
      assertEqual(setPath(p, 'ghost.leaf', 1), false, 'refuses to create a branch');
    },
  },
];

/* ------------------------------------------------------------------ *
 * Presets + macro interpolation
 * ------------------------------------------------------------------ */

/** Every path listed by any preset's macro, with its neutral. */
function macroNeutrals(): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of PRESETS) for (const e of p.macro ?? []) m.set(e.path, e.neutral);
  return m;
}

const presetTests: TestCase[] = [
  {
    name: 'DEFAULT_PARAMS is the exact identity of every stage',
    run: () => {
      const d = DEFAULT_PARAMS;
      assertEqual(d.lowpass.freq, 20000, 'lowpass fully open');
      assertEqual(d.highpass.freq, 20, 'highpass fully open');
      assertEqual(d.lowShelf.gain, 0, 'low shelf flat');
      assertEqual(d.presenceDip.gain, 0, 'presence dip flat');
      assertEqual(d.tilt.gain, 0, 'tilt flat');
      assertEqual(d.reverb.mix, 0, 'reverb dry');
      assertEqual(d.width, 1, 'width unity');
      assertEqual(d.compressor.ratio, 1, 'compressor 1:1');
      assertEqual(d.compressor.makeup, 0, 'no makeup gain');
      assertEqual(d.saturation, 0, 'no saturation');
      assertEqual(d.wowFlutter.wowDepth, 0, 'no wow');
      assertEqual(d.wowFlutter.flutterDepth, 0, 'no flutter');
      assertEqual(d.bitcrush.bits, 16, '16 bits');
      assertEqual(d.bitcrush.downsample, 1, 'no downsampling');
      assertEqual(d.bitcrush.mix, 0, 'bitcrush bypassed');
      assertEqual(d.ambience.kind, 'none', 'no ambience');
      assertEqual(d.ambience.level, -Infinity, 'ambience silent');
      assertEqual(d.drift.depth, 0, 'no drift');
      assertEqual(d.outputGain, 0, 'unity output');
      assertEqual(d.amount, 0, 'macro at zero');
    },
  },
  {
    name: 'DEFAULT_PARAMS survives sanitisation unchanged (it is in range)',
    run: () => {
      const round = sanitizeParams(DEFAULT_PARAMS, DEFAULT_PARAMS);
      assertEqual(JSON.stringify(round), JSON.stringify(DEFAULT_PARAMS), 'idempotent');
    },
  },
  {
    name: 'PRESETS: the eight required ids exist, each with a blurb, glyph and macro',
    run: () => {
      const required = [
        'next-room',
        'underwater',
        'rainy-window',
        'tape-memory',
        'library',
        'deep-focus',
        'distant-radio',
        'dream',
      ];
      for (const id of required) {
        const p = getPreset(id);
        assert(p !== undefined, `preset ${id} is missing`);
        if (!p) continue;
        assert(p.name.length > 0, `${id}: no name`);
        assert(p.blurb.length > 10, `${id}: blurb too short to be real`);
        assert(p.glyph.length > 0, `${id}: no glyph`);
        assert((p.macro ?? []).length >= 8, `${id}: macro list is too thin to morph`);
        assertEqual(p.params.amount, 1, `${id}: full params are at amount 1`);
      }
      assertEqual(PRESETS.length, required.length, 'no stray presets');
      const ids = new Set(PRESETS.map((p) => p.id));
      assertEqual(ids.size, PRESETS.length, 'ids are unique');
    },
  },
  {
    name: 'resolveParams: amount = 1 reproduces the preset exactly',
    run: () => {
      for (const p of PRESETS) {
        const r = resolveParams(p, 1);
        assertEqual(JSON.stringify(r), JSON.stringify(p.params), `${p.id} at amount 1`);
      }
    },
  },
  {
    name: 'resolveParams: amount = 0 returns every macro path to its neutral',
    run: () => {
      for (const p of PRESETS) {
        const r = resolveParams(p, 0);
        assertEqual(r.amount, 0, `${p.id}: amount`);
        for (const e of p.macro ?? []) {
          const got = getPath(r, e.path);
          assert(typeof got === 'number', `${p.id}: ${e.path} is not numeric`);
          if (typeof got !== 'number') continue;
          assertClose(got, e.neutral, 1e-6, `${p.id}: ${e.path} at amount 0`);
        }
      }
    },
  },
  {
    name: 'resolveParams: amount = 0 is audibly transparent for every preset',
    run: () => {
      // The strong version of the previous test: whatever the preset does, at
      // amount 0 the *effective* settings must be the neutral ones. Paths not
      // under macro control are allowed to differ only where they cannot be
      // heard because their gating parameter is neutral.
      for (const p of PRESETS) {
        const r = resolveParams(p, 0);
        assertClose(r.lowpass.freq, 20000, 1e-6, `${p.id}: lowpass open`);
        assertClose(r.highpass.freq, 20, 1e-6, `${p.id}: highpass open`);
        assertClose(r.lowShelf.gain, 0, 1e-6, `${p.id}: low shelf flat`);
        assertClose(r.presenceDip.gain, 0, 1e-6, `${p.id}: dip flat`);
        assertClose(r.tilt.gain, 0, 1e-6, `${p.id}: tilt flat`);
        assertClose(r.reverb.mix, 0, 1e-6, `${p.id}: reverb dry`);
        assertClose(r.width, 1, 1e-6, `${p.id}: width unity`);
        assertClose(r.compressor.ratio, 1, 1e-6, `${p.id}: 1:1`);
        assertClose(r.compressor.makeup, 0, 1e-6, `${p.id}: no makeup`);
        assertClose(r.saturation, 0, 1e-6, `${p.id}: no saturation`);
        assertClose(r.drift.depth, 0, 1e-6, `${p.id}: no drift`);
        assertClose(r.outputGain, 0, 1e-6, `${p.id}: unity out`);
        assertClose(r.bitcrush.mix, 0, 1e-6, `${p.id}: bitcrush bypassed`);
        assertClose(r.wowFlutter.wowDepth, 0, 1e-6, `${p.id}: no wow`);
        assertClose(r.wowFlutter.flutterDepth, 0, 1e-6, `${p.id}: no flutter`);
        // The ambience bed is gated by level, which must be at or below the
        // silent sentinel.
        assert(r.ambience.level <= -90, `${p.id}: ambience must be silent, got ${r.ambience.level}`);
      }
    },
  },
  {
    name: 'resolveParams: monotonic in amount for every macro path',
    run: () => {
      for (const p of PRESETS) {
        for (const e of p.macro ?? []) {
          const target = getPath(p.params, e.path);
          if (typeof target !== 'number') continue;
          if (Math.abs(target - e.neutral) < 1e-9) continue;
          const up = target > e.neutral;
          let prev = e.neutral;
          for (let a = 0; a <= 1.0001; a += 0.1) {
            const v = getPath(resolveParams(p, a), e.path);
            assert(typeof v === 'number', `${p.id}.${e.path} non-numeric`);
            if (typeof v !== 'number') break;
            // Integer paths step, so allow equality in both directions.
            assert(
              up ? v >= prev - 1e-6 : v <= prev + 1e-6,
              `${p.id}.${e.path} not monotonic at amount ${a.toFixed(1)}: ${prev} -> ${v}`,
            );
            prev = v;
          }
        }
      }
    },
  },
  {
    name: 'resolveParams: frequency paths interpolate geometrically',
    run: () => {
      const nextRoom = getPreset('next-room');
      assert(nextRoom !== undefined, 'next-room exists');
      if (!nextRoom) return;
      const mid = resolveParams(nextRoom, 0.5).lowpass.freq;
      const geometric = Math.sqrt(20000 * nextRoom.params.lowpass.freq);
      assertClose(mid, geometric, 1, 'lowpass midpoint is the geometric mean');
      // Sanity: the linear midpoint would be far higher and would make the
      // first half of the dial do nothing.
      assert(mid < (20000 + nextRoom.params.lowpass.freq) / 2 - 1000, 'not the linear midpoint');
    },
  },
  {
    name: 'resolveParams: integer paths stay integral at every amount',
    run: () => {
      const radio = getPreset('distant-radio');
      assert(radio !== undefined, 'distant-radio exists');
      if (!radio) return;
      for (let a = 0; a <= 1.0001; a += 0.05) {
        const r = resolveParams(radio, a);
        assert(Number.isInteger(r.bitcrush.bits), `bits integral at ${a}`);
        assert(Number.isInteger(r.bitcrush.downsample), `downsample integral at ${a}`);
        assert([1, 2, 3, 4].includes(r.lowpass.stages), `stages valid at ${a}`);
      }
    },
  },
  {
    name: 'resolveParams: an unknown id or a NaN amount degrades to neutral',
    run: () => {
      const r = resolveParams('does-not-exist', 0.7);
      assertEqual(JSON.stringify({ ...r, amount: 0 }), JSON.stringify(DEFAULT_PARAMS), 'defaults');
      assertClose(r.amount, 0.7, 1e-9, 'amount preserved');

      const nan = resolveParams('next-room', Number.NaN);
      assertEqual(nan.amount, 0, 'NaN amount -> 0');
      assertClose(nan.lowpass.freq, 20000, 1e-6, 'and therefore neutral');
    },
  },
  {
    name: 'macro neutrals agree with DEFAULT_PARAMS (or the silent sentinel)',
    run: () => {
      for (const [path, neutral] of macroNeutrals()) {
        const def = getPath(DEFAULT_PARAMS, path);
        if (path === 'ambience.level') {
          assertEqual(neutral, -90, 'ambience neutral is the finite silent sentinel');
          continue;
        }
        assert(typeof def === 'number', `${path} is not a numeric default`);
        if (typeof def !== 'number') continue;
        assertClose(neutral, def, 1e-9, `macro neutral for ${path}`);
      }
    },
  },
];

/* ------------------------------------------------------------------ *
 * Impulse response
 * ------------------------------------------------------------------ */

const irTests: TestCase[] = [
  {
    name: 'IR envelope: exactly -60 dB at t = decay, for every decay',
    run: () => {
      for (const decay of [0.1, 0.5, 1.2, 2.5, 4, 8]) {
        const v = envelopeAt(decay, decay);
        assertClose(v, 0.001, 1e-12, `envelope at t = decay (${decay}s)`);
        assertClose(20 * Math.log10(v), -60, 1e-9, `-60 dB at t = decay (${decay}s)`);
      }
      assertEqual(envelopeAt(1, 0), 1, 'unity at t = 0');
      // Half of RT60 is half of 60 dB, i.e. -30 dB — the defining property of
      // an exponential decay.
      assertClose(20 * Math.log10(envelopeAt(2, 1)), -30, 1e-9, '-30 dB at RT60/2');
    },
  },
  {
    name: 'IR: pre-delay is real leading silence',
    run: () => {
      const fs = 48000;
      const [l, r] = renderRoomIR({ decay: 0.4, preDelay: 25, damping: 0.5, size: 0.4 }, fs, mulberry32(1));
      const preSamples = Math.round((25 / 1000) * fs);
      for (let i = 0; i < preSamples; i++) {
        assertEqual(l[i], 0, `L silent at ${i}`);
        assertEqual(r[i], 0, `R silent at ${i}`);
      }
      assert(Math.abs(l[preSamples]) > 0, 'L starts at the pre-delay');
    },
  },
  {
    name: 'IR: length tracks decay and nothing is NaN',
    run: () => {
      const fs = 44100;
      const short = renderRoomIR({ decay: 0.3, preDelay: 0, damping: 0.5, size: 0.5 }, fs, mulberry32(2));
      const long = renderRoomIR({ decay: 3, preDelay: 0, damping: 0.5, size: 0.5 }, fs, mulberry32(2));
      assert(long[0].length > short[0].length * 5, 'a 10x decay gives a much longer IR');
      assertClose(short[0].length / fs, 0.3 * 1.12, 0.01, 'short IR duration');
      for (const ch of [...short, ...long]) {
        for (let i = 0; i < ch.length; i++) {
          assert(Number.isFinite(ch[i]), `non-finite sample at ${i}`);
        }
      }
    },
  },
  {
    name: 'IR: the tail actually decays, by at least 40 dB across its length',
    run: () => {
      const fs = 48000;
      const [l] = renderRoomIR({ decay: 1.5, preDelay: 0, damping: 0.4, size: 0.2 }, fs, mulberry32(3));
      const windowRms = (from: number, n: number): number => {
        let s = 0;
        for (let i = from; i < Math.min(from + n, l.length); i++) s += l[i] * l[i];
        return Math.sqrt(s / n);
      };
      const w = Math.round(fs * 0.02);
      const first = windowRms(0, w);
      const last = windowRms(l.length - w - 1, w);
      assert(first > 0 && last > 0, 'both windows carry energy');
      const drop = 20 * Math.log10(last / first);
      assert(drop < -40, `expected > 40 dB of decay, got ${drop.toFixed(1)} dB`);
    },
  },
  {
    name: 'IR: energy normalisation makes loudness independent of decay',
    run: () => {
      const fs = 48000;
      const energyOf = (chs: Float32Array[]): number => {
        let s = 0;
        for (const ch of chs) for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
        return s / chs.length;
      };
      for (const decay of [0.2, 1, 3, 6]) {
        const chs = renderRoomIR({ decay, preDelay: 10, damping: 0.5, size: 0.5 }, fs, mulberry32(4));
        // sqrt(mean per-channel energy) == 1 is exactly what pins the
        // convolver at unity RMS gain.
        assertClose(Math.sqrt(energyOf(chs)), 1, 1e-4, `unit energy at decay ${decay}`);
      }
    },
  },
  {
    name: 'IR: normalizeEnergy preserves the L/R balance it was given',
    run: () => {
      const l = new Float32Array([1, 1, 1, 1]);
      const r = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      normalizeEnergy([l, r]);
      // Both scaled by the same factor, so the 2:1 ratio survives.
      assertClose(l[0] / r[0], 2, 1e-9, 'ratio preserved');
      const energy = (l[0] * l[0] * 4 + r[0] * r[0] * 4) / 2;
      // float32 storage: the scaled samples are rounded on write, so the
      // energy can only be unity to about 1e-7 relative.
      assertClose(energy, 1, 1e-6, 'mean per-channel energy is unity');
    },
  },
  {
    name: 'IR: channels are decorrelated (a shared tail would image in the centre)',
    run: () => {
      const fs = 48000;
      const [l, r] = renderRoomIR({ decay: 1, preDelay: 0, damping: 0.3, size: 0.5 }, fs, mulberry32(5));
      // Skip the early-reflection region, which is deliberately correlated.
      const from = Math.round(fs * 0.3);
      let dot = 0;
      let dl = 0;
      let dr = 0;
      for (let i = from; i < l.length; i++) {
        dot += l[i] * r[i];
        dl += l[i] * l[i];
        dr += r[i] * r[i];
      }
      const corr = dot / Math.sqrt(dl * dr);
      assert(Math.abs(corr) < 0.1, `expected near-zero correlation, got ${corr.toFixed(3)}`);
    },
  },
  {
    name: 'IR: damping makes the tail darker than its own beginning',
    run: () => {
      const fs = 48000;
      // Zero-crossing rate is a cheap, robust proxy for spectral centroid.
      const zcr = (buf: Float32Array, from: number, n: number): number => {
        let z = 0;
        for (let i = from + 1; i < Math.min(from + n, buf.length); i++) {
          if (buf[i] >= 0 !== buf[i - 1] >= 0) z++;
        }
        return z / n;
      };
      const [l] = renderRoomIR({ decay: 2, preDelay: 0, damping: 0.95, size: 0.3 }, fs, mulberry32(6));
      const w = Math.round(fs * 0.05);
      const early = zcr(l, Math.round(fs * 0.1), w);
      const late = zcr(l, l.length - w - 1, w);
      assert(late < early * 0.8, `tail should be darker: early ${early.toFixed(3)} late ${late.toFixed(3)}`);
    },
  },
  {
    name: 'IR: non-finite options degrade to sane defaults instead of a NaN buffer',
    run: () => {
      const chs = renderRoomIR(
        { decay: Number.NaN, preDelay: Infinity, damping: Number.NaN, size: -5 },
        48000,
        mulberry32(7),
      );
      assertEqual(chs.length, 2, 'still stereo');
      assert(chs[0].length > 0, 'still has samples');
      for (const ch of chs) for (let i = 0; i < ch.length; i++) assert(Number.isFinite(ch[i]), `finite at ${i}`);
    },
  },
  {
    name: 'irCacheKey: quantises so a one-pixel drag causes no rebuild',
    run: () => {
      const base = { decay: 1.2, preDelay: 20, damping: 0.5, size: 0.5 };
      const a = irCacheKey(base, 48000);
      assertEqual(irCacheKey({ ...base, decay: 1.21 }, 48000), a, 'tiny decay change is the same key');
      assertEqual(irCacheKey({ ...base, damping: 0.505 }, 48000), a, 'tiny damping change is the same key');
      assert(irCacheKey({ ...base, decay: 1.4 }, 48000) !== a, 'a real change is a new key');
      assert(irCacheKey(base, 44100) !== a, 'sample rate is part of the key');
    },
  },
];

/** Everything that runs without an `AudioContext`. */
export const PURE_TESTS: readonly TestCase[] = [
  ...dbTests,
  ...lerpTests,
  ...msTests,
  ...satTests,
  ...driftTests,
  ...clampTests,
  ...presetTests,
  ...irTests,
];
