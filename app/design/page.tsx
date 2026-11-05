'use client';

/**
 * /design — the review surface.
 *
 * Everything on this page runs against `components/fixtures.ts`. It imports
 * nothing from `lib/audio/**`, `lib/spotify/**` or `components/viz/**`, so it
 * compiles and renders on its own while the engine and Spotify layers are
 * still being written. The spectrum slot is a bordered placeholder here
 * because the real scope needs live AnalyserNodes.
 *
 * It is a Client Component in full, which is the one place in the app that is
 * true: the entire point of the route is to drive every interactive state by
 * hand. `app/page.tsx` stays a Server Component.
 */

import { useCallback, useMemo, useState } from 'react';
import { Cable, Disc3, Headphones, Keyboard, Search } from 'lucide-react';
import type { DampenParams, EngineStatus, InputMode } from '@/lib/types';
import {
  FIXTURE_ARTISTS,
  FIXTURE_CAPTURE_DEVICES,
  FIXTURE_DEFAULT_PARAMS,
  FIXTURE_DEVICES,
  FIXTURE_LATENCY_MS,
  FIXTURE_PLAYBACK,
  FIXTURE_PLAYLISTS,
  FIXTURE_PRESETS,
  FIXTURE_RECENTLY_PLAYED,
  FIXTURE_SEARCH,
  FIXTURE_TRACKS,
  FIXTURE_USER,
  simulatedMeters,
} from '@/components/fixtures';
import { AccentDriver, AmbientBackdrop } from '@/components/player/AmbientBackdrop';
import { CaptureSetup } from '@/components/player/CaptureSetup';
import { DeviceList } from '@/components/player/DevicePicker';
import { NowPlaying, NowPlayingSkeleton } from '@/components/player/NowPlaying';
import { SourceSwitcher } from '@/components/player/SourceSwitcher';
import { Transport } from '@/components/player/Transport';
import { DampenConsole } from '@/components/dampen/DampenConsole';
import { ArtistRow } from '@/components/library/ArtistRow';
import { PlaylistGrid } from '@/components/library/PlaylistGrid';
import { SearchResults } from '@/components/library/SearchResults';
import { Sidebar } from '@/components/library/Sidebar';
import { TrackList } from '@/components/library/TrackList';
import { Button, RoundButton } from '@/components/ui/Button';
import { Dial } from '@/components/ui/Dial';
import { EmptyState } from '@/components/ui/EmptyState';
import { Notice } from '@/components/ui/Notice';
import { Panel, Sheet } from '@/components/ui/Panel';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { Select } from '@/components/ui/Select';
import { Skeleton, TrackListSkeleton } from '@/components/ui/Skeleton';
import { Slider } from '@/components/ui/Slider';
import { Tabs } from '@/components/ui/Tabs';
import { Toggle } from '@/components/ui/Toggle';
import { Tooltip } from '@/components/ui/Tooltip';
import { accentVars } from '@/components/ui/accent';
import { formatDb, formatHz, formatPercent } from '@/components/ui/format';
import { useUIStore, type LibraryView } from '@/components/ui/store';

/* ------------------------------------------------------------------ *
 * Local helpers
 * ------------------------------------------------------------------ */

/** Immutable dot-path set, standing in for the engine's own setter. */
function setAtPath(params: DampenParams, path: string, value: number | string): DampenParams {
  const parts = path.split('.');
  const clone = structuredClone(params) as unknown as Record<string, unknown>;
  let node = clone;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = node[parts[i]];
    if (typeof next !== 'object' || next === null) return params;
    node = next as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
  return clone as unknown as DampenParams;
}

function SectionHeading({
  title,
  blurb,
  id,
}: {
  title: string;
  blurb: string;
  id: string;
}) {
  return (
    <div className="mb-4">
      <h2 id={id} className="text-[15px] font-semibold tracking-tight text-ink">
        {title}
      </h2>
      <p className="mt-1 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-3">{blurb}</p>
    </div>
  );
}

/** The ramp itself, sampled — the amount=0..1 colour story in one row. */
function Swatches() {
  const stops = [0, 0.2, 0.4, 0.6, 0.8, 1];
  return (
    <div className="flex gap-2">
      {stops.map((s) => {
        const vars = accentVars(s);
        return (
          <div key={s} className="flex-1 space-y-1.5">
            <div
              className="h-12 rounded-lg border border-line"
              style={{
                background: `linear-gradient(145deg, ${vars['--accent']}, ${vars['--accent-hot']})`,
              }}
            />
            <span className="num block text-center text-[10px] text-ink-4">{s * 100}%</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function DesignPage() {
  /* ---- engine stand-in ---- */
  const [amount, setAmount] = useState(0.62);
  const [presetId, setPresetId] = useState(FIXTURE_PRESETS[0].id);
  const [bypass, setBypass] = useState(false);
  const [params, setParams] = useState<DampenParams>(() => ({
    ...FIXTURE_DEFAULT_PARAMS,
    lowpass: { freq: 620, q: 0, stages: 2 },
    reverb: { mix: 0.18, decay: 1.6, preDelay: 22, damping: 0.6, size: 0.5 },
    presenceDip: { freq: 2400, q: 1.2, gain: -7 },
    amount: 0.62,
  }));

  const publishDampen = useUIStore((s) => s.publishDampen);

  const onAmount = useCallback(
    (next: number) => {
      setAmount(next);
      publishDampen({ amount: next });
    },
    [publishDampen],
  );
  const onBypass = useCallback(
    (next: boolean) => {
      setBypass(next);
      publishDampen({ bypass: next });
    },
    [publishDampen],
  );
  const onParam = useCallback((path: string, value: number | string) => {
    setParams((prev) => setAtPath(prev, path, value));
  }, []);

  const getMeters = useCallback(() => simulatedMeters(performance.now() / 1000), []);
  const getInputPeak = useCallback(
    () => simulatedMeters(performance.now() / 1000).inputPeak,
    [],
  );
  const getSilentPeak = useCallback(() => Number.NEGATIVE_INFINITY, []);

  /* ---- playback stand-in ---- */
  const [isPlaying, setPlaying] = useState(true);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'track' | 'context'>('context');
  const [volume, setVolume] = useState(0.72);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState(FIXTURE_PLAYBACK.position);

  /* ---- library stand-in ---- */
  const [view, setView] = useState<LibraryView>('liked');
  const [query, setQuery] = useState('');
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [currentUri, setCurrentUri] = useState<string | null>(
    FIXTURE_PLAYBACK.track?.uri ?? null,
  );

  /* ---- source stand-in ---- */
  const [mode, setMode] = useState<InputMode>('capture');
  const [deviceId, setDeviceId] = useState<string | null>('blackhole-2ch');
  const [status] = useState<EngineStatus>('running');
  const [localFile, setLocalFile] = useState<string | null>(null);

  /* ---- primitives playground ---- */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toggleA, setToggleA] = useState(true);
  const [toggleB, setToggleB] = useState(false);
  const [tab, setTab] = useState('wall');
  const [cutoff, setCutoff] = useState(820);
  const [trim, setTrim] = useState(-3.5);
  const [mix, setMix] = useState(0.34);
  const [pick, setPick] = useState('rain');

  const tracksForView = useMemo(() => {
    if (view === 'recent') return FIXTURE_RECENTLY_PLAYED;
    return FIXTURE_TRACKS;
  }, [view]);

  const capture = {
    devices: FIXTURE_CAPTURE_DEVICES,
    selectedDeviceId: deviceId,
    onSelectDevice: setDeviceId,
    onRescan: () => undefined,
    isScanning: false,
    isCapturing: true,
    getInputPeak,
    latencyMs: FIXTURE_LATENCY_MS,
    feedbackRisk: false,
    permissionDenied: false,
    onStart: () => undefined,
    platform: 'mac' as const,
  };

  return (
    <>
      <AccentDriver />
      <AmbientBackdrop
        images={FIXTURE_PLAYBACK.track?.album.images ?? []}
        seed="Immunity Jon Hopkins"
      />

      <div className="mx-auto w-full max-w-[1680px] space-y-12 p-4 pb-24 sm:p-6">
        {/* ---------------- intro ---------------- */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="legend mb-2">Dampen &middot; design review</p>
            <h1 className="text-[26px] font-semibold tracking-tight text-ink">
              Every component, against fixtures
            </h1>
            <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-ink-2">
              The dial below is live: drag it and the whole page recolours and the artwork
              behind it blurs, because the accent ramp is written straight into CSS variables on
              the root element rather than passed through React.
            </p>
          </div>
          <Button variant="outline" onClick={() => setSheetOpen(true)}>
            <Keyboard className="size-3.5" aria-hidden />
            Open a sheet
          </Button>
        </header>

        {/* ---------------- the app ---------------- */}
        <section aria-labelledby="h-app">
          <SectionHeading
            id="h-app"
            title="The whole thing"
            blurb="Three columns: library down the side, the player in the middle under the source panel, the console on the right. At narrow widths this becomes one column in reading order, and the dial and transport stay usable at 400 px."
          />

          <div
            className={[
              'grid grid-cols-1 content-start gap-4',
              'xl:grid-cols-[320px_minmax(0,1fr)_minmax(340px,380px)]',
              'xl:grid-rows-[auto_auto_minmax(0,1fr)] xl:gap-5',
            ].join(' ')}
          >
            {/* header */}
            <div className="order-1 flex items-center justify-between gap-3 xl:col-start-1 xl:col-end-4 xl:row-start-1">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{
                    background: 'var(--accent)',
                    boxShadow: '0 0 14px var(--accent-glow)',
                  }}
                />
                <span className="text-[13px] font-semibold uppercase tracking-[0.22em] text-ink">
                  Dampen
                </span>
                <span className="hidden truncate text-[11.5px] text-ink-4 sm:block">
                  music that stays behind you
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Tooltip label="Spotify Connect devices" side="bottom">
                  <Button variant="outline" size="sm">
                    <Headphones className="size-3.5" aria-hidden />
                    Studio Monitors
                  </Button>
                </Tooltip>
                <Tooltip label="Keyboard shortcuts" shortcut="?" side="left">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Keyboard shortcuts"
                    onClick={() => setSheetOpen(true)}
                  >
                    <Keyboard className="size-4" aria-hidden />
                  </Button>
                </Tooltip>
              </div>
            </div>

            {/* source */}
            <SourceSwitcher
              className="order-2 xl:col-start-2 xl:row-start-2"
              mode={mode}
              onModeChange={setMode}
              status={status}
              latencyMs={FIXTURE_LATENCY_MS}
              capture={capture}
              spotifyAvailable
              onTransferHere={() => undefined}
              localFileName={localFile}
              onLocalFile={(file) => setLocalFile(file.name)}
              onUseDemo={() => setLocalFile('Demo track')}
            />

            {/* player */}
            <div className="order-3 flex flex-col items-center gap-7 xl:col-start-2 xl:row-start-3">
              <NowPlaying
                track={FIXTURE_PLAYBACK.track}
                position={position}
                durationMs={FIXTURE_PLAYBACK.durationMs}
                isPlaying={isPlaying}
                onSeek={setPosition}
                contextLabel="Deep Work"
              />
              <Transport
                className="max-w-[460px]"
                isPlaying={isPlaying}
                shuffle={shuffle}
                repeat={repeat}
                volume={volume}
                muted={muted}
                onToggle={() => setPlaying((p) => !p)}
                onNext={() => undefined}
                onPrevious={() => undefined}
                onShuffle={setShuffle}
                onCycleRepeat={() =>
                  setRepeat((r) => (r === 'off' ? 'context' : r === 'context' ? 'track' : 'off'))
                }
                onVolume={(v) => {
                  setVolume(v);
                  setMuted(v === 0);
                }}
                onToggleMute={() => setMuted((m) => !m)}
              />
            </div>

            {/* console */}
            <DampenConsole
              className="order-4 xl:col-start-3 xl:row-start-2 xl:row-span-2"
              amount={amount}
              onAmount={onAmount}
              presets={FIXTURE_PRESETS}
              presetId={presetId}
              onPreset={setPresetId}
              bypass={bypass}
              onBypass={onBypass}
              params={params}
              onParam={onParam}
              getMeters={getMeters}
              running
            />

            {/* library */}
            <Sidebar
              className="order-5 min-h-[520px] xl:col-start-1 xl:row-start-2 xl:row-span-2 xl:min-h-0"
              view={view}
              onViewChange={setView}
              query={query}
              onQueryChange={setQuery}
              user={FIXTURE_USER}
              authStatus="authed"
              onLogin={() => undefined}
              onLogout={() => undefined}
              counts={{
                playlists: FIXTURE_PLAYLISTS.length,
                liked: FIXTURE_TRACKS.length,
                recent: FIXTURE_RECENTLY_PLAYED.length,
                top: 10,
              }}
            >
              <ScrollArea className="p-2.5">
                {view === 'playlists' ? (
                  <PlaylistGrid
                    label="Your playlists"
                    playlists={FIXTURE_PLAYLISTS}
                    selectedId={playlistId}
                    onOpen={setPlaylistId}
                    onPlay={() => undefined}
                  />
                ) : view === 'search' ? (
                  <SearchResults
                    query={query}
                    results={query.trim() ? FIXTURE_SEARCH : null}
                    currentUri={currentUri}
                    isPlaying={isPlaying}
                    onPlayTrack={(track) => setCurrentUri(track.uri)}
                    onOpenPlaylist={setPlaylistId}
                    onOpenArtist={(artist) => setQuery(artist.name)}
                  />
                ) : (
                  <TrackList
                    label={view === 'recent' ? 'Recently played' : 'Liked songs'}
                    tracks={tracksForView}
                    currentUri={currentUri}
                    isPlaying={isPlaying}
                    onPlay={(track) => setCurrentUri(track.uri)}
                    meta={view === 'recent' ? 'played' : 'added'}
                    className="min-h-[440px]"
                  />
                )}
              </ScrollArea>
            </Sidebar>
          </div>
        </section>

        {/* ---------------- capture states ---------------- */}
        <section aria-labelledby="h-capture">
          <SectionHeading
            id="h-capture"
            title="Capture — the primary path, in every state"
            blurb="The checklist ticks itself as conditions become true, and the third step only completes when real audio shows up on the meter. Both warnings are written to be acted on: they name the better device and offer to switch to it."
          />
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            <Panel title="Nothing installed yet">
              <CaptureSetup
                devices={[FIXTURE_CAPTURE_DEVICES[3]]}
                selectedDeviceId={null}
                onSelectDevice={() => undefined}
                onRescan={() => undefined}
                isCapturing={false}
                getInputPeak={getSilentPeak}
                latencyMs={null}
                feedbackRisk={false}
                onStart={() => undefined}
                platform="mac"
              />
            </Panel>

            <Panel title="Device open, no signal">
              <CaptureSetup
                devices={FIXTURE_CAPTURE_DEVICES}
                selectedDeviceId="blackhole-2ch"
                onSelectDevice={() => undefined}
                onRescan={() => undefined}
                isCapturing
                getInputPeak={getSilentPeak}
                latencyMs={FIXTURE_LATENCY_MS}
                feedbackRisk={false}
                onStart={() => undefined}
                platform="windows"
              />
            </Panel>

            <Panel title="Passthrough device + feedback risk">
              <CaptureSetup
                devices={FIXTURE_CAPTURE_DEVICES}
                selectedDeviceId="background-music"
                onSelectDevice={setDeviceId}
                onRescan={() => undefined}
                isCapturing
                getInputPeak={getInputPeak}
                latencyMs={14.2}
                feedbackRisk
                permissionDenied
                onStart={() => undefined}
                platform="mac"
              />
            </Panel>
          </div>
        </section>

        {/* ---------------- primitives ---------------- */}
        <section aria-labelledby="h-prims">
          <SectionHeading
            id="h-prims"
            title="Primitives"
            blurb="Every control is keyboard-operable with a visible focus ring, carries aria-valuenow/min/max where it is a slider, and uses tabular numerals so readouts do not jitter mid-drag. Frequency sliders travel logarithmically."
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Dial">
              <div className="flex flex-col items-center gap-5">
                <Dial value={amount} onChange={onAmount} label="Dampen" size={200} />
                <div className="flex items-end gap-6">
                  <Dial value={amount} onChange={onAmount} label="Small" size={116} />
                  <Dial value={0.85} onChange={() => undefined} label="Locked" size={116} disabled />
                </div>
                <p className="text-center text-[11.5px] leading-relaxed text-ink-3">
                  Drag vertically or horizontally, scroll, arrow keys when focused, Shift for
                  fine, double-click to reset. The needle and arc are spring-driven and never
                  snap.
                </p>
              </div>
            </Panel>

            <Panel title="Sliders">
              <div className="space-y-5">
                <Slider
                  label="Lowpass (log)"
                  value={cutoff}
                  min={120}
                  max={20000}
                  scale="log"
                  format={formatHz}
                  onChange={setCutoff}
                  hint="20 Hz to 20 kHz, even across the travel."
                />
                <Slider
                  label="Output trim (bipolar)"
                  value={trim}
                  min={-24}
                  max={12}
                  step={0.5}
                  bipolar
                  format={formatDb}
                  onChange={setTrim}
                />
                <Slider
                  label="Reverb mix"
                  value={mix}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(v) => formatPercent(v)}
                  onChange={setMix}
                />
                <Slider
                  label="Disabled"
                  value={0.4}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(v) => formatPercent(v)}
                  onChange={() => undefined}
                  disabled
                />
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel title="Buttons">
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="accent">Start capturing</Button>
                    <Button>Solid</Button>
                    <Button variant="outline">Outline</Button>
                    <Button variant="ghost">Ghost</Button>
                    <Button variant="danger">Danger</Button>
                    <Button disabled>Disabled</Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm">Small</Button>
                    <Button size="lg">Large</Button>
                    <RoundButton diameter={40} aria-label="Round">
                      <Disc3 className="size-4" aria-hidden />
                    </RoundButton>
                    <RoundButton diameter={40} active aria-label="Round active">
                      <Cable className="size-4" aria-hidden />
                    </RoundButton>
                  </div>
                </div>
              </Panel>

              <Panel title="Toggles &amp; select">
                <div className="space-y-4">
                  <Toggle
                    checked={toggleA}
                    onChange={setToggleA}
                    label="Bypass"
                    description="Compare against the raw signal."
                    shortcut="B"
                  />
                  <Toggle
                    checked={toggleB}
                    onChange={setToggleB}
                    label="Neutral tone"
                    tone="neutral"
                    size="sm"
                  />
                  <Select
                    label="Ambience bed"
                    value={pick}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'rain', label: 'Rain', meta: '−24 dB' },
                      { value: 'tape', label: 'Tape hiss', meta: '−38 dB' },
                      { value: 'cafe', label: 'Café', meta: '−26 dB' },
                    ]}
                    onChange={setPick}
                  />
                </div>
              </Panel>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Panel title="Tabs">
              <div className="space-y-4">
                <Tabs
                  label="Parameter groups"
                  value={tab}
                  onChange={setTab}
                  items={[
                    { value: 'wall', label: 'Wall' },
                    { value: 'space', label: 'Space' },
                    { value: 'character', label: 'Character' },
                  ]}
                />
                <Tabs
                  label="Parameter groups, underlined"
                  variant="underline"
                  value={tab}
                  onChange={setTab}
                  items={[
                    { value: 'wall', label: 'Wall', count: 12 },
                    { value: 'space', label: 'Space', count: 5 },
                    { value: 'character', label: 'Character', count: 8 },
                  ]}
                />
              </div>
            </Panel>

            <Panel title="Notices">
              <div className="space-y-2.5">
                <Notice tone="info" icon={<Cable className="size-4" />} title="Three paths, one chain">
                  Spotify metadata stays live whichever one you use.
                </Notice>
                <Notice
                  tone="caution"
                  icon={<Headphones className="size-4" />}
                  title="This device plays what it captures"
                  action={<Button size="sm">Switch to BlackHole 2ch</Button>}
                >
                  You would hear Spotify raw and Dampen&rsquo;s output about 8 ms apart.
                </Notice>
                <Notice tone="good" title="Capture is live">
                  11.6 ms end to end.
                </Notice>
              </div>
            </Panel>

            <Panel title="Accent ramp">
              <div className="space-y-3">
                <Swatches />
                <p className="text-[11.5px] leading-relaxed text-ink-3">
                  Cyan when the window is open, ember when the wall is up. Interpolated in OKLCH
                  through seafoam and gold so it never passes through a muddy green.
                </p>
                <div className="flex items-center gap-2">
                  {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                    <Button key={v} size="sm" variant="outline" onClick={() => onAmount(v)}>
                      {Math.round(v * 100)}%
                    </Button>
                  ))}
                </div>
              </div>
            </Panel>
          </div>
        </section>

        {/* ---------------- loading + empty ---------------- */}
        <section aria-labelledby="h-states">
          <SectionHeading
            id="h-states"
            title="Loading and empty states"
            blurb="Skeletons match the real metrics exactly — a 56 px track row, a square cover, a 5 px scrub bar — so nothing shifts when data lands. Empty states always say what to do next."
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Now playing — loading">
              <NowPlayingSkeleton />
            </Panel>

            <Panel title="Now playing — no track">
              <NowPlaying
                track={null}
                position={0}
                durationMs={0}
                isPlaying={false}
                onSeek={() => undefined}
              />
            </Panel>

            <div className="space-y-4">
              <Panel title="Track list — loading" flush>
                <div className="px-2 py-1">
                  <TrackListSkeleton rows={5} />
                </div>
              </Panel>
              <Panel title="Track list — empty" flush>
                <TrackList
                  label="Liked songs, empty"
                  tracks={[]}
                  onPlay={() => undefined}
                  emptyTitle="No liked songs"
                  emptyBody="Hit the heart on anything in Spotify and it lands here."
                />
              </Panel>
              <Panel title="Search — nothing typed" flush>
                <EmptyState
                  icon={<Search className="size-5" aria-hidden />}
                  title="Search your Spotify"
                  body="Tracks, artists, albums and playlists. Press / from anywhere to jump straight here."
                  size="inline"
                />
              </Panel>
            </div>
          </div>
        </section>

        {/* ---------------- library pieces ---------------- */}
        <section aria-labelledby="h-lib">
          <SectionHeading
            id="h-lib"
            title="Library pieces"
            blurb="The track list windows itself over a fixed 56 px row with no dependency: only the visible slice plus six rows of overscan is ever in the DOM, and every row is memoised. Up/Down move a cursor, Enter plays."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Playlist grid">
              <PlaylistGrid
                label="Playlists"
                playlists={FIXTURE_PLAYLISTS}
                selectedId={FIXTURE_PLAYLISTS[2].id}
                onOpen={() => undefined}
                onPlay={() => undefined}
              />
            </Panel>
            <div className="space-y-4">
              <Panel title="Artist shelf">
                <ArtistRow label="Top artists" artists={FIXTURE_ARTISTS} onOpen={() => undefined} />
              </Panel>
              <Panel title="Spotify Connect devices">
                <DeviceList
                  devices={FIXTURE_DEVICES}
                  localDeviceId="dev-dampen"
                  onTransfer={() => undefined}
                />
              </Panel>
              <Panel title="Skeleton shapes">
                <div className="flex items-center gap-3">
                  <Skeleton shape="circle" className="size-10" />
                  <Skeleton className="h-10 w-10 rounded-md" delayMs={80} />
                  <div className="flex-1 space-y-2">
                    <Skeleton shape="text" className="w-2/3" />
                    <Skeleton shape="text" className="h-2.5 w-1/3" delayMs={60} />
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </section>

        {/* ---------------- search results, wide ---------------- */}
        <section aria-labelledby="h-search">
          <SectionHeading
            id="h-search"
            title="Search results"
            blurb="Sections appear only when they have hits, each with its own count. The track block reuses the windowed list inside a capped height."
          />
          <Panel>
            <SearchResults
              query="jon hopkins"
              results={FIXTURE_SEARCH}
              currentUri={FIXTURE_SEARCH.tracks[0].uri}
              isPlaying
              onPlayTrack={() => undefined}
              onOpenPlaylist={() => undefined}
              onOpenArtist={() => undefined}
            />
          </Panel>
        </section>
      </div>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Sheet"
        description="Modal surface with a focus trap, Escape to dismiss, and focus returned to the trigger on close. Used for the device picker and the shortcut reference."
      >
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-ink-2">
            Tab cycles inside this panel and nowhere else. Clicking the scrim closes it.
          </p>
          <DeviceList
            devices={FIXTURE_DEVICES}
            localDeviceId="dev-dampen"
            onTransfer={() => setSheetOpen(false)}
          />
        </div>
      </Sheet>
    </>
  );
}
