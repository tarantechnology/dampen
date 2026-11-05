/**
 * Fixtures — realistic mock data so the whole UI can be built, reviewed and
 * screenshotted before the engine and Spotify hooks land.
 *
 * `app/design/page.tsx` renders every component against these and imports
 * nothing from `lib/audio/**` or `lib/spotify/**`.
 *
 * ------------------------------------------------------------------------
 * next.config.ts — PLEASE ADD (I do not own that file).
 *
 * Spotify serves artwork from several CDN hosts. Album and profile art comes
 * from `i.scdn.co`, auto-generated playlist mosaics from `mosaic.scdn.co`,
 * and editorial/playlist covers from the regional `*.spotifycdn.com` pair.
 * The leading `**` wildcard covers subdomains, which is what we want here and
 * is scoped tightly enough by the fixed apex domain.
 *
 *   const nextConfig: NextConfig = {
 *     // ...existing config
 *     images: {
 *       remotePatterns: [
 *         { protocol: 'https', hostname: '**.scdn.co', port: '', pathname: '/**', search: '' },
 *         { protocol: 'https', hostname: '**.spotifycdn.com', port: '', pathname: '/**', search: '' },
 *       ],
 *     },
 *   };
 *
 * Notes:
 *  - `images.qualities` can stay unset: nothing in the UI passes a `quality`
 *    prop, so the Next 16 default of `[75]` is all we need.
 *  - Nothing uses the deprecated `priority` prop; artwork that must not lazy
 *    load passes `loading="eager"` + `fetchPriority="high"` instead.
 * ------------------------------------------------------------------------
 */

import type {
  CompressorParams,
  DampenParams,
  EngineMeters,
  Preset,
} from '@/lib/types';
import type {
  PlaybackState,
  SearchResults,
  SpotifyArtist,
  SpotifyDevice,
  SpotifyPlaylist,
  SpotifyTrack,
  SpotifyUser,
} from '@/lib/spotify/types';

/* ------------------------------------------------------------------ *
 * Capture devices — mirrors lib/audio/capture.ts's CaptureDevice.
 * Declared locally so /design never reaches into lib/audio.
 * ------------------------------------------------------------------ */

export interface FixtureCaptureDevice {
  deviceId: string;
  label: string;
  likelyVirtual: boolean;
  /**
   * Whether this device also passes what it captures straight to the
   * speakers. If it does, the listener hears raw Spotify *and* Dampen's
   * output a few ms apart, which combs and sounds broken.
   */
  passthrough: 'none' | 'likely' | 'unknown';
}

export const FIXTURE_CAPTURE_DEVICES: FixtureCaptureDevice[] = [
  { deviceId: 'blackhole-2ch', label: 'BlackHole 2ch', likelyVirtual: true, passthrough: 'none' },
  {
    deviceId: 'loopback-dampen',
    label: 'Loopback: Dampen',
    likelyVirtual: true,
    passthrough: 'likely',
  },
  {
    deviceId: 'background-music',
    label: 'Background Music',
    likelyVirtual: true,
    passthrough: 'likely',
  },
  {
    deviceId: 'macbook-mic',
    label: 'MacBook Pro Microphone',
    likelyVirtual: false,
    passthrough: 'none',
  },
  {
    deviceId: 'scarlett-2i2',
    label: 'Scarlett 2i2 USB',
    likelyVirtual: false,
    passthrough: 'unknown',
  },
];

/* ------------------------------------------------------------------ *
 * DSP parameters
 * ------------------------------------------------------------------ */

const NEUTRAL_COMP: CompressorParams = {
  threshold: -18,
  ratio: 2,
  attack: 0.012,
  release: 0.25,
  knee: 12,
  makeup: 0,
};

/**
 * The fully open chain — amount = 0. Every filter sits out of the way rather
 * than being bypassed, so the engine can ramp instead of reconnecting.
 */
export const FIXTURE_DEFAULT_PARAMS: DampenParams = {
  amount: 0,
  outputGain: 0,
  highpass: { freq: 20, q: 0 },
  lowShelf: { freq: 100, gain: 0 },
  lowpass: { freq: 20000, q: 0, stages: 1 },
  presenceDip: { freq: 2500, q: 1.1, gain: 0 },
  tilt: { freq: 900, gain: 0 },
  reverb: { mix: 0, decay: 1.8, preDelay: 18, damping: 0.5, size: 0.5 },
  width: 1,
  compressor: NEUTRAL_COMP,
  saturation: 0,
  wowFlutter: { wowRate: 0.8, wowDepth: 0, flutterRate: 8, flutterDepth: 0 },
  bitcrush: { bits: 16, downsample: 1, mix: 0 },
  ambience: { kind: 'none', level: -90, tone: 0.5 },
  drift: { rate: 0.05, depth: 0 },
};

function params(patch: Partial<DampenParams>): DampenParams {
  return { ...FIXTURE_DEFAULT_PARAMS, ...patch, amount: 1 };
}

/* ------------------------------------------------------------------ *
 * The eight presets
 *
 * Glyphs are geometric marks rather than emoji — they read as panel legends
 * on a piece of audio hardware instead of as chat decoration.
 * ------------------------------------------------------------------ */

export const FIXTURE_PRESETS: Preset[] = [
  {
    id: 'next-door',
    name: 'Next Door',
    glyph: '◗',
    blurb: 'Playing in the next room with the door pulled to.',
    params: params({
      highpass: { freq: 55, q: 0 },
      lowpass: { freq: 520, q: 0, stages: 2 },
      lowShelf: { freq: 110, gain: 2.5 },
      presenceDip: { freq: 2400, q: 1.2, gain: -7 },
      tilt: { freq: 900, gain: -3 },
      reverb: { mix: 0.18, decay: 1.4, preDelay: 22, damping: 0.6, size: 0.45 },
      width: 0.8,
      drift: { rate: 0.05, depth: 0.6 },
    }),
    macro: [
      { path: 'lowpass.freq', neutral: 20000 },
      { path: 'presenceDip.gain', neutral: 0 },
      { path: 'reverb.mix', neutral: 0 },
      { path: 'tilt.gain', neutral: 0 },
    ],
  },
  {
    id: 'deep-water',
    name: 'Deep Water',
    glyph: '≈',
    blurb: 'Submerged. Only the low end gets through to you.',
    params: params({
      highpass: { freq: 30, q: 0 },
      lowpass: { freq: 240, q: 0, stages: 3 },
      lowShelf: { freq: 90, gain: 4 },
      presenceDip: { freq: 1800, q: 0.9, gain: -6 },
      tilt: { freq: 800, gain: -5 },
      reverb: { mix: 0.34, decay: 3.2, preDelay: 34, damping: 0.85, size: 0.8 },
      width: 0.6,
      compressor: { ...NEUTRAL_COMP, threshold: -22, ratio: 3, makeup: 2 },
      drift: { rate: 0.06, depth: 1.5 },
    }),
    macro: [
      { path: 'lowpass.freq', neutral: 20000 },
      { path: 'reverb.mix', neutral: 0 },
      { path: 'width', neutral: 1 },
      { path: 'drift.depth', neutral: 0 },
    ],
  },
  {
    id: 'soft-snow',
    name: 'Soft Snow',
    glyph: '✳',
    blurb: 'Edges rounded off, a pale bed of noise underneath.',
    params: params({
      lowpass: { freq: 2600, q: 0, stages: 1 },
      presenceDip: { freq: 3200, q: 1.4, gain: -4.5 },
      tilt: { freq: 1200, gain: -2 },
      reverb: { mix: 0.12, decay: 1.1, preDelay: 12, damping: 0.4, size: 0.35 },
      ambience: { kind: 'white', level: -34, tone: 0.7 },
      drift: { rate: 0.04, depth: 0.4 },
    }),
    macro: [
      { path: 'lowpass.freq', neutral: 20000 },
      { path: 'ambience.level', neutral: -90 },
      { path: 'presenceDip.gain', neutral: 0 },
    ],
  },
  {
    id: 'tape-room',
    name: 'Tape Room',
    glyph: '⊟',
    blurb: 'Warm, wobbly and a little worn out.',
    params: params({
      highpass: { freq: 45, q: 0 },
      lowpass: { freq: 4200, q: 0, stages: 1 },
      lowShelf: { freq: 120, gain: 1.5 },
      tilt: { freq: 1000, gain: -2.5 },
      reverb: { mix: 0.14, decay: 1.2, preDelay: 16, damping: 0.55, size: 0.4 },
      saturation: 0.35,
      wowFlutter: { wowRate: 0.9, wowDepth: 0.35, flutterRate: 7.5, flutterDepth: 0.14 },
      bitcrush: { bits: 12, downsample: 2, mix: 0.25 },
      ambience: { kind: 'tape', level: -38, tone: 0.4 },
      compressor: { ...NEUTRAL_COMP, threshold: -20, ratio: 2.5, makeup: 1.5 },
    }),
    macro: [
      { path: 'lowpass.freq', neutral: 20000 },
      { path: 'saturation', neutral: 0 },
      { path: 'wowFlutter.wowDepth', neutral: 0 },
      { path: 'bitcrush.mix', neutral: 0 },
      { path: 'ambience.level', neutral: -90 },
    ],
  },
  {
    id: 'upstairs-cafe',
    name: 'Upstairs Café',
    glyph: '◍',
    blurb: 'Cups and conversation, one floor above the music.',
    params: params({
      highpass: { freq: 70, q: 0 },
      lowpass: { freq: 900, q: 0, stages: 2 },
      presenceDip: { freq: 3000, q: 1.1, gain: -9 },
      tilt: { freq: 900, gain: -4 },
      reverb: { mix: 0.22, decay: 1.8, preDelay: 26, damping: 0.6, size: 0.6 },
      ambience: { kind: 'cafe', level: -26, tone: 0.45 },
      width: 0.9,
      drift: { rate: 0.07, depth: 0.8 },
    }),
    macro: [
      { path: 'lowpass.freq', neutral: 20000 },
      { path: 'ambience.level', neutral: -90 },
      { path: 'presenceDip.gain', neutral: 0 },
      { path: 'reverb.mix', neutral: 0 },
    ],
  },
  {
    id: 'rain-window',
    name: 'Rain Window',
    glyph: '⌇',
    blurb: 'Rain on the glass and the music out there behind it.',
    params: params({
      highpass: { freq: 60, q: 0 },
      lowpass: { freq: 700, q: 0, stages: 2 },
      lowShelf: { freq: 100, gain: 2 },
      presenceDip: { freq: 2600, q: 1.2, gain: -8 },
      tilt: { freq: 850, gain: -3.5 },
      reverb: { mix: 0.2, decay: 2.2, preDelay: 24, damping: 0.7, size: 0.55 },
      ambience: { kind: 'rain', level: -24, tone: 0.55 },
      drift: { rate: 0.05, depth: 0.7 },
    }),
    macro: [
      { path: 'lowpass.freq', neutral: 20000 },
      { path: 'ambience.level', neutral: -90 },
      { path: 'reverb.mix', neutral: 0 },
    ],
  },
  {
    id: 'study-carrel',
    name: 'Study Carrel',
    glyph: '⌷',
    blurb: 'Just enough music left to mark the time passing.',
    params: params({
      highpass: { freq: 80, q: 0 },
      lowpass: { freq: 1400, q: 0, stages: 2 },
      presenceDip: { freq: 2200, q: 1.6, gain: -11 },
      tilt: { freq: 1000, gain: -4 },
      reverb: { mix: 0.1, decay: 1.0, preDelay: 14, damping: 0.5, size: 0.3 },
      width: 0.8,
      compressor: { threshold: -26, ratio: 4, attack: 0.02, release: 0.4, knee: 18, makeup: 3 },
      drift: { rate: 0.03, depth: 1.2 },
    }),
    macro: [
      { path: 'lowpass.freq', neutral: 20000 },
      { path: 'presenceDip.gain', neutral: 0 },
      { path: 'drift.depth', neutral: 0 },
      { path: 'compressor.ratio', neutral: 1 },
    ],
  },
  {
    id: 'lights-out',
    name: 'Lights Out',
    glyph: '●',
    blurb: 'Nothing but the bass, and that from a long way off.',
    params: params({
      highpass: { freq: 32, q: 0 },
      lowpass: { freq: 160, q: 0, stages: 4 },
      lowShelf: { freq: 80, gain: 5 },
      presenceDip: { freq: 1500, q: 0.8, gain: -5 },
      tilt: { freq: 700, gain: -6 },
      reverb: { mix: 0.4, decay: 4.5, preDelay: 42, damping: 0.95, size: 0.9 },
      width: 0.45,
      compressor: { threshold: -24, ratio: 4, attack: 0.03, release: 0.6, knee: 20, makeup: 4 },
      ambience: { kind: 'brown', level: -30, tone: 0.2 },
      drift: { rate: 0.02, depth: 2 },
      outputGain: -1.5,
    }),
    macro: [
      { path: 'lowpass.freq', neutral: 20000 },
      { path: 'reverb.mix', neutral: 0 },
      { path: 'width', neutral: 1 },
      { path: 'ambience.level', neutral: -90 },
      { path: 'drift.depth', neutral: 0 },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Spotify data
 *
 * Artwork arrays are intentionally empty: `components/ui/Artwork.tsx` falls
 * back to a deterministic procedural cover derived from the title, so the
 * design route renders rich, stable visuals with no network at all. Real
 * `SpotifyImage[]` from the API flows through the same component into
 * `next/image`.
 * ------------------------------------------------------------------ */

function track(
  id: string,
  name: string,
  artists: string[],
  album: string,
  durationMs: number,
  extra: Partial<SpotifyTrack> = {},
): SpotifyTrack {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    durationMs,
    explicit: false,
    artists: artists.map((a) => ({ id: a.toLowerCase().replace(/\W+/g, '-'), name: a })),
    album: {
      id: album.toLowerCase().replace(/\W+/g, '-'),
      name: album,
      images: [],
      releaseDate: '2019-03-15',
    },
    previewUrl: null,
    ...extra,
  };
}

export const FIXTURE_TRACKS: SpotifyTrack[] = [
  track('1kq0qm', 'An Ending (Ascent)', ['Brian Eno'], 'Apollo: Atmospheres', 264_000, {
    addedAt: '2025-09-02T09:14:00Z',
  }),
  track('2vh7wq', 'Music for Airports 1/1', ['Brian Eno'], 'Ambient 1', 1_038_000, {
    addedAt: '2025-08-28T18:02:00Z',
  }),
  track('3bn2kd', 'Avril 14th', ['Aphex Twin'], 'Drukqs', 124_000, {
    addedAt: '2025-08-21T07:48:00Z',
  }),
  track('4mz8pl', 'Rhubarb', ['Aphex Twin'], 'Selected Ambient Works Volume II', 457_000, {
    addedAt: '2025-08-19T22:31:00Z',
  }),
  track('5tc9xr', 'Teardrop', ['Massive Attack'], 'Mezzanine', 330_000, {
    addedAt: '2025-08-11T12:05:00Z',
  }),
  track('6qd4jv', 'Everything in Its Right Place', ['Radiohead'], 'Kid A', 251_000, {
    addedAt: '2025-08-04T16:44:00Z',
  }),
  track('7hs1bz', 'Svefn-g-englar', ['Sigur Rós'], 'Ágætis byrjun', 602_000, {
    addedAt: '2025-07-30T08:12:00Z',
  }),
  track('8wn6tc', 'Open Eye Signal', ['Jon Hopkins'], 'Immunity', 487_000, {
    addedAt: '2025-07-22T19:27:00Z',
  }),
  track('9kp3ld', 'Nuvole Bianche', ['Ludovico Einaudi'], 'Una Mattina', 342_000, {
    addedAt: '2025-07-18T11:09:00Z',
  }),
  track('a1vz8m', 'Lebanese Blonde', ['Thievery Corporation'], 'The Mirror Conspiracy', 290_000, {
    addedAt: '2025-07-09T21:50:00Z',
  }),
  track('b2mk4q', 'Intro', ['The xx'], 'xx', 128_000, { addedAt: '2025-07-02T13:33:00Z' }),
  track('c3jr7w', 'Nightcall', ['Kavinsky', 'Lovefoxxx'], 'OutRun', 258_000, {
    addedAt: '2025-06-26T23:18:00Z',
  }),
  track('d4ql9n', 'Weird Fishes / Arpeggi', ['Radiohead'], 'In Rainbows', 318_000, {
    addedAt: '2025-06-20T10:02:00Z',
  }),
  track('e5sv2b', 'Oslo', ['Nils Frahm'], 'Spaces', 415_000, {
    addedAt: '2025-06-14T07:41:00Z',
  }),
  track('f6tw5x', 'Lift', ['Poppy Ackroyd'], 'Resolve', 286_000, {
    addedAt: '2025-06-05T17:55:00Z',
  }),
  track('g7ux8c', 'Sun Models', ['ODESZA', 'Madelyn Grant'], 'Summer’s Gone', 217_000, {
    addedAt: '2025-05-29T20:12:00Z',
  }),
  track('h8vy1d', 'Breathe', ['Télépopmusik'], 'Genetic World', 282_000, {
    addedAt: '2025-05-21T09:36:00Z',
  }),
  track('i9wz4e', 'Hoppipolla', ['Sigur Rós'], 'Takk...', 268_000, {
    addedAt: '2025-05-12T15:21:00Z',
  }),
  track('j0xa7f', 'Immunity', ['Jon Hopkins', 'King Creosote'], 'Immunity', 581_000, {
    addedAt: '2025-05-03T08:08:00Z',
  }),
  track('k1yb0g', 'Glósóli', ['Sigur Rós'], 'Takk...', 374_000, {
    addedAt: '2025-04-27T22:44:00Z',
  }),
  track('l2zc3h', 'Saman', ['Ólafur Arnalds'], 're:member', 243_000, {
    addedAt: '2025-04-19T11:17:00Z',
  }),
  track('m3ad6i', 'Gymnopédie No. 1', ['Erik Satie'], 'Trois Gymnopédies', 211_000, {
    addedAt: '2025-04-10T06:59:00Z',
  }),
  track('n4be9j', 'Flim', ['Aphex Twin'], 'Come to Daddy', 174_000, {
    addedAt: '2025-04-01T19:03:00Z',
  }),
  track('o5cf2k', 'Rains Again', ['Solar Fields'], 'Movements', 405_000, {
    addedAt: '2025-03-24T14:26:00Z',
  }),
  track('p6dg5l', 'Terminal', ['Rival Consoles'], 'Persona', 364_000, {
    addedAt: '2025-03-15T08:37:00Z',
  }),
  track('q7eh8m', 'Dayvan Cowboy', ['Boards of Canada'], 'The Campfire Headphase', 300_000, {
    addedAt: '2025-03-06T21:11:00Z',
  }),
  track('r8fi1n', 'Roygbiv', ['Boards of Canada'], 'Music Has the Right to Children', 151_000, {
    addedAt: '2025-02-25T10:48:00Z',
  }),
  track('s9gj4o', 'Kiara', ['Bonobo'], 'Black Sands', 285_000, {
    addedAt: '2025-02-17T18:30:00Z',
  }),
  track('t0hk7p', 'Cirrus', ['Bonobo'], 'The North Borders', 329_000, {
    addedAt: '2025-02-09T12:14:00Z',
  }),
  track('u1il0q', 'Nightswimming', ['R.E.M.'], 'Automatic for the People', 257_000, {
    addedAt: '2025-01-31T23:02:00Z',
  }),
  track('v2jm3r', 'Pulse', ['Max Richter'], 'Sleep', 498_000, {
    addedAt: '2025-01-22T07:19:00Z',
  }),
  track('w3kn6s', 'On the Nature of Daylight', ['Max Richter'], 'The Blue Notebooks', 386_000, {
    addedAt: '2025-01-14T16:51:00Z',
  }),
];

export const FIXTURE_RECENTLY_PLAYED: SpotifyTrack[] = FIXTURE_TRACKS.slice(4, 16).map(
  (t, i) => ({
    ...t,
    playedAt: new Date(Date.UTC(2026, 10, 4, 18, 40 - i * 7)).toISOString(),
  }),
);

export const FIXTURE_TOP_TRACKS: SpotifyTrack[] = [
  FIXTURE_TRACKS[2],
  FIXTURE_TRACKS[7],
  FIXTURE_TRACKS[5],
  FIXTURE_TRACKS[13],
  FIXTURE_TRACKS[25],
  FIXTURE_TRACKS[27],
  FIXTURE_TRACKS[1],
  FIXTURE_TRACKS[30],
  FIXTURE_TRACKS[20],
  FIXTURE_TRACKS[11],
];

function playlist(
  id: string,
  name: string,
  description: string,
  trackCount: number,
  ownerName = 'tarantechnology',
): SpotifyPlaylist {
  return {
    id,
    uri: `spotify:playlist:${id}`,
    name,
    description,
    images: [],
    trackCount,
    ownerName,
    collaborative: false,
    isPublic: false,
  };
}

export const FIXTURE_PLAYLISTS: SpotifyPlaylist[] = [
  playlist('pl-deepwork', 'Deep Work', 'Four hours, no vocals, no surprises.', 142),
  playlist('pl-nightshift', 'Night Shift', 'For the hours after everyone else logs off.', 88),
  playlist('pl-ambient', 'Ambient Wall', 'Texture only. Nothing with a chorus.', 213),
  playlist('pl-piano', 'Piano, Quietly', 'Felt pedal down, room mics up.', 64),
  playlist('pl-rainyday', 'Rainy Day Desk', 'Grey outside, grey inside.', 97),
  playlist('pl-lofi', 'Low Fidelity', 'Tape hiss as a feature.', 120),
  playlist('pl-reading', 'Reading Room', 'Slow enough to forget it is on.', 75),
  playlist('pl-commute', 'Commute', 'Thirty-eight minutes, door to door.', 38, 'Spotify'),
  playlist('pl-focus-beats', 'Focus Beats', 'Pulse without personality.', 156),
  playlist('pl-strings', 'Strings at Dusk', 'Minimalist and a little sad.', 52),
];

function artist(id: string, name: string, genres: string[], followers: number): SpotifyArtist {
  return { id, uri: `spotify:artist:${id}`, name, images: [], genres, followers };
}

export const FIXTURE_ARTISTS: SpotifyArtist[] = [
  artist('ar-eno', 'Brian Eno', ['ambient', 'art pop'], 1_284_901),
  artist('ar-aphex', 'Aphex Twin', ['idm', 'ambient techno'], 2_741_338),
  artist('ar-hopkins', 'Jon Hopkins', ['electronic', 'ambient'], 982_104),
  artist('ar-sigur', 'Sigur Rós', ['post-rock'], 2_104_772),
  artist('ar-boc', 'Boards of Canada', ['idm', 'downtempo'], 1_511_690),
  artist('ar-richter', 'Max Richter', ['modern classical'], 1_932_455),
  artist('ar-bonobo', 'Bonobo', ['downtempo', 'future garage'], 2_388_017),
  artist('ar-olafur', 'Ólafur Arnalds', ['modern classical'], 1_104_298),
  artist('ar-frahm', 'Nils Frahm', ['neo-classical'], 1_452_004),
  artist('ar-rival', 'Rival Consoles', ['electronic'], 388_215),
];

export const FIXTURE_USER: SpotifyUser = {
  id: 'tarantechnology',
  displayName: 'Taran',
  email: 'taranusa2006@gmail.com',
  images: [],
  product: 'premium',
  country: 'US',
};

export const FIXTURE_DEVICES: SpotifyDevice[] = [
  { id: 'dev-dampen', name: 'Dampen (this browser)', type: 'Computer', isActive: true, volumePercent: 72 },
  { id: 'dev-studio', name: 'Studio Monitors', type: 'Speaker', isActive: false, volumePercent: 55 },
  { id: 'dev-phone', name: 'Taran’s iPhone', type: 'Smartphone', isActive: false, volumePercent: 90 },
  { id: 'dev-living', name: 'Living Room', type: 'CastAudio', isActive: false, volumePercent: 40 },
];

export const FIXTURE_PLAYBACK: PlaybackState = {
  isPlaying: true,
  position: 96_400,
  durationMs: FIXTURE_TRACKS[7].durationMs,
  track: FIXTURE_TRACKS[7],
  volume: 0.72,
  shuffle: false,
  repeat: 'context',
  deviceName: 'Dampen (this browser)',
  contextUri: 'spotify:playlist:pl-deepwork',
};

export const FIXTURE_SEARCH: SearchResults = {
  tracks: [FIXTURE_TRACKS[7], FIXTURE_TRACKS[18], FIXTURE_TRACKS[2], FIXTURE_TRACKS[22]],
  artists: [FIXTURE_ARTISTS[2], FIXTURE_ARTISTS[1], FIXTURE_ARTISTS[9]],
  playlists: [FIXTURE_PLAYLISTS[0], FIXTURE_PLAYLISTS[2], FIXTURE_PLAYLISTS[5]],
  albums: [FIXTURE_TRACKS[7].album, FIXTURE_TRACKS[3].album, FIXTURE_TRACKS[25].album],
};

/**
 * The engine is additionally exposing end-to-end latency and a feedback-risk
 * flag. Mirrored here so `/design` can show the capture status strip and both
 * of its warnings without reaching into lib/audio.
 */
export const FIXTURE_LATENCY_MS = 11.6;
export const FIXTURE_FEEDBACK_RISK = false;

export const FIXTURE_METERS: EngineMeters = {
  inputPeak: -8.4,
  outputPeak: -14.9,
  outputRms: -21.2,
  reduction: -3.1,
};

/**
 * A plausible live signal for the design route's meters, so the review
 * screenshot shows real movement, peak-hold and gain reduction rather than a
 * frozen bar. Deterministic in `t` (seconds).
 */
export function simulatedMeters(t: number): EngineMeters {
  const bar = Math.sin(t * 2.1) * 0.5 + 0.5;
  const transient = Math.max(0, Math.sin(t * 7.3)) ** 6;
  const inputPeak = -26 + bar * 14 + transient * 10;
  const reduction = -Math.max(0, (inputPeak + 16) * 0.55);
  const outputPeak = inputPeak + reduction - 4.5;
  return {
    inputPeak,
    outputPeak,
    outputRms: outputPeak - 6.5 - bar * 2,
    reduction,
  };
}
