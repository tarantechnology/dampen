'use client';

import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { ListMusic, Pause, Play } from 'lucide-react';
import type { SpotifyTrack } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { Artwork } from '@/components/ui/Artwork';
import { EmptyState } from '@/components/ui/EmptyState';
import { TrackListSkeleton } from '@/components/ui/Skeleton';
import { formatTime } from '@/components/ui/format';

export const ROW_HEIGHT = 56;
/** Rows rendered above and below the viewport so fast scrolling stays filled. */
const OVERSCAN = 6;

export type TrackMeta = 'album' | 'added' | 'played' | 'none';

function relativeDate(iso: string | undefined): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - then) / 3_600_000);
    if (hours <= 0) return 'just now';
    return `${hours}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/* ------------------------------------------------------------------ *
 * Row
 * ------------------------------------------------------------------ */

interface TrackRowProps {
  track: SpotifyTrack;
  index: number;
  /** Keyboard cursor. */
  active: boolean;
  /** This is the track currently loaded in the player. */
  current: boolean;
  isPlaying: boolean;
  meta: TrackMeta;
  listId: string;
  onActivate(index: number): void;
}

const TrackRow = memo(function TrackRow({
  track,
  index,
  active,
  current,
  isPlaying,
  meta,
  listId,
  onActivate,
}: TrackRowProps) {
  const artists = track.artists.map((a) => a.name).join(', ');
  const metaText =
    meta === 'album'
      ? track.album.name
      : meta === 'added'
        ? relativeDate(track.addedAt)
        : meta === 'played'
          ? relativeDate(track.playedAt)
          : '';

  return (
    <div
      id={`${listId}-opt-${index}`}
      role="option"
      aria-selected={current}
      onClick={() => onActivate(index)}
      onDoubleClick={() => onActivate(index)}
      style={{ height: ROW_HEIGHT, transform: `translateY(${index * ROW_HEIGHT}px)` }}
      className={cn(
        'group absolute inset-x-0 top-0 flex cursor-pointer items-center gap-3 rounded-lg px-2',
        'transition-colors duration-100',
        active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]',
      )}
    >
      {/* Index / play affordance. */}
      <span className="relative size-10 shrink-0">
        <Artwork
          images={track.album.images}
          alt={`${track.album.name} cover`}
          seed={`${track.album.name} ${artists}`}
          sizes="40px"
          targetWidth={64}
          className="size-10 rounded-md"
        />
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 flex items-center justify-center rounded-md bg-black/55 opacity-0 transition-opacity',
            'group-hover:opacity-100',
            active && 'opacity-100',
            current && 'opacity-100',
          )}
        >
          {current && isPlaying ? (
            <Pause className="size-4 text-ink" strokeWidth={2.4} />
          ) : (
            <Play className="size-4 translate-x-[1px] text-ink" strokeWidth={2.4} />
          )}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[13px] font-medium',
            current ? 'text-accent' : 'text-ink',
          )}
        >
          {track.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-ink-3">
          {track.explicit ? (
            <span className="shrink-0 rounded border border-line px-[3px] text-[8.5px] font-semibold text-ink-4">
              E
            </span>
          ) : null}
          <span className="truncate">{artists}</span>
        </span>
      </span>

      {metaText ? (
        <span className="hidden min-w-0 max-w-[36%] shrink truncate text-[11.5px] text-ink-4 sm:block">
          {metaText}
        </span>
      ) : null}

      <span className="num w-10 shrink-0 text-right text-[11.5px] tabular-nums text-ink-4">
        {formatTime(track.durationMs)}
      </span>
    </div>
  );
});

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

export interface TrackListProps {
  tracks: SpotifyTrack[];
  isLoading?: boolean;
  /** URI of the track in the player, for the "now playing" row state. */
  currentUri?: string | null;
  isPlaying?: boolean;
  onPlay(track: SpotifyTrack, index: number): void;
  meta?: TrackMeta;
  /** Accessible name for the list. */
  label: string;
  emptyTitle?: string;
  emptyBody?: string;
  className?: string;
}

/**
 * A windowed track list.
 *
 * Rows are a fixed 56 px, so windowing is just arithmetic — no dependency,
 * no measurement pass. Only the visible slice plus a small overscan is in
 * the DOM, every row is `memo`'d, and the scroll handler is coalesced into a
 * rAF, so a 2,000-track playlist scrolls as cheaply as a 20-track one.
 *
 * Keyboard: Up/Down move the cursor, Enter or Space plays, Home/End jump.
 * Implemented as a real listbox with `aria-activedescendant` rather than a
 * pile of tabbable buttons, so Tab still gets you out of the list.
 */
export function TrackList({
  tracks,
  isLoading = false,
  currentUri = null,
  isPlaying = false,
  onPlay,
  meta = 'album',
  label,
  emptyTitle = 'Nothing here yet',
  emptyBody = 'Save some tracks in Spotify and they will show up here.',
  className,
}: TrackListProps) {
  const listId = useId();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(560);
  const [cursor, setCursor] = useState(-1);
  const raf = useRef(0);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Reset the cursor when the underlying list changes identity.
  useEffect(() => {
    setCursor(-1);
  }, [tracks]);

  const onScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setScrollTop(el.scrollTop));
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const activate = useCallback(
    (index: number) => {
      const track = tracks[index];
      if (track) {
        setCursor(index);
        onPlay(track, index);
      }
    },
    [onPlay, tracks],
  );

  const scrollCursorIntoView = (index: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (tracks.length === 0) return;
    let next = cursor;
    switch (e.key) {
      case 'ArrowDown':
        next = Math.min(tracks.length - 1, cursor + 1);
        break;
      case 'ArrowUp':
        next = Math.max(0, cursor <= 0 ? 0 : cursor - 1);
        break;
      case 'PageDown':
        next = Math.min(tracks.length - 1, cursor + Math.floor(height / ROW_HEIGHT));
        break;
      case 'PageUp':
        next = Math.max(0, cursor - Math.floor(height / ROW_HEIGHT));
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tracks.length - 1;
        break;
      case 'Enter':
      case ' ':
        if (cursor >= 0) {
          e.preventDefault();
          e.stopPropagation();
          activate(cursor);
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    setCursor(next);
    scrollCursorIntoView(next);
  };

  if (isLoading) {
    return (
      <div className={cn('scroll-slim overflow-hidden', className)}>
        <TrackListSkeleton rows={Math.max(4, Math.round(height / ROW_HEIGHT))} />
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className={className}>
        <EmptyState
          icon={<ListMusic className="size-5" aria-hidden />}
          title={emptyTitle}
          body={emptyBody}
        />
      </div>
    );
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(tracks.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const visible = tracks.slice(start, end);

  return (
    <div
      ref={viewportRef}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={cursor >= 0 ? `${listId}-opt-${cursor}` : undefined}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      className={cn('scroll-slim overflow-y-auto overscroll-contain outline-offset-2', className)}
    >
      <div className="relative" style={{ height: tracks.length * ROW_HEIGHT }}>
        {visible.map((track, i) => {
          const index = start + i;
          return (
            <TrackRow
              key={`${track.id}-${index}`}
              track={track}
              index={index}
              active={index === cursor}
              current={currentUri !== null && track.uri === currentUri}
              isPlaying={isPlaying}
              meta={meta}
              listId={listId}
              onActivate={activate}
            />
          );
        })}
      </div>
    </div>
  );
}
