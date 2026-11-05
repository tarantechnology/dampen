/**
 * Dampen — headless verification driver.
 *
 * Drives a real Chrome over the DevTools Protocol to do the things Node cannot:
 *
 *  1. Run the Web Audio half of the DSP suite (`/selftest`), which needs a real
 *     `OfflineAudioContext` and is skipped under `npm test`.
 *  2. Screenshot the UI at desktop and phone widths so layout regressions are
 *     visible rather than inferred.
 *  3. Collect console errors and failed network requests per page.
 *
 * No dependencies: Node 22 ships `fetch` and `WebSocket`. Chrome is launched as
 * a child process against a throwaway profile and killed on exit.
 *
 *   node scripts/cdp-verify.mjs [--base http://127.0.0.1:3000] [--out ./.verify]
 *
 * Exits non-zero if the self test reports failures or any page logs an error,
 * so it works as a CI gate as-is.
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = argOf('base', 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = argOf('out', '.verify');
const PORT = Number(argOf('port', '9333'));
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const PAGES = [
  { path: '/design', name: 'design', widths: [1440, 400] },
  { path: '/', name: 'app', widths: [1440, 400] },
];

/* ------------------------------------------------------------------ *
 * Tiny CDP client
 * ------------------------------------------------------------------ */

class CDP {
  #ws;
  #id = 0;
  #pending = new Map();
  #listeners = new Map();

  static async attach(wsUrl) {
    const c = new CDP();
    c.#ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      c.#ws.addEventListener('open', res, { once: true });
      c.#ws.addEventListener('error', () => rej(new Error('CDP socket failed')), { once: true });
    });
    c.#ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = c.#pending.get(msg.id);
        if (!p) return;
        c.#pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result ?? {});
        return;
      }
      for (const fn of c.#listeners.get(msg.method) ?? []) fn(msg.params);
    });
    return c;
  }

  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 30_000);
    });
  }

  on(method, fn) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(fn);
  }

  close() {
    this.#ws.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`${url} never became reachable`);
}

/* ------------------------------------------------------------------ *
 * Driver
 * ------------------------------------------------------------------ */

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  /*
   * Probe /selftest, not a UI route. The UI pages are frequently mid-edit and
   * a 500 there is a finding to report, not a reason to refuse to start.
   */
  try {
    const probe = await fetch(`${BASE}/selftest`);
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (e) {
    console.error(`Dev server not reachable at ${BASE} — ${e.message}`);
    console.error('Start it with:  npm run dev');
    process.exit(2);
  }

  const profile = join(OUT, 'chrome-profile');
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      // An AudioContext would otherwise stay suspended with no user gesture,
      // and every Web Audio assertion would hang rather than fail.
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1440,900',
      /*
       * CI runners have no usable sandbox for a non-root Chrome. Only add
       * this there — never weaken the sandbox on a developer's machine.
       */
      ...(process.env.CI
        ? [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            // CI has no sound card. Without a fake device, constructing a
            // live AudioContext can block forever rather than fail.
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--alsa-output-device=plug:default',
          ]
        : []),
    ],
    { stdio: 'ignore' },
  );

  const failures = [];
  let cdp;

  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);

    /* ---------------- 1. the self test ---------------- */
    {
      const target = await (
        await fetch(
          `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`${BASE}/selftest`)}`,
          { method: 'PUT' },
        )
      ).json();
      cdp = await CDP.attach(target.webSocketDebuggerUrl);

      const consoleErrors = [];
      cdp.on('Runtime.exceptionThrown', (p) =>
        consoleErrors.push(p.exceptionDetails?.exception?.description ?? 'exception'),
      );
      cdp.on('Runtime.consoleAPICalled', (p) => {
        if (p.type === 'error') {
          consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? '?').join(' '));
        }
      });
      await cdp.send('Runtime.enable');
      await cdp.send('Page.enable');

      /*
       * Poll, but tolerate an evaluate that never answers. OfflineAudioContext
       * rendering and worklet construction block the renderer's main thread,
       * so an individual Runtime.evaluate can hang well past any sane timeout.
       * A hung probe is not a failed run — just try again.
       */
      let report = null;
      for (let i = 0; i < 240; i++) {
        try {
          const { result } = await cdp.send('Runtime.evaluate', {
            expression: 'JSON.stringify(window.__DAMPEN_SELFTEST__ ?? null)',
            returnByValue: true,
          });
          if (result.value && result.value !== 'null') {
            report = JSON.parse(result.value);
            break;
          }
        } catch {
          /* renderer busy — retry */
        }
        await sleep(1000);
      }

      console.log('\n=== DSP self test (real browser) ===');
      if (!report) {
        console.log('  never reported — the page did not finish');
        failures.push('selftest did not report');
      } else if (report.error) {
        console.log(`  threw: ${report.error}`);
        failures.push(`selftest threw: ${report.error}`);
      } else {
        /*
         * Enumerate groups from the report rather than hardcoding a list.
         * A hardcoded list silently omitted the engine-integration suite,
         * which then failed the run with every printed group showing zero
         * failures — the most confusing possible output.
         */
        const groups = Object.entries(report).filter(
          ([, v]) => v && typeof v === 'object' && typeof v.passed === 'number',
        );
        for (const [label, r] of groups) {
          console.log(
            `  ${label.padEnd(22)} ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped`,
          );
        }
        if (!report.ok) failures.push('selftest reported failures');
        await writeFile(join(OUT, 'selftest.txt'), report.text ?? '', 'utf8');
        // Surface the individual failures, not just the count.
        for (const [, r] of groups) {
          for (const c of r.results ?? []) {
            if (c.status === 'fail') console.log(`    FAIL  ${c.name} — ${c.detail ?? ''}`);
          }
        }
      }
      if (consoleErrors.length) {
        console.log(`  console errors on /selftest: ${consoleErrors.length}`);
        consoleErrors.slice(0, 5).forEach((e) => console.log(`    ${e.slice(0, 180)}`));
        failures.push(`/selftest logged ${consoleErrors.length} console error(s)`);
      }
      cdp.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
    }

    /* ---------------- 2. screenshots + console per page ---------------- */
    console.log('\n=== pages ===');
    for (const page of PAGES) {
      const target = await (
        await fetch(
          `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + page.path)}`,
          { method: 'PUT' },
        )
      ).json();
      const c = await CDP.attach(target.webSocketDebuggerUrl);

      const errors = [];
      const netFails = [];
      c.on('Runtime.exceptionThrown', (p) =>
        errors.push(p.exceptionDetails?.exception?.description ?? 'exception'),
      );
      c.on('Runtime.consoleAPICalled', (p) => {
        if (p.type === 'error') {
          errors.push(p.args.map((a) => a.value ?? a.description ?? '?').join(' '));
        }
      });
      c.on('Network.loadingFailed', (p) => netFails.push(`${p.type} ${p.errorText}`));
      await c.send('Runtime.enable');
      await c.send('Network.enable');
      await c.send('Page.enable');
      await sleep(2500);

      const status = (await fetch(BASE + page.path)).status;
      if (status !== 200) {
        console.log(`  ${page.path} → HTTP ${status}`);
        failures.push(`${page.path} returned HTTP ${status}`);
      }

      for (const w of page.widths) {
        await c.send('Emulation.setDeviceMetricsOverride', {
          width: w,
          height: w < 600 ? 820 : 900,
          deviceScaleFactor: 2,
          mobile: w < 600,
        });
        await sleep(900);
        const { data } = await c.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
        });
        const file = join(OUT, `${page.name}-${w}.png`);
        await writeFile(file, Buffer.from(data, 'base64'));
        console.log(`  ${page.path.padEnd(10)} @${String(w).padEnd(5)} → ${file}`);
      }

      // Does the page have real styling, or did Tailwind silently not compile?
      /*
       * Is Tailwind actually compiled? Counting `cssRules.length` is a trap:
       * it only counts TOP-LEVEL rules, and Tailwind v4 nests everything
       * inside `@layer` blocks, so a fully-working 74 kB sheet reports ~96.
       * Test it functionally instead — mount a probe and ask whether the
       * utilities resolve.
       */
      const { result: styled } = await c.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.createElement('div');
          el.className = 'flex items-center gap-2 rounded-full';
          el.style.position = 'absolute';
          el.style.visibility = 'hidden';
          document.body.appendChild(el);
          const cs = getComputedStyle(el);
          const probe = {
            display: cs.display,
            alignItems: cs.alignItems,
            gap: cs.gap,
            borderRadius: cs.borderRadius,
          };
          el.remove();
          let bytes = 0;
          for (const s of document.styleSheets) {
            try { for (const r of s.cssRules) bytes += r.cssText.length } catch {}
          }
          return JSON.stringify({
            probe,
            bytes,
            bg: getComputedStyle(document.body).backgroundColor,
            tailwindWorks: probe.display === 'flex' && probe.alignItems === 'center',
          });
        })()`,
        returnByValue: true,
      });
      const st = JSON.parse(styled.value);
      console.log(
        `             tailwind ${st.tailwindWorks ? 'OK' : 'BROKEN'} ` +
          `(flex→${st.probe.display}, gap→${st.probe.gap}), ` +
          `${(st.bytes / 1024).toFixed(0)}kB css, body bg ${st.bg}`,
      );
      if (!st.tailwindWorks) {
        failures.push(
          `${page.path}: Tailwind utilities do not resolve (display computed as ` +
            `'${st.probe.display}' for class 'flex')`,
        );
      }

      if (errors.length) {
        console.log(`             ${errors.length} console error(s):`);
        errors.slice(0, 6).forEach((e) => console.log(`               ${e.slice(0, 200)}`));
        failures.push(`${page.path} logged ${errors.length} console error(s)`);
      }
      const realNetFails = netFails.filter((f) => !/ERR_ABORTED/.test(f));
      if (realNetFails.length) {
        console.log(`             ${realNetFails.length} failed request(s):`);
        realNetFails.slice(0, 6).forEach((f) => console.log(`               ${f}`));
      }

      c.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
    }
  } finally {
    chrome.kill('SIGTERM');
  }

  console.log('\n=== verdict ===');
  if (failures.length === 0) {
    console.log('  all checks passed');
    process.exit(0);
  }
  failures.forEach((f) => console.log(`  FAIL  ${f}`));
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
