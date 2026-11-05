'use client';

/**
 * Dampen — the one React binding.
 *
 * `lib/audio/engine.ts` knows nothing about React. This file is the entire
 * boundary: a module-level engine singleton, a module-level zustand store, and
 * a hook that reads the store and forwards calls to the engine.
 *
 * ## Why a module singleton and not a ref
 *
 * React 19's StrictMode mounts every component, runs its effects, unmounts it
 * and mounts it again. A `useRef` + "create on first render" pattern therefore
 * constructs **two** `AudioContext`s, and the browser's per-page context limit
 * (six in Chrome) plus the fact that an orphaned context keeps rendering makes
 * that a real bug, not a lint warning. A module-level singleton is created
 * once per page load no matter how many times React mounts the tree, and is
 * deliberately **not** disposed on unmount — tearing down an `AudioContext`
 * because a component re-mounted would stop the music. Call
 * {@link disposeDampen} explicitly if you genuinely want it gone.
 *
 * ## Meters
 *
 * Polled on `requestAnimationFrame` but committed at most every 50 ms (~20 Hz,
 * as the contract specifies), and only when a value has moved by more than a
 * quarter of a dB. The rAF loop is torn down whenever the engine is not
 * running, so an idle or backgrounded page does no work at all (rAF is already
 * throttled to zero in a hidden tab, which is a bonus rather than the
 * mechanism).
 */

import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type {
  DampenParams,
  DampenSource,
  EngineMeters,
  EngineStatus,
  InputMode,
  Preset,
} from '@/lib/types';
import {
  ambienceAllowedFor,
  DampenEngine,
  isOutputSelectable,
  type LatencyReport,
  type OutputSelectResult,
} from './engine';
import {
  listCaptureDevices,
  listOutputDevices,
  onDeviceChange,
  type CaptureDevice,
  type FeedbackAssessment,
  type OutputDevice,
} from './capture';
import { METER_FLOOR_DB } from './dsp';
import { setParamPath } from './params';
import { DEFAULT_PARAMS, PRESETS, getPreset, resolveParams } from './presets';

/* Re-exported so consumers have a single import site, per the API contract. */
export { DEFAULT_PARAMS, PRESETS, getPreset, resolveParams };
export type { Preset };

/** Meter poll interval. 20 Hz is fast enough to look live, slow enough to be free. */
const METER_INTERVAL_MS = 50;

/** Don't re-render for sub-quarter-dB meter wobble. */
const METER_EPSILON_DB = 0.25;

/**
 * Ramp used when a whole preset is applied.
 *
 * One second, not 350 ms, on the research's advice: a preset change moves ~30
 * parameters at once and is itself a *deviant* in irrelevant-sound terms —
 * deviation effects run d = 0.93 to 1.22 and add about 4 percentage points to
 * serial-recall error. A slow morph is measurably less disruptive than a snap,
 * and preset changes should never be automatic.
 */
const PRESET_RAMP_MS = 1000;

/** Ramp used while the macro dial is being dragged. */
const MACRO_RAMP_MS = 90;

/** Ramp used for a single slider. */
const PARAM_RAMP_MS = 60;

const SILENT_METERS: EngineMeters = {
  inputPeak: METER_FLOOR_DB,
  outputPeak: METER_FLOOR_DB,
  outputRms: METER_FLOOR_DB,
  reduction: 0,
};

const NO_RISK: FeedbackAssessment = { risk: false, reason: 'none', message: '' };

/**
 * Where the chosen output device is remembered.
 *
 * Re-picking an output every session would be tedious, and on macOS it is the
 * difference between hearing Dampen and hearing nothing. Only the id is
 * stored — no audio, nothing identifying, and `deviceId`s are already
 * origin-scoped and rotated by the browser.
 */
const OUTPUT_STORAGE_KEY = 'dampen.outputDeviceId';

function loadStoredOutput(): string {
  // Every access is guarded: `localStorage` throws outright in some contexts
  // (private mode with site data blocked, sandboxed frames), and a thrown
  // preference read must not take the audio engine down with it.
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(OUTPUT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeOutput(deviceId: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (deviceId) localStorage.setItem(OUTPUT_STORAGE_KEY, deviceId);
    else localStorage.removeItem(OUTPUT_STORAGE_KEY);
  } catch {
    /* storage unavailable; the choice simply will not persist */
  }
}

const NO_LATENCY: LatencyReport = {
  base: 0,
  output: 0,
  capture: 0,
  totalMs: 0,
  partial: true,
};

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

interface DampenStore {
  status: EngineStatus;
  params: DampenParams;
  presetId: string;
  bypass: boolean;
  meters: EngineMeters;
  inputMode: InputMode;
  analysers: { input: AnalyserNode; output: AnalyserNode } | null;

  /* ---- capture path ---- */

  /** Enumerated audio inputs. Empty until `refreshCaptureDevices` is called. */
  captureDevices: CaptureDevice[];
  /** The input the user picked, if any. */
  captureDevice: CaptureDevice | null;
  /** Negotiated stream properties, for the UI's "44.1 kHz / 2 ch" readout. */
  captureSampleRate: number | null;
  captureChannels: number | null;

  /* ---- output routing (the macOS Path B fix) ---- */

  /** Enumerated audio outputs. */
  outputDevices: OutputDevice[];
  /** The chosen output id; `''` means "follow the system default". */
  outputDevice: string;
  /** False when the browser cannot choose an output at all. */
  outputSelectable: boolean;
  /** True when Dampen picked the output itself to break a feedback loop. */
  outputAutoSelected: boolean;

  /* ---- policy + safety ---- */

  /** False when an ambience bed would overlap Spotify Content; see the engine. */
  ambienceAllowed: boolean;
  /** True when starting audio could double or feed back. */
  feedbackRisk: boolean;
  /** The full assessment, with a user-facing message. */
  feedback: FeedbackAssessment;
  /** True once the engine's runaway guard has muted the output. */
  runawayTripped: boolean;
  /** Measured end-to-end latency. */
  latency: LatencyReport;
  /** The last fatal engine or capture error, as a message. */
  error: string | null;
}

const useStore = create<DampenStore>(() => ({
  status: 'idle',
  params: DEFAULT_PARAMS,
  // '' means "no preset": the params are DEFAULT_PARAMS or hand-edited.
  presetId: '',
  bypass: false,
  meters: SILENT_METERS,
  inputMode: 'local',
  analysers: null,

  captureDevices: [],
  captureDevice: null,
  captureSampleRate: null,
  captureChannels: null,

  outputDevices: [],
  outputDevice: '',
  outputSelectable: isOutputSelectable(),
  outputAutoSelected: false,

  ambienceAllowed: ambienceAllowedFor('local'),
  feedbackRisk: false,
  feedback: NO_RISK,
  runawayTripped: false,
  latency: NO_LATENCY,
  error: null,
}));

/* ------------------------------------------------------------------ *
 * Engine singleton
 * ------------------------------------------------------------------ */

let engine: DampenEngine | null = null;

/**
 * Get (and on first call, create) the engine.
 *
 * Returns `null` during server rendering: constructing an `AudioContext` needs
 * `window`, and this module is imported by client components that Next.js
 * still renders on the server.
 */
function getEngine(): DampenEngine | null {
  if (typeof window === 'undefined') return null;
  if (!engine) {
    const created = new DampenEngine();
    engine = created;
    created.addStatusListener((status) => {
      useStore.setState({ status, analysers: created.analysers });
    });
    // Seed the engine with whatever the store already holds, with no ramp:
    // nothing is connected yet, so there is nothing to click.
    created.setAllParams(useStore.getState().params, 0);
  }
  return engine;
}

/**
 * Dispose the singleton. Exported for explicit teardown (tests, a hard
 * "stop everything" button); the hook never calls it, because a StrictMode
 * re-mount must not close the audio context.
 */
export function disposeDampen(): void {
  engine?.dispose();
  engine = null;
  useStore.setState({ status: 'idle', analysers: null, meters: SILENT_METERS });
}

/** Direct access to the engine, for code outside React (debug console, tests). */
export function getDampenEngine(): DampenEngine | null {
  return engine;
}

/* ------------------------------------------------------------------ *
 * Actions — module-level so their identity is stable across renders
 * ------------------------------------------------------------------ */

function commitParams(next: DampenParams, rampMs: number, presetId?: string): void {
  const patch: Partial<DampenStore> = { params: next };
  if (presetId !== undefined) patch.presetId = presetId;
  useStore.setState(patch);
  const eng = getEngine();
  eng?.setAllParams(next, rampMs);
}

/** Pull everything the engine derives for itself back into the store. */
function syncFromEngine(eng: DampenEngine): void {
  const settings = eng.streamSettings;
  useStore.setState({
    status: eng.status,
    analysers: eng.analysers,
    inputMode: eng.inputMode,
    ambienceAllowed: eng.ambienceAllowed,
    feedbackRisk: eng.feedbackRisk,
    feedback: eng.feedback,
    runawayTripped: eng.runawayTripped,
    latency: eng.getLatency(),
    captureSampleRate: settings?.sampleRate ?? null,
    captureChannels: settings?.channelCount ?? null,
    outputDevice: eng.outputDeviceId,
    outputSelectable: eng.outputSelectable,
    outputAutoSelected: eng.outputAutoSelected,
    error: eng.error?.message ?? null,
  });
}

async function start(): Promise<void> {
  const eng = getEngine();
  if (!eng) return;
  await eng.start();
  syncFromEngine(eng);
}

async function setSource(src: DampenSource): Promise<void> {
  const eng = getEngine();
  if (!eng) return;
  await eng.setSource(src);
  syncFromEngine(eng);
}

function setInputMode(mode: InputMode): void {
  const eng = getEngine();
  // The engine owns the consequences — the ambience policy and the latency
  // hint — so it is told first and the store mirrors what it decided.
  eng?.setInputMode(mode);
  if (eng) syncFromEngine(eng);
  else useStore.setState({ inputMode: mode, ambienceAllowed: ambienceAllowedFor(mode) });
}

/**
 * Enumerate audio inputs and outputs.
 *
 * **Call this from a user gesture.** If the origin has never been granted
 * microphone access, `enumerateDevices` returns blank labels and this will
 * raise the permission prompt in order to fill them in — which is expected
 * behind a "choose input" button and alarming anywhere else.
 */
async function refreshCaptureDevices(): Promise<CaptureDevice[]> {
  try {
    // Capture first: its probe is what unlocks labels for *both* lists, and
    // on Chrome it is also what makes named output sinks selectable at all.
    const devices = await listCaptureDevices();
    const outputs = await listOutputDevices();
    useStore.setState({ captureDevices: devices, outputDevices: outputs });
    const eng = getEngine();
    if (eng) {
      // Re-assess with the current selection against the fresh output list.
      const selected = useStore.getState().captureDevice;
      const live = selected ? devices.find((d) => d.deviceId === selected.deviceId) ?? null : null;
      useStore.setState({ captureDevice: live });
      eng.setOutputDevices(outputs);
      eng.setCaptureDevice(live, outputs);
      await restoreStoredOutput(eng, outputs);
      syncFromEngine(eng);
    }
    return devices;
  } catch (err) {
    useStore.setState({
      captureDevices: [],
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Enumerate outputs only. Safe to call without a gesture (never probes). */
async function refreshOutputDevices(): Promise<OutputDevice[]> {
  try {
    const outputs = await listOutputDevices();
    useStore.setState({ outputDevices: outputs });
    const eng = getEngine();
    if (eng) {
      eng.setOutputDevices(outputs);
      syncFromEngine(eng);
    }
    return outputs;
  } catch {
    return [];
  }
}

/**
 * Re-apply a remembered output choice, once we know the device still exists.
 * Applying a stale id would just fail with `NotFoundError`, and silently
 * falling back to the system default is exactly the broken state we are trying
 * to avoid — so it is only attempted when the device is present.
 */
async function restoreStoredOutput(
  eng: DampenEngine,
  outputs: readonly OutputDevice[],
): Promise<void> {
  const stored = loadStoredOutput();
  if (!stored || eng.outputDeviceId === stored) return;
  if (!outputs.some((o) => o.deviceId === stored)) {
    storeOutput('');
    return;
  }
  const result = await eng.setOutputDevice(stored);
  if (!result.ok) storeOutput('');
}

/**
 * Choose where Dampen plays, independently of the system default.
 *
 * `''` restores the system default. The choice is persisted so it survives a
 * reload.
 */
async function setOutputDevice(deviceId: string): Promise<OutputSelectResult> {
  const eng = getEngine();
  if (!eng) {
    return { ok: false, code: 'unknown', message: 'Audio engine unavailable.' };
  }
  const result = await eng.setOutputDevice(deviceId);
  if (result.ok) storeOutput(deviceId);
  else useStore.setState({ error: result.message });
  syncFromEngine(eng);
  return result;
}

/**
 * Record which capture device the user selected, so the engine can assess
 * feedback risk *before* audio starts. Pass `null` to clear it.
 */
/**
 * Record which capture device the user selected.
 *
 * Also refreshes the output list and, if the selection would make Dampen
 * capture its own output, moves Dampen's output to a real physical device.
 * That rescue is the difference between Path B working and the user hearing
 * silence: on macOS the system default has to be the virtual device for
 * Spotify to feed it, which means Chrome's default output is the virtual
 * device too. `outputAutoSelected` goes true so the UI can say what happened
 * rather than quietly changing their routing.
 */
function setCaptureDevice(device: CaptureDevice | null): void {
  useStore.setState({ captureDevice: device });
  const eng = getEngine();
  if (!eng) return;
  eng.setCaptureDevice(device);
  syncFromEngine(eng);

  void (async () => {
    try {
      const outputs = await listOutputDevices();
      useStore.setState({ outputDevices: outputs });
      eng.setOutputDevices(outputs);
      eng.setCaptureDevice(device, outputs);

      if (device) {
        // A remembered choice wins over the automatic one.
        await restoreStoredOutput(eng, outputs);
        const auto = await eng.autoSelectSafeOutput();
        if (auto && auto.ok) storeOutput(auto.deviceId);
      }
      syncFromEngine(eng);
    } catch {
      /* enumeration failed; the guard keeps whatever it already knew */
    }
  })();
}

/** Clear a tripped runaway guard once the user has fixed their routing. */
function resetRunawayGuard(): void {
  const eng = getEngine();
  if (!eng) return;
  eng.resetRunawayGuard();
  syncFromEngine(eng);
}

function setParam(path: string, value: number | string): void {
  const current = useStore.getState().params;
  const next = setParamPath(current, path, value);
  // `setParamPath` returns the original object for a rejected edit.
  if (next === current) return;
  commitParams(next, PARAM_RAMP_MS);
}

/**
 * Select a preset.
 *
 * If the macro dial is currently at zero the preset would be inaudible, which
 * reads as "clicking the preset did nothing", so the dial is taken to 1. Any
 * other position is preserved, which is what makes auditioning presets at a
 * fixed intensity work.
 */
function applyPreset(id: string): void {
  const state = useStore.getState();
  const preset = getPreset(id);
  if (!preset) {
    commitParams(resolveParams('', 0), PRESET_RAMP_MS, '');
    return;
  }
  const amount = state.params.amount > 0 ? state.params.amount : 1;
  commitParams(resolveParams(preset, amount), PRESET_RAMP_MS, preset.id);
}

/** The macro dial. */
function setAmount(amount: number): void {
  const state = useStore.getState();
  const preset = getPreset(state.presetId);
  if (!preset) {
    // No preset selected: the dial still has to mean something, so it just
    // records the amount. Nothing to interpolate towards.
    commitParams({ ...state.params, amount: Math.min(Math.max(amount, 0), 1) }, MACRO_RAMP_MS);
    return;
  }
  commitParams(resolveParams(preset, amount), MACRO_RAMP_MS, preset.id);
}

function setBypass(bypass: boolean): void {
  useStore.setState({ bypass });
  getEngine()?.setBypass(bypass);
}

function filterResponse(freqs: Float32Array): Float32Array {
  const eng = engine;
  if (!eng) return new Float32Array(freqs.length);
  return eng.getFilterResponse(freqs);
}

function metersDiffer(a: EngineMeters, b: EngineMeters): boolean {
  return (
    Math.abs(a.inputPeak - b.inputPeak) > METER_EPSILON_DB ||
    Math.abs(a.outputPeak - b.outputPeak) > METER_EPSILON_DB ||
    Math.abs(a.outputRms - b.outputRms) > METER_EPSILON_DB ||
    Math.abs(a.reduction - b.reduction) > METER_EPSILON_DB
  );
}

/* ------------------------------------------------------------------ *
 * The hook
 * ------------------------------------------------------------------ */

export interface UseDampen {
  status: EngineStatus;
  /** Live, fully-resolved params (macro already applied). */
  params: DampenParams;
  presetId: string;
  bypass: boolean;
  /** Updated ~20 Hz while running. */
  meters: EngineMeters;
  inputMode: InputMode;

  /** Must be called from a user gesture — browsers require it. */
  start(): Promise<void>;
  setSource(src: DampenSource): Promise<void>;
  setInputMode(m: InputMode): void;

  /** Dot-path setter, e.g. `setParam('lowpass.freq', 800)`. */
  setParam(path: string, value: number | string): void;
  applyPreset(id: string): void;
  /** The macro dial, 0..1. */
  setAmount(a: number): void;
  setBypass(b: boolean): void;

  /** For the visualiser. Null until started. */
  analysers: { input: AnalyserNode; output: AnalyserNode } | null;
  /** Magnitude response of the EQ/filter section, dB, for the given freqs. */
  filterResponse(freqs: Float32Array): Float32Array;

  /* ---- additive: the capture path (Path B) ---- */

  /** Enumerated audio inputs; empty until {@link refreshCaptureDevices}. */
  captureDevices: CaptureDevice[];
  /** The selected input, if any. */
  captureDevice: CaptureDevice | null;
  /** The live stream's negotiated rate and channel count, for a UI readout. */
  captureSampleRate: number | null;
  captureChannels: number | null;
  /** Enumerate devices. Must be called from a user gesture (may prompt). */
  refreshCaptureDevices(): Promise<CaptureDevice[]>;
  /** Record the user's choice so feedback risk can be assessed before start. */
  setCaptureDevice(device: CaptureDevice | null): void;

  /* ---- additive: output routing, the macOS Path B fix ---- */

  /** Enumerated audio outputs. */
  outputDevices: OutputDevice[];
  /** The chosen output id; `''` follows the system default. */
  outputDevice: string;
  /** False when the browser has no `AudioContext.setSinkId`. */
  outputSelectable: boolean;
  /** True when Dampen chose the output itself to break a feedback loop. */
  outputAutoSelected: boolean;
  /** Choose where Dampen plays. Persisted across reloads. Never throws. */
  setOutputDevice(deviceId: string): Promise<OutputSelectResult>;
  /** Re-enumerate outputs only. Never prompts. */
  refreshOutputDevices(): Promise<OutputDevice[]>;

  /* ---- additive: policy + safety ---- */

  /** False when an ambience bed would overlap Spotify Content. */
  ambienceAllowed: boolean;
  /** True when starting audio could double or feed back. */
  feedbackRisk: boolean;
  /** The assessment behind {@link feedbackRisk}, with a message to show. */
  feedback: FeedbackAssessment;
  /** True once the engine muted itself to stop a runaway. */
  runawayTripped: boolean;
  /** Undo that, after the user fixes their routing. */
  resetRunawayGuard(): void;
  /** Measured end-to-end latency; `partial` if the platform under-reports. */
  latency: LatencyReport;
  /** The last fatal error, as a message. */
  error: string | null;
}

/**
 * The engine, as React state. See `docs/API_CONTRACT.md`.
 *
 * Safe to call from several components at once — they all read the same store
 * and drive the same engine — though the meter poll is shared, so there is no
 * per-consumer cost beyond the re-render.
 */
export function useDampen(): UseDampen {
  const status = useStore((s) => s.status);
  const params = useStore((s) => s.params);
  const presetId = useStore((s) => s.presetId);
  const bypass = useStore((s) => s.bypass);
  const meters = useStore((s) => s.meters);
  const inputMode = useStore((s) => s.inputMode);
  const analysers = useStore((s) => s.analysers);

  const captureDevices = useStore((s) => s.captureDevices);
  const captureDevice = useStore((s) => s.captureDevice);
  const captureSampleRate = useStore((s) => s.captureSampleRate);
  const captureChannels = useStore((s) => s.captureChannels);
  const outputDevices = useStore((s) => s.outputDevices);
  const outputDevice = useStore((s) => s.outputDevice);
  const outputSelectable = useStore((s) => s.outputSelectable);
  const outputAutoSelected = useStore((s) => s.outputAutoSelected);
  const ambienceAllowed = useStore((s) => s.ambienceAllowed);
  const feedbackRisk = useStore((s) => s.feedbackRisk);
  const feedback = useStore((s) => s.feedback);
  const runawayTripped = useStore((s) => s.runawayTripped);
  const latency = useStore((s) => s.latency);
  const error = useStore((s) => s.error);

  /*
   * Device hot-plug. The user is very likely to install BlackHole *while
   * Dampen is open* — that is the whole point of the setup flow — so the list
   * has to notice. This subscription never probes for permission, so plugging
   * in headphones cannot raise a microphone prompt out of nowhere; the labels
   * stay blank until `refreshCaptureDevices` is called from a gesture.
   */
  useEffect(() => {
    return onDeviceChange((devices) => {
      useStore.setState({ captureDevices: devices });
      // The output list changes with the same events — a newly installed
      // BlackHole, or headphones being unplugged, both land here.
      void refreshOutputDevices();
      const eng = engine;
      const selected = useStore.getState().captureDevice;
      if (!eng || !selected) return;
      // If the selected device has vanished, drop the selection so the UI
      // cannot keep showing an input that no longer exists.
      const live = devices.find((d) => d.deviceId === selected.deviceId) ?? null;
      if (live === null) {
        useStore.setState({ captureDevice: null });
        eng.setCaptureDevice(null);
        syncFromEngine(eng);
      }
    });
  }, []);

  /*
   * Meter polling. Mounted only while the engine is actually running, so a
   * suspended or idle page schedules no frames. Several mounted consumers each
   * start a loop; they write identical values through the same change filter,
   * so the cost is one extra `getFloatTimeDomainData` pair per frame rather
   * than extra renders. Not worth a refcount.
   */
  useEffect(() => {
    if (status !== 'running') return;
    const eng = engine;
    if (!eng) return;

    let raf = 0;
    let last = 0;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      raf = requestAnimationFrame(tick);
      if (now - last < METER_INTERVAL_MS) return;
      last = now;
      const next = eng.getMeters();
      if (metersDiffer(next, useStore.getState().meters)) {
        useStore.setState({ meters: next });
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [status]);

  /* Reset the meters to silence when playback stops, so the UI does not hold
   * a stale peak forever. */
  useEffect(() => {
    if (status === 'running') return;
    if (useStore.getState().meters !== SILENT_METERS) {
      useStore.setState({ meters: SILENT_METERS });
    }
  }, [status]);

  /*
   * Latency and the runaway flag are only knowable once the context exists, so
   * they are re-read whenever the status changes rather than polled. (The
   * runaway guard itself lives in `getMeters`, which the loop above drives at
   * 20 Hz; this just mirrors its verdict into the store.)
   */
  useEffect(() => {
    const eng = engine;
    if (eng) syncFromEngine(eng);
  }, [status]);

  // Stable identity for the one closure the visualiser calls every frame.
  const stableFilterResponse = useCallback(
    (freqs: Float32Array): Float32Array => filterResponse(freqs),
    [],
  );

  return useMemo(
    () => ({
      status,
      params,
      presetId,
      bypass,
      meters,
      inputMode,
      start,
      setSource,
      setInputMode,
      captureDevices,
      captureDevice,
      captureSampleRate,
      captureChannels,
      refreshCaptureDevices,
      setCaptureDevice,
      outputDevices,
      outputDevice,
      outputSelectable,
      outputAutoSelected,
      setOutputDevice,
      refreshOutputDevices,
      ambienceAllowed,
      feedbackRisk,
      feedback,
      runawayTripped,
      resetRunawayGuard,
      latency,
      error,
      setParam,
      applyPreset,
      setAmount,
      setBypass,
      analysers,
      filterResponse: stableFilterResponse,
    }),
    [
      status,
      params,
      presetId,
      bypass,
      meters,
      inputMode,
      analysers,
      stableFilterResponse,
      captureDevices,
      captureDevice,
      captureSampleRate,
      captureChannels,
      outputDevices,
      outputDevice,
      outputSelectable,
      outputAutoSelected,
      ambienceAllowed,
      feedbackRisk,
      feedback,
      runawayTripped,
      latency,
      error,
    ],
  );
}
