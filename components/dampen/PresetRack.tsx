'use client';

import { memo, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { Preset } from '@/lib/types';
import { cn } from '@/lib/cn';

export interface PresetRackProps {
  presets: Preset[];
  selectedId: string;
  onSelect(id: string): void;
  /** Dimmed while bypassed — the rack is still usable, just not audible. */
  muted?: boolean;
  className?: string;
}

/**
 * Eight cards, 1–8 on the keyboard.
 *
 * Selection is meant to feel physical: the chosen card sits *into* the rack
 * (inset shadow, one pixel down) while the unselected ones sit proud, and a
 * single shared highlight slides between them rather than cross-fading.
 */
export const PresetRack = memo(function PresetRack({
  presets,
  selectedId,
  onSelect,
  muted = false,
  className,
}: PresetRackProps) {
  const reduce = useReducedMotion();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    // The rack is a 2-column grid on narrow screens and 4 on wide; stepping
    // by 1 for left/right and by 2 for up/down works at both.
    const delta =
      e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowDown'
            ? 2
            : e.key === 'ArrowUp'
              ? -2
              : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = (index + delta + presets.length) % presets.length;
    onSelect(presets[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Dampen presets"
      className={cn(
        'grid grid-cols-2 gap-2 transition-opacity duration-200',
        muted && 'opacity-55',
        className,
      )}
    >
      {presets.map((preset, i) => {
        const selected = preset.id === selectedId;
        return (
          <button
            key={preset.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(preset.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'group relative flex min-h-[86px] flex-col items-start gap-1 overflow-hidden rounded-xl border p-2.5 text-left',
              'transition-[border-color,background-color,transform] duration-150',
              selected
                ? 'translate-y-px border-accent/45'
                : 'border-line bg-white/[0.025] hover:border-white/18 hover:bg-white/[0.055]',
            )}
            style={
              selected
                ? {
                    background: 'var(--accent-wash)',
                    boxShadow:
                      'inset 0 2px 6px -1px rgba(0,0,0,0.55), inset 0 0 0 1px var(--accent-wash)',
                  }
                : undefined
            }
          >
            {selected ? (
              <motion.span
                layoutId="preset-glow"
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -bottom-6 h-10 blur-xl"
                style={{ background: 'var(--accent-glow)' }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 460, damping: 36, mass: 0.6 }
                }
              />
            ) : null}

            <span className="relative flex w-full items-center justify-between gap-2">
              <span
                aria-hidden
                className="font-sans text-[17px] leading-none"
                style={{ color: selected ? 'var(--accent)' : 'var(--ink-3)' }}
              >
                {preset.glyph}
              </span>
              <kbd
                className={cn(
                  'num rounded border px-1 text-[9.5px] font-semibold',
                  selected
                    ? 'border-accent/40 text-accent'
                    : 'border-line text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
                )}
              >
                {i + 1}
              </kbd>
            </span>

            <span className="relative mt-0.5 block w-full truncate text-[12.5px] font-semibold text-ink">
              {preset.name}
            </span>
            <span className="relative line-clamp-2 text-[10.5px] leading-snug text-ink-4">
              {preset.blurb}
            </span>
          </button>
        );
      })}
    </div>
  );
});
