'use client';

import { useEffect, useRef } from 'react';
import { Clock, Heart, Library, ListMusic, LogOut, Search, TrendingUp, X } from 'lucide-react';
import type { AuthStatus, SpotifyUser } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { Artwork } from '@/components/ui/Artwork';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import type { LibraryView } from '@/components/ui/store';

const NAV: Array<{ view: LibraryView; label: string; icon: React.ReactNode }> = [
  { view: 'playlists', label: 'Playlists', icon: <ListMusic className="size-4" aria-hidden /> },
  { view: 'liked', label: 'Liked', icon: <Heart className="size-4" aria-hidden /> },
  { view: 'recent', label: 'Recent', icon: <Clock className="size-4" aria-hidden /> },
  { view: 'top', label: 'Top', icon: <TrendingUp className="size-4" aria-hidden /> },
];

export interface SidebarProps {
  view: LibraryView;
  onViewChange(view: LibraryView): void;

  query: string;
  onQueryChange(query: string): void;
  /** Increment to pull focus into the search box (the `/` shortcut). */
  focusNonce?: number;

  user: SpotifyUser | null;
  authStatus: AuthStatus;
  onLogin(): void;
  onLogout(): void;

  /** Row counts beside each nav item, when known. */
  counts?: Partial<Record<LibraryView, number>>;

  /** The list body for the current view. */
  children: React.ReactNode;
  className?: string;
}

export function Sidebar({
  view,
  onViewChange,
  query,
  onQueryChange,
  focusNonce = 0,
  user,
  authStatus,
  onLogin,
  onLogout,
  counts,
  children,
  className,
}: SidebarProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusNonce > 0) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [focusNonce]);

  return (
    <aside
      aria-label="Library"
      className={cn('panel flex min-h-0 flex-col rounded-panel', className)}
    >
      {/* Search */}
      <div className="p-3 pb-2">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-4"
          />
          <input
            ref={searchRef}
            type="search"
            role="searchbox"
            value={query}
            placeholder="Search"
            aria-label="Search your Spotify"
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => onViewChange('search')}
            className={cn(
              'h-9 w-full rounded-xl border border-line bg-white/[0.04] pl-9 pr-16 text-[13px] text-ink',
              'placeholder:text-ink-4 transition-colors hover:border-white/18',
              'focus:border-accent/50 focus:bg-white/[0.06]',
              '[&::-webkit-search-cancel-button]:hidden',
            )}
          />
          {query.length > 0 ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQueryChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-4 transition-colors hover:bg-white/[0.08] hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : (
            <kbd className="num pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-ink-4">
              /
            </kbd>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="Library sections" className="px-3 pb-2">
        <ul className="grid grid-cols-4 gap-1">
          {NAV.map((item) => {
            const selected = item.view === view;
            return (
              <li key={item.view}>
                <button
                  type="button"
                  onClick={() => onViewChange(item.view)}
                  aria-current={selected ? 'page' : undefined}
                  className={cn(
                    'flex w-full flex-col items-center gap-1 rounded-xl border px-1 py-2 transition-colors duration-150',
                    selected
                      ? 'border-accent/40 text-ink'
                      : 'border-transparent text-ink-3 hover:bg-white/[0.05] hover:text-ink-2',
                  )}
                  style={selected ? { background: 'var(--accent-wash)' } : undefined}
                >
                  <span style={{ color: selected ? 'var(--accent)' : undefined }}>
                    {item.icon}
                  </span>
                  <span className="text-[10.5px] font-medium leading-none">{item.label}</span>
                  {typeof counts?.[item.view] === 'number' ? (
                    <span className="num text-[9px] leading-none text-ink-4">
                      {counts[item.view]}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Body */}
      <div className="min-h-0 flex-1 border-t border-line">{children}</div>

      {/* User chip */}
      <div className="border-t border-line p-2.5">
        {authStatus === 'loading' ? (
          <div className="flex items-center gap-2.5 px-1 py-1">
            <Skeleton shape="circle" className="size-8" />
            <Skeleton shape="text" className="w-24" />
          </div>
        ) : user ? (
          <div className="flex items-center gap-2.5">
            <Artwork
              images={user.images}
              alt={user.displayName}
              seed={user.displayName}
              sizes="32px"
              targetWidth={64}
              className="size-8 shrink-0 rounded-full"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium text-ink">{user.displayName}</p>
              <p className="truncate text-[10.5px] uppercase tracking-wider text-ink-4">
                {user.product ?? 'spotify'}
              </p>
            </div>
            <Tooltip label="Sign out" side="top">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Sign out"
                onClick={onLogout}
                className="size-8"
              >
                <LogOut className="size-3.5" aria-hidden />
              </Button>
            </Tooltip>
          </div>
        ) : (
          <div className="space-y-2 px-0.5 pb-0.5">
            <p className="flex items-center gap-1.5 text-[11.5px] leading-snug text-ink-3">
              <Library className="size-3.5 shrink-0" aria-hidden />
              Sign in for your playlists. Dampen still works without it.
            </p>
            <Button variant="accent" size="sm" className="w-full" onClick={onLogin}>
              Connect Spotify
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
