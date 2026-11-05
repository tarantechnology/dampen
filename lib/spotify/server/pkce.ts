/**
 * RFC 7636 PKCE, on Web Crypto only.
 *
 * SERVER ONLY — the verifier is generated here and stored in an httpOnly
 * cookie, so the browser never sees it. (PKCE is normally a public-client
 * technique with the verifier in the SPA; keeping it server-side is strictly
 * stronger, and is what lets us hold the refresh token out of the browser.)
 */

if (typeof window !== 'undefined') {
  throw new Error('lib/spotify/server/pkce.ts was imported into a browser bundle. This must never happen.');
}

/** RFC 7636 §4.1 unreserved set: ALPHA / DIGIT / "-" / "." / "_" / "~". */
const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** RFC 7636 §4.1 permits 43–128 chars. 96 sits comfortably inside that. */
const VERIFIER_LENGTH = 96;

/**
 * Rejection sampling over the 66-char unreserved alphabet.
 *
 * `byte % 66` would be biased (256 is not a multiple of 66); discarding bytes
 * at or above the largest multiple of 66 (252) removes the bias. The loop is
 * expected to need ~1.02 bytes per character.
 */
export function createCodeVerifier(length: number = VERIFIER_LENGTH): string {
  if (length < 43 || length > 128) {
    throw new Error(`PKCE code_verifier length must be 43..128, got ${length}`);
  }
  const limit = 256 - (256 % VERIFIER_ALPHABET.length); // 252
  let out = '';
  const buffer = new Uint8Array(length);
  while (out.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= limit) continue;
      out += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** S256: BASE64URL(SHA256(ASCII(verifier))), no padding. */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Anti-CSRF `state`. 32 bytes of entropy, base64url. */
export function createState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Constant-time string comparison for the `state` check.
 *
 * A plain `===` on strings can short-circuit on the first differing byte. The
 * timing signal is tiny here, but state comparison is exactly the place not to
 * be clever about it.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  // Fold the length difference into the result rather than returning early.
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
