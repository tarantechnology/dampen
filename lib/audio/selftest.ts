/**
 * Dampen — browser-runnable self test.
 *
 * The same cases as `lib/audio/__tests__/run.ts`, but callable from the app (a
 * debug panel, a console one-liner) so that the Web Audio assertions actually
 * run against a real implementation rather than being skipped as they are in
 * Node.
 *
 * ```ts
 * import { runSelfTest, logSelfTest } from '@/lib/audio/selftest';
 * await logSelfTest();            // prints to the console
 * const report = await runSelfTest();
 * ```
 *
 * Deliberately side-effect free on import: nothing runs until it is called, so
 * including this module costs a few kB and no CPU.
 */

import { PURE_TESTS } from './__tests__/dsp.test';
import { CAPTURE_TESTS } from './__tests__/capture.test';
import { OFFLINE_TESTS } from './__tests__/offline.test';
import { formatReport, runCases, type TestReport } from './__tests__/harness';

export interface SelfTestReport {
  readonly pure: TestReport;
  readonly capture: TestReport;
  readonly offline: TestReport;
  readonly ok: boolean;
  /** Plain-text summary, ready to drop into a `<pre>`. */
  readonly text: string;
}

/** Run every suite and return a combined report. */
export async function runSelfTest(): Promise<SelfTestReport> {
  const pure = await runCases(PURE_TESTS);
  const capture = await runCases(CAPTURE_TESTS);
  const offline = await runCases(OFFLINE_TESTS);
  const text = [
    'pure DSP (no AudioContext)',
    formatReport(pure),
    '',
    'filters, guard, capture + policy',
    formatReport(capture),
    '',
    'Web Audio (OfflineAudioContext)',
    formatReport(offline),
  ].join('\n');
  return { pure, capture, offline, ok: pure.ok && capture.ok && offline.ok, text };
}

/** Run every suite and print it. Returns the report for further inspection. */
export async function logSelfTest(): Promise<SelfTestReport> {
  const report = await runSelfTest();
  // This function exists in order to print.
  console.log(report.text);
  return report;
}
