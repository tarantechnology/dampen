/**
 * Narrowing helpers for untrusted JSON.
 *
 * Everything that comes off the wire enters the app as `unknown` and is pulled
 * apart with these. That is the whole reason the mappers can survive Spotify's
 * null tracks, missing albums and empty image arrays without a single `any`.
 */

export type JsonRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The field as a non-empty string, or null. Trims. */
export function str(source: unknown, key: string): string | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** The field as a string, defaulting when absent/blank. Never null. */
export function strOr(source: unknown, key: string, fallback: string): string {
  return str(source, key) ?? fallback;
}

/** The field as a finite number, or null. Rejects NaN/Infinity and numeric strings. */
export function num(source: unknown, key: string): number | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function numOr(source: unknown, key: string, fallback: number): number {
  return num(source, key) ?? fallback;
}

/** Non-negative integer, or null. Used for durations and positions. */
export function intOr(source: unknown, key: string, fallback: number): number {
  const value = num(source, key);
  if (value === null) return fallback;
  return Math.max(0, Math.round(value));
}

export function bool(source: unknown, key: string): boolean | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

export function boolOr(source: unknown, key: string, fallback: boolean): boolean {
  return bool(source, key) ?? fallback;
}

/** The field as an array of unknowns. Always an array — `[]` when absent or wrong type. */
export function arr(source: unknown, key: string): readonly unknown[] {
  if (!isRecord(source)) return [];
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

/** The field as a nested record, or null. */
export function rec(source: unknown, key: string): JsonRecord | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return isRecord(value) ? value : null;
}

/**
 * Map an array field, dropping every element the mapper rejects.
 * This is the "filter out unusable rows rather than render undefined" rule.
 */
export function mapArray<T>(source: unknown, key: string, map: (item: unknown) => T | null): T[] {
  const out: T[] = [];
  for (const item of arr(source, key)) {
    const mapped = map(item);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

/** Array of plain strings, blanks dropped. */
export function strArray(source: unknown, key: string): string[] {
  const out: string[] = [];
  for (const item of arr(source, key)) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed !== '') out.push(trimmed);
  }
  return out;
}

/** Parse a JSON string without throwing. */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === '') return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Spotify's error envelope is `{ error: { status, message } }`, but gateways in
 * front of it sometimes return `{ error: "...", error_description: "..." }`
 * (the accounts service) or plain HTML. Pull out whatever message exists.
 */
export function extractApiMessage(body: unknown): string | null {
  if (typeof body === 'string') {
    const trimmed = body.trim();
    return trimmed === '' || trimmed.startsWith('<') ? null : trimmed.slice(0, 300);
  }
  if (!isRecord(body)) return null;

  const nested = rec(body, 'error');
  if (nested !== null) {
    const message = str(nested, 'message');
    if (message !== null) return message.slice(0, 300);
  }

  const description = str(body, 'error_description');
  if (description !== null) return description.slice(0, 300);

  const flat = str(body, 'error');
  if (flat !== null) return flat.slice(0, 300);

  const message = str(body, 'message');
  return message === null ? null : message.slice(0, 300);
}
