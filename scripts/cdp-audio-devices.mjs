/**
 * Dampen — capture-device probe (path B).
 *
 * Asks a real Chrome what `navigator.mediaDevices.enumerateDevices()` returns,
 * then runs the same classification the app uses, so we can confirm path B is
 * actually wired before trusting the UI.
 *
 * This runs Chrome WITHOUT --headless on purpose: headless Chrome exposes no
 * real audio hardware, so a headless enumeration would be a false negative.
 * A window flashes open and is killed immediately.
 *
 *   node scripts/cdp-audio-devices.mjs
 */

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';

const PORT = 9334;
const PROFILE = '/tmp/dampen-audio-probe';
/*
 * Must be a real page on a secure origin. `navigator.mediaDevices` is gated to
 * secure contexts, and about:blank is an opaque origin — so probing there
 * reports mediaDevices as undefined, which looks exactly like "no devices".
 * http://127.0.0.1 qualifies under the loopback exception.
 */
const PAGE = process.env.DAMPEN_BASE ?? 'http://127.0.0.1:3000/';
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Kept in sync with lib/audio/capture.ts.
const VIRTUAL =
  /blackhole|vb-?cable|vb-?audio|loopback|soundflower|background music|virtual|aggregate|multi-?output|voicemeeter|pipewire|pulse|null sink|existential audio/i;
// Devices that also pass audio through to the real output: using one means
// hearing the raw source AND Dampen's output a few ms apart, which combs.
const PASSTHROUGH = /background music|loopback|multi-?output|aggregate/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpSend(ws, id, method, params = {}) {
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    setTimeout(() => reject(new Error(`${method} timed out`)), 30_000);
  });
}

async function main() {
  await rm(PROFILE, { recursive: true, force: true });

  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      // Auto-accept the mic prompt. Without permission, device LABELS come
      // back as empty strings and classification is impossible.
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=600,400',
      '--window-position=2400,2400', // shove it off-screen
      PAGE,
    ],
    { stdio: 'ignore' },
  );

  try {
    let version;
    for (let i = 0; i < 40; i++) {
      try {
        version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
        break;
      } catch {
        await sleep(500);
      }
    }
    if (!version) throw new Error('Chrome never exposed a debugging port');

    const target = await (
      await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' })
    ).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res) => ws.addEventListener('open', res, { once: true }));

    await cdpSend(ws, 1, 'Runtime.enable');
    // Give the page a moment to actually be on its origin before probing.
    await sleep(1500);

    const evalRes = await cdpSend(ws, 2, 'Runtime.evaluate', {
      expression: `(async () => {
        // Permission first, or every label is an empty string.
        let granted = false;
        try {
          const s = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          });
          granted = true;
          s.getTracks().forEach(t => t.stop());
        } catch (e) { /* report anyway */ }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        const info = {
          granted,
          sampleRate: ctx.sampleRate,
          baseLatency: ctx.baseLatency ?? null,
          outputLatency: ctx.outputLatency ?? null,
          inputs: devices.filter(d => d.kind === 'audioinput').map(d => ({ label: d.label, id: d.deviceId })),
          outputs: devices.filter(d => d.kind === 'audiooutput').map(d => ({ label: d.label })),
        };
        await ctx.close();
        return JSON.stringify(info);
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });

    if (evalRes.exceptionDetails) {
      console.error('page threw:', JSON.stringify(evalRes.exceptionDetails, null, 2).slice(0, 1200));
      process.exit(1);
    }
    const raw = evalRes.result?.value;
    if (typeof raw !== 'string') {
      console.error('unexpected evaluate result:', JSON.stringify(evalRes).slice(0, 1200));
      process.exit(1);
    }
    const info = JSON.parse(raw);

    console.log(`\nChrome: ${version.Browser}`);
    console.log(`Mic permission granted: ${info.granted}`);
    console.log(`AudioContext: ${info.sampleRate} Hz`);
    if (info.baseLatency !== null) {
      const base = info.baseLatency * 1000;
      const out = (info.outputLatency ?? 0) * 1000;
      console.log(
        `  baseLatency ${base.toFixed(2)} ms, outputLatency ${out.toFixed(2)} ms` +
          `, round trip ≈ ${(base + out).toFixed(1)} ms`,
      );
    }

    console.log(`\nAudio inputs (${info.inputs.length}):`);
    let blackhole = null;
    for (const d of info.inputs) {
      const virtual = VIRTUAL.test(d.label);
      const pass = PASSTHROUGH.test(d.label);
      const tags = [];
      if (virtual) tags.push('virtual');
      if (pass) tags.push('PASSTHROUGH — combs with Dampen output');
      if (/blackhole/i.test(d.label)) {
        tags.push('★ ideal for path B');
        blackhole = d;
      }
      console.log(`  ${d.label || '(no label)'}${tags.length ? `   [${tags.join(', ')}]` : ''}`);
    }

    console.log(`\nAudio outputs (${info.outputs.length}):`);
    for (const d of info.outputs) console.log(`  ${d.label || '(no label)'}`);

    console.log('\n=== path B verdict ===');
    if (blackhole) {
      console.log('  BlackHole is visible to the browser. Path B is ready.');
      console.log('  Next: set the Spotify desktop app output to BlackHole 2ch,');
      console.log('        then pick BlackHole as Dampen’s capture device.');
      process.exit(0);
    }
    console.log('  BlackHole is NOT visible to the browser yet.');
    console.log('  The driver is installed, but CoreAudio has not reloaded it.');
    console.log('  Fix: restart coreaudiod  ->  sudo killall coreaudiod');
    console.log('  (or log out and back in). Then re-run this probe.');
    process.exit(1);
  } finally {
    chrome.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
