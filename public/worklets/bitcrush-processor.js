/**
 * Dampen — bitcrush / sample-and-hold processor.
 *
 * Served from `/public` and loaded by URL via `audioWorklet.addModule()`, so
 * this file is plain ES2017 JavaScript: it is never touched by the bundler and
 * must not import anything.
 *
 * Two independent degradations, both of them "digital cheapness" cues that the
 * ear reads as *a recording of a recording* rather than as the music itself:
 *
 *  - **Quantisation** (`bits`): rounding each sample to a coarse grid adds a
 *    noise floor that is correlated with the signal, which is why 8-bit audio
 *    sounds gritty rather than merely noisy.
 *  - **Sample-and-hold** (`downsample`): holding each sample for N frames is a
 *    zero-order-hold decimation *without* an anti-alias filter, so everything
 *    above the new effective Nyquist folds back down as inharmonic aliases.
 *    That folding is the whole character — filtering it properly would just
 *    sound like a lowpass.
 *
 * `mix` is a dry/wet blend so the effect can be used as a flavour rather than
 * a replacement. **`mix = 0` is an exact bypass**: the dry samples are copied
 * through untouched and the quantiser is not even evaluated.
 */

const PROCESSOR_NAME = 'dampen-bitcrush';

class BitcrushProcessor extends AudioWorkletProcessor {
  /**
   * All three controls are a-rate `AudioParam`s rather than message-passed
   * numbers so that the host can ramp them with `setTargetAtTime` and get
   * per-sample interpolation — message-passed values would step once per
   * 128-frame render quantum, which is audible as a zipper at ~375 Hz.
   */
  static get parameterDescriptors() {
    return [
      {
        name: 'bits',
        defaultValue: 16,
        minValue: 1,
        maxValue: 16,
        automationRate: 'a-rate',
      },
      {
        name: 'downsample',
        defaultValue: 1,
        minValue: 1,
        maxValue: 32,
        // k-rate: this one indexes a counter, so a per-sample value would make
        // the hold period jitter instead of being a clean division.
        automationRate: 'k-rate',
      },
      {
        name: 'mix',
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: 'a-rate',
      },
    ];
  }

  constructor() {
    super();
    /** @type {number[]} last held sample, per channel */
    this._held = [];
    /** @type {number[]} frames since the last update, per channel */
    this._counter = [];
    /** Set false by the host to release the node. */
    this._alive = true;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'reset') {
        this._held.length = 0;
        this._counter.length = 0;
      } else if (data.type === 'release') {
        this._alive = false;
      }
    };
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

    const bitsP = params.bits;
    const mixP = params.mix;
    const dsP = params.downsample;

    // k-rate params arrive as a length-1 array.
    let hold = Math.round(dsP.length > 0 ? dsP[0] : 1);
    if (!(hold >= 1)) hold = 1; // also catches NaN
    if (hold > 32) hold = 32;

    const mixIsConstant = mixP.length === 1;
    const bitsIsConstant = bitsP.length === 1;

    // Exact bypass: constant mix of 0 means "not engaged". Copy and leave.
    if (mixIsConstant && mixP[0] <= 0) {
      for (let ch = 0; ch < output.length; ch++) {
        const src = input && input[ch];
        if (src) output[ch].set(src);
        else output[ch].fill(0);
      }
      return this._alive;
    }

    for (let ch = 0; ch < output.length; ch++) {
      const out = output[ch];
      const src = input && input[ch];

      if (!src) {
        out.fill(0);
        continue;
      }

      if (this._held.length <= ch) {
        this._held[ch] = 0;
        this._counter[ch] = 0;
      }
      let held = this._held[ch];
      let counter = this._counter[ch];

      for (let i = 0; i < out.length; i++) {
        const dry = src[i];

        // Sample-and-hold. The counter is per channel but driven by the same
        // `hold`, so L and R stay phase-locked and the image does not wander.
        if (counter % hold === 0) held = dry;
        counter++;
        if (counter >= 0x40000000) counter = counter % hold; // keep it an int32

        // Quantise. `levels = 2^(bits-1)` is the number of steps either side
        // of zero, so bits = 16 gives a 32768-step grid (i.e. plain 16-bit
        // PCM, transparent) and bits = 1 gives hard ±1 square-wave clipping.
        let b = bitsIsConstant ? bitsP[0] : bitsP[i];
        if (!(b >= 1)) b = 16;
        else if (b > 16) b = 16;
        const levels = Math.pow(2, b - 1);
        let wet = Math.round(held * levels) / levels;

        // Guard: a NaN reaching the graph output silences every downstream
        // node for the lifetime of the context and reports no error.
        if (!Number.isFinite(wet)) wet = 0;

        let m = mixIsConstant ? mixP[0] : mixP[i];
        if (!(m >= 0)) m = 0;
        else if (m > 1) m = 1;

        out[i] = dry + (wet - dry) * m;
      }

      this._held[ch] = held;
      this._counter[ch] = counter;
    }

    return this._alive;
  }
}

registerProcessor(PROCESSOR_NAME, BitcrushProcessor);
