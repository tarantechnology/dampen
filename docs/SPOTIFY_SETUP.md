# Spotify setup

Everything you need to get Dampen talking to Spotify, plus what we actually
verified against the live docs (the API changed hard in 2026 — see the bottom
section before you assume anything you remember is still true).

---

## 1. Create the app

1. Go to **<https://developer.spotify.com/dashboard>** and log in with the
   Spotify account you want to develop against.
2. Accept the **Developer Terms of Service** if prompted.
3. Click **Create app**.
4. Fill in:
   - **App name** — e.g. `Dampen (dev)`. This is shown to the user on the
     consent screen.
   - **App description** — e.g. `Muffles your music so it sits behind your
     attention.` Also shown on the consent screen.
   - **Redirect URI** — paste exactly:
     ```
     http://127.0.0.1:3000/api/spotify/callback
     ```
     then press **Add**. See §2 — this must be `127.0.0.1`, **not**
     `localhost`.
   - **Which API/SDKs are you planning to use?** — tick **Web API** *and*
     **Web Playback SDK**.
5. Tick the Developer Terms checkbox and click **Save**.
6. On the app page, click **Settings** (top right).
   - Copy **Client ID** → `SPOTIFY_CLIENT_ID`.
   - Click **View client secret** → `SPOTIFY_CLIENT_SECRET` (optional, see §4).

Then:

```bash
cp .env.example .env.local
# fill in SPOTIFY_CLIENT_ID; leave SPOTIFY_CLIENT_SECRET blank unless you need it
npm run dev
```

and open **<http://127.0.0.1:3000>** — not `http://localhost:3000`. The app
binds to `127.0.0.1` (see the `dev` script), and the browser origin has to
match the registered redirect URI's host for the OAuth round-trip to work.

---

## 2. The redirect URI: use `127.0.0.1`, never `localhost`

This is the single most common setup failure, and it is **confirmed current**.
From Spotify's redirect-URI page, verbatim:

> "Use HTTPS for your redirect URI, unless you are using a loopback address,
> when HTTP is permitted."
>
> "`localhost` is not allowed as redirect URI."
>
> "If you are using a loopback address, use the explicit IPv4 or IPv6, like
> `http://127.0.0.1:PORT` or `http://[::1]:PORT`"

Valid examples the page gives: `https://example.com/callback`,
`http://127.0.0.1:8000/callback`, `http://[::1]:8000/callback`.

Enforcement began **9 April 2025** for newly created apps, with all apps
required to migrate by **November 2025**. Both dates are long past, so this
applies to every app now.

Practical rules:

| Environment | Redirect URI |
|---|---|
| Local dev | `http://127.0.0.1:3000/api/spotify/callback` |
| Production | `https://your-domain.example/api/spotify/callback` (https is mandatory) |

The value in `SPOTIFY_REDIRECT_URI` must match a registered URI **character
for character**, including scheme, host, port and path. Dampen validates this
at startup: `lib/spotify/server/config.ts` rejects `localhost` and rejects
non-https non-loopback URIs with a readable error, rather than letting you
discover it on Spotify's own error page.

> If you don't know the port in advance, Spotify permits registering a loopback
> IP literal *without* a port and supplying the port in the authorization
> request. Dampen doesn't use that — it pins port 3000.

---

## 3. Add yourself to the development-mode allowlist

A new app starts in **Development Mode**. Only explicitly listed users can
authorize it — everyone else gets `User not registered in the Developer
Dashboard` at the consent screen, even you, unless you add yourself.

1. Dashboard → your app → **Settings**.
2. Open the **User Management** tab.
3. Click **Add new user**.
4. Enter the person's **full name** and the **email address attached to their
   Spotify account** (not any other address they use — it must be the Spotify
   account email).
5. Save.

Current development-mode limits:

- **Up to 25 users** on the allowlist historically; Spotify reduced this to
  **5 users** in the February 2026 changes. Apps that already had more were
  grandfathered.
- **The app owner must have Spotify Premium** for an app in development mode
  to function at all — this requirement was added in February 2026.
- **25 client IDs per developer account** (raised from 1 in July 2026), with
  API quota **pooled across all your development-mode apps**, not per client ID.

### Extended quota mode: realistically out of reach

Since **15 May 2025** Spotify only accepts extended-quota applications from
organizations, not individuals. The stated criteria include a legally
registered business entity, a launched service, **at least 250k monthly active
users**, availability in key Spotify markets, and commercial viability.

For a personal project, plan to stay in development mode permanently. That is
fine for Dampen — but it is why some endpoints below are dead for you.

---

## 4. Premium is required for in-browser playback

> "The Web Playback SDK requires a Spotify Premium subscription (mobile only
> types of premium subscriptions are excluded)" — Web Playback SDK docs

This governs **Path A** in `docs/ARCHITECTURE.md` only. Dampen degrades
properly:

| Account | Path A (SDK) | Path B (system capture) | Path C (local audio) |
|---|---|---|---|
| Premium | yes | yes | yes |
| Free / open | **no** | yes | yes |
| Not signed in | no | yes | yes |

A free account surfaces as `usePlayback().isReady === false` with
`unavailableReason === 'not_premium'`. It does **not** throw, and it does not
spam the console: when the tier is already known to be non-Premium, the SDK
script is never injected at all.

### The awkward part: we often can't tell in advance

The February 2026 changes **removed `product` from `GET /me`** for client IDs
registered on or after 2026-02-11 (along with `country`, `email`,
`explicit_content` and `followers`). Spotify published no replacement, so the
classic "fetch `/me`, check `product === 'premium'`" gate simply does not work
on a new app.

Dampen handles this honestly:

- `useAuth().premiumStatus` is `'premium' | 'free' | 'unknown'`.
- `'unknown'` means *the API withheld it*, which is **not** the same as free.
- When the status is `'unknown'`, `usePlayback` **attempts the SDK anyway** —
  a successful `ready` event proves Premium, and an `account_error` proves
  otherwise. Either verdict is cached back into the auth store, so the probe
  runs once per session.
- `useAuth().isPremium` stays a plain boolean (it's in the API contract) and is
  true only for a confirmed `'premium'`.

### Browser requirements

- Chrome, Firefox, Safari, Edge, on desktop and mobile.
- Playback uses EME/Widevine. The page must be a **secure context** — https,
  or a loopback origin like `http://127.0.0.1:3000`. Dampen checks
  `window.isSecureContext` and reports `unavailableReason:
  'insecure_context'` rather than failing obscurely. (This is also exactly why
  `MediaElementAudioSourceNode` yields silence on the SDK's element, which is
  the whole reason Path B exists.)
- If you ever embed Dampen in a cross-origin iframe, that iframe needs
  `allow="encrypted-media; autoplay"` — Chrome's Feature Policy disallows both
  by default.

---

## 5. Scopes

Requested in one block by `GET /api/spotify/login`:

```
user-read-private user-read-email user-read-playback-state
user-modify-playback-state user-read-currently-playing streaming
playlist-read-private playlist-read-collaborative user-library-read
user-read-recently-played user-top-read
```

| Scope | What it buys |
|---|---|
| `user-read-private`, `user-read-email` | `GET /me` |
| `user-read-playback-state` | `GET /me/player`, `GET /me/player/devices` |
| `user-modify-playback-state` | every playback mutation, including transfer |
| `user-read-currently-playing` | now-playing when full state is unavailable |
| `streaming` | the Web Playback SDK (Premium only) |
| `playlist-read-private`, `playlist-read-collaborative` | `GET /me/playlists` |
| `user-library-read` | `GET /me/tracks` |
| `user-read-recently-played` | `GET /me/player/recently-played` |
| `user-top-read` | `GET /me/top/{tracks,artists}` |

Changing this list invalidates existing grants — users will see the consent
screen again on their next login.

---

## 6. Which OAuth flow, and why

**Authorization Code + PKCE (S256), with the verifier held server-side.**

PKCE is normally a *public* client technique: a browser SPA keeps the
`code_verifier` in memory and holds the tokens itself. Dampen does it
differently, and strictly more safely:

- `GET /api/spotify/login` generates a 96-char `code_verifier`
  (RFC 7636 §4.1 unreserved alphabet, rejection-sampled from
  `crypto.getRandomValues` so the character distribution is unbiased) plus an
  anti-CSRF `state`, and parks **both in httpOnly cookies**. Page JavaScript
  cannot read either.
- `GET /api/spotify/callback` compares `state` in **constant time**, exchanges
  the code, and writes `access_token` / `refresh_token` / `expires_at` as
  httpOnly cookies.
- The browser never holds a refresh token. The only thing that crosses to the
  client is a short-lived access token from `GET /api/spotify/token`, which the
  Web Playback SDK needs and nothing else uses.
- Every Web API call goes through `ALL /api/spotify/proxy/[...path]`, which
  attaches the bearer token server-side.

### About `SPOTIFY_CLIENT_SECRET`

**It is optional, and blank is the recommended setting.**

The token exchange runs as a **public** client: `client_id` in the body, no
`Authorization: Basic` header. That is the only form Spotify documents for
PKCE, and mixing a secret into a PKCE exchange is widely reported to fail with
`invalid_client`.

If you *do* set a secret, it is used only as a **fallback**: when the public
exchange is rejected specifically on client-authentication grounds
(`invalid_client` / `invalid_request` / `unsupported_grant_type`), the request
is retried once with HTTP Basic and `client_id` removed from the body
(RFC 6749 §2.3.1). That single retry is what makes the same code path work
whether the secret is present or absent, and whether your app is registered
expecting a public or confidential client. Cost is one wasted round-trip on a
misconfigured setup, and nothing at all otherwise.

### Refresh tokens now expire — plan for re-login

Since **18 June 2026** (new apps) / **20 July 2026** (existing apps), refresh
tokens issued to dashboard-registered apps have a **6-month lifetime**, and
**refreshing does not extend it** — the clock runs from the user's original
authorization. On expiry the token endpoint returns `400` with
`invalid_grant`.

Dampen treats that as routine, not exceptional: `invalid_grant` /
`unauthorized_client` clears the session cookies and returns `401`, the client
broadcasts it through `onUnauthorized`, every cache is dropped, and the UI
falls back to `status: 'anon'` so the user can just click sign-in again.
Session cookie `maxAge` is set to 175 days so a dead session self-clears
instead of sitting around failing.

Note also that a refresh response **may or may not** include a new
`refresh_token`; Spotify documents both. The code persists a new one when
present and keeps the old one when not.

---

## 7. Troubleshooting

| Symptom | Cause |
|---|---|
| `INVALID_CLIENT: Invalid redirect URI` | `SPOTIFY_REDIRECT_URI` doesn't byte-match a registered URI. Check scheme, host, **port**, path. |
| `User not registered in the Developer Dashboard` | Add the user under Settings → User Management (§3), using their Spotify account email. |
| Redirected to `/?auth_error=access_denied` | The user pressed Cancel on the consent screen. Expected, handled. |
| Redirected to `/?auth_error=state_mismatch` | The handshake cookie was missing or stale (>10 min), or the callback didn't originate from our `/login`. Just log in again. |
| Redirected to `/?auth_error=configuration` | `SPOTIFY_CLIENT_ID` / `SPOTIFY_REDIRECT_URI` missing or invalid. Server log has the detail. |
| `isReady: false`, `unavailableReason: 'not_premium'` | Free account. Use Path B or C. |
| `unavailableReason: 'insecure_context'` | You're on a plain-http non-loopback origin. Use `127.0.0.1` or https. |
| `unavailableReason: 'script_unavailable'` | An ad-blocker or CSP blocked `sdk.scdn.co`. |
| `404` with "No active device found" on a playback call | Nothing is playing anywhere. Start playback on a device, or transfer to the Dampen device first. |
| `403` "Premium required" | Free account hitting a playback mutation. Surfaces as `premium_required`. |
| `429` | Rate limited. `Retry-After` is relayed verbatim, plus `X-Dampen-Retry-After-Ms`. A body of `{"reason":"QUOTA_EXCEEDED"}` means your pooled quota is spent — backing off will not help. |

---

## 8. Running the Spotify tests

142 unit tests cover the mappers against deliberately malformed input, the
proxy allowlist (including path traversal and open-proxy attempts), PKCE
against the RFC 7636 Appendix B test vector, and `Retry-After` parsing.

The project compiles with `moduleResolution: "bundler"`, so source files import
siblings without a file extension, which Node's ESM resolver won't accept. A
resolver hook is included alongside the tests:

```bash
node --test --experimental-strip-types \
     --import ./lib/spotify/__tests__/ts-resolve-hook.mjs \
     lib/spotify/__tests__/*.test.ts
```

(The bare `npm test` script cannot resolve these imports without that
`--import` flag.)

---

## Verified against Spotify docs

Checked **4 November 2026** by fetching the live pages. Dates and quotes below
are from those fetches, not from memory. **The API changed substantially in
2026 — do not trust older tutorials, including the ones in your own head.**

### Redirect URI schemes — CONFIRMED

`localhost` is rejected; `http://127.0.0.1:PORT` or `http://[::1]:PORT` is
required for loopback; https is required for everything else. Quoted verbatim
in §2. Enforced for new apps from 9 April 2025, all apps by November 2025.
- <https://developer.spotify.com/documentation/web-api/concepts/redirect_uri>

### `preview_url` — DEAD IN PRACTICE. Do not build on it.

The field still exists on the track object and is annotated **both `Nullable`
and `Deprecated`** on the current reference page. The November 2024 changes
restricted "30-second preview URLs in multi-get responses" for development-mode
and newly registered apps, and consistent community reporting since is that
apps registered after 2024-11-27 receive `null` everywhere — tracks, albums,
playlists, search. No restoration has been announced.

**Verdict:** `SpotifyTrack.previewUrl` is mapped (it is in the frozen types and
costs nothing), and `lib/spotify/types.ts` already warns "Frequently null —
never rely on it." **No Dampen feature depends on it.** Assume `null`.
- <https://developer.spotify.com/documentation/web-api/reference/get-track>
- <https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api>

### `/audio-features`, `/audio-analysis`, `/recommendations`, related-artists — DEAD. Not used.

The 27 November 2024 restrictions are **still in force and were never
reversed** — the blog post carries no update or reversal note. Restricted:
Related Artists, Recommendations, **Audio Features**, **Audio Analysis**, Get
Featured Playlists, Get Category's Playlists, 30-second preview URLs in
multi-get responses, and algorithmic/Spotify-owned editorial playlists.

Affected: "Existing apps that are still in development mode without a pending
extension request" and "New apps that are registered on or after today's date."
Not affected: apps with existing extended-mode access.

**Verdict:** these return **403** for any app you can realistically register
today. **Dampen uses none of them**, and the proxy allowlist in
`lib/spotify/endpoints.ts` actively refuses them — there is a test asserting
`/audio-features/{id}` and `/recommendations` are not proxyable. No
tempo/energy/danceability features, and no "recommended tracks" feature, are
possible on this app. Don't add one.
- <https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api>

### Web Playback SDK — CONFIRMED, mechanics unchanged

- Premium required: *"The Web Playback SDK requires a Spotify Premium
  subscription (mobile only types of premium subscriptions are excluded)"*.
- Browsers: *"Chrome, Firefox, Safari and Microsoft Edge ... in both mobile
  (Android and iOS) and Desktop (macOS, Windows and Linux)"*.
- *"The Web Playback SDK require iframes to allow `encrypted-media` and
  `autoplay` in cases of cross origin iframes."*
- Script `https://sdk.scdn.co/spotify-player.js`, the
  `window.onSpotifyWebPlaybackSDKReady` global, the `getOAuthToken` callback,
  and the event set (`ready`, `not_ready`, `player_state_changed`,
  `autoplay_failed`, `initialization_error`, `authentication_error`,
  `account_error`, `playback_error`) are all unchanged. `enableMediaSession`
  defaults to **false**; Dampen leaves it off so the SDK doesn't grab the OS
  media keys away from the engine.
- **Caveat, honestly flagged:** no current official page states the exact
  required scope *triple* (`streaming user-read-email user-read-private`). Only
  `streaming` is confirmed as the SDK scope. The other two are requested anyway
  because `GET /me` needs them, so this is moot in practice.
- <https://developer.spotify.com/documentation/web-playback-sdk>

### February 2026 Development Mode changes — CONFIRMED, and they bite

Timeline from the migration guide: **11 February 2026** for newly created
development-mode apps, **9 March 2026** for existing ones. Extended quota apps
are explicitly exempt: *"Apps in extended quota mode are not affected by any of
the changes described in this guide."*

What affects Dampen:

| Change | Dampen's response |
|---|---|
| `GET /playlists/{id}/tracks` → **`GET /playlists/{id}/items`**, and the row key `track` → `item` | `client.ts` tries `/items` first, falls back to `/tracks` on 403/404, and **remembers which worked**. `mapTrackRowWithAddedAt` accepts either row key. Both paths are allowlisted. |
| `GET /me` **no longer returns `product`, `email`, `country`, `followers`** | `premiumStatus` is tri-state; the SDK connect attempt is the Premium probe. See §4. |
| `/search` `limit` max **50 → 10**, default 20 → 5 | `SEARCH_LIMIT_MAX = 10`, enforced client-side so it can't 400. |
| Playlist object's `tracks` count renamed to `items` | `mapPlaylist` reads `items.total` first, falls back to `tracks.total`. |
| `PUT`/`DELETE /me/tracks` → `/me/library` | Dampen never writes to the library. Only `GET /me/tracks`, which is unchanged. |
| Batch `GET /tracks`, `/albums`, `/artists` removed | Not used. |

**Unaffected and confirmed working:** `GET /me`, `GET /me/playlists`,
`GET /me/tracks`, `GET /me/player/recently-played`, `GET /me/top/{type}`,
`GET /search`, `GET /me/player`, `GET /me/player/devices`, and every playback
mutation (`play`, `pause`, `next`, `previous`, `seek`, `volume`, `shuffle`,
`repeat`, `PUT /me/player` transfer).

One documented contradiction worth knowing: the February 2026 blog post has an
appended note saying endpoint-access changes for *existing* integrations were
**postponed**, while the migration guide's timeline table still shows 9 March
2026 with no such note. Either way, **a client ID registered today gets the
restricted set**, which is what the code above is written against.
- <https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide>
- <https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security>

### PKCE and token refresh — CONFIRMED, with one gap

The PKCE token exchange takes `grant_type`, `code`, `redirect_uri`,
`client_id`, `code_verifier` as form-encoded body params, with no
`Authorization` header and no `client_secret`.

**UNCONFIRMED:** no official sentence states whether `client_secret` is
*rejected* or merely *ignored* under PKCE. The docs simply never include it,
and community reports show `invalid_client` when it is mixed in. Hence the
public-first-with-Basic-fallback design in §6 rather than a guess.

Refresh-token rotation is **not guaranteed**: *"depending on the grant used to
get the initial refresh token, a refresh token might not be included in each
response. When a refresh token is not returned, continue using the existing
token."* Implemented exactly that way.

Refresh tokens expire 6 months from original authorization and refreshing does
not extend it — see §6.
- <https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow>
- <https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens>
- <https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration>

### Rate limits — PARTIALLY CONFIRMED

Computed over a **rolling 30-second window**; 429 responses "normally include a
`Retry-After` header with a value in seconds". Since July 2026, quota breaches
carry a structured body with `"reason": "QUOTA_EXCEEDED"`, which is a different
condition from plain rate limiting — backing off does not refill a spent quota.
Dampen classifies the two separately (`rate_limited` vs `quota_exceeded`).

**UNCONFIRMED:** the actual numeric limits are not publicly documented and
Spotify states they are subject to change. Don't tune against a number.
- <https://developer.spotify.com/documentation/web-api/concepts/rate-limits>
- <https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates>

### Also UNCONFIRMED

- Whether a `market` parameter has become mandatory anywhere — no changelog
  entry says so. Dampen passes `market=from_token` on `/search` regardless, to
  keep unplayable results out.
- Custom-scheme redirect URIs (`myapp://callback`) — the redirect-URI page does
  not discuss them. Irrelevant for a web app.
