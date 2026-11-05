import { LibraryIsland } from '@/components/library/LibraryIsland';
import { LibrarySheet } from '@/components/library/LibrarySheet';
import { EngineIsland } from '@/components/dampen/EngineIsland';
import { SettingsSheet } from '@/components/dampen/SettingsSheet';
import { PlayerIsland } from '@/components/player/PlayerIsland';
import { AccentDriver } from '@/components/ui/AccentDriver';
import { KeyboardLayer } from '@/components/ui/KeyboardLayer';
import { ShortcutsOverlay } from '@/components/ui/ShortcutsOverlay';
import { TopBar } from '@/components/ui/TopBar';

/**
 * Dampen.
 *
 * A Server Component that ships layout and nothing else. Two regions:
 *
 *   left   a quiet rail — search, four destinations, and the list they open
 *   right  one centred column — artwork, transport, the Dampen control
 *
 * Everything else is behind the sliders icon in the top-right corner.
 *
 * The behaviour lives in sibling client islands, not nested ones:
 *
 *   PlayerIsland   owns `usePlayback()`
 *   EngineIsland   owns `useDampen()`
 *   LibraryIsland  owns the Spotify Web API hooks
 *   SettingsSheet  owns its own copies, and only mounts while open
 *
 * A drag on the Dampen control and a 20 Hz meter tick therefore re-render
 * only their own island; the track list cannot see either. The little that
 * genuinely crosses between them goes through selector-based zustand
 * subscriptions in `components/ui/store.ts`.
 */
export default function Home() {
  return (
    <>
      <AccentDriver />
      <KeyboardLayer />

      <div className="flex h-dvh w-full overflow-hidden">
        <aside className="hidden w-[264px] shrink-0 border-r border-hairline lg:block">
          <LibraryIsland />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
            <div className="flex min-h-full flex-col items-center justify-center px-5 pb-10 pt-2">
              <div className="flex w-full max-w-[380px] flex-col items-center">
                <PlayerIsland />
                <div className="mt-10 w-full">
                  <EngineIsland />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <LibrarySheet />
      <SettingsSheet />
      <ShortcutsOverlay />
    </>
  );
}
