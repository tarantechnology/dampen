'use client';

import { useEffect, useRef } from 'react';
import type { Preset } from '@/lib/types';
import { cn } from '@/lib/cn';

export interface PresetChipsProps {
  presets: ReadonlyArray<Preset>;
  /** The selected preset id, or `null` for Off. */
  selectedId: string | null;
  onSelect(id: string | null): void;
  disabled?: boolean;
  className?: string;
}

/**
 * The character of the muffling, as a row of plain text chips.
 *
 * No cards, no glyphs, no descriptions, no emoji — a preset is a word. The
 * one-line blurb is available on hover and nowhere else. If the row runs
 * past the column it scrolls sideways with no visible scrollbar, and the
 * selected chip is scrolled back into view whenever it changes.
 */
export function PresetChips({
  presets,
  selectedId,
  onSelect,
  disabled = false,
  className,
}: PresetChipsProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [selectedId]);

  const chips: Array<{ id: string | null; name: string; blurb?: string }> = [
    { id: null, name: 'Off' },
    ...presets.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb })),
  ];

  return (
    <div
      className={cn(
        'no-scrollbar -mx-4 flex w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto px-4',
        className,
      )}
      style={{
        // Let the row admit that it continues, without drawing a scrollbar.
        maskImage:
          'linear-gradient(to right, transparent, #000 16px, #000 calc(100% - 16px), transparent)',
      }}
    >
      {chips.map((chip) => {
        const selected = chip.id === selectedId;
        return (
          <button
            key={chip.id ?? 'off'}
            ref={selected ? selectedRef : undefined}
            type="button"
            title={chip.blurb}
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onSelect(chip.id)}
            className={cn(
              'h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium',
              'transition-colors duration-150',
              'disabled:pointer-events-none disabled:opacity-40',
              selected
                ? 'bg-[var(--accent-soft)] text-accent'
                : 'text-t3 hover:bg-fill-1 hover:text-t2',
            )}
          >
            {chip.name}
          </button>
        );
      })}
    </div>
  );
}
