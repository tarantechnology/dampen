/**
 * Dampen — a deliberately tiny test harness.
 *
 * The project has no test runner installed and the brief forbids adding one,
 * so the suites are plain TypeScript that export data. That turns out to be a
 * feature: the exact same cases run
 *
 *  - in Node (`node_modules/.bin/jiti lib/audio/__tests__/run.ts`), and
 *  - in the browser (`lib/audio/selftest.ts`), where an `OfflineAudioContext`
 *    actually exists and the Web Audio assertions can run for real.
 *
 * No globals, no magic, no `describe`. A case is a name and a function that
 * throws.
 */

export interface TestCase {
  readonly name: string;
  /** Throw (or reject) to fail. Return/resolve to pass. */
  run: () => void | Promise<void>;
  /** When true the case is reported as skipped rather than run. */
  skip?: boolean;
  /** Why it was skipped. */
  skipReason?: string;
}

export interface TestResult {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'skip';
  readonly detail?: string;
  readonly ms: number;
}

export interface TestReport {
  readonly results: readonly TestResult[];
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly ok: boolean;
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

/**
 * Thrown to abandon a case as *skipped* rather than failed, once it is already
 * running.
 *
 * `TestCase.skip` is decided at module load, which is too early for anything
 * that depends on runtime state — "is the audio context actually running?"
 * can only be answered after the engine has started. Reporting such a case as
 * a failure would be wrong (nothing is broken) and silently passing it would
 * be worse (the assertion never ran).
 */
export class SkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkippedError';
  }
}

/** Abandon the running case as skipped. */
export function skipTest(reason: string): never {
  throw new SkippedError(reason);
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new AssertionError(message);
}

/** Absolute-tolerance float comparison. */
export function assertClose(actual: number, expected: number, tol: number, what: string): void {
  if (!Number.isFinite(actual)) {
    throw new AssertionError(`${what}: expected ~${expected}, got non-finite ${actual}`);
  }
  const d = Math.abs(actual - expected);
  if (d > tol) {
    throw new AssertionError(
      `${what}: expected ${expected} ± ${tol}, got ${actual} (off by ${d.toExponential(3)})`,
    );
  }
}

export function assertEqual<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) {
    throw new AssertionError(`${what}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

/**
 * Deterministic PRNG (mulberry32).
 *
 * The IR renderer takes an injectable `rng` precisely so these tests are
 * reproducible: asserting on noise seeded by `Math.random` would be a flaky
 * test, and a flaky DSP test gets muted and then the DSP breaks.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export async function runCases(cases: readonly TestCase[]): Promise<TestReport> {
  const results: TestResult[] = [];

  for (const c of cases) {
    if (c.skip) {
      results.push({ name: c.name, status: 'skip', detail: c.skipReason, ms: 0 });
      continue;
    }
    const t0 = now();
    try {
      await c.run();
      results.push({ name: c.name, status: 'pass', ms: now() - t0 });
    } catch (err) {
      if (err instanceof SkippedError) {
        results.push({ name: c.name, status: 'skip', detail: err.message, ms: now() - t0 });
        continue;
      }
      results.push({
        name: c.name,
        status: 'fail',
        detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        ms: now() - t0,
      });
    }
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  return { results, passed, failed, skipped, ok: failed === 0 };
}

/** Render a report as plain text (used by the Node runner and the UI). */
export function formatReport(report: TestReport): string {
  const lines = report.results.map((r) => {
    const mark = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'SKIP';
    const detail = r.detail ? `\n       ${r.detail}` : '';
    return `  ${mark}  ${r.name} (${r.ms.toFixed(1)} ms)${detail}`;
  });
  lines.push(
    '',
    `  ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped`,
  );
  return lines.join('\n');
}
