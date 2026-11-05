/**
 * Raw Spotify wire shapes -> the normalised types in `./types.ts`.
 *
 * Every function here takes `unknown` and returns either a fully-populated
 * domain object or `null`. Nothing throws, nothing returns a half-built object
 * with `undefined` fields. Callers use `mapArray` so rejected rows disappear
 * instead of rendering as blanks.
 *
 * Reality this has to absorb, all observed in production responses:
 *   - `playlist_track.track` is `null` for tracks removed from Spotify
 *   - local files: `track.id === null`, `uri === 'spotify:local:...'` (unplayable)
 *   - `images: []` on brand-new playlists and many artists
 *   - podcast episodes appear where tracks are expected, with no `album`/`artists`
 *   - `album` missing entirely on some `/me/top/tracks` and search rows
 *   - `width`/`height` null on source-resolution images
 *   - `public` null on playlists you don't own
 */

import type {
  PlaybackState,
  SearchResults,
  SpotifyAlbumRef,
  SpotifyArtist,
  SpotifyArtistRef,
  SpotifyDevice,
  SpotifyImage,
  SpotifyPlaylist,
  SpotifyTrack,
  SpotifyUser,
} from './types';
import {
  arr,
  bool,
  boolOr,
  intOr,
  isRecord,
  mapArray,
  num,
  rec,
  str,
  strArray,
  strOr,
} from './guards';

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

export function mapImage(raw: unknown): SpotifyImage | null {
  const url = str(raw, 'url');
  if (url === null) return null;
  // Only accept http(s) URLs — never let a `javascript:` or `data:` string
  // from the wire reach an <img src>.
  if (!/^https?:\/\//i.test(url)) return null;
  return { url, width: num(raw, 'width'), height: num(raw, 'height') };
}

/** Largest-first, so `images[0]` is always the best available art. */
export function mapImages(source: unknown, key = 'images'): SpotifyImage[] {
  const images = mapArray(source, key, mapImage);
  return images.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
}

export function mapArtistRef(raw: unknown): SpotifyArtistRef | null {
  const name = str(raw, 'name');
  if (name === null) return null;
  // Artist id can legitimately be absent on local-file metadata; the name is
  // what the UI renders, so keep the row with an empty id rather than drop it.
  return { id: strOr(raw, 'id', ''), name };
}

export function mapAlbumRef(raw: unknown): SpotifyAlbumRef | null {
  if (!isRecord(raw)) return null;
  const name = str(raw, 'name');
  const id = str(raw, 'id');
  if (name === null && id === null) return null;
  return {
    id: id ?? '',
    name: name ?? '',
    images: mapImages(raw),
    releaseDate: str(raw, 'release_date'),
  };
}

/** `album.id === ''` and `album.name === ''` mean "no album metadata". */
const NO_ALBUM: SpotifyAlbumRef = { id: '', name: '', images: [], releaseDate: null };

/* ------------------------------------------------------------------ *
 * Tracks
 * ------------------------------------------------------------------ */

/**
 * A row is a usable track when we have something to show (a name) and
 * something to play (an id that yields a `spotify:track:` / `spotify:episode:`
 * URI). Local files fail the second test and are dropped: the Web API cannot
 * start playback for them.
 */
export function mapTrack(raw: unknown): SpotifyTrack | null {
  if (!isRecord(raw)) return null;

  const name = str(raw, 'name');
  if (name === null) return null;

  const type = str(raw, 'type');
  if (type === 'episode') return mapEpisodeAsTrack(raw, name);

  if (boolOr(raw, 'is_local', false)) return null;

  const id = str(raw, 'id');
  const rawUri = str(raw, 'uri');
  if (rawUri !== null && rawUri.startsWith('spotify:local:')) return null;

  const uri = rawUri ?? (id === null ? null : `spotify:track:${id}`);
  if (id === null || uri === null) return null;

  const album = mapAlbumRef(rec(raw, 'album')) ?? NO_ALBUM;

  return {
    id,
    uri,
    name,
    durationMs: intOr(raw, 'duration_ms', 0),
    explicit: boolOr(raw, 'explicit', false),
    artists: mapArray(raw, 'artists', mapArtistRef),
    album,
    previewUrl: httpsOrNull(str(raw, 'preview_url')),
  };
}

/**
 * Episodes turn up wherever tracks do once a user has podcasts in their
 * library or is listening to one. They have no `album`/`artists`, so project
 * the show into those slots rather than dropping the row — otherwise
 * now-playing goes blank mid-podcast.
 */
function mapEpisodeAsTrack(raw: unknown, name: string): SpotifyTrack | null {
  const id = str(raw, 'id');
  if (id === null) return null;
  const uri = str(raw, 'uri') ?? `spotify:episode:${id}`;

  const show = rec(raw, 'show');
  const showName = str(show, 'name');
  const publisher = str(show, 'publisher');
  const ownImages = mapImages(raw);
  const showImages = mapImages(show);

  const artists: SpotifyArtistRef[] = [];
  const artistName = publisher ?? showName;
  if (artistName !== null) artists.push({ id: strOr(show, 'id', ''), name: artistName });

  return {
    id,
    uri,
    name,
    durationMs: intOr(raw, 'duration_ms', 0),
    explicit: boolOr(raw, 'explicit', false),
    artists,
    album: {
      id: strOr(show, 'id', ''),
      name: showName ?? '',
      images: showImages.length > 0 ? showImages : ownImages,
      releaseDate: str(raw, 'release_date'),
    },
    previewUrl: httpsOrNull(str(raw, 'audio_preview_url')),
  };
}

function httpsOrNull(value: string | null): string | null {
  if (value === null) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

/** `{ added_at, track }` from `/me/tracks` and `/playlists/{id}/tracks`. */
export function mapTrackRowWithAddedAt(raw: unknown): SpotifyTrack | null {
  if (!isRecord(raw)) return null;
  // `track` is null for tracks delisted from Spotify. This is the common case
  // this mapper exists for.
  const track = mapTrack(raw.track);
  if (track === null) return null;
  const addedAt = str(raw, 'added_at');
  return addedAt === null ? track : { ...track, addedAt };
}

/** `{ played_at, track }` from `/me/player/recently-played`. */
export function mapRecentlyPlayedRow(raw: unknown): SpotifyTrack | null {
  if (!isRecord(raw)) return null;
  const track = mapTrack(raw.track);
  if (track === null) return null;
  const playedAt = str(raw, 'played_at');
  return playedAt === null ? track : { ...track, playedAt };
}

/* ------------------------------------------------------------------ *
 * Artists, playlists, user, devices
 * ------------------------------------------------------------------ */

export function mapArtist(raw: unknown): SpotifyArtist | null {
  if (!isRecord(raw)) return null;
  const id = str(raw, 'id');
  const name = str(raw, 'name');
  if (id === null || name === null) return null;
  return {
    id,
    uri: str(raw, 'uri') ?? `spotify:artist:${id}`,
    name,
    images: mapImages(raw),
    genres: strArray(raw, 'genres'),
    followers: num(rec(raw, 'followers'), 'total'),
  };
}

export function mapPlaylist(raw: unknown): SpotifyPlaylist | null {
  if (!isRecord(raw)) return null;
  const id = str(raw, 'id');
  const name = str(raw, 'name');
  if (id === null || name === null) return null;
  return {
    id,
    uri: str(raw, 'uri') ?? `spotify:playlist:${id}`,
    name,
    // Spotify sends `""` far more often than a real description.
    description: strOr(raw, 'description', ''),
    images: mapImages(raw),
    trackCount: intOr(rec(raw, 'tracks'), 'total', 0),
    ownerName: str(rec(raw, 'owner'), 'display_name') ?? str(rec(raw, 'owner'), 'id') ?? '',
    collaborative: boolOr(raw, 'collaborative', false),
    // Genuinely tri-state: null when the caller can't see the setting.
    isPublic: bool(raw, 'public'),
  };
}

/** Search returns simplified album objects; promote them to `SpotifyAlbumRef`. */
export function mapAlbum(raw: unknown): SpotifyAlbumRef | null {
  return mapAlbumRef(raw);
}

export function mapUser(raw: unknown): SpotifyUser | null {
  if (!isRecord(raw)) return null;
  const id = str(raw, 'id');
  if (id === null) return null;
  return {
    id,
    displayName: str(raw, 'display_name') ?? id,
    // Only present with the `user-read-email` scope.
    email: str(raw, 'email'),
    images: mapImages(raw),
    product: str(raw, 'product'),
    country: str(raw, 'country'),
  };
}

export function mapDevice(raw: unknown): SpotifyDevice | null {
  if (!isRecord(raw)) return null;
  const name = str(raw, 'name');
  if (name === null) return null;
  return {
    // Restricted devices (e.g. some Cast targets) report a null id and cannot
    // be transferred to. Keep them listed so the UI can show them greyed out.
    id: str(raw, 'id'),
    name,
    type: strOr(raw, 'type', 'Unknown'),
    isActive: boolOr(raw, 'is_active', false),
    volumePercent: clampPercent(num(raw, 'volume_percent')),
  };
}

function clampPercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/* ------------------------------------------------------------------ *
 * Playback
 * ------------------------------------------------------------------ */

const REPEAT_MODES = ['off', 'track', 'context'] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];

export function asRepeatMode(value: unknown): RepeatMode {
  return typeof value === 'string' && (REPEAT_MODES as readonly string[]).includes(value)
    ? (value as RepeatMode)
    : 'off';
}

/**
 * `GET /me/player`. Note this endpoint answers `204 No Content` when nothing
 * is active — the caller turns that into `null` before we ever get here.
 */
export function mapPlaybackState(raw: unknown): PlaybackState | null {
  if (!isRecord(raw)) return null;

  const device = rec(raw, 'device');
  const track = mapTrack(raw.item);
  const volumePercent = clampPercent(num(device, 'volume_percent'));

  return {
    isPlaying: boolOr(raw, 'is_playing', false),
    position: intOr(raw, 'progress_ms', 0),
    durationMs: track?.durationMs ?? intOr(rec(raw, 'item'), 'duration_ms', 0),
    track,
    // Devices that don't expose volume report null; show full rather than
    // muted so a slider doesn't lie about silence.
    volume: volumePercent === null ? 1 : volumePercent / 100,
    shuffle: boolOr(raw, 'shuffle_state', false),
    repeat: asRepeatMode(raw.repeat_state),
    deviceName: str(device, 'name'),
    contextUri: str(rec(raw, 'context'), 'uri'),
  };
}

/** `GET /me/player/devices` -> `{ devices: [...] }`. */
export function mapDevices(raw: unknown): SpotifyDevice[] {
  return mapArray(raw, 'devices', mapDevice);
}

/**
 * The Web Playback SDK's own state object. Different shape from the Web API's,
 * and fully typed by `./sdk.d.ts`, but still defensive: `current_track` can be
 * absent during the first few hundred ms after a transfer.
 */
export function mapSdkState(state: Spotify.PlaybackState, deviceName: string): PlaybackState {
  const current = state.track_window.current_track;
  const track = current === null || current === undefined ? null : mapSdkTrack(current);
  return {
    isPlaying: !state.paused,
    position: Math.max(0, state.position),
    durationMs: track?.durationMs ?? Math.max(0, state.duration),
    track,
    // The SDK does not report volume in its state; usePlayback overlays the
    // value it reads from `player.getVolume()`.
    volume: 1,
    shuffle: state.shuffle,
    repeat: state.repeat_mode === 1 ? 'track' : state.repeat_mode === 2 ? 'context' : 'off',
    deviceName,
    contextUri: state.context.uri ?? null,
  };
}

/**
 * The SDK hands us real objects rather than JSON, so this one is typed — but
 * it is still written against what the SDK *actually* sends. Ads arrive as
 * `type: 'ad'` with a synthetic uri and no album art; they are kept (the user
 * is hearing them) but with empty artwork.
 */
export function mapSdkTrack(track: Spotify.Track): SpotifyTrack | null {
  const name = typeof track.name === 'string' ? track.name.trim() : '';
  if (name === '') return null;

  const uri = typeof track.uri === 'string' && track.uri !== '' ? track.uri : null;
  const id = typeof track.id === 'string' && track.id !== '' ? track.id : null;
  const resolvedUri = uri ?? (id === null ? null : `spotify:track:${id}`);
  if (resolvedUri === null) return null;

  const album: Spotify.Album | undefined = track.album;

  return {
    id: id ?? resolvedUri,
    uri: resolvedUri,
    name,
    durationMs:
      typeof track.duration_ms === 'number' && Number.isFinite(track.duration_ms)
        ? Math.max(0, Math.round(track.duration_ms))
        : 0,
    explicit: track.explicit === true,
    artists: (track.artists ?? [])
      .map(sdkEntityToArtistRef)
      .filter((a): a is SpotifyArtistRef => a !== null),
    album: {
      id: idFromUri(album?.uri),
      name: typeof album?.name === 'string' ? album.name : '',
      images: mapImages({ images: album?.images ?? [] }),
      releaseDate: null,
    },
    previewUrl: null,
  };
}

function sdkEntityToArtistRef(entity: Spotify.Entity | undefined): SpotifyArtistRef | null {
  const name = typeof entity?.name === 'string' ? entity.name.trim() : '';
  if (name === '') return null;
  return { id: idFromUri(entity?.uri), name };
}

/** `spotify:artist:4tZwfgrHOc3mvqYlEYSvVi` -> `4tZwfgrHOc3mvqYlEYSvVi`. */
function idFromUri(uri: string | undefined): string {
  if (typeof uri !== 'string') return '';
  const last = uri.split(':').pop();
  return last === undefined || last === uri ? '' : last;
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/**
 * `GET /search` returns one paging object per requested type, and omits the
 * key entirely for types with no hits. Spotify also seeds `playlists.items`
 * with nulls in some locales — `mapArray` drops those.
 */
export function mapSearchResults(raw: unknown): SearchResults {
  return {
    tracks: mapArray(rec(raw, 'tracks'), 'items', mapTrack),
    artists: mapArray(rec(raw, 'artists'), 'items', mapArtist),
    playlists: mapArray(rec(raw, 'playlists'), 'items', mapPlaylist),
    albums: mapArray(rec(raw, 'albums'), 'items', mapAlbum),
  };
}

/* ------------------------------------------------------------------ *
 * Paging
 * ------------------------------------------------------------------ */

export interface Page<T> {
  readonly items: T[];
  /** Absolute `https://api.spotify.com/v1/...` URL, or null on the last page. */
  readonly next: string | null;
  readonly total: number | null;
}

export function mapPage<T>(raw: unknown, mapItem: (item: unknown) => T | null): Page<T> {
  return {
    items: mapArray(raw, 'items', mapItem),
    next: str(raw, 'next'),
    total: num(raw, 'total'),
  };
}

/**
 * `GET /me/player/recently-played` is cursor-paged: it has `items` + `next`
 * but no meaningful `total`. Same mapper works; this alias documents intent.
 */
export function mapCursorPage<T>(raw: unknown, mapItem: (item: unknown) => T | null): Page<T> {
  return mapPage(raw, mapItem);
}

/** True when the response body had no recognisable paging envelope at all. */
export function looksLikePage(raw: unknown): boolean {
  return isRecord(raw) && Array.isArray(raw.items);
}

export { arr as rawArray };
