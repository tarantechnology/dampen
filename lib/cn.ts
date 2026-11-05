import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names, with later Tailwind utilities winning over earlier
 * ones of the same kind. Use everywhere instead of string concatenation so
 * component consumers can always override via `className`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
