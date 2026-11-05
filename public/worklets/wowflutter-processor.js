/**
 * Dampen — tape wow & flutter processor.
 *
 * Plain ES2017, loaded by URL. No imports.
 *
 * ## What it does
 *
 * Wow and flutter are speed errors in a tape transport, and a speed error is a
 * *pitch* error. The standard way to produce one digitally is a modulated
 * fractional delay line: if the read pointer moves through the buffer slightly
 * slower than the write pointer, the output is pitched down, and vice versa.
 * The instantaneous pitch ratio is `1 - d'(t)` where `d` is the delay in
 * samples — so a sinusoidally-modulated delay gives sinusoidally-modulated
 * pitch, which is exactly what a slipping capstan does.
 *
 *  - **wow**   — 0.05–4 Hz, several milliseconds of deviation. Heard as the
 *    pitch sagging and recovering. This is the "old cassette" cue.
 *  - **flutter** — 2–20 Hz, a fraction of a millisecond. Heard as a shimmer
 *    or a slight roughness on sustained notes, not as pitch movement.
 *
 * ## Why the delay is not centred on a fixed base
 *
 * The obvious design — a 20 ms base delay modulated ±depth — is not a bypass
 * at zero depth: it is a 20 ms delay, which breaks lip-sync against video and
 * comb-filters against the dry bypass path. Instead the base delay is
 * *derived* from the depth:
 *
 *     base = wowAmp + flutterAmp          (samples)
 *     delay(t) = base + wowAmp·sin(φw) + flutterAmp·sin(φf)
 *
 * so the delay is always ≥ 0 and, crucially, **collapses to exactly 0 when
 * both depths are 0** — the read pointer lands on the sample just written and
 * the processor is sample-exact transparent. Engaging the effect glides the
 * base up, which is itself a brief pitch dip; that is what a tape does when it
 * starts moving, so it is a feature.
 *
 * The base is smoothed by a one-pole so a jump in the depth parameter becomes
 * a glide rather than a click.
 *
 * ## Interpolation
 *
 * 4-point cubic Hermite (Catmull-Rom) whenever there are neighbours on both
 * sides, falling back to linear for delays under one sample (where the "next"
 * sample has not been written yet). Hermite matters: plain linear
 * interpolation on a slowly-moving fractional delay is a comb filter whose
 * notch depth modulates with the fraction, which you hear as a periodic HF
 * swish riding on the wow.
 */

const PROCESSOR_NAME = 'dampen-wowflutter';

/** Peak delay deviation at depth = 1, in ms. ~1.4 semitones of sag at 0.8 Hz. */
const WOW_MAX_MS = 9;
/** Peak delay deviation at depth = 1, in ms. Small by definition. */
const FLUTTER_MAX_MS = 0.9;
/** Delay-line capacity. Comfortably above WOW_MAX_MS + FLUTTER_MAX_MS + slack. */
const BUFFER_MS = 120;
/** One-pole time constant for the base-delay glide, seconds. */
const BASE_GLIDE_SECONDS = 0.08;

class WowFlutterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'wowRate', defaultValue: 0.8, minValue: 0.01, maxValue: 8, automationRate: 'k-rate' },
      { name: 'wowDepth', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      {
        name: 'flutterRate',
        defaultValue: 8,
        minValue: 0.5,
        maxValue: 40,
        automationRate: 'k-rate',
      },
      {
        name: 'flutterDepth',
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    this._size = Math.max(256, Math.ceil((BUFFER_MS / 1000) * sampleRate));
    /** @type {Float32Array[]} circular delay lines, allocated per channel on demand */
    this._lines = [];
    /** Shared write index. Both channels write in lockstep so they cannot drift apart. */
    this._write = 0;

    /*
     * LFO phases are kept as a normalised 0..1 accumulator and wrapped every
     * sample. Two reasons not to use `currentTime * rate`: a float32 clock
     * loses phase resolution after a few hours of playback, and wrapping into
     * 0..1 means the accumulator is bounded forever — "must not drift
     * unbounded" is a hard requirement for something meant to run all day.
     */
    this._wowPhase = Math.random();
    this._flutterPhase = Math.random();

    /** Smoothed base delay in samples. */
    this._base = 0;
    this._alive = true;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'reset') {
        for (const line of this._lines) line.fill(0);
        this._write = 0;
        this._base = 0;
      } else if (data.type === 'release') {
        this._alive = false;
      }
    };
  }

  /** Clamp to a finite number in [min, max]; NaN-safe. */
  static _safe(v, fallback, min, max) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return v < min ? min : v > max ? max : v;
  }

  /**
   * @param {Float32Array[][]} inputs
   * @param {Float32Array[][]} outputs
   * @param {Record<string, Float32Array>} params
   */
  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return this._alive;

    const S = WowFlutterProcessor._safe;
    const wowRate = S(params.wowRate[0], 0.8, 0.01, 8);
    const wowDepth = S(params.wowDepth[0], 0, 0, 1);
    const flutterRate = S(params.flutterRate[0], 8, 0.5, 40);
    const flutterDepth = S(params.flutterDepth[0], 0, 0, 1);

    const frames = output[0].length;

    // True bypass. Both depths at zero *and* the base already settled means
    // the delay would be exactly zero anyway, so skip the whole machinery —
    // and keep the lines zeroed so re-engaging does not replay stale audio.
    if (wowDepth === 0 && flutterDepth === 0 && this._base < 1e-4) {
      this._base = 0;
      for (let ch = 0; ch < output.length; ch++) {
        const src = input && input[ch];
        if (src) output[ch].set(src);
        else output[ch].fill(0);
      }
      // Phases keep advancing so that re-engaging does not start from a fixed
      // point in the cycle (which would make every engage sound identical).
      this._wowPhase = (this._wowPhase + (wowRate * frames) / sampleRate) % 1;
      this._flutterPhase = (this._flutterPhase + (flutterRate * frames) / sampleRate) % 1;
      return this._alive;
    }

    const wowAmp = (wowDepth * WOW_MAX_MS * sampleRate) / 1000;
    const flutterAmp = (flutterDepth * FLUTTER_MAX_MS * sampleRate) / 1000;

    /*
     * Target base delay. The `+2` keeps the trough of the modulation at a
     * delay of 2 samples rather than 0, so once engaged the read position is
     * always in the Hermite branch and never flips between interpolators
     * mid-cycle. 2 samples is ~0.04 ms — far below audibility.
     */
    const targetBase = wowAmp + flutterAmp > 0 ? wowAmp + flutterAmp + 2 : 0;

    // One-pole glide coefficient: fraction of the remaining gap closed per
    // sample for a given time constant.
    const glide = 1 - Math.exp(-1 / (BASE_GLIDE_SECONDS * sampleRate));

    const wowInc = wowRate / sampleRate;
    const flutterInc = flutterRate / sampleRate;
    const size = this._size;
    const TWO_PI = Math.PI * 2;

    for (let ch = 0; ch < output.length; ch++) {
      if (!this._lines[ch]) this._lines[ch] = new Float32Array(size);
    }

    // Phases are shared across channels (a transport wobble is mono by
    // nature); only the write index and buffers are per channel.
    let wowPhase = this._wowPhase;
    let flutterPhase = this._flutterPhase;
    let base = this._base;
    let write = this._write;

    for (let i = 0; i < frames; i++) {
      base += glide * (targetBase - base);

      const wobble =
        wowAmp * Math.sin(TWO_PI * wowPhase) + flutterAmp * Math.sin(TWO_PI * flutterPhase);
      let delay = base + wobble;
      if (!(delay >= 0)) delay = 0; // NaN-safe
      if (delay > size - 4) delay = size - 4;

      for (let ch = 0; ch < output.length; ch++) {
        const line = this._lines[ch];
        const src = input && input[ch];
        const dry = src ? src[i] : 0;
        line[write] = Number.isFinite(dry) ? dry : 0;

        const intDelay = Math.floor(delay);
        const frac = delay - intDelay;
        const base0 = write - intDelay;

        let wet;
        if (delay < 1) {
          // Linear between the sample just written and the one before it.
          // At delay === 0 and frac === 0 this returns line[write] exactly,
          // i.e. the input sample: the bypass is bit-exact.
          const x0 = line[((base0 % size) + size) % size];
          const x1 = line[((base0 - 1) % size + size) % size];
          wet = x0 + (x1 - x0) * frac;
        } else {
          // Catmull-Rom over x[-1] (newer), x[0], x[1], x[2] (older).
          const im1 = ((base0 + 1) % size + size) % size;
          const i0 = ((base0 % size) + size) % size;
          const i1 = ((base0 - 1) % size + size) % size;
          const i2 = ((base0 - 2) % size + size) % size;
          const xm1 = line[im1];
          const x0 = line[i0];
          const x1 = line[i1];
          const x2 = line[i2];

          const c0 = x0;
          const c1 = 0.5 * (x1 - xm1);
          const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
          const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
          wet = ((c3 * frac + c2) * frac + c1) * frac + c0;
        }

        output[ch][i] = Number.isFinite(wet) ? wet : 0;
      }

      write++;
      if (write >= size) write = 0;

      wowPhase += wowInc;
      if (wowPhase >= 1) wowPhase -= 1;
      flutterPhase += flutterInc;
      if (flutterPhase >= 1) flutterPhase -= 1;
    }

    this._wowPhase = wowPhase;
    this._flutterPhase = flutterPhase;
    this._base = base;
    this._write = write;

    return this._alive;
  }
}

registerProcessor(PROCESSOR_NAME, WowFlutterProcessor);
