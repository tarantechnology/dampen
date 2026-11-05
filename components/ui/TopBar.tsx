'use client';

import { PanelLeft, SlidersHorizontal } from 'lucide-react';
import { IconButton } from './Button';
import { useUIStore } from './store';

/**
 * The only chrome on the player screen: a way to the library on a narrow
 * window, and a way to everything else.
 */
export function TopBar() {
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const setLibraryOpen = useUIStore((s) => s.setLibraryOpen);

  return (
    <div className="flex h-12 shrink-0 items-center justify-between px-3">
      <IconButton
        label="Show library"
        onClick={() => setLibraryOpen(true)}
        className="lg:invisible"
      >
        <PanelLeft size={18} strokeWidth={2} />
      </IconButton>

      <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
        <SlidersHorizontal size={18} strokeWidth={2} />
      </IconButton>
    </div>
  );
}
