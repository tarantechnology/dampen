'use client';

/**
 * React binding for the Web Playback SDK + Web API transport.
 *
 * Signature is fixed by docs/API_CONTRACT.md; `phase`, `unavailableReason` and
 * `error` are additive extras so the UI can explain *why* `isReady` is false
 * instead of just hiding the player.
 *
 * All the machinery lives in `./sdk-controller.ts` as a module-level singleton,
 * so this hook is thin: subscribe, reference-count, expose stable callbacks.
 */

import { useCallback, useEffect } from 'react';
import { useStore } from 'zustand';

import * as sdk from './sdk-controller';
import { authStore, premiumStatusOf } from './store';
import type { PlaybackState, SpotifyDevice } from './types';

export interface UsePlaybackResult {
  /** Null when no device is active. */
  state: PlaybackState | null;
  /** Our Web Playback SDK device id, once registered. */
  localDeviceId: string | null;
  isReady: boolean;
  /** True if playback is happening on OUR in-browser device. */
  isLocalDevice: boolean;
  devices: SpotifyDevice[];

  play(opts?: { uris?: string[]; contextUri?: string; offset?: number }): Promise<void>;
  pause(): Promise<void>;
  toggle(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(ms: number): Promise<void>;
  /** 0..1 */
  setVolume(v: number): Promise<void>;
  setShuffle(on: boolean): Promise<void>;
  cycleRepeat(): Promise<void>;
  transferTo(deviceId: string): Promise<void>;
  refreshDevices(): Promise<void>;

  /** Additive. Where the SDK got to. */
  phase: sdk.SdkPhase;
  /**
   * Additive. Why `isReady` is false. `'not_premium'` is the common one — the
   * Web Playback SDK is Premium-only, and a free account surfaces here rather
   * than as a thrown error or a console full of SDK complaints.
   */
  unavailableReason: sdk.UnavailableReason | null;
  /** Additive. Last non-fatal failure, user-facing. */
  error: string | null;
}

export function usePlayback(): UsePlaybackResult {
  const playback = useStore(sdk.playbackStore);
  const auth = useStore(authStore);

  const authStatus = auth.status;
  const premiumStatus = premiumStatusOf(auth);

  // Reference-count the polling and animation loops. The SDK connection itself
  // is intentionally left up across unmounts so the "Dampen" device does not
  // vanish from the user's Spotify app on every route change.
  useEffect(() => {
    sdk.acquire();
    return () => {
      sdk.release();
    };
  }, []);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    // Attempt the SDK when we know the account is Premium *or* when we cannot
    // tell. On post-Feb-2026 client IDs `/me` withholds `product`, so
    // 'unknown' is the normal case and the connect attempt is the only probe
    // available. `account_error` then settles it, quietly.
    void sdk.ensurePlayer(premiumStatus);
  }, [authStatus, premiumStatus]);

  const play = useCallback(
    (opts?: { uris?: string[]; contextUri?: string; offset?: number }): Promise<void> => sdk.play(opts ?? {}),
    [],
  );
  const pause = useCallback((): Promise<void> => sdk.pause(), []);
  const toggle = useCallback((): Promise<void> => sdk.toggle(), []);
  const next = useCallback((): Promise<void> => sdk.next(), []);
  const previous = useCallback((): Promise<void> => sdk.previous(), []);
  const seek = useCallback((ms: number): Promise<void> => sdk.seek(ms), []);
  const setVolume = useCallback((v: number): Promise<void> => sdk.setVolume(v), []);
  const setShuffle = useCallback((on: boolean): Promise<void> => sdk.setShuffle(on), []);
  const cycleRepeat = useCallback((): Promise<void> => sdk.cycleRepeat(), []);
  const transferTo = useCallback((deviceId: string): Promise<void> => sdk.transferTo(deviceId), []);
  const refreshDevices = useCallback((): Promise<void> => sdk.refreshDevices(), []);

  return {
    state: playback.state,
    localDeviceId: playback.localDeviceId,
    isReady: playback.isReady,
    isLocalDevice: playback.isLocalDevice,
    devices: playback.devices,
    phase: playback.phase,
    unavailableReason: playback.unavailableReason,
    error: playback.error,

    play,
    pause,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    setShuffle,
    cycleRepeat,
    transferTo,
    refreshDevices,
  };
}

export { LOCAL_DEVICE_NAME } from './sdk-controller';
export type { SdkPhase, UnavailableReason } from './sdk-controller';
