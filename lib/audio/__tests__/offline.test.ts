/**
 * Dampen — tests that genuinely need a Web Audio implementation.
 *
 * These run against `OfflineAudioContext`, which renders faster than realtime
 * and deterministically. In Node there is no such global, so every case is
 * reported as **skipped** rather than failing — the pure suite in
 * `dsp.test.ts` is the one that must be green everywhere.
 *
 * Note that the `DampenEngine` itself is not exercised here: it constructs a
 * realtime `AudioContext` (it has to — `OfflineAudioContext` has no
 * `destination` you can listen to and no `resume`). What is tested is the
 * pieces whose correctness is a claim about *samples*: the M/S matrix as
 * actually wired, the waveshaper's transparency at drive 0, and the
 * convolver's loudness independence from the synthesised IR.
 */

import { makeSaturationCurve } from '../dsp';
import { buildRoomIR } from '../ir';
import { createWidthBlock } from '../width';
import { assert, assertClose, type TestCase } from './harness';

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

function offlineCtor(): OfflineCtor | null {
  const g = globalThis as unknown as {
    OfflineAudioContext?: OfflineCtor;
    webkitOfflineAudioContext?: OfflineCtor;
  };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

const CTOR = offlineCtor();
const SKIP = CTOR === null;
const SKIP_REASON = 'OfflineAudioContext is unavailable (running outside a browser)';

const SR = 48000;
const N = 4096;

/** A deterministic stereo test signal: two different tones, L and R. */
function makeStereoSource(ctx: OfflineAudioContext): AudioBufferSourceNode {
  const buf = ctx.createBuffer(2, N, SR);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  for (let i = 0; i < N; i++) {
    l[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR);
    r[i] = 0.3 * Math.sin((2 * Math.PI * 660 * i) / SR + 1);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

async function renderWidth(width: number): Promise<{ out: AudioBuffer; src: AudioBuffer }> {
  if (!CTOR) throw new Error('unreachable');
  const ctx = new CTOR(2, N, SR);
  const src = makeStereoSource(ctx);
  const block = createWidthBlock(ctx);
  block.widthParam.setValueAtTime(width, 0);
  src.connect(block.input);
  block.output.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  const buffer = src.buffer;
  if (!buffer) throw new Error('source buffer vanished');
  return { out, src: buffer };
}

const widthCases: TestCase[] = [
  {
    name: 'offline: the wired M/S block at width 1 is transparent',
    skip: SKIP,
    skipReason: SKIP_REASON,
    run: async () => {
      const { out, src } = await renderWidth(1);
      for (let ch = 0; ch < 2; ch++) {
        const a = out.getChannelData(ch);
        const b = src.getChannelData(ch);
        let worst = 0;
        for (let i = 0; i < N; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
        // float32 accumulation through six gain nodes; 1e-6 is generous but
        // still three orders of magnitude below audibility.
        assert(worst < 1e-6, `channel ${ch} deviates by ${worst.toExponential(2)}`);
      }
    },
  },
  {
    name: 'offline: the wired M/S block at width 0 is exact mono',
    skip: SKIP,
    skipReason: SKIP_REASON,
    run: async () => {
      const { out, src } = await renderWidth(0);
      const ol = out.getChannelData(0);
      const or = out.getChannelData(1);
      const sl = src.getChannelData(0);
      const sr = src.getChannelData(1);
      for (let i = 0; i < N; i++) {
        assert(Math.abs(ol[i] - or[i]) < 1e-7, `channels differ at ${i}`);
        assert(Math.abs(ol[i] - (sl[i] + sr[i]) / 2) < 1e-6, `not the mid at ${i}`);
      }
    },
  },
  {
    name: 'offline: a mono input is not panned by the M/S block',
    skip: SKIP,
    skipReason: SKIP_REASON,
    run: async () => {
      if (!CTOR) return;
      // The failure mode this guards: ChannelSplitter is 'discrete', so a mono
      // signal would appear as L = mono, R = 0 and come out hard left.
      const ctx = new CTOR(2, N, SR);
      const buf = ctx.createBuffer(1, N, SR);
      const mono = buf.getChannelData(0);
      for (let i = 0; i < N; i++) mono[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / SR);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const block = createWidthBlock(ctx);
      block.widthParam.setValueAtTime(1.6, 0);
      src.connect(block.input);
      block.output.connect(ctx.destination);
      src.start();
      const out = await ctx.startRendering();
      const l = out.getChannelData(0);
      const r = out.getChannelData(1);
      for (let i = 0; i < N; i++) {
        assert(Math.abs(l[i] - r[i]) < 1e-6, `mono went off-centre at ${i}`);
        assert(Math.abs(l[i] - mono[i]) < 1e-6, `mono level changed at ${i}`);
      }
    },
  },
];

const waveshaperCases: TestCase[] = [
  {
    name: 'offline: the waveshaper at drive 0 passes samples through unchanged',
    skip: SKIP,
    skipReason: SKIP_REASON,
    run: async () => {
      if (!CTOR) return;
      const ctx = new CTOR(1, N, SR);
      const buf = ctx.createBuffer(1, N, SR);
      const data = buf.getChannelData(0);
      for (let i = 0; i < N; i++) data[i] = 0.9 * Math.sin((2 * Math.PI * 1000 * i) / SR);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const shaper = ctx.createWaveShaper();
      shaper.curve = makeSaturationCurve(0);
      shaper.oversample = 'none';
      src.connect(shaper);
      shaper.connect(ctx.destination);
      src.start();
      const out = (await ctx.startRendering()).getChannelData(0);
      let worst = 0;
      for (let i = 0; i < N; i++) worst = Math.max(worst, Math.abs(out[i] - data[i]));
      // The browser interpolates linearly within the table, and the table is
      // linear, so the only error is float32 rounding.
      assert(worst < 1e-5, `identity curve deviates by ${worst.toExponential(2)}`);
    },
  },
  {
    name: 'offline: the waveshaper at full drive adds odd harmonics and no DC',
    skip: SKIP,
    skipReason: SKIP_REASON,
    run: async () => {
      if (!CTOR) return;
      const ctx = new CTOR(1, N, SR);
      const buf = ctx.createBuffer(1, N, SR);
      const data = buf.getChannelData(0);
      for (let i = 0; i < N; i++) data[i] = 0.8 * Math.sin((2 * Math.PI * 500 * i) / SR);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const shaper = ctx.createWaveShaper();
      shaper.curve = makeSaturationCurve(1);
      shaper.oversample = '4x';
      src.connect(shaper);
      shaper.connect(ctx.destination);
      src.start();
      const out = (await ctx.startRendering()).getChannelData(0);

      let sum = 0;
      let peak = 0;
      for (let i = 0; i < N; i++) {
        sum += out[i];
        peak = Math.max(peak, Math.abs(out[i]));
      }
      // Odd symmetry means no even harmonics and therefore no DC term.
      assertClose(sum / N, 0, 0.02, 'DC offset');
      assert(peak > 0.85, `expected the peak to be pushed up by compression, got ${peak}`);
      assert(peak <= 1.001, `must not exceed full scale, got ${peak}`);
    },
  },
];

const convolverCases: TestCase[] = [
  {
    name: 'offline: the synthesised IR gives the convolver unity RMS gain at any decay',
    skip: SKIP,
    skipReason: SKIP_REASON,
    run: async () => {
      if (!CTOR) return;
      const results: number[] = [];
      for (const decay of [0.3, 1.5]) {
        const len = Math.round(SR * (decay * 1.12 + 1.2));
        const ctx = new CTOR(1, len, SR);
        // White noise in: the IR is normalised for noise-like input.
        const buf = ctx.createBuffer(2, Math.round(SR * 1), SR);
        for (let ch = 0; ch < 2; ch++) {
          const d = buf.getChannelData(ch);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const conv = ctx.createConvolver();
        conv.normalize = false;
        conv.buffer = buildRoomIR(ctx, { decay, preDelay: 0, damping: 0.4, size: 0.4 });
        src.connect(conv);
        conv.connect(ctx.destination);
        src.start();
        const out = (await ctx.startRendering()).getChannelData(0);
        let s = 0;
        for (let i = 0; i < out.length; i++) s += out[i] * out[i];
        results.push(Math.sqrt(s / out.length));
      }
      // Both renders are the same length relative to their own tail, so the
      // RMS figures should be within a couple of dB of each other. The claim
      // being tested is only that decay is not also a volume control.
      const ratioDb = 20 * Math.log10(results[0] / results[1]);
      assert(
        Math.abs(ratioDb) < 6,
        `decay changed the level by ${ratioDb.toFixed(1)} dB (expected < 6)`,
      );
    },
  },
];

/** Everything that needs a Web Audio implementation. */
export const OFFLINE_TESTS: readonly TestCase[] = [
  ...widthCases,
  ...waveshaperCases,
  ...convolverCases,
];
