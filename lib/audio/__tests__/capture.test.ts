/**
 * Dampen — tests for the filter Q conventions, the output guard, and the
 * capture path's device classification and policy rules.
 *
 * All pure: no `AudioContext`, no `navigator`. These exist because every one of
 * them encodes a decision that is either (a) a documented silent-bug trap, or
 * (b) a product/legal constraint that must not be quietly regressed.
 */

import {
  BUTTERWORTH_Q_DB,
  BUTTERWORTH_Q_LINEAR,
  dbQToLinear,
  linearQToDb,
  makeOutputGuardCurve,
  OUTPUT_GUARD_CEILING,
  OUTPUT_GUARD_KNEE,
} from '../dsp';
import { BUTTER_Q, cascadeStageQsDb } from '../biquad';
import {
  assessFeedbackRisk,
  CAPTURE_DEVICE_NOTES,
  CaptureError,
  describeDevice,
  isLikelyVirtual,
  pickLikelyDevice,
  preferredContextSampleRate,
  type CaptureDevice,
  type CaptureStreamSettings,
} from '../capture';
import { ambienceAllowedFor, latencyHintFor } from '../engine';
import { assert, assertClose, assertEqual, type TestCase } from './harness';

/* ------------------------------------------------------------------ *
 * Q conventions
 * ------------------------------------------------------------------ */

const qTests: TestCase[] = [
  {
    name: 'Q: the Butterworth constants are consistent across both conventions',
    run: () => {
      assertClose(BUTTERWORTH_Q_LINEAR, 0.7071067811865476, 1e-15, 'linear Butterworth Q');
      assertClose(BUTTERWORTH_Q_DB, -3.010299956639812, 1e-12, 'dB Butterworth Q');
      assertClose(linearQToDb(BUTTERWORTH_Q_LINEAR), BUTTERWORTH_Q_DB, 1e-12, 'linear -> dB');
      assertClose(dbQToLinear(BUTTERWORTH_Q_DB), BUTTERWORTH_Q_LINEAR, 1e-12, 'dB -> linear');
    },
  },
  {
    name: 'Q: the conversion is the documented 20*log10, and NaN-safe',
    run: () => {
      // The spec's identity: for a lowpass, |H| at the cutoff in dB *is* the Q
      // value. So Q_linear = 1 must map to 0 dB, not to "no resonance".
      assertClose(linearQToDb(1), 0, 1e-12, 'Q_linear 1 is 0 dB');
      assertClose(linearQToDb(0.5), -6.0206, 1e-3, 'Q_linear 0.5 is -6 dB');
      assertClose(linearQToDb(2), 6.0206, 1e-3, 'Q_linear 2 is +6 dB');
      // The trap this guards: assigning 0.7071 straight to Q.value would give
      // Q_linear = 1.085 — a resonant bump where flat was intended.
      assert(
        Math.abs(linearQToDb(BUTTERWORTH_Q_LINEAR) - BUTTERWORTH_Q_LINEAR) > 3,
        'converted and unconverted values must be clearly different',
      );
      assert(Number.isFinite(linearQToDb(Number.NaN)), 'NaN -> finite fallback');
      assert(Number.isFinite(linearQToDb(0)), 'zero -> finite fallback (clamped, not -Infinity)');
      assert(Number.isFinite(linearQToDb(Infinity)), 'Infinity -> finite fallback');
    },
  },
  {
    name: 'cascade: neutral q reproduces the exact Butterworth alignment',
    run: () => {
      for (const stages of [1, 2, 3, 4]) {
        const qs = cascadeStageQsDb(stages, BUTTERWORTH_Q_LINEAR);
        const table = BUTTER_Q[stages * 2];
        assertEqual(qs.length, stages, `stage count for ${stages}`);
        for (let i = 0; i < stages; i++) {
          assertClose(qs[i], linearQToDb(table[i]), 1e-9, `stage ${i} of ${stages}`);
        }
      }
    },
  },
  {
    name: 'cascade: the sum of stage dB is -3.01, i.e. the corner is at freq',
    run: () => {
      // For a lowpass, each section's gain at f0 in dB equals its Q in dB, so
      // the cascade's gain at f0 is the sum. A real order-2n Butterworth is
      // -3.0103 dB at its corner whatever n is — which is the entire point of
      // staggering the Qs instead of using identical sections.
      for (const stages of [1, 2, 3, 4]) {
        const sum = cascadeStageQsDb(stages, BUTTERWORTH_Q_LINEAR).reduce((a, b) => a + b, 0);
        assertClose(sum, BUTTERWORTH_Q_DB, 2e-4, `cascade of ${stages} at its corner`);
      }
    },
  },
  {
    name: 'cascade: identical sections would NOT be -3 dB at the corner',
    run: () => {
      // The bug being avoided, stated as a test: n identical Butterworth
      // sections give -3.01n dB at the nominal cutoff, so a 3-stage cascade
      // would be 9 dB down where it claims to be 3 dB down.
      const naive = BUTTERWORTH_Q_DB * 3;
      assertClose(naive, -9.0309, 1e-3, 'three identical sections at f0');
      const actual = cascadeStageQsDb(3, BUTTERWORTH_Q_LINEAR).reduce((a, b) => a + b, 0);
      assert(
        Math.abs(actual - naive) > 5,
        `staggered (${actual.toFixed(2)} dB) must differ from naive (${naive.toFixed(2)} dB)`,
      );
    },
  },
  {
    name: 'cascade: resonance lands on the top section only, and is bounded',
    run: () => {
      const flat = cascadeStageQsDb(2, BUTTERWORTH_Q_LINEAR);
      const resonant = cascadeStageQsDb(2, 3); // `underwater`
      assertClose(resonant[0], flat[0], 1e-9, 'lower section untouched');
      assert(resonant[1] > flat[1] + 6, 'top section carries the resonance');
      for (const stages of [1, 2, 3, 4]) {
        for (const q of [0.1, 0.7071, 3, 8, 1e6, Number.NaN]) {
          for (const v of cascadeStageQsDb(stages, q)) {
            assert(Number.isFinite(v), `finite for stages=${stages} q=${q}`);
            assert(v <= 12 + 1e-9 && v >= -24 - 1e-9, `bounded: got ${v}`);
          }
        }
      }
    },
  },
  {
    name: 'cascade: out-of-range stage counts degrade instead of throwing',
    run: () => {
      for (const stages of [0, -3, 9, 2.4, Number.NaN]) {
        const qs = cascadeStageQsDb(stages, BUTTERWORTH_Q_LINEAR);
        assert(qs.length >= 1 && qs.length <= 4, `usable length for stages=${stages}`);
        for (const v of qs) assert(Number.isFinite(v), 'finite');
      }
    },
  },
];

/* ------------------------------------------------------------------ *
 * Output guard
 * ------------------------------------------------------------------ */

const guardTests: TestCase[] = [
  {
    name: 'guard: disengaged is the exact identity (DEFAULT_PARAMS stays transparent)',
    run: () => {
      const n = 2048;
      const curve = makeOutputGuardCurve(false, n);
      for (let i = 0; i < n; i++) {
        assertClose(curve[i], (i / (n - 1)) * 2 - 1, 1e-6, `identity at ${i}`);
      }
    },
  },
  {
    name: 'guard: engaged is linear below the knee and bounded above it',
    run: () => {
      const n = 4096;
      const curve = makeOutputGuardCurve(true, n);
      let maxAbs = 0;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        const y = curve[i];
        maxAbs = Math.max(maxAbs, Math.abs(y));
        if (Math.abs(x) <= OUTPUT_GUARD_KNEE) {
          assertClose(y, x, 1e-6, `linear below the knee at x=${x.toFixed(3)}`);
        } else {
          assert(Math.abs(y) < Math.abs(x) + 1e-6, `compressive above the knee at x=${x}`);
        }
      }
      // A WaveShaper clamps |x| > 1 to its endpoints, so this bound is the
      // absolute ceiling the output can reach however hot the input is.
      assert(
        maxAbs <= OUTPUT_GUARD_CEILING + 1e-6,
        `ceiling respected: max |y| was ${maxAbs}`,
      );
      assert(maxAbs > OUTPUT_GUARD_KNEE, 'and it is not over-attenuating');
    },
  },
  {
    name: 'guard: engaged curve is odd-symmetric and monotonic',
    run: () => {
      const n = 2049;
      const curve = makeOutputGuardCurve(true, n);
      for (let i = 0; i < n; i++) {
        assertClose(curve[i], -curve[n - 1 - i], 1e-6, `odd symmetry at ${i}`);
      }
      for (let i = 1; i < n; i++) {
        assert(curve[i] >= curve[i - 1] - 1e-7, `monotonic at ${i}`);
      }
    },
  },
];

/* ------------------------------------------------------------------ *
 * Capture device classification
 * ------------------------------------------------------------------ */

function device(label: string, groupId = 'g1'): CaptureDevice {
  const described = describeDevice(label);
  return {
    deviceId: `id-${label}`,
    label,
    likelyVirtual: isLikelyVirtual(label),
    passthrough: described.passthrough,
    groupId,
    note: described.note,
  };
}

const deviceTests: TestCase[] = [
  {
    name: 'devices: the virtual-device pattern matches what people actually install',
    run: () => {
      const virtual = [
        'BlackHole 2ch',
        'BlackHole 16ch',
        'VB-Cable',
        'VB-Audio Virtual Cable',
        'Loopback Audio',
        'Soundflower (2ch)',
        'Background Music',
        'Background Music (UI Sounds)',
        'Aggregate Device',
        'Multi-Output Device',
        'VoiceMeeter Output',
        'pipewire',
        'Monitor of Null Sink',
        'Existential Audio BlackHole',
      ];
      for (const label of virtual) {
        assert(isLikelyVirtual(label), `should be virtual: ${label}`);
      }
      const physical = ['MacBook Pro Microphone', 'Scarlett 2i2 USB', 'AirPods Pro'];
      for (const label of physical) {
        assert(!isLikelyVirtual(label), `should not be virtual: ${label}`);
      }
    },
  },
  {
    name: 'devices: passthrough classification is correct for the known hardware',
    run: () => {
      // Pure sinks: Spotify routed in is silent at the speakers. Ideal.
      for (const label of ['BlackHole 2ch', 'VB-Cable', 'Soundflower (2ch)']) {
        assertEqual(describeDevice(label).passthrough, 'none', label);
      }
      // Passthrough: the user would hear the original AND the dampened copy.
      for (const label of [
        'Background Music',
        'Background Music (UI Sounds)',
        'Loopback Audio',
        'Aggregate Device',
        'Multi-Output Device',
      ]) {
        assertEqual(describeDevice(label).passthrough, 'likely', label);
      }
      // Meeting-app devices are not system taps at all.
      for (const label of ['ZoomAudioDevice', 'LoomAudioDevice']) {
        assertEqual(describeDevice(label).passthrough, 'unknown', label);
        assert(describeDevice(label).note !== undefined, `${label} should carry advice`);
      }
      assertEqual(describeDevice('Scarlett 2i2 USB').passthrough, 'unknown', 'interface');
      assertEqual(describeDevice('Scarlett 2i2 USB').note, undefined, 'no advice for unknowns');
    },
  },
  {
    name: 'devices: every recognised device carries a usable note',
    run: () => {
      for (const label of ['BlackHole 2ch', 'Background Music', 'Loopback Audio']) {
        const note = describeDevice(label).note;
        assert(note !== undefined && note.length > 40, `${label}: note too short to help`);
      }
      for (const key of ['none-installed', 'microphone']) {
        assert(CAPTURE_DEVICE_NOTES[key].length > 40, `${key}: note too short`);
      }
    },
  },
  {
    name: 'devices: pickLikelyDevice prefers a pure sink over a passthrough',
    run: () => {
      const list = [device('MacBook Pro Microphone'), device('Background Music'), device('BlackHole 2ch')];
      assertEqual(pickLikelyDevice(list)?.label, 'BlackHole 2ch', 'pure sink wins');
      const noSink = [device('MacBook Pro Microphone'), device('Background Music')];
      assertEqual(pickLikelyDevice(noSink)?.label, 'Background Music', 'virtual beats physical');
      assertEqual(pickLikelyDevice([device('MacBook Pro Microphone')]), null, 'no virtual device');
      assertEqual(pickLikelyDevice([]), null, 'empty list');
    },
  },
];

/* ------------------------------------------------------------------ *
 * Feedback risk
 * ------------------------------------------------------------------ */

function output(groupId: string): MediaDeviceInfo {
  return {
    deviceId: `out-${groupId}`,
    groupId,
    kind: 'audiooutput',
    label: `Output ${groupId}`,
    toJSON: () => ({}),
  };
}

const feedbackTests: TestCase[] = [
  {
    name: 'feedback: a pure sink with a separate output is the safe case',
    run: () => {
      const a = assessFeedbackRisk(device('BlackHole 2ch', 'gBH'), [output('gSpeakers')]);
      assertEqual(a.risk, false, 'no risk');
      assertEqual(a.reason, 'none', 'reason');
      assertEqual(a.message, '', 'no message when there is no risk');
    },
  },
  {
    name: 'feedback: sharing a groupId with an output is the only howl case',
    run: () => {
      const a = assessFeedbackRisk(device('BlackHole 2ch', 'gSame'), [output('gSame')]);
      assertEqual(a.risk, true, 'risk');
      assertEqual(a.reason, 'same-device', 'reason');
      assert(a.message.length > 20, 'explains itself');
      // groupId takes priority over the (otherwise clean) passthrough verdict.
      const bm = assessFeedbackRisk(device('Background Music', 'gSame'), [output('gSame')]);
      assertEqual(bm.reason, 'same-device', 'the worse hazard wins');
    },
  },
  {
    name: 'feedback: a passthrough device is flagged even on a separate output',
    run: () => {
      const a = assessFeedbackRisk(device('Background Music', 'gBM'), [output('gSpeakers')]);
      assertEqual(a.risk, true, 'risk');
      assertEqual(a.reason, 'passthrough', 'reason');
      assert(/mute|BlackHole|through/i.test(a.message), 'tells the user what to do');
    },
  },
  {
    name: 'feedback: a real microphone is always a risk',
    run: () => {
      const a = assessFeedbackRisk(device('MacBook Pro Microphone', 'gMic'), [output('gSpeakers')]);
      assertEqual(a.risk, true, 'risk');
      assertEqual(a.reason, 'microphone', 'reason');
    },
  },
  {
    name: 'feedback: no device and no output list are both handled',
    run: () => {
      assertEqual(assessFeedbackRisk(null).risk, false, 'null device');
      assertEqual(assessFeedbackRisk(null, [output('g')]).risk, false, 'null device with outputs');
      // No output list means we cannot prove a same-device loop, but the
      // passthrough verdict still stands on its own.
      assertEqual(assessFeedbackRisk(device('BlackHole 2ch', 'gBH')).risk, false, 'sink, no outputs');
      assertEqual(
        assessFeedbackRisk(device('Background Music', 'gBM')).reason,
        'passthrough',
        'passthrough, no outputs',
      );
    },
  },
];

/* ------------------------------------------------------------------ *
 * Sample rate + policy
 * ------------------------------------------------------------------ */

function settings(sampleRate: number | null): CaptureStreamSettings {
  return { sampleRate, channelCount: 2, deviceId: 'x', label: 'x', latency: null };
}

const policyTests: TestCase[] = [
  {
    name: 'sampleRate: a reported rate is adopted, a missing one defers to the browser',
    run: () => {
      assertEqual(preferredContextSampleRate(settings(44100)), 44100, '44.1 kHz');
      assertEqual(preferredContextSampleRate(settings(48000)), 48000, '48 kHz');
      assertEqual(preferredContextSampleRate(settings(96000)), 96000, '96 kHz');
      // Safari and older Firefox do not report it; guessing would be worse
      // than letting the browser resample.
      assertEqual(preferredContextSampleRate(settings(null)), null, 'unreported');
    },
  },
  {
    name: 'sampleRate: nonsense rates are rejected, not passed to the constructor',
    run: () => {
      // `new AudioContext({sampleRate})` throws NotSupportedError for an
      // unsupported rate, which would take the whole engine down.
      for (const bad of [0, -48000, 7999, 192001, Number.NaN, Infinity]) {
        assertEqual(preferredContextSampleRate(settings(bad)), null, `rejects ${bad}`);
      }
      assertEqual(preferredContextSampleRate(settings(44100.4)), 44100, 'rounds');
    },
  },
  {
    name: 'policy: the capture path gets interactive latency, the others playback',
    run: () => {
      assertEqual(latencyHintFor('capture'), 'interactive', 'capture is the low-latency path');
      assertEqual(latencyHintFor('local'), 'playback', 'local prefers stability');
      assertEqual(latencyHintFor('spotify'), 'playback', 'spotify prefers stability');
    },
  },
  {
    name: 'policy: ambience is permitted only for local audio',
    run: () => {
      // Spotify Developer Policy III forbids overlapping Spotify Content with
      // any other audio content, so the bed is off wherever the audio could be
      // Spotify Content. This is enforced in the engine, not just the UI.
      assertEqual(ambienceAllowedFor('local'), true, 'the user’s own files');
      assertEqual(ambienceAllowedFor('capture'), false, 'OS tap of Spotify');
      assertEqual(ambienceAllowedFor('spotify'), false, 'Web Playback SDK');
    },
  },
  {
    name: 'CaptureError: carries a typed code and a cause, and is an Error',
    run: () => {
      const cause = new Error('underlying');
      const err = new CaptureError('permission-denied', 'nope', { cause });
      assert(err instanceof Error, 'is an Error');
      assert(err instanceof CaptureError, 'is a CaptureError');
      assertEqual(err.code, 'permission-denied', 'code');
      assertEqual(err.name, 'CaptureError', 'name');
      assertEqual(err.cause, cause, 'cause');
      // Callers must be able to branch on the code rather than parse strings.
      assertEqual(new CaptureError('device-lost', 'x').code, 'device-lost', 'device-lost');
    },
  },
];

export const CAPTURE_TESTS: readonly TestCase[] = [
  ...qTests,
  ...guardTests,
  ...deviceTests,
  ...feedbackTests,
  ...policyTests,
];
