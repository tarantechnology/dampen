import { AccentDriver } from '@/components/player/AmbientBackdrop';
import { PlayerIsland } from '@/components/player/PlayerIsland';
import { LibraryIsland } from '@/components/library/LibraryIsland';
import { EngineIsland } from '@/components/dampen/EngineIsland';
import { KeyboardLayer } from '@/components/ui/KeyboardLayer';
import { ShortcutsOverlay } from '@/components/ui/ShortcutsOverlay';

/**
 * Dampen.
 *
 * This page is a Server Component and stays one: it ships layout and nothing
 * else. All the behaviour lives in three sibling client islands —
 *
 *   PlayerIsland   owns `usePlayback()`   (header + player column)
 *   EngineIsland   owns `useDampen()`     (source panel + console column)
 *   LibraryIsland  owns the Spotify Web API hooks (left rail)
 *
 * They are siblings rather than nested on purpose. A dial drag, a 20 Hz meter
 * tick and a seek-bar update all re-render only their own island; the track
 * list cannot see any of them. The little that genuinely crosses between them
 * (the accent amount, the current track URI, the keyboard command registry)
 * goes through selector-based zustand subscriptions in
 * `components/ui/store.ts`.
 *
 * Each island returns several grid items as a fragment. Placement is by grid
 * line at `xl`, and by `order-*` in the single-column stack below it, so DOM
 * adjacency never constrains the layout.
 */
export default function Home() {
  return (
    <>
      <AccentDriver />
      <KeyboardLayer />

      <div
        className={[
          'mx-auto grid min-h-dvh w-full max-w-[1680px] grid-cols-1 content-start gap-4 p-4',
          'xl:h-dvh xl:grid-cols-[320px_minmax(0,1fr)_minmax(340px,380px)]',
          'xl:grid-rows-[auto_auto_minmax(0,1fr)] xl:gap-5 xl:overflow-hidden xl:p-5',
        ].join(' ')}
      >
        <PlayerIsland />
        <EngineIsland />
        <LibraryIsland />
      </div>

      <ShortcutsOverlay />
    </>
  );
}
