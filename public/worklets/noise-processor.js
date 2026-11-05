/**
 * Dampen — ambience bed generator.
 *
 * Plain ES2017, loaded by URL. No imports.
 *
 * This is a *source* node (zero inputs) that synthesises a continuous
 * stereo ambience bed. Its purpose is psychoacoustic masking: a broadband bed
 * sitting a little above the room's own noise floor raises the detection
 * threshold for the music's remaining detail, so the brain stops trying to
 * parse lyrics and transients. That is why a muffled track plus a quiet rain
 * bed recedes so much further than muffling alone.
 *
 * ## Generators
 *
 * **white** — uniform `Math.random()`. Flat power spectrum; hissy and fatiguing
 * on its own, useful as an ingredient.
 *
 * **pink** — **Paul Kellet's refined (7-pole) filter**, not the "economy"
 * 3-pole variant and not Voss-McCartney. The refined version holds −3 dB/oct
 * to within about ±0.05 dB from ~10 Hz to ~20 kHz, where the economy filter
 * drifts by nearly a dB at the extremes and Voss-McCartney has a visible
 * staircase in the spectrum from its octave-rate update scheme. Since the bed
 * runs for hours at a time and is deliberately near the threshold of
 * awareness, spectral artefacts are exactly the thing that would make it
 * noticeable.
 *
 * **brown** — leaky integrator, `b = 0.995·b + 0.045·white`. A true integrator
 * (`b += white`) is a −6 dB/oct random walk with infinite DC gain: it
 * accumulates offset until the output is a slow drift out of range, which
 * reads as a thump and eats headroom. The 0.995 leak puts a first-order
 * highpass at `fs·(1−a)/2π` ≈ 38 Hz at 48 kHz, which is below the audible
 * rumble band but finite, so the walk is bounded and DC-free. The 0.045 scales
 * the result back to roughly unit variance.
 *
 * The composite kinds (`rain`, `vinyl`, `tape`, `cafe`, `river`, `fan`) are
 * built from those three plus one-pole filters, slow random envelopes and —
 * for vinyl — sparse Poisson crackle impulses. Each is level-trimmed so that
 * all kinds land near −20 dBFS RMS, which makes the host's `level` parameter
 * mean the same thing whichever bed is selected.
 */

const PROCESSOR_NAME = 'dampen-noise';

/** Target RMS for every kind, so `level` in dB is kind-independent. */
const TARGET_RMS = 0.1; // -20 dBFS

const KINDS = [
  'none',
  'white',
  'pink',
  'brown',
  'rain',
  'vinyl',
  'tape',
  'cafe',
  'river',
  'fan',
];

/** One-pole coefficient for a corner frequency, exact (not small-angle). */
function poleCoeff(fc, fs) {
  const f = Math.min(Math.max(fc, 1), fs * 0.49);
  return 1 - Math.exp((-2 * Math.PI * f) / fs);
}

/**
 * Per-channel generator state. Everything is a closure-free plain object so
 * the hot loop stays monomorphic.
 */
class ChannelState {
  constructor(fs) {
    this.fs = fs;

    // Paul Kellet refined pink-noise filter state.
    this.b0 = 0;
    this.b1 = 0;
    this.b2 = 0;
    this.b3 = 0;
    this.b4 = 0;
    this.b5 = 0;
    this.b6 = 0;

    // Brown noise leaky integrator.
    this.brown = 0;

    // General-purpose one-pole states.
    this.lp1 = 0;
    this.lp2 = 0;
    this.lp3 = 0;
    this.hp1 = 0;
    this.hp2 = 0;

    // Two-pole bandpass state (used by rain / river / cafe / fan).
    this.bp1 = 0;
    this.bp2 = 0;

    // Slow random envelope: a one-pole smoothing a new random target that is
    // refreshed every `envPeriod` samples. Gives organic swells with no
    // periodicity for the ear to lock onto.
    this.envTarget = 0.5;
    this.env = 0.5;
    this.envCounter = 0;
    this.envPeriod = Math.max(1, Math.round(fs * 0.35));

    // Vinyl crackle: remaining samples of the current click and its decay.
    this.clickAmp = 0;
    this.clickPos = 0;
    this.clickLen = 0;

    // Vinyl rotation thump, 33⅓ rpm = 0.5556 Hz.
    this.rotPhase = Math.random();

    // Fan blade modulation phase.
    this.fanPhase = Math.random();
  }

  /** Uniform white noise in [-1, 1). */
  white() {
    return Math.random() * 2 - 1;
  }

  /**
   * Paul Kellet's refined pink filter. The coefficients are a 7-pole fit to a
   * −3 dB/oct slope; the final `0.11` trim brings the output back to roughly
   * unit variance (the filter itself has a large passband gain).
   */
  pink() {
    const w = this.white();
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const out = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return out * 0.11;
  }

  /** Leaky-integrator brown noise, ≈ −6 dB/oct above ~38 Hz. */
  brownNoise() {
    this.brown = 0.995 * this.brown + 0.045 * this.white();
    return this.brown * 3.5; // back to ~unit variance
  }

  /** Advance the slow random envelope and return it in 0..1. */
  slowEnv(smoothing) {
    if (this.envCounter <= 0) {
      this.envTarget = Math.random();
      this.envCounter = this.envPeriod;
    }
    this.envCounter--;
    this.env += smoothing * (this.envTarget - this.env);
    return this.env;
  }
}

class NoiseProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Pre-level trim, a-rate so the host can fade the bed in and out
      // smoothly without a separate GainNode in the worklet's own path.
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'a-rate' },
    ];
  }

  /**
   * @param {{processorOptions?: {kind?: string}}} [options]
   */
  constructor(options) {
    super();

    /*
     * The kind can arrive two ways, and it needs both.
     *
     * `port.postMessage` is the live control path, but it is asynchronous
     * across the main/render thread boundary: a message posted immediately
     * before rendering starts is **not** guaranteed to be seen by the first
     * `process()` call. In a realtime context that is harmless (the message
     * lands within a render quantum, ~2.7 ms, while the host's fade-in is
     * still climbing out of silence) — but in an `OfflineAudioContext`, which
     * can render seconds of audio before the message is delivered, it means
     * the generator would emit nothing at all.
     *
     * So the initial kind is also accepted through `processorOptions`, which
     * is passed synchronously through the constructor and is therefore in
     * effect from sample 0. Measured: without this, an offline render started
     * in the same task as the postMessage produces silence for a random
     * subset of kinds.
     */
    const opts = (options && options.processorOptions) || {};
    this._kind = typeof opts.kind === 'string' && KINDS.indexOf(opts.kind) !== -1 ? opts.kind : 'none';
    this._alive = true;
    /** @type {ChannelState[]} */
    this._states = [];

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (typeof data.kind === 'string' && KINDS.indexOf(data.kind) !== -1) {
        this._kind = data.kind;
      }
      if (data.type === 'release') this._alive = false;
    };
  }

  _state(ch) {
    let s = this._states[ch];
    if (!s) {
      s = new ChannelState(sampleRate);
      this._states[ch] = s;
    }
    return s;
  }

  process(inputs, outputs, params) {
    const output = outputs[0];
    if (!output || output.length === 0) return this._alive;

    const kind = this._kind;

    // `none` costs one fill per channel. The host additionally disconnects the
    // branch, at which point this node stops being pulled at all.
    if (kind === 'none') {
      for (let ch = 0; ch < output.length; ch++) output[ch].fill(0);
      return this._alive;
    }

    const gainP = params.gain;
    const gainConst = gainP.length === 1;
    const frames = output[0].length;

    for (let ch = 0; ch < output.length; ch++) {
      const out = output[ch];
      const s = this._state(ch);

      for (let i = 0; i < frames; i++) {
        let v = 0;
        switch (kind) {
          case 'white':
            v = s.white() * TARGET_RMS * 1.73; // uniform noise RMS = 1/sqrt(3)
            break;
          case 'pink':
            v = s.pink() * TARGET_RMS * 1.0;
            break;
          case 'brown':
            v = s.brownNoise() * TARGET_RMS * 1.0;
            break;
          case 'rain':
            v = NoiseProcessor._rain(s);
            break;
          case 'vinyl':
            v = NoiseProcessor._vinyl(s);
            break;
          case 'tape':
            v = NoiseProcessor._tape(s);
            break;
          case 'cafe':
            v = NoiseProcessor._cafe(s);
            break;
          case 'river':
            v = NoiseProcessor._river(s);
            break;
          case 'fan':
            v = NoiseProcessor._fan(s);
            break;
          default:
            v = 0;
        }

        let g = gainConst ? gainP[0] : gainP[i];
        if (!(g >= 0)) g = 0;
        else if (g > 4) g = 4;

        const y = v * g;
        out[i] = Number.isFinite(y) ? y : 0;
      }
    }

    return this._alive;
  }

  /* ---------------------------------------------------------------- *
   * Composite beds
   * ---------------------------------------------------------------- */

  /**
   * Rain on glass: a broadband hiss shelved down below ~400 Hz (rain has
   * almost no low end — the rumble you imagine is the building, not the rain),
   * plus a wideband sheet whose level breathes with a slow random envelope so
   * squalls come and go.
   */
  static _rain(s) {
    const fs = s.fs;
    // Highpass the white noise: y = x - lp(x).
    const aHp = poleCoeff(400, fs);
    const w = s.white();
    s.hp1 += aHp * (w - s.hp1);
    const high = w - s.hp1;

    // Gentle lowpass at 7 kHz so it is a sheet of water, not a cymbal.
    const aLp = poleCoeff(7000, fs);
    s.lp1 += aLp * (high - s.lp1);

    // A thin band around 1.4 kHz adds the "hitting a hard surface" edge.
    const aBp = poleCoeff(1400, fs);
    s.bp1 += aBp * (high - s.bp1);
    s.bp2 += aBp * (s.bp1 - s.bp2);
    const band = s.bp1 - s.bp2;

    const env = 0.72 + 0.45 * s.slowEnv(poleCoeff(0.6, fs));
    return (s.lp1 * 1.1 + band * 1.6) * env * TARGET_RMS * 2.6;
  }

  /**
   * Vinyl: a dull surface-noise floor (lowpassed pink), sparse crackle
   * impulses, and a once-per-revolution thump.
   *
   * The crackle is the part that sells it. Real surface defects are a Poisson
   * process, so each sample gets an independent small probability of starting
   * a new click rather than following any clock. Each click is a short
   * exponentially-decaying burst, lowpassed by the same surface filter, which
   * is why vinyl crackle sounds like a *tick* and not a *beep*.
   */
  static _vinyl(s) {
    const fs = s.fs;

    // Surface floor: pink, rolled off hard above 5 kHz.
    const aLp = poleCoeff(5000, fs);
    s.lp1 += aLp * (s.pink() - s.lp1);
    let v = s.lp1 * 0.55;

    // Crackle. ~9 clicks/second expected.
    if (s.clickPos >= s.clickLen) {
      if (Math.random() < 9 / fs) {
        s.clickAmp = (Math.random() * 2 - 1) * (0.25 + Math.random() * 0.75);
        s.clickLen = Math.max(4, Math.round(fs * (0.0004 + Math.random() * 0.0025)));
        s.clickPos = 0;
      }
    }
    if (s.clickPos < s.clickLen) {
      const k = s.clickPos / s.clickLen;
      v += s.clickAmp * Math.exp(-k * 5) * (1 - k);
      s.clickPos++;
    }

    // 33⅓ rpm = 0.5556 Hz warp thump, deliberately tiny.
    s.rotPhase += 0.5556 / fs;
    if (s.rotPhase >= 1) s.rotPhase -= 1;
    const thump = Math.sin(2 * Math.PI * s.rotPhase);
    v += thump * thump * thump * 0.035;

    return v * TARGET_RMS * 2.0;
  }

  /**
   * Tape hiss: pink noise band-limited to roughly a cassette's bandwidth
   * (80 Hz – 11 kHz), with a slow amplitude breath from the transport.
   */
  static _tape(s) {
    const fs = s.fs;
    const p = s.pink();
    const aHp = poleCoeff(80, fs);
    s.hp1 += aHp * (p - s.hp1);
    const band = p - s.hp1;
    const aLp = poleCoeff(11000, fs);
    s.lp1 += aLp * (band - s.lp1);

    const env = 0.88 + 0.24 * s.slowEnv(poleCoeff(0.35, fs));
    return s.lp1 * env * TARGET_RMS * 2.4;
  }

  /**
   * Café murmur: brown noise for the room, plus "babble" — noise restricted to
   * the 250–2200 Hz speech formant band and amplitude-modulated by a slow
   * random envelope raised to a power, which clusters the energy into
   * utterance-length bursts instead of a continuous wash.
   */
  static _cafe(s) {
    const fs = s.fs;
    const room = s.brownNoise() * 0.45;

    const w = s.white();
    const aHp = poleCoeff(250, fs);
    s.hp1 += aHp * (w - s.hp1);
    const above = w - s.hp1;
    const aLp = poleCoeff(2200, fs);
    s.lp1 += aLp * (above - s.lp1);

    const e = s.slowEnv(poleCoeff(2.2, fs));
    const babble = s.lp1 * (e * e * 1.8);

    return (room + babble * 0.9) * TARGET_RMS * 1.9;
  }

  /**
   * River: brighter and more continuous than rain — white noise highpassed at
   * 250 Hz, with two detuned slow envelopes so the "rushing" swells never
   * repeat, and a low bed for the body of water.
   */
  static _river(s) {
    const fs = s.fs;
    const w = s.white();
    const aHp = poleCoeff(250, fs);
    s.hp1 += aHp * (w - s.hp1);
    const rush = w - s.hp1;

    const aLp = poleCoeff(9000, fs);
    s.lp1 += aLp * (rush - s.lp1);

    const aLow = poleCoeff(180, fs);
    s.lp2 += aLow * (s.brownNoise() - s.lp2);

    const env = 0.78 + 0.4 * s.slowEnv(poleCoeff(0.9, fs));
    return (s.lp1 * 0.95 + s.lp2 * 0.5) * env * TARGET_RMS * 2.5;
  }

  /**
   * Fan / air conditioning: a narrow low rumble (two cascaded one-poles at
   * 300 Hz on brown noise) plus a very shallow 11.7 Hz blade modulation. The
   * modulation is kept under ±4 % because anything deeper stops being
   * "mechanical hum" and starts being a tremolo you notice.
   */
  static _fan(s) {
    const fs = s.fs;
    const b = s.brownNoise();
    const aLp = poleCoeff(300, fs);
    s.lp1 += aLp * (b - s.lp1);
    s.lp2 += aLp * (s.lp1 - s.lp2);

    const aHp = poleCoeff(35, fs);
    s.hp1 += aHp * (s.lp2 - s.hp1);
    const body = s.lp2 - s.hp1;

    // A touch of broadband air so it is not purely sub-bass.
    const aAir = poleCoeff(1800, fs);
    s.lp3 += aAir * (s.white() - s.lp3);

    s.fanPhase += 11.7 / fs;
    if (s.fanPhase >= 1) s.fanPhase -= 1;
    const blade = 1 + 0.04 * Math.sin(2 * Math.PI * s.fanPhase);

    return (body * 1.5 + s.lp3 * 0.22) * blade * TARGET_RMS * 2.2;
  }
}

registerProcessor(PROCESSOR_NAME, NoiseProcessor);
