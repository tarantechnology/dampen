# Public module APIs — the contract between agents

Code against these signatures exactly. If you need to deviate, the deviation
must be *additive* (extra optional fields), never a rename or a removal.

## `lib/audio/useDampen.ts`  (owner: engine)

```ts
import type { DampenParams, EngineMeters, EngineStatus, InputMode, DampenSource } from '@/lib/types';

export function useDampen(): {
  status: EngineStatus;
  /** Live, fully-resolved params (macro already applied). */
  params: DampenParams;
  presetId: string;
  bypass: boolean;
  /** Updated ~20 Hz while running. */
  meters: EngineMeters;
  inputMode: InputMode;

  /** Must be called from a user gesture — browsers require it. */
  start(): Promise<void>;
  setSource(src: DampenSource): Promise<void>;
  setInputMode(m: InputMode): void;

  /** Dot-path setter, e.g. setParam('lowpass.freq', 800). */
  setParam(path: string, value: number | string): void;
  applyPreset(id: string): void;
  /** The macro dial, 0..1. */
  setAmount(a: number): void;
  setBypass(b: boolean): void;

  /** For the visualiser. Null until started. */
  analysers: { input: AnalyserNode; output: AnalyserNode } | null;
  /** Magnitude response of the EQ/filter section, dB, for the given freqs. */
  filterResponse(freqs: Float32Array): Float32Array;
};

export const PRESETS: Preset[];           // from lib/audio/presets.ts
export const DEFAULT_PARAMS: DampenParams;
```

## `lib/audio/capture.ts`  (owner: engine)

```ts
export interface CaptureDevice { deviceId: string; label: string; likelyVirtual: boolean }
/** Enumerate audio inputs, flagging BlackHole / VB-Cable / Loopback / Soundflower. */
export function listCaptureDevices(): Promise<CaptureDevice[]>;
export function openCapture(deviceId: string): Promise<MediaStream>;
```

## `lib/spotify/useSpotify.ts`  (owner: spotify)

```ts
export function useAuth(): {
  status: AuthStatus;
  user: SpotifyUser | null;
  isPremium: boolean;
  login(): void;
  logout(): void;
};

export function useLibrary(): {
  playlists: SpotifyPlaylist[];
  savedTracks: SpotifyTrack[];
  recentlyPlayed: SpotifyTrack[];
  topTracks: SpotifyTrack[];
  topArtists: SpotifyArtist[];
  isLoading: boolean;
  error: string | null;
  refresh(): void;
};

export function usePlaylistTracks(playlistId: string | null): {
  tracks: SpotifyTrack[]; isLoading: boolean; error: string | null;
};

export function useSearch(query: string): {
  results: SearchResults | null; isLoading: boolean;
};
```

## `lib/spotify/usePlayback.ts`  (owner: spotify)

```ts
export function usePlayback(): {
  /** Null when no device is active. */
  state: PlaybackState | null;
  /** Our Web Playback SDK device id, once registered. */
  localDeviceId: string | null;
  isReady: boolean;
  /** True if playback is happening on OUR in-browser device. */
  isLocalDevice: boolean;
  devices: SpotifyDevice[];

  play(opts?: { uris?: string[]; contextUri?: string; offset?: number }): Promise<void>;
  pause(): Promise<void>;
  toggle(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(ms: number): Promise<void>;
  /** 0..1 */
  setVolume(v: number): Promise<void>;
  setShuffle(on: boolean): Promise<void>;
  cycleRepeat(): Promise<void>;
  transferTo(deviceId: string): Promise<void>;
  refreshDevices(): Promise<void>;
};
```

## Route handlers  (owner: spotify)

| Route | Purpose |
|---|---|
| `GET  /api/spotify/login` | 302 to Spotify authorize with PKCE challenge; stores verifier+state in httpOnly cookies |
| `GET  /api/spotify/callback` | exchanges code, sets httpOnly session cookies, 302 back to `/` |
| `POST /api/spotify/logout` | clears cookies |
| `GET  /api/spotify/token` | returns `{ accessToken, expiresAt }` for the Web Playback SDK, refreshing if needed |
| `ALL  /api/spotify/proxy/[...path]` | authenticated passthrough to `api.spotify.com/v1/*` so the browser never holds a refresh token |
