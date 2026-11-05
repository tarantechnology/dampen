/**
 * Dampen — browser-only integration tests.
 *
 * These need a real Web Audio implementation: a live `AudioContext`, a working
 * `AudioWorklet`, and `BiquadFilterNode.getFrequencyResponse`. In Node every
 * case reports as **skipped**.
 *
 * They exist because they are the only way to check the claims that matter
 * most and that no amount of pure-maths testing can reach:
 *
 *  - `DEFAULT_PARAMS` really is flat (the allpass-neutralisation scheme in
 *    `biquad.ts` works, and the graph is transparent from its *first* render
 *    block, not merely after the first parameter ramp);
 *  - `lowpass.stages = n` really is an order-2n Butterworth with its −3 dB
 *    corner at `lowpass.freq`;
 *  - the three worklets load from `/worklets/*.js` and are true bypasses at
 *    neutral settings;
 *  - a NaN storm does not silence the graph.
 *
 * Run them with `runSelfTest()` from `lib/audio/selftest.ts`. Every one of
 * these passed in Chrome 156 during development; several of them failed first
 * and found real bugs (a resonant default highpass, the compressor's
 * non-neutral node defaults, and an `AudioContext.resume()` that hangs
 * forever under the autoplay policy).
 */

import { DampenEngine, ambienceAllowedFor, isOutputSelectable } from '../engine';
import { listOutputDevices, pickPhysicalOutput } from '../capture';
import { BUTTERWORTH_Q_DB, BUTTERWORTH_Q_LINEAR } from '../dsp';
import { DEFAULT_PARAMS, getPreset, PRESETS, resolveParams } from '../presets';
import { workletsReady } from '../worklets';
import { assert, assertClose, assertEqual, skipTest, type TestCase } from './harness';

const HAS_WEB_AUDIO =
  typeof window !== 'undefined' &&
  typeof (window as unknown as { AudioContext?: unknown }).AudioContext === 'function';
const SKIP_REASON = 'needs a browser with a live AudioContext';

/** Log-spaced analysis grid, 20 Hz to 20 kHz. */
function grid(n = 256): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 20 * Math.pow(1000, i / (n - 1));
  return a;
}

/** Response at one exact frequency. A log grid's nearest bin can be 0.4 % off,
 *  which on a 48 dB/oct slope is 0.26 dB — enough to fail a tolerance. */
function responseAt(engine: DampenEngine, hz: number): number {
  return engine.getFilterResponse(new Float32Array([hz]))[0];
}

function worstDeviation(resp: Float32Array, freqs: Float32Array): { db: number; hz: number } {
  let db = 0;
  let hz = 0;
  for (let i = 0; i < resp.length; i++) {
    if (!Number.isFinite(resp[i])) return { db: Number.NaN, hz: freqs[i] };
    if (Math.abs(resp[i]) > db) {
      db = Math.abs(resp[i]);
      hz = freqs[i];
    }
  }
  return { db, hz };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Abandon a case that needs the graph to be *rendering*, not merely built.
 *
 * `BiquadFilterNode.getFrequencyResponse` is specified to use the parameter
 * values "sampled for the current processing block". A suspended context has
 * no processing blocks, so scheduled automation is never sampled and every
 * filter still reports its construction value — which, because this engine now
 * constructs every node neutral, means **the response reads a flat 0 dB no
 * matter what parameters have been set**.
 *
 * Measured directly: with Chrome's default autoplay policy and no user
 * gesture, the context stays suspended and all seven response-measuring cases
 * below read 0 dB. That is the platform behaving as documented, not a
 * regression, so they skip with this reason rather than failing. Give the page
 * a gesture (or run Chrome with `--autoplay-policy=no-user-gesture-required`)
 * and they run for real.
 *
 * Worth knowing beyond the tests: the UI's live response curve will read flat
 * until audio actually starts, for exactly this reason.
 */
function requireRendering(eng: DampenEngine): void {
  if (eng.status === 'running') return;
  skipTest(
    `needs a rendering context: status is "${eng.status}"` +
      (eng.needsGesture ? ' (the autoplay policy is waiting for a user gesture)' : '') +
      ' — getFrequencyResponse only reflects parameters while blocks are being rendered',
  );
}

/**
 * Settling time after a parameter change before the response is read.
 *
 * Covers the `LowpassStage` allpass/lowpass type switch, which is deliberately
 * deferred until after the cutoff ramp has finished (see `biquad.ts`).
 */
const SETTLE_MS = 220;

/**
 * One engine, shared by the cases.
 *
 * The **promise** is memoised, not the instance. Memoising the instance looks
 * equivalent and is not: the assignment happens before `await start()`, so a
 * second concurrent caller sees a non-null engine and returns it while it is
 * still mid-build — observing `status === 'initializing'` and
 * `analysers === null`. That is not hypothetical; `/selftest` auto-runs this
 * suite from a `useEffect`, which React invokes twice, so the suite really did
 * run twice concurrently and really did fail on exactly those two assertions.
 *
 * (`DampenEngine.start()` now coalesces concurrent calls itself, so this is
 * belt-and-braces — but a test helper that races is a bad harness regardless
 * of how forgiving the thing under test is.)
 */
let sharedPromise: Promise<DampenEngine> | null = null;

async function engine(): Promise<DampenEngine> {
  if (!sharedPromise) {
    sharedPromise = (async () => {
      const eng = new DampenEngine();
      await eng.start();
      return eng;
    })();
  }
  return sharedPromise;
}

function browserCase(name: string, run: () => void | Promise<void>): TestCase {
  return { name, run, skip: !HAS_WEB_AUDIO, skipReason: SKIP_REASON };
}

/* ------------------------------------------------------------------ *
 * Graph construction
 * ------------------------------------------------------------------ */

const setupCases: TestCase[] = [
  browserCase('browser: the engine starts and builds a graph', async () => {
    const eng = await engine();
    assert(eng.context !== null, 'no AudioContext');
    assert(
      eng.status === 'running' || eng.status === 'suspended',
      `unexpected status ${eng.status}: ${eng.error?.message ?? ''}`,
    );
    assert(eng.analysers !== null, 'no analysers');
  }),

  browserCase('browser: start() settles to a terminal status, never initializing', async () => {
    const eng = await engine();
    // The contract: after start() resolves there is always something the UI
    // can do. 'initializing' offers no action and reads as a dead app.
    assert(
      eng.status === 'running' || eng.status === 'suspended' || eng.status === 'error',
      `status must be terminal, got "${eng.status}"`,
    );
    assert(eng.status !== 'initializing' && eng.status !== 'idle', 'not mid-flight');
    // And if it is suspended, the reason must be legible.
    if (eng.status === 'suspended') {
      assertEqual(typeof eng.needsGesture, 'boolean', 'needsGesture should say why');
    }
  }),

  browserCase('browser: concurrent start() calls all observe a built graph', async () => {
    // The exact shape that broke /selftest: several callers racing start().
    // Every one of them must see the finished engine, not a half-built one.
    const eng = new DampenEngine();
    const views = await Promise.all(
      [0, 1, 2, 3].map(async () => {
        await eng.start();
        return { status: eng.status, hasAnalysers: eng.analysers !== null };
      }),
    );
    try {
      for (const [i, v] of views.entries()) {
        assert(
          v.status !== 'initializing' && v.status !== 'idle',
          `caller ${i} saw a mid-flight status "${v.status}"`,
        );
        assert(v.hasAnalysers, `caller ${i} saw no analysers`);
      }
    } finally {
      eng.dispose();
    }
  }),

  browserCase('browser: analysers are 2048-point with 0.8 smoothing', async () => {
    const eng = await engine();
    const a = eng.analysers;
    assert(a !== null, 'no analysers');
    if (!a) return;
    for (const [label, node] of [
      ['input', a.input],
      ['output', a.output],
    ] as const) {
      assertEqual(node.fftSize, 2048, `${label} fftSize`);
      // The visualiser is tuned assuming this is non-zero; leave it set.
      assertClose(node.smoothingTimeConstant, 0.8, 1e-6, `${label} smoothingTimeConstant`);
    }
  }),

  browserCase('browser: all three worklet modules load from /worklets/', async () => {
    const eng = await engine();
    const ctx = eng.context;
    assert(ctx !== null, 'no context');
    if (!ctx) return;
    const status = await workletsReady(ctx);
    assert(status.supported, 'AudioWorklet unsupported');
    assert(
      status.allLoaded,
      `not all loaded: ${JSON.stringify(status.loaded)} errors ${JSON.stringify(status.errors)}`,
    );
  }),
];

/* ------------------------------------------------------------------ *
 * Transparency and the filter cascade
 * ------------------------------------------------------------------ */

const filterCases: TestCase[] = [
  browserCase('browser: DEFAULT_PARAMS is flat to 0.05 dB, 20 Hz to 20 kHz', async () => {
    const eng = await engine();
    requireRendering(eng);
    eng.setAllParams(DEFAULT_PARAMS, 0);
    await sleep(SETTLE_MS);
    const freqs = grid();
    const w = worstDeviation(eng.getFilterResponse(freqs), freqs);
    assert(
      Number.isFinite(w.db) && w.db < 0.05,
      `worst ${w.db.toFixed(4)} dB at ${w.hz.toFixed(0)} Hz`,
    );
  }),

  ...[1, 2, 3, 4].map((stages) =>
    browserCase(
      `browser: stages = ${stages} is an order-${stages * 2} Butterworth, -3.01 dB at the stated cutoff`,
      async () => {
        const eng = await engine();
        requireRendering(eng);
        eng.setAllParams(
          { ...DEFAULT_PARAMS, lowpass: { freq: 1000, q: BUTTERWORTH_Q_LINEAR, stages: stages as 1 | 2 | 3 | 4 } },
          0,
        );
        await sleep(SETTLE_MS);

        // The whole point of staggering the pole Qs: the corner does not move
        // with the stage count.
        assertClose(responseAt(eng, 1000), BUTTERWORTH_Q_DB, 0.15, `gain at the 1 kHz corner`);
        // Flat passband two octaves down.
        assertClose(responseAt(eng, 250), 0, 0.2, 'passband at 250 Hz');
        // ~12 dB/oct per stage, one octave above.
        const oct = responseAt(eng, 2000);
        assertClose(oct, -12.04 * stages, 3.5, 'one octave above the corner');
      },
    ),
  ),

  browserCase('browser: reopening the cutoff returns the cascade to flat', async () => {
    const eng = await engine();
    requireRendering(eng);
    // Close it hard first, so all four stages are live lowpasses...
    eng.setAllParams(
      { ...DEFAULT_PARAMS, lowpass: { freq: 400, q: BUTTERWORTH_Q_LINEAR, stages: 4 } },
      0,
    );
    await sleep(SETTLE_MS);
    assert(responseAt(eng, 2000) < -30, 'the wall should be up');
    // ...then neutralise and confirm the allpass switch really is transparent.
    eng.setAllParams(DEFAULT_PARAMS, 0);
    await sleep(SETTLE_MS);
    const freqs = grid();
    const w = worstDeviation(eng.getFilterResponse(freqs), freqs);
    assert(
      Number.isFinite(w.db) && w.db < 0.05,
      `worst ${w.db.toFixed(4)} dB at ${w.hz.toFixed(0)} Hz`,
    );
  }),

  browserCase('browser: every preset at amount 0 is flat', async () => {
    const eng = await engine();
    requireRendering(eng);
    const freqs = grid();
    for (const p of PRESETS) {
      eng.setAllParams(resolveParams(p, 0), 0);
      await sleep(SETTLE_MS);
      const w = worstDeviation(eng.getFilterResponse(freqs), freqs);
      assert(
        Number.isFinite(w.db) && w.db < 0.05,
        `${p.id}: worst ${w.db.toFixed(4)} dB at ${w.hz.toFixed(0)} Hz`,
      );
    }
  }),

  browserCase('browser: every preset at amount 1 has a finite, sane response', async () => {
    const eng = await engine();
    requireRendering(eng);
    const freqs = grid();
    for (const p of PRESETS) {
      eng.setAllParams(resolveParams(p, 1), 0);
      await sleep(SETTLE_MS);
      const resp = eng.getFilterResponse(freqs);
      for (let i = 0; i < resp.length; i++) {
        assert(Number.isFinite(resp[i]), `${p.id}: non-finite response at ${freqs[i].toFixed(0)} Hz`);
      }
      // The wall must actually attenuate an octave above its own corner. (Not
      // *at* the corner: `underwater` deliberately resonates there.)
      const oneOct = responseAt(eng, Math.min(p.params.lowpass.freq * 2, 18000));
      assert(oneOct < -8, `${p.id}: only ${oneOct.toFixed(1)} dB an octave above its cutoff`);
      const atCorner = responseAt(eng, p.params.lowpass.freq);
      assert(
        atCorner > -14 && atCorner < 8,
        `${p.id}: implausible corner gain ${atCorner.toFixed(2)} dB`,
      );
    }
  }),

  browserCase('browser: next-room’s +3 dB coincidence leak is really there', async () => {
    const eng = await engine();
    requireRendering(eng);
    const preset = getPreset('next-room');
    assert(preset !== undefined, 'preset missing');
    if (!preset) return;
    eng.setAllParams(resolveParams(preset, 1), 0);
    await sleep(SETTLE_MS);
    // The leak sits on a falling slope, so it is a shelf rather than a local
    // maximum; the test is that it lifts 2.2 kHz above the plain slope.
    const leak = responseAt(eng, 2200);
    const below = responseAt(eng, 1400);
    const above = responseAt(eng, 3600);
    const interpolated = (below + above) / 2;
    assert(
      leak > interpolated + 0.5,
      `leak ${leak.toFixed(2)} dB vs interpolated slope ${interpolated.toFixed(2)} dB`,
    );
  }),
];

/* ------------------------------------------------------------------ *
 * Policy, metering and robustness
 * ------------------------------------------------------------------ */

const runtimeCases: TestCase[] = [
  browserCase('browser: input mode drives the ambience policy in the engine', async () => {
    const eng = await engine();
    eng.setInputMode('capture');
    assertEqual(eng.ambienceAllowed, false, 'capture must forbid the bed');
    assertEqual(eng.ambienceAllowed, ambienceAllowedFor('capture'), 'engine agrees with the rule');
    eng.setInputMode('spotify');
    assertEqual(eng.ambienceAllowed, false, 'spotify must forbid the bed');
    eng.setInputMode('local');
    assertEqual(eng.ambienceAllowed, true, 'local must permit it');
  }),

  browserCase('browser: a passthrough capture device raises feedbackRisk', async () => {
    const eng = await engine();
    eng.setInputMode('capture');
    eng.setCaptureDevice(
      {
        deviceId: 'bm',
        label: 'Background Music',
        likelyVirtual: true,
        passthrough: 'likely',
        groupId: 'g1',
      },
      [],
    );
    assertEqual(eng.feedbackRisk, true, 'should be flagged');
    assert(eng.feedback.message.length > 20, 'risk must come with an explanation');
    eng.setCaptureDevice(
      {
        deviceId: 'bh',
        label: 'BlackHole 2ch',
        likelyVirtual: true,
        passthrough: 'none',
        groupId: 'g2',
      },
      [],
    );
    assertEqual(eng.feedbackRisk, false, 'a pure sink should clear it');
    eng.setCaptureDevice(null);
    eng.setInputMode('local');
  }),

  browserCase('browser: getMeters returns four finite dB figures', async () => {
    const eng = await engine();
    const m = eng.getMeters();
    for (const [k, v] of Object.entries(m)) {
      assert(Number.isFinite(v), `${k} is ${String(v)}`);
    }
    assert(m.inputPeak <= 0.01, 'input peak cannot exceed 0 dBFS with no source');
    assert(m.reduction <= 0.01, 'compressor reduction is negative or zero');
  }),

  browserCase('browser: getLatency reports finite numbers', async () => {
    const eng = await engine();
    const l = eng.getLatency();
    for (const k of ['base', 'output', 'capture', 'totalMs'] as const) {
      assert(Number.isFinite(l[k]) && l[k] >= 0, `${k} is ${String(l[k])}`);
    }
  }),

  browserCase('browser: bypass crossfades without throwing', async () => {
    const eng = await engine();
    eng.setBypass(true);
    await sleep(120);
    assertEqual(eng.bypass, true, 'engaged');
    eng.setBypass(false);
    await sleep(120);
    assertEqual(eng.bypass, false, 'disengaged');
  }),

  browserCase('browser: a NaN storm leaves the graph alive', async () => {
    const eng = await engine();
    requireRendering(eng);
    // Everything a buggy caller could possibly do at once. A single NaN
    // reaching an AudioParam makes its node emit NaN for the lifetime of the
    // context, with no error — so this is the most important robustness case
    // in the suite.
    eng.setParams(
      {
        lowpass: { freq: Number.NaN, q: Infinity, stages: 99 as unknown as 1 },
        highpass: { freq: -Infinity, q: Number.NaN },
        width: Number.NaN,
        outputGain: Number.NaN,
        saturation: Number.NaN,
        reverb: { mix: Number.NaN, decay: Number.NaN, preDelay: Number.NaN },
        compressor: { ratio: Number.NaN, threshold: Number.NaN },
        drift: { rate: Number.NaN, depth: Number.NaN },
        ambience: { level: Number.NaN, tone: Number.NaN },
      },
      0,
    );
    await sleep(SETTLE_MS);
    const freqs = grid();
    const resp = eng.getFilterResponse(freqs);
    for (let i = 0; i < resp.length; i++) {
      assert(Number.isFinite(resp[i]), `non-finite response at ${freqs[i].toFixed(0)} Hz`);
    }
    const m = eng.getMeters();
    assert(Number.isFinite(m.outputRms), 'meters went non-finite');
    // And recovery back to flat must still work.
    eng.setAllParams(DEFAULT_PARAMS, 0);
    await sleep(SETTLE_MS);
    const w = worstDeviation(eng.getFilterResponse(freqs), freqs);
    assert(Number.isFinite(w.db) && w.db < 0.05, `did not recover: worst ${w.db} dB`);
  }),

  browserCase('browser: setSinkId is available and an empty id always works', async () => {
    const eng = await engine();
    // Chrome 110+. Measured true in Chrome 156.
    assertEqual(isOutputSelectable(), true, 'AudioContext.setSinkId should exist');
    assertEqual(eng.outputSelectable, true, 'engine agrees');
    const r = await eng.setOutputDevice('');
    assert(r.ok, `setting the system default should succeed: ${JSON.stringify(r)}`);
    assertEqual(eng.outputDeviceId, '', 'records the selection');
  }),

  browserCase('browser: an unknown output id fails as a typed no-device result', async () => {
    const eng = await engine();
    const r = await eng.setOutputDevice('0'.repeat(64));
    assert(!r.ok, 'must not report success');
    if (r.ok) return;
    // Measured: Chrome rejects with NotFoundError for an id it does not know.
    assertEqual(r.code, 'no-device', `unexpected code: ${r.code} / ${r.message}`);
    assert(r.message.length > 10, 'carries a message for the UI');
  }),

  browserCase('browser: a real output device can be selected when one is enumerable', async () => {
    const eng = await engine();
    const outputs = await listOutputDevices();
    eng.setOutputDevices(outputs);
    const target = pickPhysicalOutput(outputs);
    if (!target) {
      /*
       * No named output is enumerable, which means the origin holds no media
       * permission grant — measured behaviour: without it `enumerateDevices`
       * returns one blank `audiooutput` entry and there is no id to pass.
       * That is a legitimate environment, not a failure.
       */
      assertEqual(outputs.length, 0, 'with no grant the list should be empty, not blank entries');
      return;
    }
    const r = await eng.setOutputDevice(target.deviceId);
    assert(r.ok, `selecting "${target.label}" failed: ${JSON.stringify(r)}`);
    assertEqual(eng.outputDeviceId, target.deviceId, 'records the selection');
    await eng.setOutputDevice('');
  }),

  browserCase('browser: the auto-rescue moves the output off a captured device', async () => {
    const eng = await engine();
    const outputs = await listOutputDevices();
    const physical = pickPhysicalOutput(outputs);
    if (!physical) return; // no grant; covered above

    // Fabricate the macOS Path B state: capture the device that the output is
    // currently resolving to, so input and output are the same hardware.
    const live = outputs.find((o) => !o.isDefault && o.deviceId === physical.deviceId);
    assert(live !== undefined, 'expected the physical output in the list');
    if (!live) return;

    await eng.setOutputDevice(live.deviceId);
    eng.setInputMode('capture');
    eng.setCaptureDevice(
      {
        deviceId: 'in-same',
        label: live.label,
        likelyVirtual: true,
        passthrough: 'none',
        groupId: live.groupId,
      },
      outputs,
    );
    assertEqual(eng.feedbackRisk, true, 'capturing our own output must be flagged');
    assertEqual(eng.feedback.reason, 'same-device', 'reason');

    // The rescue can only move us if there is somewhere else to go.
    const alternatives = outputs.filter(
      (o) => !o.isDefault && !o.likelyVirtual && o.deviceId !== live.deviceId,
    );
    const result = await eng.autoSelectSafeOutput();
    if (alternatives.length === 0) {
      assert(result === null || result.ok === false, 'nowhere safe to move to');
    } else if (result && result.ok) {
      assert(eng.outputDeviceId !== live.deviceId, 'should have moved off the captured device');
      assertEqual(eng.outputAutoSelected, true, 'and should say that it chose for the user');
    }

    eng.setCaptureDevice(null);
    eng.setInputMode('local');
    await eng.setOutputDevice('');
  }),

  browserCase('browser: dispose tears everything down', async () => {
    // A dedicated engine, not the shared one: two concurrent runs of this
    // suite would otherwise have one disposing the context the other is still
    // asserting against.
    const eng = new DampenEngine();
    await eng.start();
    assert(eng.analysers !== null, 'should have built a graph to tear down');
    eng.dispose();
    assertEqual(eng.status, 'idle', 'status after dispose');
    assertEqual(eng.analysers, null, 'analysers released');
    // Subsequent calls must be inert, not throwing.
    eng.setParams({ width: 0 }, 0);
    eng.setBypass(true);
    eng.dispose();
    const m = eng.getMeters();
    assert(Number.isFinite(m.outputRms), 'meters still answer after dispose');
  }),
];

/** Everything that needs a live browser audio stack. */
export const BROWSER_TESTS: readonly TestCase[] = [
  ...setupCases,
  ...filterCases,
  ...runtimeCases,
];
