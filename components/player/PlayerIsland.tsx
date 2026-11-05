'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayback } from '@/lib/spotify/usePlayback';
import { clamp } from '@/components/ui/accent';
import { useUIStore } from '@/components/ui/store';
import { NowPlaying } from './NowPlaying';
import { Scrubber } from './Scrubber';
import { Transport } from './Transport';

/**
 * The playback island.
 *
 * The only caller of `usePlayback()` on the player screen, so position ticks
 * and device polling stay inside this boundary. The library reaches playback
 * through the store's action registry rather than taking a second
 * subscription.
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
  /* Empty seed means "no opinion": the accent falls back to a neutral, so an
     idle player is grey rather than tinted by a hash of nothing. */
  const accentSeed = track ? `${track.album.name} ${track.artists[0]?.name ?? ''}` : '';

  useEffect(() => {
    publishPlayback({ artworkUrl, accentSeed, currentUri, isPlaying });
  }, [artworkUrl, accentSeed, currentUri, isPlaying, publishPlayback]);

  /* Latest-value refs so the keyboard commands can seek and mute without
     re-registering on every position tick. */
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

  const idle = state === null;

  return (
    <>
      <NowPlaying
        track={track}
        idleLine={playback.isReady ? 'Pick something from your library' : 'Connecting'}
      />

      <Scrubber
        className="mt-8 w-full max-w-[380px]"
        position={state?.position ?? 0}
        durationMs={state?.durationMs ?? 0}
        onSeek={(ms) => void playback.seek(ms)}
        disabled={idle}
      />

      <Transport
        className="mt-5"
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
        disabled={idle}
      />
    </>
  );
}
