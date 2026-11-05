'use client';

import { useEffect } from 'react';
import { useUIStore } from './store';

export interface ShortcutSpec {
  keys: string[];
  description: string;
  group: 'Playback' | 'Dampen' | 'Navigation';
}

/** The single source of truth for both the handler and the `?` overlay. */
export const SHORTCUTS: ShortcutSpec[] = [
  { keys: ['Space'], description: 'Play / pause', group: 'Playback' },
  { keys: ['←', '→'], description: 'Seek 5 seconds', group: 'Playback' },
  { keys: ['Shift', '←/→'], description: 'Seek 30 seconds', group: 'Playback' },
  { keys: ['M'], description: 'Mute / unmute', group: 'Playback' },
  { keys: ['B'], description: 'Bypass — the A/B test for your ears', group: 'Dampen' },
  { keys: ['↑', '↓'], description: 'Dampen amount ± 5%', group: 'Dampen' },
  { keys: ['Shift', '↑/↓'], description: 'Dampen amount ± 1%', group: 'Dampen' },
  { keys: ['1', '…', '8'], description: 'Jump to preset', group: 'Dampen' },
  { keys: ['/'], description: 'Search your library', group: 'Navigation' },
  { keys: ['?'], description: 'This list', group: 'Navigation' },
  { keys: ['Esc'], description: 'Close overlays', group: 'Navigation' },
];

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * The global keyboard layer. One window listener, mounted once.
 *
 * It reads the action registry with `getState()` rather than subscribing, so
 * it re-renders nothing — and it steps aside whenever a control that owns the
 * key already has focus (the dial's own arrow keys, a focused button's space).
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target;
      const typing = isTypingTarget(target);
      const el = target instanceof HTMLElement ? target : null;
      const role = el?.getAttribute('role');
      const onSlider = role === 'slider';
      const onPressable =
        el?.tagName === 'BUTTON' || role === 'button' || role === 'switch' || role === 'tab';

      const store = useUIStore.getState();
      const actions = store.actions;

      // `/` focuses search from anywhere you are not already typing.
      if (!typing && e.key === '/') {
        e.preventDefault();
        store.focusSearch();
        return;
      }
      if (!typing && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault();
        store.setShortcutsOpen(!store.shortcutsOpen);
        return;
      }
      if (e.key === 'Escape') {
        if (store.shortcutsOpen) {
          e.preventDefault();
          store.setShortcutsOpen(false);
        } else if (typing && el) {
          el.blur();
        }
        return;
      }

      if (typing) return;

      switch (e.key) {
        case ' ':
          // Let a focused button keep its own activation.
          if (onPressable) return;
          e.preventDefault();
          actions.togglePlay?.();
          return;
        case 'ArrowLeft':
          if (onSlider) return;
          e.preventDefault();
          actions.seekBy?.(e.shiftKey ? -30_000 : -5_000);
          return;
        case 'ArrowRight':
          if (onSlider) return;
          e.preventDefault();
          actions.seekBy?.(e.shiftKey ? 30_000 : 5_000);
          return;
        case 'ArrowUp':
          if (onSlider) return;
          e.preventDefault();
          actions.nudgeAmount?.(e.shiftKey ? 0.01 : 0.05);
          return;
        case 'ArrowDown':
          if (onSlider) return;
          e.preventDefault();
          actions.nudgeAmount?.(e.shiftKey ? -0.01 : -0.05);
          return;
        default:
          break;
      }

      const lower = e.key.toLowerCase();
      if (lower === 'b') {
        e.preventDefault();
        actions.toggleBypass?.();
        return;
      }
      if (lower === 'm') {
        e.preventDefault();
        actions.toggleMute?.();
        return;
      }
      if (/^[1-8]$/.test(e.key)) {
        e.preventDefault();
        actions.selectPresetIndex?.(Number(e.key) - 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
