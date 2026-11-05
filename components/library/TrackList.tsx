'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SpotifyTrack } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { formatTime } from '@/components/ui/format';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { MediaRow } from './MediaRow';

export const ROW_HEIGHT = 52;
const OVERSCAN = 8;

export interface TrackListProps {
  label: string;
  tracks: SpotifyTrack[];
  isLoading: boolean;
  /** The URI currently playing, so one row can be marked. */
  currentUri: string | null;
  onPlay(track: SpotifyTrack, index: number): void;
  emptyTitle: string;
  emptyBody: string;
  className?: string;
}

/**
 * A windowed listbox.
 *
 * A liked-songs library runs to thousands of rows, so only the visible slice
 * is mounted. Keyboard support is a roving cursor with `aria-activedescendant`
 * rather than a tab stop per row — tabbing through four thousand tracks to
 * reach the settings button is not accessibility.
 */
export function TrackList({
  label,
  tracks,
  isLoading,
  currentUri,
  onPlay,
  emptyTitle,
  emptyBody,
  className,
}: TrackListProps) {
  const listId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(480);
  const [cursor, setCursor] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setHeight(el.clientHeight);
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const frame = useRef(0);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setScrollTop(el.scrollTop));
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /* A new list is a new cursor. Adjusting during render is the documented
     pattern for state derived from props; an effect would paint once with
     the stale cursor first. */
  const listKey = `${label}:${tracks.length}`;
  const [seenKey, setSeenKey] = useState(listKey);
  if (seenKey !== listKey) {
    setSeenKey(listKey);
    setCursor(0);
  }

  const scrollIntoView = useCallback((index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
  }, []);

  const move = (next: number) => {
    const clamped = Math.max(0, Math.min(tracks.length - 1, next));
    setCursor(clamped);
    scrollIntoView(clamped);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (tracks.length === 0) return;
    const page = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        move(cursor + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        move(cursor - 1);
        break;
      case 'PageDown':
        e.preventDefault();
        move(cursor + page);
        break;
      case 'PageUp':
        e.preventDefault();
        move(cursor - page);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(tracks.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        onPlay(tracks[cursor], cursor);
        break;
      default:
        break;
    }
  };

  if (isLoading && tracks.length === 0) {
    return (
      <div className={cn('flex flex-col gap-1 px-1 py-1', className)}>
        {Array.from({ length: 8 }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className={className}>
        <EmptyState title={emptyTitle} body={emptyBody} />
      </div>
    );
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(tracks.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const visible = tracks.slice(start, end);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={`${listId}-${cursor}`}
      onKeyDown={onKeyDown}
      className={cn('scroll-quiet h-full overflow-y-auto overscroll-contain', className)}
    >
      <div className="relative" style={{ height: tracks.length * ROW_HEIGHT }}>
        {visible.map((track, i) => {
          const index = start + i;
          const current = track.uri === currentUri;
          return (
            <div
              key={`${track.id}-${index}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === cursor}
              onClick={() => {
                setCursor(index);
                onPlay(track, index);
              }}
              className={cn(
                'absolute inset-x-0 cursor-pointer rounded-[8px] transition-colors duration-100',
                'hover:bg-fill-1',
                index === cursor && 'bg-fill-1',
              )}
              style={{ height: ROW_HEIGHT, transform: `translateY(${index * ROW_HEIGHT}px)` }}
            >
              <MediaRow
                images={track.album.images}
                seed={`${track.album.name} ${track.artists[0]?.name ?? ''}`}
                title={track.name}
                subtitle={track.artists.map((a) => a.name).join(', ')}
                trailing={formatTime(track.durationMs)}
                current={current}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
