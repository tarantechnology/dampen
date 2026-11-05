'use client';

import { useEffect, useRef } from 'react';
import { ChevronLeft, Clock, Heart, ListMusic, Search, TrendingUp } from 'lucide-react';
import type { AuthStatus, SpotifyUser } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import type { LibraryView } from '@/components/ui/store';

const NAV: ReadonlyArray<{
  view: LibraryView;
  label: string;
  Icon: typeof ListMusic;
}> = [
  { view: 'playlists', label: 'Playlists', Icon: ListMusic },
  { view: 'liked', label: 'Liked', Icon: Heart },
  { view: 'recent', label: 'Recent', Icon: Clock },
  { view: 'top', label: 'Top', Icon: TrendingUp },
];

export interface SidebarProps {
  view: LibraryView;
  onViewChange(view: LibraryView): void;
  query: string;
  onQueryChange(query: string): void;
  /** Bumped by the `/` shortcut; focuses the field. */
  focusNonce: number;
  /** Set while a playlist is open, so the list can be backed out of. */
  openTitle: string | null;
  onBack(): void;
  user: SpotifyUser | null;
  authStatus: AuthStatus;
  onLogin(): void;
  /** Shown without a brand mark when the sidebar is a sheet. */
  showBrand?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * The quiet rail: a name, a search field, four destinations, and whatever
 * list those produce. No counts, no badges, no section headings in caps.
 */
export function Sidebar({
  view,
  onViewChange,
  query,
  onQueryChange,
  focusNonce,
  openTitle,
  onBack,
  user,
  authStatus,
  onLogin,
  showBrand = true,
  children,
  className,
}: SidebarProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusNonce > 0) searchRef.current?.focus();
  }, [focusNonce]);

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col bg-sunken', className)}>
      {showBrand ? (
        <div className="px-4 pb-1 pt-5">
          <span className="text-[17px] font-semibold tracking-[-0.015em] text-t1">
            Dampen
          </span>
        </div>
      ) : null}

      <div className="px-3 pb-2 pt-3">
        <div className="relative">
          <Search
            size={15}
            strokeWidth={2.2}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-t3"
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search"
            aria-label="Search your library"
            onChange={(e) => onQueryChange(e.target.value)}
            className={cn(
              'h-9 w-full rounded-[10px] bg-fill-1 pl-8 pr-3 text-[13.5px] text-t1',
              'placeholder:text-t3 focus:bg-fill-2 focus:outline-none',
              '[&::-webkit-search-cancel-button]:appearance-none',
            )}
          />
        </div>
      </div>

      <nav aria-label="Library" className="flex flex-col gap-px px-2 pb-2">
        {NAV.map(({ view: target, label, Icon }) => {
          const selected = view === target;
          return (
            <button
              key={target}
              type="button"
              aria-current={selected ? 'page' : undefined}
              onClick={() => onViewChange(target)}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-[8px] px-2 text-[14px] font-medium',
                'transition-colors duration-100',
                selected ? 'bg-fill-2 text-t1' : 'text-t2 hover:bg-fill-1 hover:text-t1',
              )}
            >
              <Icon size={15} strokeWidth={2.1} aria-hidden className="shrink-0" />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="mx-4 h-px bg-hairline" />

      {openTitle ? (
        <div className="flex items-center gap-1 px-2 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-7 items-center gap-1 rounded-[7px] pl-1 pr-2 text-[13px] text-t2 transition-colors hover:bg-fill-1 hover:text-t1"
          >
            <ChevronLeft size={15} strokeWidth={2.2} aria-hidden />
            Playlists
          </button>
          <span className="min-w-0 truncate text-[13px] font-medium text-t1">
            {openTitle}
          </span>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col px-1 py-1">{children}</div>

      {authStatus !== 'authed' ? (
        <div className="border-t border-hairline p-3">
          <Button
            variant="filled"
            size="sm"
            className="w-full"
            onClick={onLogin}
            disabled={authStatus === 'loading'}
          >
            {authStatus === 'loading' ? 'Connecting…' : 'Connect Spotify'}
          </Button>
        </div>
      ) : user ? (
        <div className="truncate border-t border-hairline px-4 py-3 text-[12.5px] text-t3">
          {user.displayName}
        </div>
      ) : null}
    </div>
  );
}
