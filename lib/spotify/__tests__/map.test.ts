/**
 * Mapper tests, run with `node --test --experimental-strip-types`.
 *
 * The brief for these mappers is "survive garbage input and filter out
 * unusable rows rather than rendering undefined into the UI", so the cases
 * below are mostly garbage on purpose: nulls where objects are documented,
 * wrong primitive types, missing required fields, and the specific real-world
 * shapes Spotify is known to send (null playlist tracks, local files,
 * podcast episodes, empty image arrays).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  asRepeatMode,
  mapAlbumRef,
  mapArtist,
  mapDevice,
  mapDevices,
  mapImage,
  mapImages,
  mapPage,
  mapPlaybackState,
  mapPlaylist,
  mapRecentlyPlayedRow,
  mapSearchResults,
  mapTrack,
  mapTrackRowWithAddedAt,
  mapUser,
} from '../map';

/** Values that must never crash any mapper. */
const GARBAGE: readonly unknown[] = [
  null,
  undefined,
  0,
  1,
  -1,
  NaN,
  '',
  'nope',
  true,
  false,
  [],
  [null],
  {},
  { name: null },
  { name: 123 },
  { id: {}, name: [] },
  Symbol.iterator,
  () => undefined,
];

describe('garbage tolerance', () => {
  const mappers: ReadonlyArray<[string, (raw: unknown) => unknown]> = [
    ['mapImage', mapImage],
    ['mapAlbumRef', mapAlbumRef],
    ['mapTrack', mapTrack],
    ['mapArtist', mapArtist],
    ['mapPlaylist', mapPlaylist],
    ['mapUser', mapUser],
    ['mapDevice', mapDevice],
    ['mapPlaybackState', mapPlaybackState],
    ['mapTrackRowWithAddedAt', mapTrackRowWithAddedAt],
    ['mapRecentlyPlayedRow', mapRecentlyPlayedRow],
  ];

  for (const [name, map] of mappers) {
    it(`${name} returns null (never throws) for every garbage input`, () => {
      for (const input of GARBAGE) {
        const result = map(input);
        assert.equal(result, null, `${name} should reject ${String(input)}`);
      }
    });
  }

  it('mapImages and mapSearchResults always return containers, never null', () => {
    for (const input of GARBAGE) {
      assert.deepEqual(mapImages(input), []);
      const results = mapSearchResults(input);
      assert.deepEqual(results, { tracks: [], artists: [], playlists: [], albums: [] });
    }
  });

  it('mapDevices returns [] for garbage', () => {
    for (const input of GARBAGE) assert.deepEqual(mapDevices(input), []);
  });

  it('mapPage returns an empty page for garbage', () => {
    for (const input of GARBAGE) {
      const page = mapPage(input, mapTrack);
      assert.deepEqual(page.items, []);
      assert.equal(page.next, null);
    }
  });
});

describe('mapImage', () => {
  it('keeps null width/height (Spotify sends them for source-resolution art)', () => {
    assert.deepEqual(mapImage({ url: 'https://i.scdn.co/image/abc', width: null, height: null }), {
      url: 'https://i.scdn.co/image/abc',
      width: null,
      height: null,
    });
  });

  it('rejects non-http(s) URLs so nothing hostile reaches an <img src>', () => {
    assert.equal(mapImage({ url: 'javascript:alert(1)' }), null);
    assert.equal(mapImage({ url: 'data:image/png;base64,AAAA' }), null);
    assert.equal(mapImage({ url: '//i.scdn.co/x' }), null);
  });

  it('sorts largest first so images[0] is the best art', () => {
    const images = mapImages({
      images: [
        { url: 'https://x/s', width: 64, height: 64 },
        { url: 'https://x/l', width: 640, height: 640 },
        { url: 'https://x/m', width: 300, height: 300 },
      ],
    });
    assert.deepEqual(
      images.map((i) => i.width),
      [640, 300, 64],
    );
  });

  it('drops unusable entries rather than the whole array', () => {
    const images = mapImages({ images: [null, { url: 'https://x/a' }, { width: 10 }, 'nope'] });
    assert.equal(images.length, 1);
    assert.equal(images[0]?.url, 'https://x/a');
  });
});

describe('mapTrack', () => {
  const full = {
    id: '4cOdK2wGLETKBW3PvgPWqT',
    uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
    name: 'Never Gonna Give You Up',
    duration_ms: 213_573,
    explicit: false,
    type: 'track',
    preview_url: 'https://p.scdn.co/mp3-preview/abc',
    artists: [{ id: '0gxyHStUsqpMadRV0Di1Qt', name: 'Rick Astley' }],
    album: {
      id: '6eUW0wxWtzkFdaEFsTJto6',
      name: 'Whenever You Need Somebody',
      release_date: '1987-11-12',
      images: [{ url: 'https://i.scdn.co/image/ab', width: 640, height: 640 }],
    },
  };

  it('maps a complete track', () => {
    const track = mapTrack(full);
    assert.ok(track !== null);
    assert.equal(track.name, 'Never Gonna Give You Up');
    assert.equal(track.durationMs, 213_573);
    assert.equal(track.artists[0]?.name, 'Rick Astley');
    assert.equal(track.album.releaseDate, '1987-11-12');
    assert.equal(track.previewUrl, 'https://p.scdn.co/mp3-preview/abc');
  });

  it('survives a missing album with an empty placeholder, not undefined', () => {
    const noAlbum: Record<string, unknown> = { ...full };
    delete noAlbum.album;
    const track = mapTrack(noAlbum);
    assert.ok(track !== null);
    assert.deepEqual(track.album, { id: '', name: '', images: [], releaseDate: null });
    assert.notEqual(track.album, undefined);
  });

  it('survives an empty images array', () => {
    const track = mapTrack({ ...full, album: { ...full.album, images: [] } });
    assert.ok(track !== null);
    assert.deepEqual(track.album.images, []);
  });

  it('survives missing artists with an empty array', () => {
    const track = mapTrack({ ...full, artists: null });
    assert.ok(track !== null);
    assert.deepEqual(track.artists, []);
  });

  it('treats preview_url: null as null (it is deprecated and now usually null)', () => {
    const track = mapTrack({ ...full, preview_url: null });
    assert.equal(track?.previewUrl, null);
  });

  it('drops local files — they have no id and cannot be played via the API', () => {
    assert.equal(mapTrack({ ...full, id: null, is_local: true, uri: 'spotify:local:a:b:c:1' }), null);
    assert.equal(mapTrack({ ...full, is_local: true }), null);
    assert.equal(mapTrack({ ...full, id: null, uri: 'spotify:local:x' }), null);
  });

  it('drops a row with no id at all', () => {
    assert.equal(mapTrack({ ...full, id: null, uri: null }), null);
  });

  it('synthesises a uri when only the id is present', () => {
    const track = mapTrack({ ...full, uri: undefined });
    assert.equal(track?.uri, 'spotify:track:4cOdK2wGLETKBW3PvgPWqT');
  });

  it('clamps a nonsense duration to 0 rather than emitting NaN', () => {
    assert.equal(mapTrack({ ...full, duration_ms: 'long' })?.durationMs, 0);
    assert.equal(mapTrack({ ...full, duration_ms: NaN })?.durationMs, 0);
    assert.equal(mapTrack({ ...full, duration_ms: -5 })?.durationMs, 0);
  });

  it('maps a podcast episode into the track shape using the show', () => {
    const episode = mapTrack({
      type: 'episode',
      id: '512ojhOuo1ktJprKbVcKyQ',
      uri: 'spotify:episode:512ojhOuo1ktJprKbVcKyQ',
      name: 'Episode 1',
      duration_ms: 1_800_000,
      release_date: '2026-01-02',
      show: {
        id: '38bS44xjbVVZ3No3ByF1dJ',
        name: 'A Show',
        publisher: 'A Publisher',
        images: [{ url: 'https://i.scdn.co/image/show', width: 640, height: 640 }],
      },
    });
    assert.ok(episode !== null);
    assert.equal(episode.name, 'Episode 1');
    assert.equal(episode.album.name, 'A Show');
    assert.equal(episode.artists[0]?.name, 'A Publisher');
    assert.equal(episode.album.images.length, 1);
  });
});

describe('playlist and saved-track rows', () => {
  const track = { id: 'abc', uri: 'spotify:track:abc', name: 'T', duration_ms: 1, type: 'track' };

  it('drops rows whose track is null (delisted tracks)', () => {
    assert.equal(mapTrackRowWithAddedAt({ added_at: '2024-01-01T00:00:00Z', track: null }), null);
    assert.equal(mapTrackRowWithAddedAt({ added_at: '2024-01-01T00:00:00Z', item: null }), null);
  });

  it('accepts the pre-2026 `track` key', () => {
    const row = mapTrackRowWithAddedAt({ added_at: '2024-01-01T00:00:00Z', track });
    assert.equal(row?.addedAt, '2024-01-01T00:00:00Z');
  });

  it('accepts the post-Feb-2026 `item` key', () => {
    const row = mapTrackRowWithAddedAt({ added_at: '2024-01-01T00:00:00Z', item: track });
    assert.equal(row?.id, 'abc');
    assert.equal(row?.addedAt, '2024-01-01T00:00:00Z');
  });

  it('omits addedAt rather than setting it to undefined when absent', () => {
    const row = mapTrackRowWithAddedAt({ track });
    assert.ok(row !== null);
    assert.equal('addedAt' in row, false);
  });

  it('maps played_at on recently-played rows', () => {
    const row = mapRecentlyPlayedRow({ played_at: '2026-03-04T05:06:07Z', track });
    assert.equal(row?.playedAt, '2026-03-04T05:06:07Z');
  });
});

describe('mapPlaylist', () => {
  it('reads the new `items.total` count and falls back to `tracks.total`', () => {
    const base = { id: 'p1', name: 'Mine', owner: { display_name: 'Me' } };
    assert.equal(mapPlaylist({ ...base, items: { total: 7 } })?.trackCount, 7);
    assert.equal(mapPlaylist({ ...base, tracks: { total: 3 } })?.trackCount, 3);
    // New key wins when both are present.
    assert.equal(mapPlaylist({ ...base, items: { total: 7 }, tracks: { total: 3 } })?.trackCount, 7);
    assert.equal(mapPlaylist(base)?.trackCount, 0);
  });

  it('keeps `public: null` as null — it is genuinely tri-state', () => {
    assert.equal(mapPlaylist({ id: 'p', name: 'n', public: null })?.isPublic, null);
    assert.equal(mapPlaylist({ id: 'p', name: 'n', public: false })?.isPublic, false);
    assert.equal(mapPlaylist({ id: 'p', name: 'n', public: true })?.isPublic, true);
  });

  it('falls back from owner.display_name to owner.id, then to empty string', () => {
    assert.equal(mapPlaylist({ id: 'p', name: 'n', owner: { id: 'uid' } })?.ownerName, 'uid');
    assert.equal(mapPlaylist({ id: 'p', name: 'n' })?.ownerName, '');
  });

  it('normalises a missing description to an empty string', () => {
    assert.equal(mapPlaylist({ id: 'p', name: 'n' })?.description, '');
  });
});

describe('mapUser', () => {
  it('treats a withheld product as null, not as free', () => {
    const user = mapUser({ id: 'u1', display_name: 'Me' });
    assert.equal(user?.product, null);
    assert.equal(user?.email, null);
    assert.equal(user?.country, null);
  });

  it('falls back to the id when display_name is missing', () => {
    assert.equal(mapUser({ id: 'u1' })?.displayName, 'u1');
  });
});

describe('mapDevice', () => {
  it('keeps restricted devices with a null id so the UI can grey them out', () => {
    const device = mapDevice({ id: null, name: 'Living Room', type: 'CastAudio', is_active: false });
    assert.equal(device?.id, null);
    assert.equal(device?.name, 'Living Room');
  });

  it('clamps volume_percent and preserves null', () => {
    assert.equal(mapDevice({ name: 'd', volume_percent: 150 })?.volumePercent, 100);
    assert.equal(mapDevice({ name: 'd', volume_percent: -20 })?.volumePercent, 0);
    assert.equal(mapDevice({ name: 'd', volume_percent: null })?.volumePercent, null);
  });
});

describe('mapPlaybackState', () => {
  it('maps a full state', () => {
    const state = mapPlaybackState({
      is_playing: true,
      progress_ms: 1_234,
      shuffle_state: true,
      repeat_state: 'context',
      device: { name: 'Phone', volume_percent: 55 },
      context: { uri: 'spotify:playlist:xyz' },
      item: { id: 't', uri: 'spotify:track:t', name: 'T', duration_ms: 9_000, type: 'track' },
    });
    assert.ok(state !== null);
    assert.equal(state.isPlaying, true);
    assert.equal(state.position, 1_234);
    assert.equal(state.durationMs, 9_000);
    assert.equal(state.volume, 0.55);
    assert.equal(state.repeat, 'context');
    assert.equal(state.deviceName, 'Phone');
    assert.equal(state.contextUri, 'spotify:playlist:xyz');
  });

  it('reports volume 1 when the device does not expose volume', () => {
    const state = mapPlaybackState({ device: { name: 'Cast', volume_percent: null } });
    assert.equal(state?.volume, 1);
  });

  it('keeps a null item instead of failing (ads and podcast gaps)', () => {
    const state = mapPlaybackState({ is_playing: true, item: null, device: { name: 'd' } });
    assert.ok(state !== null);
    assert.equal(state.track, null);
    assert.equal(state.durationMs, 0);
  });

  it('coerces an unknown repeat_state to off', () => {
    assert.equal(mapPlaybackState({ is_playing: false, repeat_state: 'sideways' })?.repeat, 'off');
    assert.equal(asRepeatMode(undefined), 'off');
    assert.equal(asRepeatMode('track'), 'track');
  });

  it('rejects an object with no recognisable playback field', () => {
    // Guards against reporting a confident "nothing is playing" for a body we
    // did not actually understand.
    assert.equal(mapPlaybackState({}), null);
    assert.equal(mapPlaybackState({ unrelated: true }), null);
    // One recognisable field is enough.
    assert.notEqual(mapPlaybackState({ is_playing: false }), null);
    assert.notEqual(mapPlaybackState({ device: { name: 'd' } }), null);
    assert.notEqual(mapPlaybackState({ item: null }), null);
  });
});

describe('mapSearchResults', () => {
  it('omits whole sections that Spotify left out', () => {
    const results = mapSearchResults({
      tracks: { items: [{ id: 't', uri: 'spotify:track:t', name: 'T', duration_ms: 1, type: 'track' }] },
    });
    assert.equal(results.tracks.length, 1);
    assert.deepEqual(results.artists, []);
    assert.deepEqual(results.playlists, []);
  });

  it('drops null entries inside a section (observed in some locales)', () => {
    const results = mapSearchResults({
      playlists: { items: [null, { id: 'p', name: 'P' }, null] },
      artists: { items: [{ id: 'a', name: 'A' }, 'junk'] },
    });
    assert.equal(results.playlists.length, 1);
    assert.equal(results.artists.length, 1);
  });
});

describe('mapArtist', () => {
  it('reads followers.total and tolerates its absence', () => {
    assert.equal(mapArtist({ id: 'a', name: 'A', followers: { total: 12 } })?.followers, 12);
    assert.equal(mapArtist({ id: 'a', name: 'A' })?.followers, null);
  });

  it('drops non-string genres', () => {
    assert.deepEqual(mapArtist({ id: 'a', name: 'A', genres: ['rock', 1, null, ' '] })?.genres, ['rock']);
  });
});
