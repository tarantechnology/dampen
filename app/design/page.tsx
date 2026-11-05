'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  FIXTURE_CAPTURE_DEVICES,
  FIXTURE_DEFAULT_PARAMS,
  FIXTURE_PLAYBACK,
  FIXTURE_PLAYLISTS,
  FIXTURE_PRESETS,
  FIXTURE_SEARCH,
  FIXTURE_TRACKS,
  FIXTURE_USER,
  simulatedMeters,
} from '@/components/fixtures';
import type { DampenParams, EngineMeters, InputMode } from '@/lib/types';
import { AdvancedParams } from '@/components/dampen/AdvancedParams';
import { writeParam } from '@/components/dampen/paramSpec';
import { DampenSlider } from '@/components/dampen/DampenSlider';
import { Meters } from '@/components/dampen/Meters';
import { PresetChips } from '@/components/dampen/PresetChips';
import { PlaylistList } from '@/components/library/PlaylistList';
import { SearchResults } from '@/components/library/SearchResults';
import { Sidebar } from '@/components/library/Sidebar';
import { TrackList } from '@/components/library/TrackList';
import { CaptureSteps } from '@/components/player/CaptureSetup';
import { NowPlaying } from '@/components/player/NowPlaying';
import { Scrubber } from '@/components/player/Scrubber';
import { Transport } from '@/components/player/Transport';
import { SpectrumScope } from '@/components/viz/SpectrumScope';
import { AccentDriver } from '@/components/ui/AccentDriver';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Group, GroupLabel, GroupNote, Row, RowButton } from '@/components/ui/Rows';
import { Segmented } from '@/components/ui/Segmented';
import { Select } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import { formatDb } from '@/components/ui/format';
import { useUIStore, type LibraryView } from '@/components/ui/store';
import { SlidersHorizontal } from 'lucide-react';

const MODE_OPTIONS: ReadonlyArray<{ value: InputMode; label: string }> = [
  { value: 'capture', label: 'Capture' },
  { value: 'spotify', label: 'Spotify' },
  { value: 'local', label: 'Local' },
];

/**
 * The review route.
 *
 * Fixtures only: nothing here imports `lib/audio/**` or `lib/spotify/**` at
 * runtime, so this page renders identically with no engine, no network and
 * no Spotify session. It exists so the design can be looked at — the
 * previous version of this interface was shipped without anyone doing that.
 */
export default function DesignPage() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const publishPlayback = useUIStore((s) => s.publishPlayback);

  const track = FIXTURE_PLAYBACK.track ?? FIXTURE_TRACKS[7];

  useEffect(() => {
    publishPlayback({
      artworkUrl: null,
      accentSeed: `${track.album.name} ${track.artists[0]?.name ?? ''}`,
      currentUri: track.uri,
      isPlaying: true,
    });
  }, [publishPlayback, track]);

  return (
    <div className="min-h-dvh bg-bg">
      <AccentDriver />

      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-hairline bg-bg/85 px-5 py-3 backdrop-blur-xl">
        <div>
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">
            Dampen — design review
          </h1>
          <p className="text-[12.5px] text-t3">Fixtures only. No engine, no network.</p>
        </div>
        <Segmented
          label="Theme"
          className="w-[220px]"
          value={theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={setTheme}
        />
      </header>

      <main className="mx-auto flex max-w-[1180px] flex-col gap-16 px-5 py-12">
        <PlayerScreen />
        <ControlStates />
        <SettingsPieces />
        <LibraryStates />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>
        {note ? <p className="mt-1 text-[13.5px] text-t2">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The whole player, at the size it actually renders. */
function PlayerScreen() {
  const [amount, setAmount] = useState(0.42);
  const [presetId, setPresetId] = useState<string | null>(FIXTURE_PRESETS[0].id);
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(FIXTURE_PLAYBACK.position);
  const [volume, setVolume] = useState(FIXTURE_PLAYBACK.volume);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'track' | 'context'>('context');
  const [view, setView] = useState<LibraryView>('playlists');
  const [query, setQuery] = useState('');

  const publishDampen = useUIStore((s) => s.publishDampen);
  useEffect(() => publishDampen({ amount }), [amount, publishDampen]);

  const track = FIXTURE_PLAYBACK.track ?? FIXTURE_TRACKS[7];

  return (
    <Section
      title="The player"
      note="One centred column, a quiet rail, and one control that matters."
    >
      <div className="flex h-[880px] overflow-hidden rounded-[14px] border border-hairline">
        <aside className="hidden w-[264px] shrink-0 border-r border-hairline sm:block">
          <Sidebar
            view={view}
            onViewChange={setView}
            query={query}
            onQueryChange={setQuery}
            focusNonce={0}
            openTitle={null}
            onBack={() => undefined}
            user={FIXTURE_USER}
            authStatus="authed"
            onLogin={() => undefined}
          >
            <div className="flex min-h-0 flex-1 flex-col">
              {view === 'playlists' ? (
                <PlaylistList
                  playlists={FIXTURE_PLAYLISTS}
                  isLoading={false}
                  onOpen={() => undefined}
                  emptyBody=""
                />
              ) : (
                <TrackList
                  label="Liked songs"
                  tracks={FIXTURE_TRACKS}
                  isLoading={false}
                  currentUri={track.uri}
                  onPlay={() => undefined}
                  emptyTitle="No liked songs"
                  emptyBody=""
                />
              )}
            </div>
          </Sidebar>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-end px-3">
            <IconButton label="Settings">
              <SlidersHorizontal size={18} strokeWidth={2} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex min-h-full flex-col items-center justify-center px-5 pb-10 pt-2">
              <div className="flex w-full max-w-[380px] flex-col items-center">
                <NowPlaying track={track} />
                <Scrubber
                  className="mt-8 w-full max-w-[380px]"
                  position={position}
                  durationMs={FIXTURE_PLAYBACK.durationMs}
                  onSeek={setPosition}
                />
                <Transport
                  className="mt-5"
                  isPlaying={playing}
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
                <div className="mt-10 flex w-full flex-col items-center gap-3">
                  <DampenSlider value={amount} onChange={setAmount} />
                  <PresetChips
                    presets={FIXTURE_PRESETS}
                    selectedId={amount > 0.001 ? presetId : null}
                    onSelect={(id) => {
                      setPresetId(id ?? presetId);
                      if (id === null) setAmount(0);
                      else if (amount < 0.05) setAmount(0.7);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </Section>
  );
}

/** The hero control at four values, so the label inversion is visible. */
function ControlStates() {
  const [values, setValues] = useState([0, 0.35, 0.72, 1]);

  return (
    <Section
      title="The Dampen control"
      note="Drag anywhere on the body. The percentage appears only while you are on it."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {values.map((value, i) => (
          <DampenSlider
            key={i}
            value={value}
            onChange={(next) =>
              setValues((all) => all.map((v, j) => (i === j ? next : v)))
            }
          />
        ))}
      </div>
      <div className="max-w-[420px]">
        <DampenSlider value={0.5} onChange={() => undefined} disabled />
        <p className="mt-2 text-[12.5px] text-t3">Disabled, while bypass is on.</p>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

function SettingsPieces() {
  const [mode, setMode] = useState<InputMode>('capture');
  const [deviceId, setDeviceId] = useState(FIXTURE_CAPTURE_DEVICES[0].deviceId);
  const [bypass, setBypass] = useState(false);
  const [params, setParams] = useState<DampenParams>(FIXTURE_DEFAULT_PARAMS);
  const [meters, setMeters] = useState<EngineMeters>(() => simulatedMeters(0));

  /* A plausible live signal, so the meters are not a frozen bar. */
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      setMeters(simulatedMeters((performance.now() - start) / 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const getMeters = useMemo(() => () => meters, [meters]);

  const onParam = (path: string, value: number | string) =>
    setParams((p) => writeParam(p, path, value));

  return (
    <Section
      title="Settings"
      note="Everything that is not the music. Grouped rows, hairlines inside one container, no cards."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-7">
          <section className="flex flex-col gap-2">
            <GroupLabel>Audio source</GroupLabel>
            <Segmented
              label="Audio source"
              value={mode}
              options={MODE_OPTIONS}
              onChange={(value) => setMode(value)}
            />
            <Group className="mt-1">
              <Row
                label="Input device"
                trailing={
                  <Select
                    label="Capture input device"
                    className="max-w-[190px]"
                    value={deviceId}
                    options={FIXTURE_CAPTURE_DEVICES.map((d) => ({
                      value: d.deviceId,
                      label: d.likelyVirtual ? `${d.label} — virtual` : d.label,
                    }))}
                    onChange={setDeviceId}
                  />
                }
              />
              <RowButton label="Scan for devices" onClick={() => undefined} />
              <RowButton label="Start capture" tone="action" onClick={() => undefined} />
            </Group>
            <GroupNote>
              Spotify&rsquo;s web player is DRM-locked, so route the desktop app
              through a virtual audio device to filter it.
            </GroupNote>
            <Group className="mt-1">
              <CaptureSteps />
            </Group>
          </section>

          <section className="flex flex-col gap-2">
            <GroupLabel>Dampen</GroupLabel>
            <Group>
              <Row
                label="Bypass"
                detail="Hear the track untouched, without losing your settings."
                trailing={
                  <Toggle label="Bypass the effect" checked={bypass} onChange={setBypass} />
                }
              />
          <div className="px-3.5 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] text-t1">Output level</span>
              <span className="num text-[12.5px] text-t3">{formatDb(params.outputGain)}</span>
            </div>
            <Slider
              className="mt-0.5"
              label="Output level"
              min={-24}
              max={12}
              step={0.5}
              bipolar
              value={params.outputGain}
              valueText={formatDb(params.outputGain)}
              onChange={(v) => onParam('outputGain', v)}
            />
          </div>
            </Group>
          </section>

          <section className="flex flex-col gap-2">
            <GroupLabel>Analysis</GroupLabel>
            <Group>
              <div className="p-3.5">
                <SpectrumScope
                  analysers={null}
                  amount={params.amount}
                  className="h-[120px] w-full overflow-hidden rounded-[10px] bg-[#0b0b0c]"
                />
              </div>
              <Meters getMeters={getMeters} running />
            </Group>
            <GroupNote>Input against output, live.</GroupNote>
          </section>
        </div>

        <AdvancedParams params={params} onParam={onParam} />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Library
 * ------------------------------------------------------------------ */

function LibraryStates() {
  return (
    <Section title="Library states" note="Loaded, searching, loading, empty.">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Panel label="Tracks">
          <TrackList
            label="Liked songs"
            tracks={FIXTURE_TRACKS}
            isLoading={false}
            currentUri={FIXTURE_TRACKS[7].uri}
            onPlay={() => undefined}
            emptyTitle=""
            emptyBody=""
          />
        </Panel>

        <Panel label="Search">
          <div className="h-full overflow-y-auto">
            <SearchResults
              query="hopkins"
              results={FIXTURE_SEARCH}
              isLoading={false}
              currentUri={null}
              onPlayTrack={() => undefined}
              onOpenPlaylist={() => undefined}
              onOpenArtist={() => undefined}
            />
          </div>
        </Panel>

        <Panel label="Loading">
          <TrackList
            label="Loading"
            tracks={[]}
            isLoading
            currentUri={null}
            onPlay={() => undefined}
            emptyTitle=""
            emptyBody=""
          />
        </Panel>

        <Panel label="Signed out">
          <EmptyState
            title="No playlists"
            body="Connect Spotify to see your library here."
            action={
              <Button variant="filled" size="sm">
                Connect Spotify
              </Button>
            }
          />
        </Panel>
      </div>
    </Section>
  );
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-[420px] flex-col">
      <span className="mb-2 px-1 text-[12.5px] text-t3">{label}</span>
      <div className="min-h-0 flex-1 overflow-hidden rounded-[12px] bg-sunken p-1">
        {children}
      </div>
    </div>
  );
}
