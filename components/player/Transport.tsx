'use client';

import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { PlaybackState } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { RoundButton } from '@/components/ui/Button';
import { Slider } from '@/components/ui/Slider';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatPercent } from '@/components/ui/format';

export interface TransportProps {
  isPlaying: boolean;
  shuffle: boolean;
  repeat: PlaybackState['repeat'];
  /** 0..1 */
  volume: number;
  muted: boolean;
  onToggle(): void;
  onNext(): void;
  onPrevious(): void;
  onShuffle(on: boolean): void;
  onCycleRepeat(): void;
  onVolume(v: number): void;
  onToggleMute(): void;
  /** No active device yet — everything but the volume fader is inert. */
  disabled?: boolean;
  className?: string;
}

const REPEAT_LABEL: Record<PlaybackState['repeat'], string> = {
  off: 'Repeat off',
  context: 'Repeat playlist',
  track: 'Repeat this track',
};

export function Transport({
  isPlaying,
  shuffle,
  repeat,
  volume,
  muted,
  onToggle,
  onNext,
  onPrevious,
  onShuffle,
  onCycleRepeat,
  onVolume,
  onToggleMute,
  disabled = false,
  className,
}: TransportProps) {
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center gap-5 sm:flex-row sm:justify-between',
        className,
      )}
    >
      {/* Left: modes. On a phone these sit under the main row. */}
      <div className="order-2 flex items-center gap-1.5 sm:order-1 sm:w-32">
        <Tooltip label={shuffle ? 'Shuffle on' : 'Shuffle off'}>
          <RoundButton
            diameter={36}
            active={shuffle}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            disabled={disabled}
            onClick={() => onShuffle(!shuffle)}
          >
            <Shuffle className="size-4" aria-hidden />
          </RoundButton>
        </Tooltip>
        <Tooltip label={REPEAT_LABEL[repeat]}>
          <RoundButton
            diameter={36}
            active={repeat !== 'off'}
            aria-label={REPEAT_LABEL[repeat]}
            disabled={disabled}
            onClick={onCycleRepeat}
          >
            {repeat === 'track' ? (
              <Repeat1 className="size-4" aria-hidden />
            ) : (
              <Repeat className="size-4" aria-hidden />
            )}
          </RoundButton>
        </Tooltip>
      </div>

      {/* Centre: the three that matter. */}
      <div className="order-1 flex items-center gap-3 sm:order-2">
        <Tooltip label="Previous">
          <RoundButton
            diameter={46}
            aria-label="Previous track"
            disabled={disabled}
            onClick={onPrevious}
          >
            <SkipBack className="size-5" aria-hidden />
          </RoundButton>
        </Tooltip>

        <Tooltip label={isPlaying ? 'Pause' : 'Play'} shortcut="Space">
          <button
            type="button"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            disabled={disabled}
            onClick={onToggle}
            className={cn(
              'relative flex size-16 shrink-0 items-center justify-center rounded-full',
              'text-ground transition-transform duration-150 active:scale-[0.95]',
              'disabled:pointer-events-none disabled:opacity-35',
            )}
            style={{
              background: 'linear-gradient(160deg, var(--accent), var(--accent-hot))',
              boxShadow: '0 10px 30px -10px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.3)',
            }}
          >
            {isPlaying ? (
              <Pause className="size-7" strokeWidth={2.4} aria-hidden />
            ) : (
              <Play className="size-7 translate-x-[2px]" strokeWidth={2.4} aria-hidden />
            )}
          </button>
        </Tooltip>

        <Tooltip label="Next">
          <RoundButton
            diameter={46}
            aria-label="Next track"
            disabled={disabled}
            onClick={onNext}
          >
            <SkipForward className="size-5" aria-hidden />
          </RoundButton>
        </Tooltip>
      </div>

      {/* Right: volume. */}
      <div className="order-3 flex w-full items-center gap-2.5 sm:w-32">
        <Tooltip label={muted ? 'Unmute' : 'Mute'} shortcut="M">
          <RoundButton
            diameter={32}
            aria-label={muted ? 'Unmute' : 'Mute'}
            aria-pressed={muted}
            onClick={onToggleMute}
            className={muted ? 'text-ink-4' : undefined}
          >
            <VolumeIcon className="size-4" aria-hidden />
          </RoundButton>
        </Tooltip>
        <Slider
          compact
          className="flex-1"
          label="Volume"
          value={muted ? 0 : volume}
          min={0}
          max={1}
          step={0.01}
          format={(v) => formatPercent(v)}
          onChange={onVolume}
        />
      </div>
    </div>
  );
}
