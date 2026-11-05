'use client';

import { Sheet } from './Sheet';
import { Group, GroupLabel } from './Rows';
import { useUIStore } from './store';
import { SHORTCUTS } from './useShortcuts';

const GROUPS = ['Playback', 'Dampen', 'Navigation'] as const;

/** The `?` list. One sheet, three groups, a key cap per row. */
export function ShortcutsOverlay() {
  const open = useUIStore((s) => s.shortcutsOpen);
  const setOpen = useUIStore((s) => s.setShortcutsOpen);

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      width={380}
    >
      <div className="flex flex-col gap-6 pt-1">
        {GROUPS.map((group) => (
          <section key={group} className="flex flex-col gap-2">
            <GroupLabel>{group}</GroupLabel>
            <Group>
              {SHORTCUTS.filter((s) => s.group === group).map((shortcut) => (
                <div
                  key={shortcut.description}
                  className="flex min-h-[44px] items-center gap-3 px-3.5 py-2.5"
                >
                  <span className="min-w-0 flex-1 text-[14px] text-t1">
                    {shortcut.description}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="num inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] bg-fill-2 px-1.5 text-[11.5px] font-medium text-t2"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </Group>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
