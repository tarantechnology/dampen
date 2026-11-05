/**
 * Dampen — Node entry point for the audio test suites.
 *
 * There is no test runner in this project's dependencies and the brief
 * forbids adding one, so this is a plain script. `jiti` is already present
 * (Next.js depends on it) and resolves TypeScript and extensionless imports,
 * so:
 *
 * ```sh
 * node_modules/.bin/jiti lib/audio/__tests__/run.ts
 * ```
 *
 * Node 22.6+ can also run it directly with `node --experimental-strip-types`,
 * but only if the import specifiers carry `.ts` extensions, which
 * `tsconfig.json` (no `allowImportingTsExtensions`) does not permit. `jiti` it
 * is.
 *
 * Exits non-zero if anything failed, so it is usable from CI as-is.
 */

import { formatReport, runCases } from './harness';
import { PURE_TESTS } from './dsp.test';
import { CAPTURE_TESTS } from './capture.test';
import { OFFLINE_TESTS } from './offline.test';

async function main(): Promise<void> {
  let failed = 0;

  for (const [title, cases] of [
    ['pure DSP (no AudioContext)', PURE_TESTS],
    ['filters, guard, capture + policy', CAPTURE_TESTS],
    ['Web Audio (OfflineAudioContext)', OFFLINE_TESTS],
  ] as const) {
    const report = await runCases(cases);
    console.log(`\n${title}\n${formatReport(report)}`);
    failed += report.failed;
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll audio tests passed.');
  }
}

void main();
