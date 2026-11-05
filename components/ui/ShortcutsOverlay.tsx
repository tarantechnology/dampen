'use client';

import { Keyboard } from 'lucide-react';
import { useUIStore } from './store';
import { SHORTCUTS, type ShortcutSpec } from './useShortcuts';
import { Sheet } from './Panel';
import { Tooltip } from './Tooltip';
import { Button } from './Button';

const GROUPS: Array<ShortcutSpec['group']> = ['Dampen', 'Playback', 'Navigation'];

export function ShortcutsOverlay() {
  const open = useUIStore((s) => s.shortcutsOpen);
  const setOpen = useUIStore((s) => s.setShortcutsOpen);

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard"
      description="Dampen is built to be played without the mouse. Bypass is one key, because A/B is the only way to actually hear the effect."
    >
      <div className="space-y-6">
        {GROUPS.map((group) => (
          <section key={group}>
            <h3 className="legend mb-2.5">{group}</h3>
            <ul className="space-y-1">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <li
                  key={s.description}
                  className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 odd:bg-white/[0.025]"
                >
                  <span className="text-[13px] text-ink-2">{s.description}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="num min-w-6 rounded-md border border-line-strong bg-white/[0.06] px-1.5 py-0.5 text-center text-[11px] font-semibold text-ink"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

/** The small persistent affordance that tells people the overlay exists. */
export function ShortcutsButton({ className }: { className?: string }) {
  const setOpen = useUIStore((s) => s.setShortcutsOpen);
  return (
    <Tooltip label="Keyboard shortcuts" shortcut="?" side="left">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Keyboard shortcuts"
        onClick={() => setOpen(true)}
        className={className}
      >
        <Keyboard className="size-4" />
      </Button>
    </Tooltip>
  );
}
