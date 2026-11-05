'use client';

/**
 * components/viz/VizSandbox.tsx
 *
 * A self-contained test rig for the three visualisers. It builds its own
 * AudioContext, synthesises a signal with known spectral content (pink noise
 * plus three slowly sweeping sines), runs it through a real filter section
 * built from BiquadFilterNodes, and renders SpectrumScope, Waveform and
 * LevelMeter against it.
 *
 * `filterResponse` here is the genuine article: `BiquadFilterNode
 * .getFrequencyResponse` on every node in the section, summed in dB. So the
 * curve on screen is the actual transfer function of the actual audio path,
 * which is the only way to know the scope is telling the truth.
 *
 * No route is created for this — mount it yourself from a page you own.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { LevelMeter, type LevelMeterHandle } from './LevelMeter';
import { SpectrumScope } from './SpectrumScope';
import { Waveform } from './Waveform';

/* ------------------------------------------------------------------ *
 * Test signal
 * ------------------------------------------------------------------ */

/**
 * Paul Kellet's refined pink-noise filter. Pink (-3 dB/octave) rather than
 * white because a white spectrum slopes *up* on a log axis and makes the
 * display look top-heavy and wrong; pink draws as a flat-ish line, which makes
 * any error in the log mapping or the bin resampling immediately obvious.
 */
function fillPink(data: Float32Array): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
}

interface SweepSpec {
  /** Centre frequency, Hz. */
  base: number;
  /** LFO rate, Hz — very slow, so the peak visibly crawls across the axis. */
  rate: number;
  /** Sweep depth in cents. 1200 = one octave either side. */
  cents: number;
  /** Linear gain. */
  level: number;
}

const SWEEPS: readonly SweepSpec[] = [
  { base: 160, rate: 0.071, cents: 900, level: 0.07 },
  { base: 760, rate: 0.113, cents: 1100, level: 0.055 },
  { base: 3100, rate: 0.047, cents: 1300, level: 0.04 },
];

/* ------------------------------------------------------------------ *
 * Graph
 * ------------------------------------------------------------------ */

interface Graph {
  ctx: AudioContext;
  sources: AudioScheduledSourceNode[];
  analysers: { input: AnalyserNode; output: AnalyserNode };
  /** Everything whose magnitude response contributes to the drawn curve. */
  section: BiquadFilterNode[];
  lowpasses: BiquadFilterNode[];
  monitor: GainNode;
}

const FFT_SIZE = 4096;

function buildGraph(cutoff: number, monitorLevel: number): Graph {
  const ctx = new AudioContext({ latencyHint: 'interactive' });

  const inputGain = ctx.createGain();
  inputGain.gain.value = 1;

  // Pink noise: four seconds, looped, independent per channel so the stereo
  // image is not a dead centre mono blob.
  const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 4), ctx.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) fillPink(buffer.getChannelData(ch));
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.5;
  noise.connect(noiseGain).connect(inputGain);

  const sources: AudioScheduledSourceNode[] = [noise];

  for (const s of SWEEPS) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = s.base;

    const level = ctx.createGain();
    level.gain.value = s.level;
    osc.connect(level).connect(inputGain);

    // Modulate `detune` (cents), not `frequency` (Hz): cents are logarithmic,
    // so the peak sweeps at a constant visual speed across the log axis.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = s.rate;
    const depth = ctx.createGain();
    depth.gain.value = s.cents;
    lfo.connect(depth);
    depth.connect(osc.detune);

    sources.push(osc, lfo);
  }

  const analyserIn = ctx.createAnalyser();
  analyserIn.fftSize = FFT_SIZE;
  // The engine owns these settings in the real app; 0.65 is a reasonable
  // stand-in and lets the component's own envelope do the visible work.
  analyserIn.smoothingTimeConstant = 0.65;
  analyserIn.minDecibels = -100;
  analyserIn.maxDecibels = 0;

  const analyserOut = ctx.createAnalyser();
  analyserOut.fftSize = FFT_SIZE;
  analyserOut.smoothingTimeConstant = 0.65;
  analyserOut.minDecibels = -100;
  analyserOut.maxDecibels = 0;

  // The filter section: a structural bass lift, two cascaded lowpass stages
  // (the "wall"), and a dip in the attention band. Same shape as the real
  // engine's EQ section, so the curve exercises the same dB range.
  const lowShelf = ctx.createBiquadFilter();
  lowShelf.type = 'lowshelf';
  lowShelf.frequency.value = 120;
  lowShelf.gain.value = 4;

  const lp1 = ctx.createBiquadFilter();
  lp1.type = 'lowpass';
  lp1.frequency.value = cutoff;
  lp1.Q.value = 0.707;

  const lp2 = ctx.createBiquadFilter();
  lp2.type = 'lowpass';
  lp2.frequency.value = cutoff;
  lp2.Q.value = 0.707;

  const dip = ctx.createBiquadFilter();
  dip.type = 'peaking';
  dip.frequency.value = 3000;
  dip.Q.value = 1.1;
  dip.gain.value = -5;

  const monitor = ctx.createGain();
  monitor.gain.value = monitorLevel;

  inputGain
    .connect(analyserIn)
    .connect(lowShelf)
    .connect(lp1)
    .connect(lp2)
    .connect(dip)
    .connect(analyserOut)
    .connect(monitor)
    .connect(ctx.destination);

  for (const s of sources) s.start();

  return {
    ctx,
    sources,
    analysers: { input: analyserIn, output: analyserOut },
    section: [lowShelf, lp1, lp2, dip],
    lowpasses: [lp1, lp2],
    monitor,
  };
}

function teardown(g: Graph): void {
  for (const s of g.sources) {
    try {
      s.stop();
    } catch {
      // Already stopped — harmless.
    }
    s.disconnect();
  }
  g.analysers.input.disconnect();
  g.analysers.output.disconnect();
  for (const n of g.section) n.disconnect();
  g.monitor.disconnect();
  void g.ctx.close();
}

/* ------------------------------------------------------------------ *
 * Cutoff slider mapping
 * ------------------------------------------------------------------ */

const CUT_MIN = 80;
const CUT_MAX = 20_000;
/** Slider is 0..1000 and maps logarithmically, to match the display axis. */
function sliderToHz(v: number): number {
  return CUT_MIN * Math.pow(CUT_MAX / CUT_MIN, v / 1000);
}
function hzToSlider(hz: number): number {
  return (Math.log(hz / CUT_MIN) / Math.log(CUT_MAX / CUT_MIN)) * 1000;
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10_000 ? 1 : 2)} kHz` : `${Math.round(hz)} Hz`;
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export function VizSandbox(): JSX.Element {
  const graphRef = useRef<Graph | null>(null);
  const meterRef = useRef<LevelMeterHandle | null>(null);

  const [running, setRunning] = useState(false);
  const [cutoffSlider, setCutoffSlider] = useState(() => hzToSlider(20_000));
  const [monitorLevel, setMonitorLevel] = useState(0.06);
  const [analysers, setAnalysers] = useState<{ input: AnalyserNode; output: AnalyserNode } | null>(
    null,
  );
  // Mirrored into state rather than read off `graphRef` during render: reading
  // a ref while rendering is neither safe nor permitted by the lint config.
  const [sampleRate, setSampleRate] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const cutoffHz = sliderToHz(cutoffSlider);

  /* ---- filterResponse: the real transfer function ----------------- */

  // Scratch buffers for getFrequencyResponse, grown on demand and reused —
  // SpectrumScope calls this at 10 Hz and must not make us allocate.
  const magRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(0));
  const phaseRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(0));
  const accRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(0));
  const freqRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(0));

  const filterResponse = useCallback((freqs: Float32Array): Float32Array => {
    const n = freqs.length;
    if (accRef.current.length !== n) {
      magRef.current = new Float32Array(n);
      phaseRef.current = new Float32Array(n);
      accRef.current = new Float32Array(n);
      freqRef.current = new Float32Array(n);
    }
    const acc = accRef.current;
    acc.fill(0);

    const g = graphRef.current;
    if (!g) return acc; // Flat 0 dB before the graph exists.

    // `getFrequencyResponse` requires views over a plain ArrayBuffer, which a
    // bare `Float32Array` parameter no longer guarantees, so the caller's
    // frequencies are copied into our own scratch first.
    const freq = freqRef.current;
    freq.set(freqs);

    const mag = magRef.current;
    const phase = phaseRef.current;
    for (const node of g.section) {
      node.getFrequencyResponse(freq, mag, phase);
      for (let i = 0; i < n; i++) {
        // Serial nodes multiply in linear magnitude, i.e. add in dB.
        acc[i] += 20 * Math.log10(Math.max(mag[i], 1e-7));
      }
    }
    return acc;
  }, []);

  /* ---- start / stop ----------------------------------------------- */

  const start = useCallback(async () => {
    if (graphRef.current) return;
    try {
      const g = buildGraph(sliderToHz(cutoffSlider), monitorLevel);
      graphRef.current = g;
      // Autoplay policy: a context created outside a gesture starts suspended.
      if (g.ctx.state === 'suspended') await g.ctx.resume();
      setAnalysers(g.analysers);
      setSampleRate(g.ctx.sampleRate);
      setRunning(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start audio.');
    }
  }, [cutoffSlider, monitorLevel]);

  const stop = useCallback(() => {
    const g = graphRef.current;
    graphRef.current = null;
    setAnalysers(null);
    setSampleRate(0);
    setRunning(false);
    if (g) teardown(g);
  }, []);

  // Unmount cleanup. StrictMode double-mounts this; `start` is only ever
  // called from a click, so the double mount simply tears down a graph that
  // does not exist yet.
  useEffect(() => {
    return () => {
      const g = graphRef.current;
      graphRef.current = null;
      if (g) teardown(g);
    };
  }, []);

  /* ---- parameter pushes ------------------------------------------- */

  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    const hz = sliderToHz(cutoffSlider);
    const t = g.ctx.currentTime;
    // Ramped, never assigned — the same rule the real engine follows.
    for (const lp of g.lowpasses) lp.frequency.setTargetAtTime(hz, t, 0.02);
  }, [cutoffSlider]);

  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    g.monitor.gain.setTargetAtTime(monitorLevel, g.ctx.currentTime, 0.03);
  }, [monitorLevel]);

  /* ---- drive the level meter at 20 Hz ----------------------------- */

  useEffect(() => {
    if (!running) return;
    const buf = new Float32Array(FFT_SIZE);
    const id = window.setInterval(() => {
      const g = graphRef.current;
      const meter = meterRef.current;
      if (!g || !meter) return;
      g.analysers.output.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i]);
        if (a > peak) peak = a;
      }
      meter.setLevel(peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY);
    }, 50);
    return () => window.clearInterval(id);
  }, [running]);

  /* ---- a rough amount, for tinting the small widgets -------------- */

  // SpectrumScope derives its own amount from the real response curve. The
  // waveform and meter get this cheap approximation instead: how far the
  // cutoff has closed, in octaves, relative to a fully closed 250 Hz.
  const uiAmount = Math.max(
    0,
    Math.min(1, Math.log2(20_000 / Math.max(250, cutoffHz)) / Math.log2(20_000 / 250)),
  );

  return (
    <div className="min-h-screen bg-[#07080b] px-6 py-8 text-neutral-300">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex items-baseline justify-between">
          <h1 className="font-mono text-xs tracking-[0.2em] text-neutral-500 uppercase">
            viz sandbox
          </h1>
          <span className="font-mono text-xs text-neutral-600">
            {running && sampleRate > 0 ? `${(sampleRate / 1000).toFixed(1)} kHz` : 'stopped'}
          </span>
        </header>

        <SpectrumScope
          analysers={analysers}
          filterResponse={filterResponse}
          className="h-64 rounded-lg ring-1 ring-white/[0.06]"
        />

        <div className="flex items-center gap-4 rounded-lg px-3 py-2 ring-1 ring-white/[0.06]">
          <button
            type="button"
            onClick={running ? stop : () => void start()}
            className="shrink-0 rounded-sm px-2 py-1 font-mono text-[11px] tracking-wider text-neutral-300 uppercase ring-1 ring-white/15 transition hover:bg-white/5"
          >
            {running ? 'stop' : 'start'}
          </button>
          <Waveform analyser={analysers?.output ?? null} amount={uiAmount} className="h-8 flex-1" />
          <LevelMeter
            ref={meterRef}
            amount={uiAmount}
            orientation="horizontal"
            className="h-2 w-28 shrink-0"
            showTickLabels={false}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-lg px-4 py-4 ring-1 ring-white/[0.06]">
          <label className="flex items-center gap-4">
            <span className="w-20 shrink-0 font-mono text-[11px] tracking-wider text-neutral-500 uppercase">
              cutoff
            </span>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={cutoffSlider}
              onChange={(e) => setCutoffSlider(Number(e.target.value))}
              className="h-1 flex-1 cursor-ew-resize accent-neutral-400"
            />
            <span className="w-20 shrink-0 text-right font-mono text-[11px] text-neutral-400 tabular-nums">
              {formatHz(cutoffHz)}
            </span>
          </label>

          <label className="flex items-center gap-4">
            <span className="w-20 shrink-0 font-mono text-[11px] tracking-wider text-neutral-500 uppercase">
              monitor
            </span>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.005}
              value={monitorLevel}
              onChange={(e) => setMonitorLevel(Number(e.target.value))}
              className="h-1 flex-1 accent-neutral-400"
            />
            <span className="w-20 shrink-0 text-right font-mono text-[11px] text-neutral-400 tabular-nums">
              {monitorLevel === 0
                ? 'muted'
                : `${(20 * Math.log10(monitorLevel)).toFixed(1)} dB`}
            </span>
          </label>

          <div className="flex gap-2 pt-1">
            {([20_000, 6000, 1800, 600, 220] as const).map((hz) => (
              <button
                key={hz}
                type="button"
                onClick={() => setCutoffSlider(hzToSlider(Math.max(CUT_MIN, hz)))}
                className="rounded-sm px-2 py-0.5 font-mono text-[10px] text-neutral-500 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-neutral-300"
              >
                {formatHz(hz)}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p className="font-mono text-[11px] text-red-400/80">{error}</p>
        ) : (
          <p className="font-mono text-[11px] leading-relaxed text-neutral-600">
            Pink noise plus three sweeping sines, through a low shelf, two cascaded lowpass
            stages and a 3 kHz dip. The curve is the real
            <code className="px-1 text-neutral-500">getFrequencyResponse</code> of that chain.
            Drag the cutoff and watch the gap between the two spectra open.
          </p>
        )}
      </div>
    </div>
  );
}

export default VizSandbox;
