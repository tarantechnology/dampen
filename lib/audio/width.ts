/**
 * Dampen — mid/side stereo width control.
 *
 * Narrowing the stereo image is one of the strongest "this is not for you"
 * cues available. A wide mix surrounds you and demands attention; collapsed
 * towards mono it reads as a single distant source that the ear is happy to
 * file under "background". So `width` is a first-class Dampen parameter, not a
 * utility.
 *
 * The matrix is built out of plain `GainNode`s rather than an `AudioWorklet`
 * so that it is sample-exact, zero-latency and ramps with the same
 * `setTargetAtTime` machinery as everything else in the chain.
 *
 *     L ──┬─ 0.5 ─┐                      ┌── ×1 ──▶ merge[0]
 *         │       ├─▶ mid ───────────────┤
 *     R ──┼─ 0.5 ─┘                      └── ×1 ──▶ merge[1]
 *         │
 *     L ──┼─ 0.5 ─┐
 *         │       ├─▶ side ─▶ ×width ─┬── ×+1 ──▶ merge[0]
 *     R ──┴─ −0.5 ┘                   └── ×−1 ──▶ merge[1]
 *
 * which is M = (L+R)/2, S = (L−R)/2, L' = M + w·S, R' = M − w·S. See
 * {@link MS_GAINS} for the proof that w = 1 is an exact identity and w = 0 is
 * exact mono.
 */

import { MS_GAINS, num } from './dsp';

export interface WidthBlock {
  /** Connect the upstream chain here. */
  readonly input: AudioNode;
  /** Connect this to the downstream chain. */
  readonly output: AudioNode;
  /** The `width` scalar, so the engine can ramp it with its own helper. */
  readonly widthParam: AudioParam;
  /** Tear the block down; safe to call twice. */
  dispose(): void;
}

/**
 * Build the M/S width block.
 *
 * The `input` node deserves a note. `ChannelSplitterNode` has a fixed
 * `channelInterpretation` of `'discrete'`, which means a **mono** upstream
 * signal would appear as `L = mono, R = silence`. Run that through the matrix
 * and you get `L' = mono, R' = 0` — the whole mix hard left. That is a real
 * failure mode here, because `getUserMedia` on a virtual loopback device quite
 * happily hands you a single channel.
 *
 * The fix is the explicit up-mixer in front: a `GainNode` with
 * `channelCount = 2`, `channelCountMode = 'explicit'` and
 * `channelInterpretation = 'speakers'`, which the spec's up-mix rules turn
 * into `L = R = mono`. Then M = mono and S = 0, so the matrix leaves mono
 * material alone at any width. A 3+ channel input is down-mixed by the same
 * rules.
 */
export function createWidthBlock(ctx: BaseAudioContext): WidthBlock {
  // Force exactly two channels, up-mixing mono and down-mixing surround.
  const input = ctx.createGain();
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';

  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);

  const lToMid = ctx.createGain();
  const rToMid = ctx.createGain();
  const lToSide = ctx.createGain();
  const rToSide = ctx.createGain();
  lToMid.gain.value = MS_GAINS.midFromL;
  rToMid.gain.value = MS_GAINS.midFromR;
  lToSide.gain.value = MS_GAINS.sideFromL;
  rToSide.gain.value = MS_GAINS.sideFromR;

  // Summing buses. A GainNode sums all of its inputs, so `mid` and `side` are
  // just unity gains acting as adders.
  const mid = ctx.createGain();
  const side = ctx.createGain();
  mid.gain.value = 1;
  side.gain.value = 1;

  // The one live parameter. Starts at unity = bit-transparent.
  const widthGain = ctx.createGain();
  widthGain.gain.value = 1;

  const sideToL = ctx.createGain();
  const sideToR = ctx.createGain();
  sideToL.gain.value = MS_GAINS.sideToL;
  sideToR.gain.value = MS_GAINS.sideToR;

  input.connect(splitter);
  splitter.connect(lToMid, 0);
  splitter.connect(rToMid, 1);
  splitter.connect(lToSide, 0);
  splitter.connect(rToSide, 1);

  lToMid.connect(mid);
  rToMid.connect(mid);
  lToSide.connect(side);
  rToSide.connect(side);

  side.connect(widthGain);
  widthGain.connect(sideToL);
  widthGain.connect(sideToR);

  // Mid goes to both outputs unscaled; side goes in with opposite polarity.
  mid.connect(merger, 0, 0);
  mid.connect(merger, 0, 1);
  sideToL.connect(merger, 0, 0);
  sideToR.connect(merger, 0, 1);

  const all: AudioNode[] = [
    input,
    splitter,
    lToMid,
    rToMid,
    lToSide,
    rToSide,
    mid,
    side,
    widthGain,
    sideToL,
    sideToR,
    merger,
  ];

  let disposed = false;

  return {
    input,
    output: merger,
    widthParam: widthGain.gain,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const n of all) {
        try {
          n.disconnect();
        } catch {
          // A node can already be detached; nothing to do.
        }
      }
    },
  };
}

/** Clamp a width request. 0 = mono, 1 = untouched, 2 = double-wide. */
export function clampWidth(w: unknown): number {
  return num(w, 1, 0, 2);
}
