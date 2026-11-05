/**
 * Typed error results for every Spotify network path.
 *
 * Nothing in this layer throws for an *expected* failure (offline, 401, 429,
 * malformed body, abort). Those are values. `throw` is reserved for programmer
 * error, and there is none of it on the request path.
 *
 * This module is isomorphic — it is imported by both the route handlers and
 * the browser client. It must never read env vars or touch `window`.
 */

export type SpotifyErrorKind =
  /** fetch() itself rejected: DNS, TLS, no network, CORS. */
  | 'offline'
  /** 400 — we sent something Spotify did not like. */
  | 'bad_request'
  /** 401 — token missing, expired beyond repair, or revoked. Re-login. */
  | 'unauthorized'
  /** 403 — authenticated but not allowed (scope, or non-Premium playback). */
  | 'forbidden'
  /** 403 on a playback endpoint for a free account. */
  | 'premium_required'
  /** 404 — includes "no active device" on several player endpoints. */
  | 'not_found'
  /** 429 — carries `retryAfterMs`. */
  | 'rate_limited'
  /**
   * 429 with `{ "reason": "QUOTA_EXCEEDED" }`. Since the July 2026 quota
   * changes Spotify distinguishes "you're going too fast" from "your app's
   * rolling quota is spent". Backing off does not fix the second one.
   */
  | 'quota_exceeded'
  /** 5xx, or a Spotify gateway hiccup. */
  | 'server'
  /** 200 with a body we could not parse, or a shape we cannot use. */
  | 'malformed'
  /** The caller's AbortSignal fired. Not an error to show the user. */
  | 'aborted'
  /** Anything else, including non-standard statuses. */
  | 'unknown';

export interface SpotifyError {
  readonly kind: SpotifyErrorKind;
  /** HTTP status, when there was a response. */
  readonly status: number | null;
  /** Safe to render. Never contains a token, a secret, or an internal marker. */
  readonly message: string;
  /** Only ever set on `rate_limited` / `quota_exceeded`. */
  readonly retryAfterMs?: number;
  /**
   * The machine-readable code from the upstream error body, when there was one
   * — e.g. OAuth's `invalid_grant` / `invalid_client`. Branch on this rather
   * than string-matching `message`, which is prose and may be localised.
   */
  readonly code?: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: SpotifyError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export interface ErrorExtras {
  readonly retryAfterMs?: number;
  readonly code?: string;
}

export function err<T = never>(
  kind: SpotifyErrorKind,
  message: string,
  status: number | null = null,
  extras: ErrorExtras = {},
): Result<T> {
  const error: SpotifyError = {
    kind,
    status,
    message,
    ...(extras.retryAfterMs === undefined ? {} : { retryAfterMs: extras.retryAfterMs }),
    ...(extras.code === undefined ? {} : { code: extras.code }),
  };
  return { ok: false, error };
}

/** True when retrying the identical request could plausibly succeed. */
export function isRetryable(error: SpotifyError): boolean {
  return error.kind === 'offline' || error.kind === 'rate_limited' || error.kind === 'server';
}

/** 429 reason body sent by Spotify since July 2026. */
export const QUOTA_EXCEEDED_REASON = 'QUOTA_EXCEEDED';

const KIND_BY_STATUS: Readonly<Record<number, SpotifyErrorKind>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  429: 'rate_limited',
};

export function kindForStatus(status: number): SpotifyErrorKind {
  const mapped = KIND_BY_STATUS[status];
  if (mapped !== undefined) return mapped;
  if (status >= 500) return 'server';
  if (status >= 400) return 'unknown';
  return 'unknown';
}

/**
 * Parse `Retry-After`. Spotify sends integer seconds, but RFC 9110 also allows
 * an HTTP-date, so handle both. Clamped to 5 minutes so a hostile or buggy
 * value cannot wedge a UI that honours it.
 */
export function parseRetryAfterMs(raw: string | null): number {
  const FALLBACK = 1_000;
  const MAX = 300_000;
  if (raw === null) return FALLBACK;
  const trimmed = raw.trim();
  if (trimmed === '') return FALLBACK;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(seconds)) return FALLBACK;
    return Math.min(MAX, Math.max(0, seconds) * 1_000);
  }

  // Only try the date branch for something that could actually be an
  // HTTP-date. `Date.parse` is alarmingly permissive — it reads "-5" as a
  // year and returns a valid timestamp — so a malformed numeric value would
  // otherwise be silently misread as a date instead of falling back.
  if (!/[A-Za-z]/.test(trimmed)) return FALLBACK;

  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return FALLBACK;
  return Math.min(MAX, Math.max(0, when - Date.now()));
}

/** Classify a rejected `fetch()`. */
export function errorFromThrown<T = never>(thrown: unknown): Result<T> {
  if (thrown instanceof DOMException && thrown.name === 'AbortError') {
    return err('aborted', 'Request cancelled.');
  }
  // Some runtimes surface aborts as a plain Error named AbortError.
  if (thrown instanceof Error && thrown.name === 'AbortError') {
    return err('aborted', 'Request cancelled.');
  }
  if (thrown instanceof Error && thrown.name === 'TimeoutError') {
    return err('offline', 'The request timed out.');
  }
  const detail = thrown instanceof Error ? thrown.message : 'Unknown network failure.';
  return err('offline', `Could not reach the network: ${detail}`);
}

/** One line, user-facing. Used by the hooks for their `error: string | null`. */
export function describeError(error: SpotifyError): string {
  switch (error.kind) {
    case 'offline':
      return 'You appear to be offline.';
    case 'unauthorized':
      return 'Your Spotify session expired. Please sign in again.';
    case 'premium_required':
      return 'Spotify Premium is required for in-browser playback.';
    case 'forbidden':
      return 'Spotify refused that request for this account.';
    case 'not_found':
      return 'Spotify had nothing for that request.';
    case 'rate_limited':
      return 'Spotify is rate-limiting us. Trying again shortly.';
    case 'quota_exceeded':
      return "This app's Spotify API quota is exhausted. Try again later.";
    case 'server':
      return 'Spotify is having trouble right now.';
    case 'malformed':
      return 'Spotify returned something we could not read.';
    case 'bad_request':
      return error.message;
    case 'aborted':
      return 'Request cancelled.';
    case 'unknown':
      return error.message;
  }
}
