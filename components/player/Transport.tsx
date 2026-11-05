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
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui/Button';
import { Slider } from '@/components/ui/Slider';

export interface TransportProps {
  isPlaying: boolean;
  shuffle: boolean;
  repeat: 'off' | 'track' | 'context';
  /** 0..1 */
  volume: number;
  muted: boolean;
  onToggle(): void;
  onNext(): void;
  onPrevious(): void;
  onShuffle(on: boolean): void;
  onCycleRepeat(): void;
  onVolume(value: number): void;
  onToggleMute(): void;
  disabled?: boolean;
  className?: string;
}

const REPEAT_LABEL: Record<TransportProps['repeat'], string> = {
  off: 'Repeat off',
  context: 'Repeat all',
  track: 'Repeat this track',
};

/**
 * Shuffle, previous, play, next, repeat — then volume, one row below and
 * half a step quieter. The same arrangement Apple Music uses, for the same
 * reason: only one of these controls is ever the one you came for.
 */
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
    <div className={cn('flex w-full flex-col items-center gap-4', className)}>
      <div className="flex items-center gap-2 sm:gap-3">
        <IconButton
          label="Shuffle"
          active={shuffle}
          disabled={disabled}
          onClick={() => onShuffle(!shuffle)}
          className={shuffle ? 'text-accent' : undefined}
        >
          <Shuffle size={16} strokeWidth={2.1} />
        </IconButton>

        <IconButton
          label="Previous track"
          disabled={disabled}
          onClick={onPrevious}
          className="size-11 text-t1"
        >
          <SkipBack size={21} strokeWidth={1.9} fill="currentColor" />
        </IconButton>

        <button
          type="button"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          disabled={disabled}
          onClick={onToggle}
          className={cn(
            'mx-1 flex size-[56px] items-center justify-center rounded-full bg-t1 text-invert',
            'transition-[transform,opacity] duration-150 active:scale-95',
            'disabled:pointer-events-none disabled:opacity-30',
          )}
        >
          {isPlaying ? (
            <Pause size={22} strokeWidth={0} fill="currentColor" />
          ) : (
            <Play size={22} strokeWidth={0} fill="currentColor" className="ml-[3px]" />
          )}
        </button>

        <IconButton
          label="Next track"
          disabled={disabled}
          onClick={onNext}
          className="size-11 text-t1"
        >
          <SkipForward size={21} strokeWidth={1.9} fill="currentColor" />
        </IconButton>

        <IconButton
          label={REPEAT_LABEL[repeat]}
          active={repeat !== 'off'}
          disabled={disabled}
          onClick={onCycleRepeat}
          className={repeat !== 'off' ? 'text-accent' : undefined}
        >
          {repeat === 'track' ? (
            <Repeat1 size={16} strokeWidth={2.1} />
          ) : (
            <Repeat size={16} strokeWidth={2.1} />
          )}
        </IconButton>
      </div>

      <div className="flex w-full max-w-[260px] items-center gap-2.5">
        <IconButton
          label={muted ? 'Unmute' : 'Mute'}
          onClick={onToggleMute}
          disabled={disabled}
          className="size-7 text-t3 hover:bg-transparent"
        >
          <VolumeIcon size={15} strokeWidth={2} />
        </IconButton>
        <Slider
          label="Volume"
          min={0}
          max={1}
          value={muted ? 0 : volume}
          onChange={onVolume}
          valueText={`${Math.round((muted ? 0 : volume) * 100)} percent`}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
