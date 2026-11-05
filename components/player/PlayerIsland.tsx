'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayback } from '@/lib/spotify/usePlayback';
import { cn } from '@/lib/cn';
import { ShortcutsButton } from '@/components/ui/ShortcutsOverlay';
import { clamp } from '@/components/ui/accent';
import { useUIStore } from '@/components/ui/store';
import { AmbientBackdrop } from './AmbientBackdrop';
import { DevicePicker } from './DevicePicker';
import { NowPlaying } from './NowPlaying';
import { Transport } from './Transport';

/**
 * The playback island.
 *
 * It is the only caller of `usePlayback()`, so position ticks and device
 * polling stay inside this boundary. The library reaches playback through the
 * store's action registry (`playTrack`) rather than taking a second
 * subscription, and reads the current track's URI from the store — which only
 * changes when the track actually changes.
 *
 * Renders two grid items: the app header and the player column.
 */
export function PlayerIsland() {
  const playback = usePlayback();
  const state = playback.state;
  const track = state?.track ?? null;

  const [muted, setMuted] = useState(false);
  const volumeBeforeMute = useRef(0.7);

  const publishPlayback = useUIStore((s) => s.publishPlayback);
  const registerActions = useUIStore((s) => s.registerActions);

  const artworkUrl = track?.album.images[0]?.url ?? null;
  const currentUri = track?.uri ?? null;
  const isPlaying = state?.isPlaying ?? false;

  useEffect(() => {
    publishPlayback({ artworkUrl, currentUri, isPlaying });
  }, [artworkUrl, currentUri, isPlaying, publishPlayback]);

  // Latest-value refs so the keyboard commands can seek and mute without
  // re-registering on every position tick.
  const positionRef = useRef(0);
  const volumeRef = useRef(0.7);
  useEffect(() => {
    positionRef.current = state?.position ?? 0;
    if (typeof state?.volume === 'number') volumeRef.current = state.volume;
  }, [state?.position, state?.volume]);

  const onToggleMute = useCallback(() => {
    setMuted((wasMuted) => {
      if (wasMuted) {
        void playback.setVolume(volumeBeforeMute.current);
        return false;
      }
      volumeBeforeMute.current = volumeRef.current;
      void playback.setVolume(0);
      return true;
    });
  }, [playback]);

  const onVolume = useCallback(
    (v: number) => {
      setMuted(v === 0);
      void playback.setVolume(v);
    },
    [playback],
  );

  useEffect(() => {
    registerActions({
      togglePlay: () => void playback.toggle(),
      next: () => void playback.next(),
      previous: () => void playback.previous(),
      seekBy: (ms) =>
        void playback.seek(clamp(positionRef.current + ms, 0, state?.durationMs ?? 0)),
      toggleMute: onToggleMute,
      playTrack: (uris, contextUri, offset) =>
        void playback.play(contextUri ? { contextUri, offset } : { uris }),
    });
  }, [playback, registerActions, onToggleMute, state?.durationMs]);

  const contextLabel = state?.contextUri ? (state.deviceName ?? null) : null;

  return (
    <>
      <AmbientBackdrop
        images={track?.album.images ?? []}
        seed={track ? `${track.album.name} ${track.artists[0]?.name ?? ''}` : 'dampen'}
      />

      <header
        className={cn(
          'order-1 flex items-center justify-between gap-3',
          'xl:col-start-1 xl:col-end-4 xl:row-start-1',
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: 'var(--accent)', boxShadow: '0 0 14px var(--accent-glow)' }}
          />
          <span className="text-[13px] font-semibold uppercase tracking-[0.22em] text-ink">
            Dampen
          </span>
          <span className="hidden truncate text-[11.5px] text-ink-4 sm:block">
            music that stays behind you
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <DevicePicker
            devices={playback.devices}
            localDeviceId={playback.localDeviceId}
            activeDeviceName={state?.deviceName ?? null}
            onTransfer={(id) => void playback.transferTo(id)}
            onRefresh={() => void playback.refreshDevices()}
          />
          <ShortcutsButton />
        </div>
      </header>

      <div className="order-3 flex flex-col items-center gap-7 xl:col-start-2 xl:row-start-3">
        <NowPlaying
          track={track}
          position={state?.position ?? 0}
          durationMs={state?.durationMs ?? 0}
          isPlaying={isPlaying}
          isLoading={!playback.isReady && state === null}
          onSeek={(ms) => void playback.seek(ms)}
          contextLabel={contextLabel}
        />

        <Transport
          className="max-w-[460px]"
          isPlaying={isPlaying}
          shuffle={state?.shuffle ?? false}
          repeat={state?.repeat ?? 'off'}
          volume={state?.volume ?? 0.7}
          muted={muted}
          onToggle={() => void playback.toggle()}
          onNext={() => void playback.next()}
          onPrevious={() => void playback.previous()}
          onShuffle={(on) => void playback.setShuffle(on)}
          onCycleRepeat={() => void playback.cycleRepeat()}
          onVolume={onVolume}
          onToggleMute={onToggleMute}
          disabled={state === null}
        />
      </div>
    </>
  );
}
