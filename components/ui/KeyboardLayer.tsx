'use client';

import { useGlobalShortcuts } from './useShortcuts';

/**
 * Mounts the one global keydown listener. Renders nothing, subscribes to
 * nothing — it reads the action registry with `getState()` at the moment a key
 * is pressed, so no keypress handler is ever a render dependency.
 */
export function KeyboardLayer() {
  useGlobalShortcuts();
  return null;
}
