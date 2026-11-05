/**
 * Dampen — AudioWorklet module loading.
 *
 * The three processors in `public/worklets/` are loaded **by URL**, not
 * bundled: `audioWorklet.addModule()` takes a URL, the worklet global scope
 * has no module resolution, and Turbopack has no business rewriting a file
 * that is evaluated in a different realm. They are therefore plain `.js` under
 * `public/`, served at `/worklets/*.js`.
 *
 * ## Why this file is more than a one-liner
 *
 * `addModule()` fails for reasons that are entirely outside our control:
 *
 *  - `AudioWorklet` is missing (older Safari, locked-down WebViews);
 *  - the page is not a secure context, so `audioWorklet` is undefined;
 *  - the fetch 404s or is blocked by a CSP that forbids `worker-src`;
 *  - the module throws while being evaluated.
 *
 * None of those are a reason to have no music player. So loading is
 * **advisory**: the result reports which processors are available, and the
 * engine builds its graph around whatever it got, neutralising the stages it
 * cannot run. Nothing here ever rejects.
 */

/** The processor names registered by the files in `public/worklets/`. */
export type WorkletName = 'dampen-bitcrush' | 'dampen-wowflutter' | 'dampen-noise';

interface WorkletSpec {
  readonly name: WorkletName;
  readonly url: string;
}

const SPECS: readonly WorkletSpec[] = [
  { name: 'dampen-bitcrush', url: '/worklets/bitcrush-processor.js' },
  { name: 'dampen-wowflutter', url: '/worklets/wowflutter-processor.js' },
  { name: 'dampen-noise', url: '/worklets/noise-processor.js' },
] as const;

export interface WorkletStatus {
  /** True only if every processor loaded. */
  readonly allLoaded: boolean;
  /** True if `ctx.audioWorklet` existed at all. */
  readonly supported: boolean;
  /** Per-processor availability. Check this before constructing a node. */
  readonly loaded: Readonly<Record<WorkletName, boolean>>;
  /** Human-readable failures, for logging and the UI's diagnostics panel. */
  readonly errors: readonly string[];
}

const NONE_LOADED: Readonly<Record<WorkletName, boolean>> = {
  'dampen-bitcrush': false,
  'dampen-wowflutter': false,
  'dampen-noise': false,
};

function unsupported(reason: string): WorkletStatus {
  return { allLoaded: false, supported: false, loaded: { ...NONE_LOADED }, errors: [reason] };
}

/**
 * One in-flight/settled promise per `AudioContext`.
 *
 * Keyed by context because `addModule` installs into a *specific* worklet
 * global scope — a module loaded into context A is not available in context B.
 * A `WeakMap` means a disposed context and its cached status are collected
 * together.
 */
const cache = new WeakMap<BaseAudioContext, Promise<WorkletStatus>>();

function describeError(url: string, err: unknown): string {
  if (err instanceof Error) return `${url}: ${err.name}: ${err.message}`;
  return `${url}: ${String(err)}`;
}

async function load(ctx: BaseAudioContext): Promise<WorkletStatus> {
  const worklet: AudioWorklet | undefined = ctx.audioWorklet;
  if (!worklet || typeof worklet.addModule !== 'function') {
    return unsupported(
      'AudioWorklet is unavailable (needs a secure context and a modern engine). ' +
        'Bitcrush, wow/flutter and the ambience bed will be disabled.',
    );
  }

  const loaded: Record<WorkletName, boolean> = { ...NONE_LOADED };
  const errors: string[] = [];

  // Load in parallel: three independent fetches, and one failing must not
  // prevent the others from being available.
  await Promise.all(
    SPECS.map(async (spec) => {
      try {
        await worklet.addModule(spec.url);
        loaded[spec.name] = true;
      } catch (err) {
        errors.push(describeError(spec.url, err));
      }
    }),
  );

  const allLoaded = SPECS.every((s) => loaded[s.name]);
  return { allLoaded, supported: true, loaded, errors };
}

/**
 * The `workletsReady` promise for a context: resolves (never rejects) once
 * every module has either loaded or definitively failed.
 *
 * Memoised per context, so calling it from several places — the engine's
 * graph build, the ambience bed, a diagnostics panel — costs one set of
 * fetches. Call it and `await` it before constructing any `AudioWorkletNode`;
 * constructing one for an unregistered name throws `InvalidStateError`.
 */
export function workletsReady(ctx: BaseAudioContext): Promise<WorkletStatus> {
  const existing = cache.get(ctx);
  if (existing) return existing;
  // `load` is written so that it cannot reject, but belt-and-braces: a
  // rejected cached promise would be an unrecoverable sticky failure.
  const p = load(ctx).catch((err: unknown) => unsupported(describeError('audioWorklet', err)));
  cache.set(ctx, p);
  return p;
}

/** Forget the memoised status for a context (used by `DampenEngine.dispose`). */
export function forgetWorklets(ctx: BaseAudioContext): void {
  cache.delete(ctx);
}

/**
 * Convenience guard. Constructing an `AudioWorkletNode` whose processor never
 * registered throws, so every call site asks this first.
 */
export function canUse(status: WorkletStatus, name: WorkletName): boolean {
  return status.supported && status.loaded[name];
}
