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
import { DampenEngine } from './engine';
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

/** Ramp used when a whole preset is applied — a morph, not a jump. */
const PRESET_RAMP_MS = 350;

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

async function start(): Promise<void> {
  const eng = getEngine();
  if (!eng) return;
  await eng.start();
  useStore.setState({ status: eng.status, analysers: eng.analysers });
}

async function setSource(src: DampenSource): Promise<void> {
  const eng = getEngine();
  if (!eng) return;
  await eng.setSource(src);
  useStore.setState({ status: eng.status, analysers: eng.analysers });
}

function setInputMode(mode: InputMode): void {
  useStore.setState({ inputMode: mode });
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
      setParam,
      applyPreset,
      setAmount,
      setBypass,
      analysers,
      filterResponse: stableFilterResponse,
    }),
    [status, params, presetId, bypass, meters, inputMode, analysers, stableFilterResponse],
  );
}
