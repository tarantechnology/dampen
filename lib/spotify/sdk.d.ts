/**
 * Types for the Spotify Web Playback SDK global, as loaded from
 * https://sdk.scdn.co/spotify-player.js
 *
 * This file is a global script (no top-level import/export), so `Spotify.*`
 * and the `Window` members below are ambient everywhere in the project.
 *
 * Only the surface `usePlayback.ts` actually touches is declared. Fields that
 * the SDK documents but that are empirically absent during transfers are typed
 * as nullable so the mappers are forced to handle them.
 */

declare namespace Spotify {
  interface Image {
    readonly url: string;
    readonly height?: number | null;
    readonly width?: number | null;
    /** 'unknown' | 'small' | 'medium' | 'large' | 'xlarge' */
    readonly size?: string;
  }

  /** An artist or album reference inside a `Track`. */
  interface Entity {
    readonly uri: string;
    readonly name: string;
    readonly url?: string;
  }

  interface Album {
    readonly uri: string;
    readonly name: string;
    readonly images: readonly Image[];
  }

  interface Track {
    readonly uri: string;
    /** Null for local files and some ad / podcast items. */
    readonly id: string | null;
    readonly type: 'track' | 'episode' | 'ad';
    readonly media_type: 'audio' | 'video';
    readonly name: string;
    readonly duration_ms: number;
    readonly is_playable?: boolean;
    readonly album: Album;
    readonly artists: readonly Entity[];
    readonly linked_from?: { readonly uri: string | null; readonly id: string | null };
    readonly explicit?: boolean;
  }

  interface TrackWindow {
    /** Null in the brief window after `connect()` but before the first track. */
    readonly current_track: Track | null;
    readonly previous_tracks: readonly Track[];
    readonly next_tracks: readonly Track[];
  }

  interface PlaybackContextMetadata {
    readonly context_description?: string | null;
  }

  interface PlaybackContext {
    readonly uri: string | null;
    readonly metadata: PlaybackContextMetadata | null;
  }

  interface PlaybackRestrictions {
    readonly disallow_pausing_reasons: readonly string[];
    readonly disallow_peeking_next_reasons: readonly string[];
    readonly disallow_peeking_prev_reasons: readonly string[];
    readonly disallow_resuming_reasons: readonly string[];
    readonly disallow_seeking_reasons: readonly string[];
    readonly disallow_skipping_next_reasons: readonly string[];
    readonly disallow_skipping_prev_reasons: readonly string[];
  }

  interface PlaybackDisallows {
    readonly pausing?: boolean;
    readonly peeking_next?: boolean;
    readonly peeking_prev?: boolean;
    readonly resuming?: boolean;
    readonly seeking?: boolean;
    readonly skipping_next?: boolean;
    readonly skipping_prev?: boolean;
  }

  interface PlaybackState {
    readonly context: PlaybackContext;
    readonly disallows: PlaybackDisallows;
    readonly duration: number;
    readonly paused: boolean;
    readonly position: number;
    /** 0 = off, 1 = one track, 2 = whole context. */
    readonly repeat_mode: 0 | 1 | 2;
    readonly shuffle: boolean;
    readonly restrictions?: PlaybackRestrictions;
    readonly track_window: TrackWindow;
    /** ms since epoch at which `position` was accurate. */
    readonly timestamp?: number;
    readonly loading?: boolean;
  }

  interface WebPlaybackInstance {
    readonly device_id: string;
  }

  interface Error {
    readonly message: string;
  }

  type ErrorEvent =
    | 'initialization_error'
    | 'authentication_error'
    | 'account_error'
    | 'playback_error'
    | 'autoplay_failed';

  interface PlayerInit {
    name: string;
    /**
     * Called by the SDK whenever it needs a (fresh) access token. Invoke the
     * callback with the token; never call it with an empty string — the SDK
     * will loop on `authentication_error`.
     */
    getOAuthToken: (callback: (token: string) => void) => void;
    /** 0..1. Defaults to 1 if omitted. */
    volume?: number;
    /**
     * Default false. When true the SDK populates the Media Session API and
     * takes over the OS media keys — left off so it cannot fight Dampen's own
     * transport or the user's other audio.
     */
    enableMediaSession?: boolean;
  }

  class Player {
    constructor(options: PlayerInit);

    addListener(event: 'ready' | 'not_ready', callback: (instance: WebPlaybackInstance) => void): boolean;
    addListener(event: 'player_state_changed', callback: (state: PlaybackState | null) => void): boolean;
    addListener(event: ErrorEvent, callback: (error: Error) => void): boolean;

    removeListener(event: 'ready' | 'not_ready', callback?: (instance: WebPlaybackInstance) => void): boolean;
    removeListener(event: 'player_state_changed', callback?: (state: PlaybackState | null) => void): boolean;
    removeListener(event: ErrorEvent, callback?: (error: Error) => void): boolean;

    connect(): Promise<boolean>;
    disconnect(): void;

    getCurrentState(): Promise<PlaybackState | null>;
    getVolume(): Promise<number>;
    setVolume(volume: number): Promise<void>;
    setName(name: string): Promise<void>;

    pause(): Promise<void>;
    resume(): Promise<void>;
    togglePlay(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    previousTrack(): Promise<void>;
    nextTrack(): Promise<void>;

    activateElement(): Promise<void>;
  }
}

interface Window {
  readonly Spotify?: { readonly Player: typeof Spotify.Player };
  /**
   * The SDK script calls this exactly once, when it has finished loading.
   * It must be assigned *before* the script tag is appended.
   */
  onSpotifyWebPlaybackSDKReady?: (() => void) | undefined;
}
