/**
 * Dampen — the DSP engine.
 *
 * A plain TypeScript class. No React, no stores, no imports from `components/`
 * or `app/`. One hook (`useDampen.ts`) is the only thing that talks to it.
 *
 * ## The chain
 *
 * ```
 * source ─▶ inputGain ─▶ [analyser:in] ─┬────────────── dryBypass ──┐
 *                                       │                           │
 *                             highpass  ▼                           │
 *                             lowShelf                              │
 *                             lowpass × 4 (N active)                │
 *                             presenceDip                           │
 *                             tilt                                  │
 *                             saturation (WaveShaper, 4×)           │
 *                             wow/flutter (worklet, optional)       │
 *                             bitcrush    (worklet, optional)       │
 *                                 │                                 │
 *                       ┌─────────┴─────────┐                       │
 *                    revDry            convolver (synth IR)         │
 *                       │                   │                       │
 *                       └────────┬──────────┘                       │
 *                        M/S width control                           │
 *                          compressor + makeup                       │
 *                          drift LFO (gain breathe)                  │
 *                                 │                                  │
 *               ambience bed ─────┴──▶ dampenMix ─▶ wetBypass ───────┤
 *                                                                    ▼
 *                                                outputGain ─▶ [analyser:out] ─▶ dest
 * ```
 *
 * ## Invariants
 *
 * 1. **The graph is built exactly once and never rewired.** Optional stages
 *    are neutralised in place (see `biquad.ts`), because `connect`/`disconnect`
 *    on a live graph clicks.
 * 2. **No parameter is ever assigned.** Everything goes through `ramp.ts`.
 * 3. **No value reaches an `AudioParam` unclamped.** `params.ts` sanitises,
 *    `ramp.ts` clamps again against the param's own range. A single NaN
 *    silences the whole context with no error.
 * 4. **Missing capabilities degrade, never throw.** No `AudioWorklet` means no
 *    wow/flutter, no bitcrush and no ambience bed — and a working player.
 */

import type {
  AmbienceParams,
  DampenParams,
  DampenSource,
  EngineMeters,
  EngineStatus,
  InputMode,
} from '@/lib/types';
import { createAmbienceBed, type AmbienceBed } from './ambience';
import { cascadeStageQsDb, LOWPASS_STAGE_COUNT, LowpassStage } from './biquad';
import {
  assessFeedbackRisk,
  CaptureError,
  captureErrorMessage,
  preferredContextSampleRate,
  readCaptureSettings,
  type CaptureDevice,
  type CaptureStreamSettings,
  type FeedbackAssessment,
} from './capture';
import {
  blockLevels,
  BUTTERWORTH_Q_DB,
  dbToLin,
  driftWindow,
  linearQToDb,
  makeOutputGuardCurve,
  makeSaturationCurve,
  METER_FLOOR_DB,
  num,
} from './dsp';
import { buildRoomIR, irCacheKey, normalizeIROptions, type RoomIROptions } from './ir';
import {
  LOWPASS_OPEN_HZ,
  HIGHPASS_OPEN_HZ,
  mergeParams,
  sanitizeParams,
  type DampenParamsPatch,
} from './params';
import { DEFAULT_PARAMS } from './presets';
import { rampLinear, rampSmooth, setInitial } from './ramp';
import { createWidthBlock, type WidthBlock } from './width';
import { canUse, forgetWorklets, workletsReady, type WorkletStatus } from './worklets';

/* ------------------------------------------------------------------ *
 * Tunables
 * ------------------------------------------------------------------ */

/** Default ramp for a parameter change. 60 ms is below the threshold at which
 *  a gain change reads as a separate event, and well above a render quantum. */
export const DEFAULT_RAMP_MS = 60;

/** Bypass crossfade length. */
export const BYPASS_FADE_MS = 80;

/** How long to sit on reverb parameter changes before re-rendering the IR. */
const IR_DEBOUNCE_MS = 140;

/** Duck the convolver this far either side of a buffer swap. */
const IR_SWAP_DUCK_MS = 25;

/** How many rendered IRs to keep. A 3 s stereo IR at 48 kHz is ~1.1 MB. */
const IR_CACHE_LIMIT = 6;

/** Saturation drive quantisation — avoids rebuilding the curve on every pixel. */
const SATURATION_CURVE_STEP = 0.002;

/** Below this drive the waveshaper is the identity and oversampling is pointless. */
const SATURATION_ENGAGE = 0.0005;

const FFT_SIZE = 2048;
const SMOOTHING = 0.8;

/**
 * Output RMS above which, *and only when a feedback risk has been flagged*,
 * the runaway guard starts counting. A dampened background track sits at
 * −25 to −15 dBFS RMS; −6 dBFS sustained is not music, it is a loop.
 */
const RUNAWAY_RMS_DB = -6;

/** Consecutive 20 Hz meter polls above {@link RUNAWAY_RMS_DB} before ducking. */
const RUNAWAY_POLLS = 30;

/** How fast the runaway guard pulls the output down once it decides. */
const RUNAWAY_DUCK_MS = 120;

/** No risk, as a frozen value, so identity comparisons are cheap. */
const NO_FEEDBACK_RISK: FeedbackAssessment = Object.freeze({
  risk: false,
  reason: 'none' as const,
  message: '',
});

/** Ambience is silenced to this by policy (see `ambienceAllowed`). */
const AMBIENCE_OFF: AmbienceParams = Object.freeze({
  kind: 'none' as const,
  level: -Infinity,
  tone: 0.5,
});

/* ------------------------------------------------------------------ *
 * Internal graph shape
 * ------------------------------------------------------------------ */

interface Graph {
  readonly inputGain: GainNode;
  readonly analyserIn: AnalyserNode;

  readonly highpass: BiquadFilterNode;
  readonly lowShelf: BiquadFilterNode;
  readonly lowpass: readonly LowpassStage[];
  readonly presenceDip: BiquadFilterNode;
  readonly tilt: BiquadFilterNode;

  readonly saturator: WaveShaperNode;
  readonly wow: AudioWorkletNode | null;
  readonly crush: AudioWorkletNode | null;

  readonly revTap: GainNode;
  readonly revDry: GainNode;
  readonly convolver: ConvolverNode;
  readonly revWet: GainNode;
  readonly revSum: GainNode;

  readonly width: WidthBlock;

  readonly compressor: DynamicsCompressorNode;
  readonly makeup: GainNode;

  readonly driftGain: GainNode;
  readonly driftOsc: OscillatorNode;
  readonly driftDepth: GainNode;

  readonly ambience: AmbienceBed;
  readonly dampenMix: GainNode;

  readonly wetBypass: GainNode;
  readonly dryBypass: GainNode;
  readonly outputGain: GainNode;
  /** Zero-latency output safety clipper; see `makeOutputGuardCurve`. */
  readonly guard: WaveShaperNode;
  readonly analyserOut: AnalyserNode;

  /** Everything disconnectable, for `dispose`. */
  readonly all: readonly AudioNode[];
}

type StatusListener = (status: EngineStatus) => void;

/**
 * `lib.dom` has no `AudioContextLatencyHint` alias; the spec's type is the
 * category union or an explicit number of seconds.
 */
export type LatencyHint = AudioContextLatencyCategory | number;

export interface DampenEngineOptions {
  /**
   * Overrides the per-input-mode default (see {@link latencyHintFor}). Set it
   * only if you know better than the engine does.
   */
  readonly latencyHint?: LatencyHint;
  /** Initial input mode. Drives latency, and whether ambience is permitted. */
  readonly inputMode?: InputMode;
}

/** End-to-end latency, as far as the platform will tell us. */
export interface LatencyReport {
  /**
   * `AudioContext.baseLatency` — the graph's own buffering, i.e. how far ahead
   * of the output device the render thread works. Seconds.
   */
  base: number;
  /**
   * `AudioContext.outputLatency` — the device/driver path from the browser to
   * the speaker. Seconds. Not implemented everywhere; 0 when unavailable.
   */
  output: number;
  /**
   * Capture-side latency reported by the input track, when the browser offers
   * it (`MediaTrackSettings.latency`). Seconds, 0 when unknown.
   */
  capture: number;
  /** The sum, in milliseconds — the figure to show the user. */
  totalMs: number;
  /** True if `output` or `capture` was unavailable, so `totalMs` understates. */
  partial: boolean;
}

/**
 * Latency policy per input mode.
 *
 * `'interactive'` asks the browser for the smallest buffer it will give us.
 * The capture path needs it: the user is hearing the dampened output *instead
 * of* the original, so every millisecond of added latency is a millisecond of
 * lip-sync error against video and of lag behind a transport button.
 *
 * `'playback'` asks for the largest buffer, which is the right trade for local
 * files and the Spotify SDK path: nobody notices 200 ms on a background music
 * player, and everybody notices a dropout from a convolver plus three
 * worklets fighting for a 128-frame deadline.
 */
export function latencyHintFor(mode: InputMode): LatencyHint {
  return mode === 'capture' ? 'interactive' : 'playback';
}

/**
 * Whether an ambience bed may be mixed in, given the input mode.
 *
 * This is a **policy** constraint, not a technical one. Spotify's Developer
 * Policy §III (quoted in `docs/EFFECTS_RESEARCH.md` §6.7) says:
 *
 * > "Do not permit any device or system to segue, mix, re-mix, or overlap any
 * > Spotify Content with any other audio content."
 *
 * A rain bed under a Spotify track is other audio content overlapped with
 * Spotify Content — the same clause under which Spotify pulled every
 * third-party DJ integration in 2020. So the bed is hard-muted whenever the
 * audio could be Spotify Content, which is both the `capture` path (Path B,
 * the OS tap) and the `spotify` path (Path A, the Web Playback SDK, where the
 * clause binds hardest because we are an API client).
 *
 * Note this is slightly broader than the instruction, which named `capture`
 * only: `spotify` is included because the policy argument there is strictly
 * stronger, and silently allowing the one case that uses a Spotify API key
 * would be the wrong way round. It is a one-line change if that is not wanted.
 *
 * `local` — the user's own files — is unaffected, and the bed is fully
 * available there.
 */
export function ambienceAllowedFor(mode: InputMode): boolean {
  return mode === 'local';
}

/* ------------------------------------------------------------------ *
 * The engine
 * ------------------------------------------------------------------ */

export class DampenEngine {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private graphPromise: Promise<void> | null = null;
  private worklets: WorkletStatus | null = null;

  private state: DampenParams = sanitizeParams(DEFAULT_PARAMS, DEFAULT_PARAMS);
  private statusValue: EngineStatus = 'idle';
  private bypassValue = false;
  private disposed = false;
  private lastError: Error | null = null;

  private readonly listeners = new Set<StatusListener>();
  /** Explicit override from the constructor, or null to follow the input mode. */
  private readonly latencyHintOverride: LatencyHint | null;

  /* ---- input mode / policy ---- */

  private inputModeValue: InputMode;
  /** Sample rate the context is wanted at, or null for "browser's choice". */
  private desiredSampleRate: number | null = null;
  /** Latency hint the live context was actually built with. */
  private builtLatencyHint: LatencyHint | null = null;

  /* ---- capture risk ---- */

  private captureDeviceInfo: CaptureDevice | null = null;
  private outputDeviceInfo: readonly MediaDeviceInfo[] = [];
  private feedbackValue: FeedbackAssessment = NO_FEEDBACK_RISK;
  private captureSettings: CaptureStreamSettings | null = null;
  private runawayPolls = 0;
  private runawayDucked = false;
  private guardEngaged = false;

  /* ---- source bookkeeping ---- */

  /**
   * `createMediaElementSource` may be called **at most once per element**: a
   * second call throws `InvalidStateError`. Worse, the first call permanently
   * re-routes that element's audio into the graph, so the node must be kept
   * and reused for the lifetime of the element. A `WeakMap` keyed on the
   * element gives us exactly that without leaking elements that the page has
   * since discarded.
   */
  private readonly elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private sourceNode: AudioNode | null = null;
  private bufferNode: AudioBufferSourceNode | null = null;
  private activeStream: MediaStream | null = null;
  /** `removeEventListener` thunks for the active stream's `ended` handlers. */
  private streamLossCleanups: Array<() => void> = [];

  /* ---- metering ---- */

  // Explicitly ArrayBuffer-backed: `getFloatTimeDomainData` will not accept a
  // view that might be over a SharedArrayBuffer.
  private meterIn: Float32Array<ArrayBuffer> | null = null;
  private meterOut: Float32Array<ArrayBuffer> | null = null;

  /* ---- scratch for getFilterResponse ---- */

  private respMag: Float32Array<ArrayBuffer> | null = null;
  private respPhase: Float32Array<ArrayBuffer> | null = null;
  private respFreqs: Float32Array<ArrayBuffer> | null = null;

  /* ---- saturation ---- */

  private satDriveApplied = -1;
  private satOversampled = false;

  /* ---- impulse response ---- */

  private irAppliedKey = '';
  private irTimer: ReturnType<typeof setTimeout> | null = null;
  private irSwapTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly irCache = new Map<string, AudioBuffer>();

  constructor(options: DampenEngineOptions = {}) {
    this.latencyHintOverride = options.latencyHint ?? null;
    this.inputModeValue = options.inputMode ?? 'local';
  }

  /** The latency hint the next context will be built with. */
  private get wantedLatencyHint(): LatencyHint {
    return this.latencyHintOverride ?? latencyHintFor(this.inputModeValue);
  }

  /* ---------------------------------------------------------------- *
   * Public surface
   * ---------------------------------------------------------------- */

  get status(): EngineStatus {
    return this.statusValue;
  }

  /** The live, fully-resolved parameter set. A copy is not returned: treat as read-only. */
  get params(): DampenParams {
    return this.state;
  }

  get bypass(): boolean {
    return this.bypassValue;
  }

  /** The `AudioContext`, once created. Null before the first `start`/`setSource`. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Which worklets loaded. Null until the graph has been built. */
  get workletStatus(): WorkletStatus | null {
    return this.worklets;
  }

  /** The last fatal error, if `status === 'error'`. */
  get error(): Error | null {
    return this.lastError;
  }

  /** Pre- and post-DSP analysers for the visualiser. Null until started. */
  get analysers(): { input: AnalyserNode; output: AnalyserNode } | null {
    if (!this.graph) return null;
    return { input: this.graph.analyserIn, output: this.graph.analyserOut };
  }

  /** How the user is feeding audio in. Drives latency and ambience policy. */
  get inputMode(): InputMode {
    return this.inputModeValue;
  }

  /**
   * False when an ambience bed would overlap Spotify Content. See
   * {@link ambienceAllowedFor}. When false the bed is hard-muted *in the
   * engine*, whatever `params.ambience` says — the UI's choice is remembered
   * and comes back when the input mode does.
   */
  get ambienceAllowed(): boolean {
    return ambienceAllowedFor(this.inputModeValue);
  }

  /**
   * True when starting audio could double or feed back: the capture device
   * passes audio through to the speakers, shares a physical device with our
   * output, or is a real microphone. Set the device with
   * {@link setCaptureDevice}; read the explanation from {@link feedback}.
   */
  get feedbackRisk(): boolean {
    return this.feedbackValue.risk;
  }

  /** The full feedback assessment, including a user-facing message. */
  get feedback(): FeedbackAssessment {
    return this.feedbackValue;
  }

  /** True once the runaway guard has pulled the output down. */
  get runawayTripped(): boolean {
    return this.runawayDucked;
  }

  /** Negotiated properties of the live capture stream, if the source is one. */
  get streamSettings(): CaptureStreamSettings | null {
    return this.captureSettings;
  }

  /**
   * Switch input mode.
   *
   * Two things follow from it, and both are enforced here rather than in the
   * UI: the ambience bed is permitted or hard-muted
   * ({@link ambienceAllowedFor}), and the `AudioContext`'s latency hint
   * changes ({@link latencyHintFor}).
   *
   * The latency change cannot be applied to a live context — `latencyHint` is
   * a construction-time option — so it is deferred rather than forced: the
   * next `setSource` rebuilds the context if the hint no longer matches.
   * Tearing down a running context the instant a mode button is pressed would
   * drop audio that is still playing, for no benefit; by the time the mode
   * actually matters the caller is changing source anyway.
   */
  setInputMode(mode: InputMode): void {
    if (this.disposed || mode === this.inputModeValue) return;
    this.inputModeValue = mode;
    // Re-apply so the ambience policy takes effect immediately, with a fade.
    this.applyParams(DEFAULT_RAMP_MS);
    this.refreshFeedback();
  }

  /**
   * Tell the engine which capture device is selected, so it can assess
   * feedback risk. Pass `null` when the source is not a capture stream.
   *
   * `outputs` (from `capture.ts`'s `listOutputDevices`) lets the assessment
   * spot the dangerous case where the input and the output are the same
   * physical device.
   */
  setCaptureDevice(
    device: CaptureDevice | null,
    outputs: readonly MediaDeviceInfo[] = this.outputDeviceInfo,
  ): void {
    if (this.disposed) return;
    this.captureDeviceInfo = device;
    this.outputDeviceInfo = outputs;
    this.refreshFeedback();
  }

  /**
   * End-to-end latency, as far as the platform will report it.
   *
   * `baseLatency` is widely implemented; `outputLatency` is not (it is absent
   * in Safari and was long absent in Firefox) and capture-side latency is
   * reported by almost nobody — so `partial` tells the UI whether `totalMs` is
   * a floor or a real figure, which is the difference between an honest
   * readout and a misleading one.
   */
  getLatency(): LatencyReport {
    const ctx = this.ctx;
    const finite = (v: unknown): number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;

    const base = finite(ctx?.baseLatency);
    // `outputLatency` is not in every lib.dom version; read it defensively.
    const out = finite(
      ctx ? (ctx as unknown as { outputLatency?: number }).outputLatency : undefined,
    );
    const capture = finite(this.captureSettings?.latency);

    const haveOutput = out > 0;
    const haveCapture = this.captureSettings?.latency != null;
    return {
      base,
      output: out,
      capture,
      totalMs: (base + out + capture) * 1000,
      partial: !haveOutput || (this.captureSettings !== null && !haveCapture),
    };
  }

  /** Clear a tripped runaway guard and restore the output gain. */
  resetRunawayGuard(): void {
    if (!this.runawayDucked) return;
    this.runawayDucked = false;
    this.runawayPolls = 0;
    this.applyParams(DEFAULT_RAMP_MS);
  }

  /** Subscribe to status changes. Returns an unsubscribe function. */
  addStatusListener(fn: StatusListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Create the context and graph if needed, then resume.
   *
   * **Must be called from a user gesture.** Browsers start an `AudioContext`
   * suspended and only `resume()` successfully inside a gesture-initiated
   * task; calling this from an effect on mount will leave the status at
   * `'suspended'` (not an error — just silent until the user clicks).
   */
  async start(): Promise<void> {
    if (this.disposed) return;
    await this.ensureGraph();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch (err) {
        // Autoplay policy refusal. Not fatal: the user can click again.
        this.lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    this.syncStatusFromContext();
  }

  /** Suspend the context without tearing anything down. */
  async suspend(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    try {
      await ctx.suspend();
    } catch {
      /* already suspended or closed */
    }
    this.syncStatusFromContext();
  }

  /**
   * Attach an input.
   *
   * The engine **takes ownership** of a `MediaStream` handed to it: when the
   * source is replaced or the engine is disposed, the stream's tracks are
   * stopped, so the browser's capture indicator turns off and a virtual
   * loopback device is released. Pass a clone if you need to keep it.
   *
   * One Web Audio sharp edge worth knowing about for `kind: 'element'`: once
   * an element has been handed to `createMediaElementSource`, its audio is
   * routed into the graph *permanently*. Switching to a different source
   * therefore leaves that element silent until it is made the source again.
   * That is a platform behaviour, not a bug here.
   */
  async setSource(src: DampenSource): Promise<void> {
    if (this.disposed) return;

    /*
     * Work out what the context has to look like *before* it is built, so the
     * first build is already correct and the common case never rebuilds.
     * See `preferredContextSampleRate` in `capture.ts` for why the capture
     * path dictates the context's sample rate.
     */
    if (src.kind === 'stream') {
      const settings = readCaptureSettings(src.stream);
      this.captureSettings = settings;
      this.desiredSampleRate = preferredContextSampleRate(settings);
    } else {
      this.captureSettings = null;
      this.desiredSampleRate = null;
    }

    await this.ensureCompatibleContext();
    this.clearError();
    await this.ensureGraph();
    const ctx = this.ctx;
    const graph = this.graph;
    if (!ctx || !graph) return;

    this.releaseSource();

    switch (src.kind) {
      case 'none':
        return;

      case 'element': {
        let node = this.elementSources.get(src.el);
        if (!node) {
          node = ctx.createMediaElementSource(src.el);
          this.elementSources.set(src.el, node);
        }
        node.connect(graph.inputGain);
        this.sourceNode = node;
        return;
      }

      case 'stream': {
        const node = ctx.createMediaStreamSource(src.stream);
        node.connect(graph.inputGain);
        this.sourceNode = node;
        this.activeStream = src.stream;
        this.watchStreamForLoss(src.stream);
        this.refreshFeedback();
        return;
      }

      case 'buffer': {
        const node = ctx.createBufferSource();
        node.buffer = src.buffer;
        node.loop = src.loop ?? false;
        node.connect(graph.inputGain);
        node.start();
        this.sourceNode = node;
        this.bufferNode = node;
        return;
      }
    }
  }

  /**
   * Merge a partial parameter patch and apply it.
   *
   * @param patch  any subset of `DampenParams`; missing fields keep their
   *               current value, invalid fields are rejected
   * @param rampMs ramp length for every affected parameter. The default of
   *               60 ms is right for slider drags. Pass a larger value for a
   *               preset change (300–500 ms morphs rather than snaps), or 0
   *               only when nothing is audible yet.
   */
  setParams(patch: DampenParamsPatch, rampMs: number = DEFAULT_RAMP_MS): void {
    if (this.disposed) return;
    this.state = mergeParams(this.state, patch);
    this.applyParams(num(rampMs, DEFAULT_RAMP_MS, 0, 10000));
  }

  /** Replace the whole parameter set (used by preset application). */
  setAllParams(next: DampenParams, rampMs: number = DEFAULT_RAMP_MS): void {
    if (this.disposed) return;
    this.state = sanitizeParams(next, DEFAULT_PARAMS);
    this.applyParams(num(rampMs, DEFAULT_RAMP_MS, 0, 10000));
  }

  /**
   * Crossfade between the processed and unprocessed paths over
   * {@link BYPASS_FADE_MS}.
   *
   * Honest caveat: the dry tap is taken pre-DSP and the wet path has real
   * latency in it (the `DynamicsCompressorNode` alone carries a few ms of
   * lookahead, and the convolver adds the IR's pre-delay), so the two are not
   * time-aligned. During the 80 ms crossfade the sum therefore comb-filters
   * slightly. The alternative — a hard switch — is a click, which is worse;
   * fully fixing it would mean a delay-matched dry path and a latency figure
   * that changes with the reverb settings.
   */
  setBypass(b: boolean): void {
    const next = !!b;
    this.bypassValue = next;
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    rampLinear(ctx, g.wetBypass.gain, next ? 0 : 1, BYPASS_FADE_MS);
    rampLinear(ctx, g.dryBypass.gain, next ? 1 : 0, BYPASS_FADE_MS);
  }

  /**
   * Input peak, output peak, output RMS (all dBFS) and compressor reduction.
   *
   * Cheap enough for 20 Hz: two 2048-sample `getFloatTimeDomainData` copies
   * into pre-allocated buffers plus one pass each. ~8 k float ops per call,
   * 160 k/s — noise next to the DSP itself. The buffers are allocated once and
   * reused, so this allocates nothing and never triggers GC during playback.
   */
  getMeters(): EngineMeters {
    const g = this.graph;
    if (!g) {
      return {
        inputPeak: METER_FLOOR_DB,
        outputPeak: METER_FLOOR_DB,
        outputRms: METER_FLOOR_DB,
        reduction: 0,
      };
    }

    if (!this.meterIn || this.meterIn.length !== g.analyserIn.fftSize) {
      this.meterIn = new Float32Array(g.analyserIn.fftSize);
    }
    if (!this.meterOut || this.meterOut.length !== g.analyserOut.fftSize) {
      this.meterOut = new Float32Array(g.analyserOut.fftSize);
    }

    g.analyserIn.getFloatTimeDomainData(this.meterIn);
    g.analyserOut.getFloatTimeDomainData(this.meterOut);

    const inLevels = blockLevels(this.meterIn);
    const outLevels = blockLevels(this.meterOut);

    // `reduction` is already in dB and negative. It is a plain number on the
    // node (it was an AudioParam in very old implementations).
    const reduction = Number.isFinite(g.compressor.reduction) ? g.compressor.reduction : 0;

    this.checkRunaway(inLevels.peakDb, outLevels.rmsDb);

    return {
      inputPeak: inLevels.peakDb,
      outputPeak: outLevels.peakDb,
      outputRms: outLevels.rmsDb,
      reduction,
    };
  }

  /**
   * The second half of "never let it howl".
   *
   * The {@link makeOutputGuardCurve} clipper bounds the *instantaneous* level,
   * so a loop can never exceed −0.44 dBFS or damage anything — but a bounded
   * loop is still a loud one. This detects the sustained, simultaneous rise in
   * input *and* output level that a real loop produces and pulls the output
   * down for good.
   *
   * It is deliberately narrow, because a false positive is a muted player:
   *
   *  - It only arms when a risk has been flagged via {@link setCaptureDevice},
   *    so a local-file listener can never trip it.
   *  - It needs **both** meters sustained above −6 dBFS. Dampened background
   *    music lives at −25 to −15 dBFS RMS by construction; −6 dBFS RMS held
   *    for a second and a half is not a mix, it is a loop.
   *  - The counter decays, so transients and loud passages cannot accumulate.
   *
   * **Known limitation, stated plainly:** this runs inside `getMeters`, which
   * means it only runs while something is polling the meters — the hook does,
   * at 20 Hz, whenever the engine is running. A consumer that never calls
   * `getMeters` gets the clipper but not the ducker. Putting it on an
   * independent timer would make the engine own a timer it cannot cancel from
   * the audio thread; doing it properly would mean a sidechain
   * `AudioWorklet` reporting level over its port, which is the right answer if
   * this ever needs to be guaranteed.
   */
  private checkRunaway(inputPeakDb: number, outputRmsDb: number): void {
    if (!this.feedbackValue.risk || this.runawayDucked) return;

    if (outputRmsDb > RUNAWAY_RMS_DB && inputPeakDb > RUNAWAY_RMS_DB) {
      this.runawayPolls++;
    } else if (this.runawayPolls > 0) {
      this.runawayPolls--;
    }

    if (this.runawayPolls < RUNAWAY_POLLS) return;

    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    this.runawayDucked = true;
    this.runawayPolls = 0;
    rampLinear(ctx, g.outputGain.gain, 0, RUNAWAY_DUCK_MS);
    this.lastError = new Error(
      'Dampen muted its output: the input and output levels were climbing together, ' +
        'which means the capture device is hearing Dampen. Pick a different input or output.',
    );
  }

  /**
   * Total magnitude response of the EQ/filter section, in dB, at the given
   * frequencies — exactly what the visualiser draws over the spectrum.
   *
   * The product of the stages' magnitudes is accumulated **in dB** rather than
   * as a linear product: four cascaded steep lowpasses can reach 1e-20 in the
   * stopband, which underflows float32 long before the log is taken, and the
   * curve would flatten into a lie at the bottom of the plot.
   *
   * Neutralised lowpass stages are `allpass` and so report a magnitude of
   * exactly 1, contributing 0 dB — which is why all four stages can be
   * included unconditionally and the curve is automatically correct for any
   * stage count.
   */
  getFilterResponse(freqs: Float32Array): Float32Array {
    const n = freqs.length;
    const out = new Float32Array(n);
    const g = this.graph;
    if (!g || n === 0) return out;

    if (!this.respMag || this.respMag.length !== n) {
      this.respMag = new Float32Array(n);
      this.respPhase = new Float32Array(n);
      this.respFreqs = new Float32Array(n);
    }
    const mag = this.respMag;
    const phase = this.respPhase;
    const bins = this.respFreqs;
    if (!phase || !bins) return out;

    /*
     * Copy the requested frequencies into our own buffer rather than passing
     * the caller's array straight through. Two reasons: `getFrequencyResponse`
     * requires an `ArrayBuffer`-backed view (the caller's may be over a
     * `SharedArrayBuffer`), and clamping each bin into [0, Nyquist] here means
     * a visualiser that plots up to 24 kHz on a 44.1 kHz context gets a
     * sensible edge value instead of a column of NaN.
     */
    const nyquist = this.ctx ? this.ctx.sampleRate / 2 : 24000;
    for (let i = 0; i < n; i++) {
      const f = freqs[i];
      bins[i] = Number.isFinite(f) ? Math.min(Math.max(f, 0), nyquist) : 0;
    }

    const filters: BiquadFilterNode[] = [
      g.highpass,
      g.lowShelf,
      ...g.lowpass.map((s) => s.node),
      g.presenceDip,
      g.tilt,
    ];

    for (const f of filters) {
      f.getFrequencyResponse(bins, mag, phase);
      for (let i = 0; i < n; i++) {
        const m = mag[i];
        // Out-of-range frequencies (negative, or above Nyquist) yield NaN per
        // spec; treat those bins as transparent rather than poisoning the sum.
        if (!Number.isFinite(m)) continue;
        out[i] += 20 * Math.log10(m > 1e-8 ? m : 1e-8);
      }
    }
    return out;
  }

  /**
   * Tear everything down: stop the LFO and any buffer source, release
   * captured streams, disconnect every node and close the context.
   *
   * The engine is not reusable afterwards; every method becomes a no-op.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.irTimer !== null) clearTimeout(this.irTimer);
    if (this.irSwapTimer !== null) clearTimeout(this.irSwapTimer);
    this.irTimer = null;
    this.irSwapTimer = null;
    this.irCache.clear();

    this.releaseSource();
    this.teardownGraph();

    const ctx = this.ctx;
    if (ctx) {
      forgetWorklets(ctx);
      ctx.onstatechange = null;
      if (ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    }
    this.ctx = null;
    this.listeners.clear();
    this.setStatus('idle');
  }

  /* ---------------------------------------------------------------- *
   * Construction
   * ---------------------------------------------------------------- */

  /**
   * Recompute the feedback assessment and engage or release the output guard.
   *
   * The guard is only engaged when a risk has been flagged, because an engaged
   * guard is not transparent above −0.92 dBFS and `DEFAULT_PARAMS` has to be.
   * Swapping the curve is the same operation as a saturation drive change and
   * is equally click-free: the two curves agree exactly over the whole range
   * the signal is actually using at the moment of the swap.
   */
  private refreshFeedback(): void {
    const device = this.inputModeValue === 'capture' ? this.captureDeviceInfo : null;
    this.feedbackValue = assessFeedbackRisk(device, this.outputDeviceInfo);
    if (!this.feedbackValue.risk) {
      this.runawayPolls = 0;
      if (this.runawayDucked) this.resetRunawayGuard();
    }

    const g = this.graph;
    if (!g) return;
    if (this.feedbackValue.risk !== this.guardEngaged) {
      this.guardEngaged = this.feedbackValue.risk;
      g.guard.curve = makeOutputGuardCurve(this.guardEngaged);
    }
  }

  /**
   * Disconnect and release every node, leaving the `AudioContext` itself
   * alone. Shared by `dispose()` and by `ensureCompatibleContext()`, which
   * needs to rebuild the graph into a *new* context without tearing the
   * engine down.
   */
  private teardownGraph(): void {
    const g = this.graph;
    this.graph = null;
    this.graphPromise = null;
    if (!g) return;

    try {
      g.driftOsc.stop();
    } catch {
      /* never started, or already stopped */
    }
    // Tell the worklet processors to return false so they are collected
    // rather than lingering until the context closes.
    g.wow?.port.postMessage({ type: 'release' });
    g.crush?.port.postMessage({ type: 'release' });
    g.ambience.dispose();
    g.width.dispose();
    for (const stage of g.lowpass) stage.dispose();
    for (const node of g.all) {
      try {
        node.disconnect();
      } catch {
        /* already detached */
      }
    }
    // A rebuilt graph must re-derive these rather than reuse stale state.
    this.satDriveApplied = -1;
    this.satOversampled = false;
    this.guardEngaged = false;
    this.irAppliedKey = '';
    this.irCache.clear();
  }

  private setStatus(next: EngineStatus): void {
    if (this.statusValue === next) return;
    this.statusValue = next;
    for (const fn of this.listeners) {
      try {
        fn(next);
      } catch {
        // A listener throwing must not break the engine.
      }
    }
  }

  private syncStatusFromContext(): void {
    const ctx = this.ctx;
    if (this.disposed || !ctx) return;
    if (this.statusValue === 'error') return;
    switch (ctx.state) {
      case 'running':
        this.setStatus('running');
        break;
      case 'suspended':
        this.setStatus('suspended');
        break;
      default:
        this.setStatus('idle');
    }
  }

  private createContext(): AudioContext {
    if (typeof window === 'undefined') {
      throw new Error('DampenEngine requires a browser environment');
    }
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    // Safari exposed the constructor under a vendor prefix for years and some
    // embedded WebViews still only have the prefixed one.
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio API is unavailable in this browser');

    const latencyHint = this.wantedLatencyHint;
    const sampleRate = this.desiredSampleRate;

    /*
     * `sampleRate` is only passed when a capture stream told us its real rate.
     * See `preferredContextSampleRate` in `capture.ts` for why matching the
     * capture device's rate matters more than any other context option.
     * An unsupported rate throws NotSupportedError, hence the staircase of
     * fallbacks: rate + hint, then hint alone, then nothing at all (ancient
     * prefixed constructors reject the options bag entirely).
     */
    if (sampleRate !== null) {
      try {
        const ctx = new Ctor({ latencyHint, sampleRate });
        this.builtLatencyHint = latencyHint;
        return ctx;
      } catch {
        this.desiredSampleRate = null;
      }
    }
    try {
      const ctx = new Ctor({ latencyHint });
      this.builtLatencyHint = latencyHint;
      return ctx;
    } catch {
      const ctx = new Ctor();
      this.builtLatencyHint = null;
      return ctx;
    }
  }

  private async ensureGraph(): Promise<void> {
    if (this.disposed) return;
    if (!this.graphPromise) this.graphPromise = this.buildGraph();
    await this.graphPromise;
  }

  private async buildGraph(): Promise<void> {
    this.setStatus('initializing');
    try {
      const ctx = this.createContext();
      this.ctx = ctx;
      ctx.onstatechange = () => this.syncStatusFromContext();

      // Loading is advisory and never rejects; whatever did not load is simply
      // not built, and the corresponding stage is permanently neutral.
      this.worklets = await workletsReady(ctx);
      if (this.disposed) return;

      this.graph = this.assemble(ctx, this.worklets);
      // rampMs 0: nothing is connected to a source yet, so there is nothing to
      // click. Everything after this point ramps.
      this.applyParams(0);
      this.setBypass(this.bypassValue);
      // Re-derive the guard state for the freshly built graph.
      this.refreshFeedback();
      this.syncStatusFromContext();
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      this.setStatus('error');
    }
  }

  private assemble(ctx: AudioContext, worklets: WorkletStatus): Graph {
    const nyquist = ctx.sampleRate / 2;

    const inputGain = ctx.createGain();

    const analyserIn = ctx.createAnalyser();
    analyserIn.fftSize = FFT_SIZE;
    analyserIn.smoothingTimeConstant = SMOOTHING;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = HIGHPASS_OPEN_HZ;
    highpass.Q.value = 0;

    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = DEFAULT_PARAMS.lowShelf.freq;
    lowShelf.gain.value = 0;

    const lowpass: LowpassStage[] = [];
    for (let i = 0; i < LOWPASS_STAGE_COUNT; i++) lowpass.push(new LowpassStage(ctx));

    const presenceDip = ctx.createBiquadFilter();
    presenceDip.type = 'peaking';
    presenceDip.frequency.value = DEFAULT_PARAMS.presenceDip.freq;
    presenceDip.Q.value = DEFAULT_PARAMS.presenceDip.q;
    presenceDip.gain.value = 0;

    const tilt = ctx.createBiquadFilter();
    tilt.type = 'highshelf';
    tilt.frequency.value = DEFAULT_PARAMS.tilt.freq;
    tilt.gain.value = 0;

    const saturator = ctx.createWaveShaper();
    saturator.curve = makeSaturationCurve(0);
    // An identity curve cannot alias, so oversampling would only add the
    // resampler's own band-edge ripple. It is switched on with the drive.
    saturator.oversample = 'none';

    const wow = canUse(worklets, 'dampen-wowflutter')
      ? this.tryWorklet(ctx, 'dampen-wowflutter')
      : null;
    const crush = canUse(worklets, 'dampen-bitcrush')
      ? this.tryWorklet(ctx, 'dampen-bitcrush')
      : null;

    const revTap = ctx.createGain();
    const revDry = ctx.createGain();
    revDry.gain.value = 1;
    const convolver = ctx.createConvolver();
    // Must be set *before* a buffer is assigned. We energy-normalise the IR
    // ourselves (see `ir.ts`) so that changing `decay` does not change
    // loudness; the browser's own normalisation is a different scheme and
    // would fight ours.
    convolver.normalize = false;
    const revWet = ctx.createGain();
    revWet.gain.value = 0;
    const revSum = ctx.createGain();

    const width = createWidthBlock(ctx);

    const compressor = ctx.createDynamicsCompressor();
    const makeup = ctx.createGain();

    const driftGain = ctx.createGain();
    const driftOsc = ctx.createOscillator();
    driftOsc.type = 'sine';
    driftOsc.frequency.value = DEFAULT_PARAMS.drift.rate;
    const driftDepth = ctx.createGain();
    driftDepth.gain.value = 0;

    const ambience = createAmbienceBed(ctx, worklets);
    const dampenMix = ctx.createGain();

    const wetBypass = ctx.createGain();
    wetBypass.gain.value = 1;
    const dryBypass = ctx.createGain();
    dryBypass.gain.value = 0;

    const outputGain = ctx.createGain();

    // The last node before the analyser and the destination. Starts as the
    // exact identity; only engaged when a feedback risk is flagged.
    const guard = ctx.createWaveShaper();
    guard.curve = makeOutputGuardCurve(false);
    guard.oversample = 'none';

    const analyserOut = ctx.createAnalyser();
    analyserOut.fftSize = FFT_SIZE;
    analyserOut.smoothingTimeConstant = SMOOTHING;

    /* ---- wiring ---- */

    inputGain.connect(analyserIn);

    // Pre-DSP dry tap for the bypass crossfade.
    analyserIn.connect(dryBypass);
    dryBypass.connect(outputGain);

    analyserIn.connect(highpass);
    highpass.connect(lowShelf);

    let cursor: AudioNode = lowShelf;
    for (const stage of lowpass) {
      cursor.connect(stage.node);
      cursor = stage.node;
    }
    cursor.connect(presenceDip);
    presenceDip.connect(tilt);
    tilt.connect(saturator);

    // The two worklet slots. Deciding *here*, once, which of them exist is not
    // "rewiring on a param change" — it is a build-time capability check.
    cursor = saturator;
    if (wow) {
      cursor.connect(wow);
      cursor = wow;
    }
    if (crush) {
      cursor.connect(crush);
      cursor = crush;
    }
    cursor.connect(revTap);

    revTap.connect(revDry);
    revTap.connect(convolver);
    convolver.connect(revWet);
    revDry.connect(revSum);
    revWet.connect(revSum);

    revSum.connect(width.input);
    width.output.connect(compressor);
    compressor.connect(makeup);
    makeup.connect(driftGain);
    driftGain.connect(dampenMix);

    // The LFO is summed into the gain param, on top of its intrinsic value.
    driftOsc.connect(driftDepth);
    driftDepth.connect(driftGain.gain);
    try {
      driftOsc.start();
    } catch {
      // Already started — cannot happen on a fresh node, but a throw here
      // would abandon a half-built graph.
    }

    ambience.output.connect(dampenMix);

    dampenMix.connect(wetBypass);
    wetBypass.connect(outputGain);
    // The output analyser sits *after* the guard so the meters report what the
    // listener actually hears, guard action included.
    outputGain.connect(guard);
    guard.connect(analyserOut);
    analyserOut.connect(ctx.destination);

    const all: AudioNode[] = [
      inputGain,
      analyserIn,
      highpass,
      lowShelf,
      presenceDip,
      tilt,
      saturator,
      revTap,
      revDry,
      convolver,
      revWet,
      revSum,
      compressor,
      makeup,
      driftGain,
      driftOsc,
      driftDepth,
      dampenMix,
      wetBypass,
      dryBypass,
      outputGain,
      guard,
      analyserOut,
    ];
    if (wow) all.push(wow);
    if (crush) all.push(crush);

    // Guard against a sample rate so low that a default frequency would sit
    // above Nyquist (an 8 kHz context would make 5 kHz corners illegal).
    if (nyquist < 11025) {
      setInitial(ctx, tilt.frequency, Math.min(tilt.frequency.value, nyquist * 0.9));
      setInitial(ctx, presenceDip.frequency, Math.min(presenceDip.frequency.value, nyquist * 0.9));
    }

    return {
      inputGain,
      analyserIn,
      highpass,
      lowShelf,
      lowpass,
      presenceDip,
      tilt,
      saturator,
      wow,
      crush,
      revTap,
      revDry,
      convolver,
      revWet,
      revSum,
      width,
      compressor,
      makeup,
      driftGain,
      driftOsc,
      driftDepth,
      ambience,
      dampenMix,
      wetBypass,
      dryBypass,
      outputGain,
      guard,
      analyserOut,
      all,
    };
  }

  /** Construct a worklet node, returning null rather than throwing. */
  private tryWorklet(ctx: AudioContext, name: string): AudioWorkletNode | null {
    try {
      return new AudioWorkletNode(ctx, name, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      return null;
    }
  }

  /* ---------------------------------------------------------------- *
   * Parameter application
   * ---------------------------------------------------------------- */

  private applyParams(rampMs: number): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    const p = this.state;
    const nyquist = ctx.sampleRate / 2;
    const fMax = nyquist * 0.98;

    /* ---- highpass ----
     * No allpass trick needed here, unlike the lowpass cascade: a single
     * Butterworth highpass parked at 10 Hz is already −0.27 dB at 20 Hz and
     * −0.01 dB at 40 Hz, i.e. transparent in the audible band. */
    const hpOpen = p.highpass.freq <= HIGHPASS_OPEN_HZ;
    rampSmooth(ctx, g.highpass.frequency, hpOpen ? 10 : Math.min(p.highpass.freq, fMax), rampMs);
    // `highpass.q` is LINEAR in DampenParams (per lib/types.ts) but the node
    // wants decibels. See BUTTERWORTH_Q_DB for why this conversion exists.
    rampSmooth(
      ctx,
      g.highpass.Q,
      hpOpen ? BUTTERWORTH_Q_DB : linearQToDb(p.highpass.q),
      rampMs,
    );

    /* ---- low shelf (structural bass lift) ---- */
    rampSmooth(ctx, g.lowShelf.frequency, Math.min(p.lowShelf.freq, fMax), rampMs);
    rampSmooth(ctx, g.lowShelf.gain, p.lowShelf.gain, rampMs);

    /* ---- the lowpass wall ----
     * A stage is active if it is within the cascade count *and* the cutoff is
     * below the "fully open" sentinel. The second condition is what makes
     * DEFAULT_PARAMS (20 kHz, 1 stage) exactly transparent. */
    const lpOpen = p.lowpass.freq >= LOWPASS_OPEN_HZ;
    // Staggered Butterworth alignment: `stages = n` is a genuine order-2n
    // filter, so the -3 dB corner stays exactly at `freq` whatever the stage
    // count. Returns dB, ready for the node.
    const stageQs = cascadeStageQsDb(p.lowpass.stages, p.lowpass.q);
    for (let i = 0; i < g.lowpass.length; i++) {
      const active = !lpOpen && i < p.lowpass.stages;
      g.lowpass[i].setTarget(
        active,
        Math.min(p.lowpass.freq, fMax),
        stageQs[i] ?? BUTTERWORTH_Q_DB,
        rampMs,
      );
    }

    /* ---- presence dip (the 1–5 kHz attention band) ---- */
    rampSmooth(ctx, g.presenceDip.frequency, Math.min(p.presenceDip.freq, fMax), rampMs);
    // A `peaking` filter's Q is a *linear* Q natively, so this one is NOT
    // converted. Mixing the two conventions up is the classic silent bug here.
    rampSmooth(ctx, g.presenceDip.Q, p.presenceDip.q, rampMs);
    rampSmooth(ctx, g.presenceDip.gain, p.presenceDip.gain, rampMs);

    /* ---- tilt ---- */
    rampSmooth(ctx, g.tilt.frequency, Math.min(p.tilt.freq, fMax), rampMs);
    rampSmooth(ctx, g.tilt.gain, p.tilt.gain, rampMs);

    /* ---- saturation ---- */
    this.applySaturation(p.saturation);

    /* ---- wow / flutter ---- */
    if (g.wow) {
      this.rampWorkletParam(g.wow, 'wowRate', p.wowFlutter.wowRate, rampMs);
      this.rampWorkletParam(g.wow, 'wowDepth', p.wowFlutter.wowDepth, rampMs);
      this.rampWorkletParam(g.wow, 'flutterRate', p.wowFlutter.flutterRate, rampMs);
      this.rampWorkletParam(g.wow, 'flutterDepth', p.wowFlutter.flutterDepth, rampMs);
    }

    /* ---- bitcrush ---- */
    if (g.crush) {
      this.rampWorkletParam(g.crush, 'bits', p.bitcrush.bits, rampMs);
      this.rampWorkletParam(g.crush, 'downsample', p.bitcrush.downsample, rampMs);
      this.rampWorkletParam(g.crush, 'mix', p.bitcrush.mix, rampMs);
    }

    /* ---- reverb ----
     * Linear amplitude crossfade. The wet leg is energy-normalised to unity
     * RMS gain (see `ir.ts`), so dry = 1 − mix / wet = mix keeps the total
     * roughly constant while making mix = 0 an exact bypass. */
    rampSmooth(ctx, g.revDry.gain, 1 - p.reverb.mix, rampMs);
    rampSmooth(ctx, g.revWet.gain, p.reverb.mix, rampMs);
    // Render synchronously only when the convolver is about to be audible and
    // has nothing loaded; otherwise debounce. In particular this keeps the
    // ~5 ms render off the graph-construction path, where `reverb.mix` is 0
    // and a blocking render would just delay the first sound.
    this.scheduleIR(p.reverb, p.reverb.mix > 0 && g.convolver.buffer === null);

    /* ---- width ---- */
    rampSmooth(ctx, g.width.widthParam, p.width, rampMs);

    /* ---- compressor ---- */
    rampSmooth(ctx, g.compressor.threshold, p.compressor.threshold, rampMs);
    rampSmooth(ctx, g.compressor.ratio, p.compressor.ratio, rampMs);
    rampSmooth(ctx, g.compressor.knee, p.compressor.knee, rampMs);
    rampSmooth(ctx, g.compressor.attack, p.compressor.attack, rampMs);
    rampSmooth(ctx, g.compressor.release, p.compressor.release, rampMs);
    rampSmooth(ctx, g.makeup.gain, dbToLin(p.compressor.makeup), rampMs);

    /* ---- drift ----
     * The GainNode's intrinsic value holds the centre of the window and the
     * oscillator is summed in on top of it, so the resulting gain stays inside
     * [10^(-depth/20), 1]: it can only ever duck, never boost, and never
     * reaches zero or flips sign. */
    const window = driftWindow(p.drift.depth);
    rampSmooth(ctx, g.driftGain.gain, window.centre, rampMs);
    rampSmooth(ctx, g.driftDepth.gain, window.amplitude, rampMs);
    rampSmooth(ctx, g.driftOsc.frequency, p.drift.rate, rampMs);

    /* ---- ambience ----
     * Policy gate, enforced here rather than in the UI: see
     * `ambienceAllowedFor`. `p.ambience` keeps the user's choice so that it
     * returns intact when they switch back to a local source. */
    g.ambience.setParams(this.ambienceAllowed ? p.ambience : AMBIENCE_OFF, Math.max(rampMs, 0));

    /* ---- output ----
     * A tripped runaway guard overrides the user's output gain until it is
     * explicitly reset, so a feedback loop cannot be re-armed by a slider. */
    const outTarget = this.runawayDucked ? 0 : dbToLin(p.outputGain);
    rampSmooth(ctx, g.outputGain.gain, outTarget, rampMs);
    rampSmooth(ctx, g.inputGain.gain, 1, rampMs);
  }

  /** Ramp a worklet's `AudioParam`, if the processor declares it. */
  private rampWorkletParam(
    node: AudioWorkletNode,
    name: string,
    value: number,
    rampMs: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const param = node.parameters.get(name);
    if (!param) return;
    rampSmooth(ctx, param, value, rampMs);
  }

  /**
   * Update the waveshaper.
   *
   * The curve is only regenerated when the drive moves by more than
   * {@link SATURATION_CURVE_STEP}, so a slider drag rebuilds a 4096-point
   * table a few hundred times rather than a few thousand. Swapping the table
   * is click-free in practice because consecutive curves differ by a fraction
   * of a dB at every input level.
   *
   * `oversample` is the one discrete switch in the chain. 4× is needed as soon
   * as the curve bends — a `tanh` fed a 10 kHz tone generates harmonics at 30
   * and 50 kHz which would otherwise fold back as inharmonic grit — but with
   * an identity curve there is nothing to alias and oversampling would only
   * contribute the resampler's own band-edge ripple and latency. The switch
   * therefore happens exactly at the point where the curve is still the
   * identity, where the two behave the same.
   */
  private applySaturation(drive: number): void {
    const g = this.graph;
    if (!g) return;
    const d = num(drive, 0, 0, 1);

    const quantised = Math.round(d / SATURATION_CURVE_STEP) * SATURATION_CURVE_STEP;
    if (quantised !== this.satDriveApplied) {
      this.satDriveApplied = quantised;
      g.saturator.curve = makeSaturationCurve(quantised);
    }

    const wantOversample = d > SATURATION_ENGAGE;
    if (wantOversample !== this.satOversampled) {
      this.satOversampled = wantOversample;
      g.saturator.oversample = wantOversample ? '4x' : 'none';
    }
  }

  /* ---------------------------------------------------------------- *
   * Impulse response lifecycle
   * ---------------------------------------------------------------- */

  /**
   * Re-render the IR only when the reverb parameters have actually changed,
   * and not more than once per {@link IR_DEBOUNCE_MS}.
   *
   * Rendering a 3 s stereo IR is a few hundred thousand `Math.random()` calls
   * plus a filter pass per channel — single-digit milliseconds, but on the
   * main thread. Triggered naively from a slider that emits a change per
   * animation frame, that is 60 renders a second and a visibly janky UI. The
   * cache key quantises the parameters to just-noticeable steps
   * (see `irCacheKey`), so a one-pixel wiggle produces no work at all, and
   * recently rendered IRs are kept so dragging back and forth is free.
   */
  private scheduleIR(reverb: RoomIROptions, immediate: boolean): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;

    const opts = normalizeIROptions(reverb);
    const key = irCacheKey(opts, ctx.sampleRate);
    if (key === this.irAppliedKey) return;

    if (this.irTimer !== null) {
      clearTimeout(this.irTimer);
      this.irTimer = null;
    }

    const run = () => {
      this.irTimer = null;
      if (this.disposed) return;
      if (key === this.irAppliedKey) return;
      this.irAppliedKey = key;

      let buffer = this.irCache.get(key);
      if (!buffer) {
        try {
          buffer = buildRoomIR(ctx, opts);
        } catch (err) {
          // A failed render must leave the convolver with whatever it had.
          this.lastError = err instanceof Error ? err : new Error(String(err));
          return;
        }
        this.irCache.set(key, buffer);
        // Simple FIFO eviction: insertion order is Map iteration order.
        while (this.irCache.size > IR_CACHE_LIMIT) {
          const oldest = this.irCache.keys().next();
          if (oldest.done) break;
          this.irCache.delete(oldest.value);
        }
      }
      this.swapIR(buffer);
    };

    if (immediate) run();
    else this.irTimer = setTimeout(run, IR_DEBOUNCE_MS);
  }

  /**
   * Install a new impulse response.
   *
   * Assigning `ConvolverNode.buffer` discards the convolver's internal tail
   * state, so doing it while the wet leg is audible truncates the reverb
   * mid-decay — a small but distinct "pfft". Ducking the wet gain to zero for
   * 25 ms either side hides the discontinuity completely.
   */
  private swapIR(buffer: AudioBuffer): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;

    const targetWet = this.state.reverb.mix;

    if (targetWet <= 0) {
      // Nothing audible through the convolver; swap straight in.
      g.convolver.buffer = buffer;
      return;
    }

    if (this.irSwapTimer !== null) clearTimeout(this.irSwapTimer);
    rampLinear(ctx, g.revWet.gain, 0, IR_SWAP_DUCK_MS);
    this.irSwapTimer = setTimeout(() => {
      this.irSwapTimer = null;
      const liveCtx = this.ctx;
      const liveGraph = this.graph;
      if (this.disposed || !liveCtx || !liveGraph) return;
      liveGraph.convolver.buffer = buffer;
      rampLinear(liveCtx, liveGraph.revWet.gain, this.state.reverb.mix, IR_SWAP_DUCK_MS * 2);
    }, IR_SWAP_DUCK_MS + 10);
  }

  /* ---------------------------------------------------------------- *
   * Source lifecycle
   * ---------------------------------------------------------------- */

  /**
   * Detach the current source.
   *
   * `MediaElementAudioSourceNode`s are disconnected but **kept** in the
   * `WeakMap`: the platform only allows one per element, so throwing it away
   * would make that element permanently unusable. Buffer sources are stopped
   * (they are single-use). Captured streams have their tracks stopped, which
   * is what turns the browser's recording indicator off.
   */
  /**
   * Rebuild the `AudioContext` if the live one cannot serve the source we are
   * about to attach.
   *
   * Two construction-time options can go stale: `sampleRate` (which must match
   * the capture device — see `capture.ts`) and `latencyHint` (which follows
   * the input mode). Neither can be changed on a live context, so the only
   * remedy is a new one.
   *
   * This is called from `setSource` and nowhere else, deliberately: a source
   * change is already a discontinuity, so rebuilding there is inaudible,
   * whereas rebuilding the moment a mode button is pressed would drop audio
   * that is still playing.
   */
  private async ensureCompatibleContext(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;

    const rateMismatch =
      this.desiredSampleRate !== null && Math.round(ctx.sampleRate) !== this.desiredSampleRate;
    const hintMismatch =
      this.builtLatencyHint !== null && this.builtLatencyHint !== this.wantedLatencyHint;
    if (!rateMismatch && !hintMismatch) return;

    this.teardownGraph();
    const old = this.ctx;
    this.ctx = null;
    this.graphPromise = null;
    this.builtLatencyHint = null;
    if (old) {
      forgetWorklets(old);
      old.onstatechange = null;
      if (old.state !== 'closed') {
        try {
          await old.close();
        } catch {
          /* already closing */
        }
      }
    }
  }

  /**
   * Fail soft when a capture device disappears mid-session.
   *
   * Unplugging an interface, or uninstalling a virtual driver while Dampen is
   * running, ends the track. The stream then produces silence (or, on some
   * platforms, nothing at all and a stalled graph), which is confusing rather
   * than informative. So: ramp the output down cleanly, record a typed error
   * and surface the error status. Nothing is thrown — this fires from a DOM
   * event with nowhere to propagate to, and throwing towards the audio thread
   * is never the answer.
   */
  private watchStreamForLoss(stream: MediaStream): void {
    const handler = (): void => {
      if (this.disposed) return;
      const ctx = this.ctx;
      const g = this.graph;
      if (ctx && g) rampLinear(ctx, g.outputGain.gain, 0, BYPASS_FADE_MS);
      this.lastError = new CaptureError('device-lost', captureErrorMessage('device-lost'));
      this.setStatus('error');
    };
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', handler);
      this.streamLossCleanups.push(() => track.removeEventListener('ended', handler));
    }
  }

  /** Forget a previous fatal error so a fresh source can run. */
  private clearError(): void {
    this.lastError = null;
    if (this.statusValue === 'error') {
      this.statusValue = 'idle';
      this.syncStatusFromContext();
    }
  }

  private releaseSource(): void {
    if (this.bufferNode) {
      try {
        this.bufferNode.stop();
      } catch {
        /* never started */
      }
      this.bufferNode = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        /* already detached */
      }
      this.sourceNode = null;
    }
    for (const off of this.streamLossCleanups) {
      try {
        off();
      } catch {
        /* listener already gone */
      }
    }
    this.streamLossCleanups = [];
    if (this.activeStream) {
      for (const track of this.activeStream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* already ended */
        }
      }
      this.activeStream = null;
    }
    this.captureSettings = null;
  }
}
