'use client';

/**
 * Dampen — /selftest
 *
 * The DSP suite has two halves. The pure maths runs anywhere, including Node.
 * The Web Audio assertions need a real `OfflineAudioContext`, which Node does
 * not have, so under `npm test` those cases report as skipped.
 *
 * This route runs the whole suite in a browser, where nothing has to be
 * skipped. It also publishes the report on `window.__DAMPEN_SELFTEST__` so a
 * headless Chrome driver can read it and fail CI on a real regression.
 */

import { useCallback, useEffect, useState } from 'react';

import { runSelfTest, type SelfTestReport } from '@/lib/audio/selftest';

declare global {
  interface Window {
    __DAMPEN_SELFTEST__?: SelfTestReport | { error: string };
  }
}

export default function SelfTestPage() {
  const [report, setReport] = useState<SelfTestReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await runSelfTest();
      setReport(r);
      window.__DAMPEN_SELFTEST__ = r;
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setError(msg);
      window.__DAMPEN_SELFTEST__ = { error: msg };
    } finally {
      setRunning(false);
    }
  }, []);

  // Auto-run on mount: the driver just navigates and polls the global.
  useEffect(() => {
    void run();
  }, [run]);

  const counts = report
    ? [report.pure, report.capture, report.offline, report.browser].reduce(
        (a, r) => ({
          passed: a.passed + r.passed,
          failed: a.failed + r.failed,
          skipped: a.skipped + r.skipped,
        }),
        { passed: 0, failed: 0, skipped: 0 },
      )
    : null;

  return (
    <main style={{ padding: 24, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>Dampen self test</h1>
      <p style={{ opacity: 0.6, marginBottom: 16 }}>
        The full DSP suite, in a real browser, so the Web Audio cases run instead of skipping.
      </p>

      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        style={{ padding: '6px 14px', marginBottom: 16 }}
      >
        {running ? 'Running…' : 'Run again'}
      </button>

      {counts ? (
        <p data-testid="summary" style={{ marginBottom: 12 }}>
          {counts.passed} passed · {counts.failed} failed · {counts.skipped} skipped —{' '}
          <strong>{report?.ok ? 'OK' : 'FAILURES'}</strong>
        </p>
      ) : null}

      {error ? <pre style={{ color: '#c00' }}>{error}</pre> : null}
      {report ? <pre style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{report.text}</pre> : null}
    </main>
  );
}
