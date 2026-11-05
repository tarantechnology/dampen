/**
 * Spotify domain types — normalised, not raw API shapes.
 *
 * The client layer maps Spotify's wire format into these. The UI only ever
 * sees these. Keep them flat and boring.
 */

export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface SpotifyArtistRef {
  id: string;
  name: string;
}

export interface SpotifyAlbumRef {
  id: string;
  name: string;
  images: SpotifyImage[];
  releaseDate: string | null;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  durationMs: number;
  explicit: boolean;
  artists: SpotifyArtistRef[];
  album: SpotifyAlbumRef;
  /** 30s MP3 clip. Frequently null — never rely on it. */
  previewUrl: string | null;
  /** Present on saved-track and playlist-track rows. ISO 8601. */
  addedAt?: string;
  /** Present on recently-played rows. ISO 8601. */
  playedAt?: string;
}

export interface SpotifyArtist {
  id: string;
  uri: string;
  name: string;
  images: SpotifyImage[];
  genres: string[];
  followers: number | null;
}

export interface SpotifyPlaylist {
  id: string;
  uri: string;
  name: string;
  description: string;
  images: SpotifyImage[];
  trackCount: number;
  ownerName: string;
  collaborative: boolean;
  isPublic: boolean | null;
}

export interface SpotifyUser {
  id: string;
  displayName: string;
  email: string | null;
  images: SpotifyImage[];
  /** 'premium' | 'free' | 'open' | null */
  product: string | null;
  country: string | null;
}

export interface SpotifyDevice {
  id: string | null;
  name: string;
  type: string;
  isActive: boolean;
  volumePercent: number | null;
}

export interface PlaybackState {
  isPlaying: boolean;
  /** ms into the current track. */
  position: number;
  durationMs: number;
  track: SpotifyTrack | null;
  /** 0..1 */
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'track' | 'context';
  deviceName: string | null;
  /** Spotify context URI the track is playing from, if any. */
  contextUri: string | null;
}

export interface SearchResults {
  tracks: SpotifyTrack[];
  artists: SpotifyArtist[];
  playlists: SpotifyPlaylist[];
  albums: SpotifyAlbumRef[];
}

export type AuthStatus = 'loading' | 'anon' | 'authed' | 'error';
