/**
 * The Web Playback SDK, wrapped in a module-level singleton.
 *
 * One player per page load, created lazily, surviving every remount. React
 * reads the state through `playbackStore`; it never touches `Spotify.Player`.
 *
 * Three things here are subtler than they look:
 *
 * 1. **Free accounts.** The SDK is Premium-only. On a free account it raises
 *    `account_error` and logs noisily, so we avoid constructing it at all when
 *    we already know the tier. Since Feb 2026 `GET /me` no longer returns
 *    `product` for newly registered client IDs, "we already know" is often
 *    false — so the SDK attempt *is* the probe, and its verdict is cached back
 *    into the auth store (`recordSdkVerdict`). Either way the outcome surfaces
 *    as `isReady: false` plus a reason, never a throw.
 *
 * 2. **Two sources of truth.** When audio is on our in-browser device the SDK
 *    pushes `player_state_changed` and we use that. When it is on the user's
 *    phone or desktop app the SDK goes silent (it emits a single `null` state),
 *    so we fall back to polling `GET /me/player` every 3 s — and only while the
 *    tab is visible, because a hidden tab polling Spotify forever is both rude
 *    and quota-expensive.
 *
 * 3. **Position.** Both sources give position in discrete jumps (per event, or
 *    per 3 s poll). A progress bar fed directly from that visibly stutters, so
 *    position is extrapolated from the last authoritative sample with rAF.
 */

import { createStore } from 'zustand/vanilla';

import * as api from './client';
import { describeError, isRetryable, type SpotifyError } from './errors';
import { mapSdkState, type RepeatMode } from './map';
import { recordSdkVerdict, resetToAnonymous } from './store';
import type { PlaybackState, SpotifyDevice } from './types';

const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';
export const LOCAL_DEVICE_NAME = 'Dampen';

/** How often to poll `/me/player` when playback is on someone else's device. */
const REMOTE_POLL_MS = 3_000;
/** The SDK script occasionally never fires its ready hook (blocked, offline). */
const SCRIPT_TIMEOUT_MS = 15_000;
/** Don't re-render for sub-frame position changes. */
const POSITION_EPSILON_MS = 16;

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export type SdkPhase = 'idle' | 'loading' | 'connecting' | 'ready' | 'unavailable';

export type UnavailableReason =
  /** Confirmed non-Premium account. The SDK cannot work, ever. */
  | 'not_premium'
  /** No Spotify session; sign in first. */
  | 'no_session'
  /** The script did not load — blocked by an extension, CSP, or offline. */
  | 'script_unavailable'
  /** Browser lacks what the SDK needs (EME / unsupported engine). */
  | 'unsupported_browser'
  /** Page is not a secure context, so EME is unavailable. */
  | 'insecure_context'
  /** The SDK connected and then dropped. */
  | 'disconnected';

export interface PlaybackStoreState {
  readonly phase: SdkPhase;
  readonly unavailableReason: UnavailableReason | null;
  readonly localDeviceId: string | null;
  readonly isReady: boolean;
  readonly isLocalDevice: boolean;
  readonly devices: SpotifyDevice[];
  readonly state: PlaybackState | null;
  /** Last non-fatal failure, user-facing. Cleared by the next success. */
  readonly error: string | null;
}

const INITIAL: PlaybackStoreState = {
  phase: 'idle',
  unavailableReason: null,
  localDeviceId: null,
  isReady: false,
  isLocalDevice: false,
  devices: [],
  state: null,
  error: null,
};

export const playbackStore = createStore<PlaybackStoreState>(() => INITIAL);

/* ------------------------------------------------------------------ *
 * Module state (deliberately outside the store — changes every frame)
 * ------------------------------------------------------------------ */

let player: Spotify.Player | null = null;
let scriptLoad: Promise<boolean> | null = null;
let connectAttempt: Promise<void> | null = null;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let rafHandle: number | null = null;
let visibilityBound = false;

/** Last authoritative position sample, used by the rAF extrapolator. */
let anchor = { positionMs: 0, atMs: 0, durationMs: 0, isPlaying: false };

/** Volume as the SDK reports it (0..1); the SDK omits volume from its state. */
let localVolume = 0.8;

/** Consumers currently mounted. Drives polling/rAF, not the connection. */
let subscribers = 0;

/** Error messages already logged, so a repeating fault logs once. */
const loggedErrors = new Set<string>();

function logOnce(scope: string, message: string): void {
  const key = `${scope}:${message}`;
  if (loggedErrors.has(key)) return;
  loggedErrors.add(key);
  console.warn(`[spotify/sdk] ${scope}: ${message}`);
}

/* ------------------------------------------------------------------ *
 * Script loading
 * ------------------------------------------------------------------ */

function loadSdkScript(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
  if (window.Spotify?.Player !== undefined) return Promise.resolve(true);
  if (scriptLoad !== null) return scriptLoad;

  scriptLoad = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // The SDK calls this global exactly once when it is ready. It must be
    // assigned before the script executes.
    window.onSpotifyWebPlaybackSDKReady = () => {
      finish(window.Spotify?.Player !== undefined);
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    if (existing !== null) {
      existing.addEventListener('error', () => finish(false), { once: true });
    } else {
      const script = document.createElement('script');
      script.src = SDK_SRC;
      script.async = true;
      script.addEventListener('error', () => finish(false), { once: true });
      document.head.appendChild(script);
    }

    // Belt and braces: an ad-blocker can drop the request without firing
    // `error`, leaving the ready hook never called.
    window.setTimeout(() => finish(window.Spotify?.Player !== undefined), SCRIPT_TIMEOUT_MS);
  });

  return scriptLoad;
}

/* ------------------------------------------------------------------ *
 * Connect
 * ------------------------------------------------------------------ */

function unavailable(reason: UnavailableReason, message: string | null = null): void {
  playbackStore.setState({
    phase: 'unavailable',
    unavailableReason: reason,
    isReady: false,
    error: message,
  });
}

/**
 * Bring up the player. Safe to call repeatedly — at most one attempt runs, and
 * a confirmed-unavailable state is not retried.
 *
 * `premium` is what the app currently believes: 'free' short-circuits (no
 * script, no console noise), 'unknown' attempts anyway because on post-Feb-2026
 * client IDs that is the only way to find out.
 */
export function ensurePlayer(premium: 'premium' | 'free' | 'unknown'): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  const current = playbackStore.getState();

  if (premium === 'free') {
    if (current.unavailableReason !== 'not_premium') unavailable('not_premium');
    return Promise.resolve();
  }
  if (current.unavailableReason === 'not_premium' || current.unavailableReason === 'unsupported_browser') {
    return Promise.resolve();
  }
  if (player !== null || connectAttempt !== null) return connectAttempt ?? Promise.resolve();

  // EME needs a secure context. `127.0.0.1` and `localhost` both qualify, so
  // this only trips on a plain-http LAN address or similar.
  if (window.isSecureContext !== true) {
    unavailable('insecure_context', 'In-browser playback needs HTTPS (or 127.0.0.1).');
    return Promise.resolve();
  }

  connectAttempt = (async () => {
    playbackStore.setState({ phase: 'loading', error: null, unavailableReason: null });

    const loaded = await loadSdkScript();
    const Constructor = window.Spotify?.Player;
    if (!loaded || Constructor === undefined) {
      unavailable('script_unavailable', 'Could not load the Spotify player.');
      return;
    }

    playbackStore.setState({ phase: 'connecting' });

    const instance = new Constructor({
      name: LOCAL_DEVICE_NAME,
      volume: localVolume,
      // Leave the OS media keys alone — Dampen has its own transport and the
      // user may be running other audio through the engine.
      enableMediaSession: false,
      getOAuthToken: (callback) => {
        void supplyToken(callback);
      },
    });

    attachListeners(instance);
    player = instance;

    let connected = false;
    try {
      connected = await instance.connect();
    } catch (thrown) {
      logOnce('connect', thrown instanceof Error ? thrown.message : String(thrown));
      connected = false;
    }

    if (!connected) {
      // `connect()` resolving false usually means the error listeners have
      // already fired with something more specific; don't clobber that.
      if (playbackStore.getState().phase !== 'unavailable') {
        unavailable('unsupported_browser', 'This browser could not start the Spotify player.');
      }
      detach(instance);
      player = null;
    }
  })().finally(() => {
    connectAttempt = null;
  });

  return connectAttempt;
}

/**
 * The SDK's token callback.
 *
 * Deliberately does NOT call back with an empty string on failure: the SDK
 * treats that as a bad token and re-enters `authentication_error` in a tight
 * loop. Leaving the callback un-invoked stalls this one connect attempt, which
 * is the quiet failure we want.
 */
async function supplyToken(callback: (token: string) => void): Promise<void> {
  const result = await api.fetchAccessToken();
  if (result.ok) {
    callback(result.value.accessToken);
    return;
  }
  if (result.error.kind === 'unauthorized') {
    unavailable('no_session', 'Sign in to Spotify to use in-browser playback.');
    resetToAnonymous();
    return;
  }
  logOnce('token', result.error.message);
  playbackStore.setState({ error: describeError(result.error) });
}

/* ------------------------------------------------------------------ *
 * Listeners
 * ------------------------------------------------------------------ */

interface Handlers {
  ready: (instance: Spotify.WebPlaybackInstance) => void;
  notReady: (instance: Spotify.WebPlaybackInstance) => void;
  stateChanged: (state: Spotify.PlaybackState | null) => void;
  initError: (error: Spotify.Error) => void;
  authError: (error: Spotify.Error) => void;
  accountError: (error: Spotify.Error) => void;
  playbackError: (error: Spotify.Error) => void;
  autoplayFailed: (error: Spotify.Error) => void;
}

const handlers = new WeakMap<Spotify.Player, Handlers>();

function attachListeners(instance: Spotify.Player): void {
  const set: Handlers = {
    ready: ({ device_id }) => {
      // Connecting at all proves the account is Premium — which is the only
      // reliable signal left now that `/me` withholds `product`.
      recordSdkVerdict('premium');
      playbackStore.setState({
        phase: 'ready',
        unavailableReason: null,
        isReady: true,
        localDeviceId: device_id,
        error: null,
      });
      // Our device exists but may not be the active one; poll until the SDK
      // tells us otherwise.
      startRemotePolling();
      void refreshDevices();
    },

    notReady: () => {
      playbackStore.setState({ isReady: false, isLocalDevice: false, phase: 'unavailable', unavailableReason: 'disconnected' });
      startRemotePolling();
    },

    stateChanged: (state) => {
      if (state === null) {
        // Playback left our device.
        playbackStore.setState({ isLocalDevice: false });
        startRemotePolling();
        return;
      }
      stopRemotePolling();
      void applySdkState(state);
    },

    initError: ({ message }) => {
      logOnce('initialization_error', message);
      unavailable('unsupported_browser', 'This browser cannot run the Spotify player.');
    },

    authError: ({ message }) => {
      logOnce('authentication_error', message);
      unavailable('no_session', 'Spotify rejected the session. Please sign in again.');
      resetToAnonymous();
    },

    accountError: ({ message }) => {
      // The authoritative "this is a free account" signal.
      logOnce('account_error', message);
      recordSdkVerdict('free');
      unavailable('not_premium');
      teardownPlayer();
    },

    playbackError: ({ message }) => {
      // Non-fatal: a single track failed to start (region lock, DRM hiccup).
      logOnce('playback_error', message);
      playbackStore.setState({ error: 'Spotify could not play that track.' });
    },

    autoplayFailed: () => {
      // Browsers block audio without a gesture. Surfaced, not logged as a bug.
      playbackStore.setState({ error: 'Press play — your browser blocked autoplay.' });
    },
  };

  instance.addListener('ready', set.ready);
  instance.addListener('not_ready', set.notReady);
  instance.addListener('player_state_changed', set.stateChanged);
  instance.addListener('initialization_error', set.initError);
  instance.addListener('authentication_error', set.authError);
  instance.addListener('account_error', set.accountError);
  instance.addListener('playback_error', set.playbackError);
  instance.addListener('autoplay_failed', set.autoplayFailed);

  handlers.set(instance, set);
}

function detach(instance: Spotify.Player): void {
  const set = handlers.get(instance);
  if (set === undefined) return;
  instance.removeListener('ready', set.ready);
  instance.removeListener('not_ready', set.notReady);
  instance.removeListener('player_state_changed', set.stateChanged);
  instance.removeListener('initialization_error', set.initError);
  instance.removeListener('authentication_error', set.authError);
  instance.removeListener('account_error', set.accountError);
  instance.removeListener('playback_error', set.playbackError);
  instance.removeListener('autoplay_failed', set.autoplayFailed);
  handlers.delete(instance);
}

/** Disconnect and forget the player. Used on logout and on `account_error`. */
export function teardownPlayer(): void {
  stopRemotePolling();
  stopInterpolation();
  const instance = player;
  player = null;
  if (instance === null) return;
  detach(instance);
  try {
    instance.disconnect();
  } catch (thrown) {
    logOnce('disconnect', thrown instanceof Error ? thrown.message : String(thrown));
  }
}

/** Full reset, including the store. Called from `logout()`. */
export function resetPlayback(): void {
  teardownPlayer();
  loggedErrors.clear();
  anchor = { positionMs: 0, atMs: 0, durationMs: 0, isPlaying: false };
  playbackStore.setState(INITIAL, true);
}

/* ------------------------------------------------------------------ *
 * State derivation
 * ------------------------------------------------------------------ */

async function applySdkState(sdkState: Spotify.PlaybackState): Promise<void> {
  // The SDK leaves volume out of its state object, so read it separately.
  if (player !== null) {
    try {
      const volume = await player.getVolume();
      if (Number.isFinite(volume)) localVolume = Math.min(1, Math.max(0, volume));
    } catch {
      // getVolume rejects if the player disconnected mid-call; keep the last value.
    }
  }

  const derived = mapSdkState(sdkState, LOCAL_DEVICE_NAME);
  const next: PlaybackState = { ...derived, volume: localVolume };

  setAnchor(next);
  playbackStore.setState({ state: next, isLocalDevice: true, isReady: true, phase: 'ready', error: null });
  syncInterpolation();
}

function applyRemoteState(remote: PlaybackState | null): void {
  if (remote === null) {
    anchor = { positionMs: 0, atMs: 0, durationMs: 0, isPlaying: false };
    playbackStore.setState({ state: null, isLocalDevice: false });
    stopInterpolation();
    return;
  }

  const localId = playbackStore.getState().localDeviceId;
  // `/me/player` names the device; if it is ours, the SDK is authoritative and
  // will have told us already — but a poll can land first after a transfer.
  const isLocal = localId !== null && remote.deviceName === LOCAL_DEVICE_NAME;

  setAnchor(remote);
  playbackStore.setState({ state: remote, isLocalDevice: isLocal });
  syncInterpolation();
}

function setAnchor(state: PlaybackState): void {
  anchor = {
    positionMs: state.position,
    atMs: now(),
    durationMs: state.durationMs,
    isPlaying: state.isPlaying,
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/* ------------------------------------------------------------------ *
 * Position interpolation
 * ------------------------------------------------------------------ */

function tick(): void {
  rafHandle = requestAnimationFrame(tick);

  if (!anchor.isPlaying) return;
  const current = playbackStore.getState().state;
  if (current === null) return;

  const elapsed = now() - anchor.atMs;
  const ceiling = anchor.durationMs > 0 ? anchor.durationMs : Number.POSITIVE_INFINITY;
  const projected = Math.min(ceiling, anchor.positionMs + elapsed);

  if (Math.abs(projected - current.position) < POSITION_EPSILON_MS) return;
  playbackStore.setState({ state: { ...current, position: Math.round(projected) } });
}

function startInterpolation(): void {
  if (rafHandle !== null) return;
  if (typeof requestAnimationFrame !== 'function') return;
  rafHandle = requestAnimationFrame(tick);
}

function stopInterpolation(): void {
  if (rafHandle === null) return;
  cancelAnimationFrame(rafHandle);
  rafHandle = null;
}

/** Run the rAF loop only when it can do something useful. */
function syncInterpolation(): void {
  const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
  if (subscribers > 0 && anchor.isPlaying && visible) startInterpolation();
  else stopInterpolation();
}

/* ------------------------------------------------------------------ *
 * Remote polling
 * ------------------------------------------------------------------ */

async function pollOnce(): Promise<void> {
  const result = await api.getPlaybackState();
  if (!result.ok) {
    if (result.error.kind === 'aborted') return;
    // A poll failure must not clear a working UI. Record it and keep the last
    // known state; the next tick may succeed. Transient faults (offline, 429,
    // 5xx) are expected on a 3-second timer and are not worth logging.
    if (!isRetryable(result.error)) logOnce('poll', result.error.message);
    playbackStore.setState({ error: describeError(result.error) });
    return;
  }
  playbackStore.setState({ error: null });
  applyRemoteState(result.value);
}

function startRemotePolling(): void {
  bindVisibility();
  if (pollTimer !== null) return;
  if (subscribers === 0) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

  void pollOnce();
  pollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    void pollOnce();
  }, REMOTE_POLL_MS);
}

function stopRemotePolling(): void {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function bindVisibility(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Catch up immediately rather than waiting out the interval.
      if (!playbackStore.getState().isLocalDevice) startRemotePolling();
      void refreshDevices();
    } else {
      stopRemotePolling();
    }
    syncInterpolation();
  });
}

/* ------------------------------------------------------------------ *
 * Subscriber accounting
 * ------------------------------------------------------------------ */

/**
 * Called by `usePlayback` on mount/unmount. The *connection* is intentionally
 * not torn down when the last consumer unmounts — the device should stay
 * visible in the user's Spotify app across a route change. Only the polling
 * and rAF loops are reference-counted.
 */
export function acquire(): void {
  subscribers += 1;
  bindVisibility();
  if (!playbackStore.getState().isLocalDevice) startRemotePolling();
  syncInterpolation();
}

export function release(): void {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers === 0) {
    stopRemotePolling();
    stopInterpolation();
  }
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

function fail(error: SpotifyError): void {
  if (error.kind === 'aborted') return;
  playbackStore.setState({ error: describeError(error) });
}

/** Run a Web API mutation, surface its error, then re-sync. */
async function command(run: () => Promise<import('./errors').Result<void>>): Promise<void> {
  const result = await run();
  if (!result.ok) {
    fail(result.error);
    return;
  }
  playbackStore.setState({ error: null });
  // Spotify needs a beat before `/me/player` reflects the change.
  if (!playbackStore.getState().isLocalDevice) {
    window.setTimeout(() => void pollOnce(), 350);
  }
}

function targetDeviceId(): string | undefined {
  const { isLocalDevice, localDeviceId } = playbackStore.getState();
  // Only pin the device when we are the active one; otherwise let Spotify
  // apply the command to whatever the user is actually listening on.
  return isLocalDevice && localDeviceId !== null ? localDeviceId : undefined;
}

export interface PlayArgs {
  readonly uris?: string[];
  readonly contextUri?: string;
  readonly offset?: number;
}

export async function play(args: PlayArgs = {}): Promise<void> {
  const { isLocalDevice, localDeviceId } = playbackStore.getState();
  const resuming = args.uris === undefined && args.contextUri === undefined;

  // Resuming on our own device: the SDK path avoids a network round-trip and
  // works even when `/me/player/play` would 404 for want of an active device.
  if (resuming && isLocalDevice && player !== null) {
    try {
      await player.resume();
      playbackStore.setState({ error: null });
      return;
    } catch (thrown) {
      logOnce('resume', thrown instanceof Error ? thrown.message : String(thrown));
    }
  }

  // Safari and iOS require a user gesture to unlock the SDK's media element.
  // `play()` is always called from a click, so this is the right moment.
  if (player !== null && localDeviceId !== null) {
    try {
      await player.activateElement();
    } catch {
      // Older SDK builds lack it, and it throws harmlessly when already active.
    }
  }

  await command(() =>
    api.play({
      uris: args.uris,
      contextUri: args.contextUri,
      offset: args.offset,
      // Starting fresh should land on our device if we have one.
      deviceId: localDeviceId ?? undefined,
    }),
  );
}

export async function pause(): Promise<void> {
  const { isLocalDevice } = playbackStore.getState();
  if (isLocalDevice && player !== null) {
    try {
      await player.pause();
      playbackStore.setState({ error: null });
      return;
    } catch (thrown) {
      logOnce('pause', thrown instanceof Error ? thrown.message : String(thrown));
    }
  }
  await command(() => api.pause(targetDeviceId()));
}

export async function toggle(): Promise<void> {
  const { isLocalDevice, state } = playbackStore.getState();
  if (isLocalDevice && player !== null) {
    try {
      await player.togglePlay();
      playbackStore.setState({ error: null });
      return;
    } catch (thrown) {
      logOnce('togglePlay', thrown instanceof Error ? thrown.message : String(thrown));
    }
  }
  if (state?.isPlaying === true) await pause();
  else await play();
}

export async function next(): Promise<void> {
  const { isLocalDevice } = playbackStore.getState();
  if (isLocalDevice && player !== null) {
    try {
      await player.nextTrack();
      return;
    } catch (thrown) {
      logOnce('nextTrack', thrown instanceof Error ? thrown.message : String(thrown));
    }
  }
  await command(() => api.skipNext(targetDeviceId()));
}

export async function previous(): Promise<void> {
  const { isLocalDevice } = playbackStore.getState();
  if (isLocalDevice && player !== null) {
    try {
      await player.previousTrack();
      return;
    } catch (thrown) {
      logOnce('previousTrack', thrown instanceof Error ? thrown.message : String(thrown));
    }
  }
  await command(() => api.skipPrevious(targetDeviceId()));
}

export async function seek(positionMs: number): Promise<void> {
  if (!Number.isFinite(positionMs) || positionMs < 0) return;
  const clamped = Math.round(positionMs);

  // Move the UI immediately; the authoritative update follows.
  const current = playbackStore.getState().state;
  if (current !== null) {
    const optimistic: PlaybackState = { ...current, position: clamped };
    setAnchor(optimistic);
    playbackStore.setState({ state: optimistic });
  }

  const { isLocalDevice } = playbackStore.getState();
  if (isLocalDevice && player !== null) {
    try {
      await player.seek(clamped);
      return;
    } catch (thrown) {
      logOnce('seek', thrown instanceof Error ? thrown.message : String(thrown));
    }
  }
  await command(() => api.seek(clamped, targetDeviceId()));
}

export async function setVolume(volume: number): Promise<void> {
  if (!Number.isFinite(volume)) return;
  const clamped = Math.min(1, Math.max(0, volume));
  localVolume = clamped;

  const current = playbackStore.getState().state;
  if (current !== null) playbackStore.setState({ state: { ...current, volume: clamped } });

  const { isLocalDevice } = playbackStore.getState();
  if (isLocalDevice && player !== null) {
    try {
      await player.setVolume(clamped);
      return;
    } catch (thrown) {
      logOnce('setVolume', thrown instanceof Error ? thrown.message : String(thrown));
    }
  }
  await command(() => api.setVolume(clamped, targetDeviceId()));
}

/**
 * Shuffle and repeat have no SDK equivalent — they are context-level settings,
 * so they always go through the Web API.
 */
export async function setShuffle(on: boolean): Promise<void> {
  const current = playbackStore.getState().state;
  if (current !== null) playbackStore.setState({ state: { ...current, shuffle: on } });
  await command(() => api.setShuffle(on, targetDeviceId()));
}

const REPEAT_CYCLE: readonly RepeatMode[] = ['off', 'context', 'track'];

export async function cycleRepeat(): Promise<void> {
  const current = playbackStore.getState().state;
  const index = current === null ? 0 : REPEAT_CYCLE.indexOf(current.repeat);
  const nextMode = REPEAT_CYCLE[(index + 1) % REPEAT_CYCLE.length] ?? 'off';

  if (current !== null) playbackStore.setState({ state: { ...current, repeat: nextMode } });
  await command(() => api.setRepeat(nextMode, targetDeviceId()));
}

export async function transferTo(deviceId: string): Promise<void> {
  if (deviceId.trim() === '') return;
  const result = await api.transferPlayback(deviceId, playbackStore.getState().state?.isPlaying ?? true);
  if (!result.ok) {
    fail(result.error);
    return;
  }
  playbackStore.setState({ error: null });

  const localId = playbackStore.getState().localDeviceId;
  if (deviceId === localId) {
    // The SDK will push a state shortly; stop polling so the two don't fight.
    playbackStore.setState({ isLocalDevice: true });
    stopRemotePolling();
  } else {
    playbackStore.setState({ isLocalDevice: false });
    startRemotePolling();
  }

  // Devices change as a result of a transfer; and give Spotify a moment.
  window.setTimeout(() => {
    void refreshDevices();
    if (!playbackStore.getState().isLocalDevice) void pollOnce();
  }, 400);
}

export async function refreshDevices(): Promise<void> {
  const result = await api.getDevices();
  if (!result.ok) {
    if (result.error.kind !== 'aborted') fail(result.error);
    return;
  }
  playbackStore.setState({ devices: result.value });
}
