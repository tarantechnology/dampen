'use client';

import { Sheet } from '@/components/ui/Sheet';
import { useUIStore } from '@/components/ui/store';
import { LibraryIsland } from './LibraryIsland';

/**
 * The sidebar, for windows too narrow to hold one.
 *
 * It only mounts while open, so below the two-column breakpoint there is
 * still exactly one `LibraryIsland` in the tree and exactly one set of
 * Spotify subscriptions.
 */
export function LibrarySheet() {
  const open = useUIStore((s) => s.libraryOpen);
  const setOpen = useUIStore((s) => s.setLibraryOpen);

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="Library"
      side="left"
      width={330}
      bodyClassName="min-h-0 flex-1 overflow-hidden"
    >
      {open ? <LibraryIsland showBrand={false} className="bg-bg" /> : null}
    </Sheet>
  );
}
