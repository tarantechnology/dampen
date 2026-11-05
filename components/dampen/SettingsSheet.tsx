'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useDampen } from '@/lib/audio/useDampen';
import { openCapture } from '@/lib/audio/capture';
import { usePlayback } from '@/lib/spotify/usePlayback';
import { useAuth } from '@/lib/spotify/useSpotify';
import type { InputMode } from '@/lib/types';
import { SpectrumScope } from '@/components/viz/SpectrumScope';
import { CaptureSteps } from '@/components/player/CaptureSetup';
import { Group, GroupLabel, GroupNote, Row, RowButton } from '@/components/ui/Rows';
import { Segmented } from '@/components/ui/Segmented';
import { Select } from '@/components/ui/Select';
import { Sheet } from '@/components/ui/Sheet';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import { formatDb } from '@/components/ui/format';
import { useUIStore, type ThemePreference } from '@/components/ui/store';
import { AdvancedParams } from './AdvancedParams';
import { Meters } from './Meters';

const MODES: ReadonlyArray<{ value: InputMode; label: string }> = [
  { value: 'capture', label: 'Capture' },
  { value: 'spotify', label: 'Spotify' },
  { value: 'local', label: 'Local' },
];

const THEMES: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * One `<audio>` element for local files, kept at module scope.
 *
 * The sheet unmounts whenever it closes, and the engine holds a
 * `MediaElementAudioSourceNode` pointing at this element — losing the
 * reference would leave a track playing that nothing could stop.
 */
let localAudio: HTMLAudioElement | null = null;

/**
 * Everything that is not the music.
 *
 * The source switcher, the virtual-device walkthrough, the whole DSP tree,
 * the spectrum analyser and the meters all live here, behind one icon. The
 * player screen is left with artwork, a transport, a slider and nine words.
 */
export function SettingsSheet() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Settings">
      {open ? <SettingsBody /> : null}
    </Sheet>
  );
}

function SettingsBody() {
  const dampen = useDampen();
  const playback = usePlayback();
  const auth = useAuth();

  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);

  const [scanning, setScanning] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [localName, setLocalName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* The 20 Hz meter stream goes through a ref, so the bars animate without
     re-rendering this (large) tree twenty times a second. */
  const metersRef = useRef(dampen.meters);
  useEffect(() => {
    metersRef.current = dampen.meters;
  }, [dampen.meters]);
  const getMeters = useCallback(() => metersRef.current, []);

  const devices = dampen.captureDevices;
  const hasVirtual = devices.some((d) => d.likelyVirtual);

  const scan = useCallback(async () => {
    setScanning(true);
    setSourceError(null);
    try {
      const found = await dampen.refreshCaptureDevices();
      if (!dampen.captureDevice) {
        const preferred =
          found.find((d) => d.likelyVirtual && d.passthrough === 'none') ??
          found.find((d) => d.likelyVirtual) ??
          found[0] ??
          null;
        dampen.setCaptureDevice(preferred);
      }
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : 'Could not list audio inputs.');
    } finally {
      setScanning(false);
    }
  }, [dampen]);

  /* Enumerate once when Capture comes on screen with nothing listed yet.
     Deferred by a tick: enumeration can raise the microphone prompt, and
     that must not happen inside a render pass. */
  useEffect(() => {
    if (dampen.inputMode !== 'capture' || devices.length > 0) return;
    const timer = setTimeout(() => void scan(), 0);
    return () => clearTimeout(timer);
    // Only on mode change: re-running on every device list edit would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dampen.inputMode]);

  const startCapture = async () => {
    const device = dampen.captureDevice;
    if (!device) return;
    setSourceError(null);
    try {
      await dampen.start();
      const stream = await openCapture(device.deviceId);
      await dampen.setSource({ kind: 'stream', stream });
    } catch (err) {
      setSourceError(
        err instanceof Error ? err.message : 'Could not open that input device.',
      );
    }
  };

  const playElement = async (src: string, name: string) => {
    setSourceError(null);
    try {
      await dampen.start();
      if (!localAudio) {
        localAudio = new Audio();
        localAudio.crossOrigin = 'anonymous';
      }
      localAudio.src = src;
      await dampen.setSource({ kind: 'element', el: localAudio });
      setLocalName(name);
      await localAudio.play();
    } catch {
      // Autoplay can still refuse; the transport's play button will start it.
    }
  };

  const running = dampen.status === 'running';
  const capturing = running && dampen.inputMode === 'capture';

  return (
    <div className="flex flex-col gap-7 pt-1">
      {/* ---- Audio source ---- */}
      <section className="flex flex-col gap-2">
        <GroupLabel>Audio source</GroupLabel>
        <Segmented
          label="Audio source"
          value={dampen.inputMode}
          options={MODES}
          onChange={(mode) => {
            setSourceError(null);
            dampen.setInputMode(mode);
          }}
        />

        {dampen.inputMode === 'capture' ? (
          <>
            <Group className="mt-1">
              <Row
                label="Input device"
                trailing={
                  <Select
                    label="Capture input device"
                    className="max-w-[190px]"
                    placeholder="No inputs found"
                    value={dampen.captureDevice?.deviceId ?? ''}
                    options={devices.map((d) => ({
                      value: d.deviceId,
                      label: d.likelyVirtual ? `${d.label} — virtual` : d.label,
                    }))}
                    onChange={(id) =>
                      dampen.setCaptureDevice(
                        devices.find((d) => d.deviceId === id) ?? null,
                      )
                    }
                  />
                }
              />
              <RowButton
                label={scanning ? 'Scanning…' : 'Scan for devices'}
                disabled={scanning}
                onClick={() => void scan()}
              />
              <RowButton
                label={capturing ? 'Capturing' : 'Start capture'}
                tone="action"
                disabled={!dampen.captureDevice || capturing}
                onClick={() => void startCapture()}
              />
            </Group>

            <GroupNote>
              Spotify&rsquo;s web player is DRM-locked, so route the desktop app
              through a virtual audio device to filter it.
            </GroupNote>

            {dampen.feedback.risk ? (
              <Warning>{dampen.feedback.message}</Warning>
            ) : null}

            {!hasVirtual || showSteps ? (
              <Group className="mt-1">
                <CaptureSteps />
              </Group>
            ) : (
              <Group className="mt-1">
                <RowButton
                  label="Set up a virtual device"
                  chevron
                  onClick={() => setShowSteps(true)}
                />
              </Group>
            )}
          </>
        ) : null}

        {dampen.inputMode === 'spotify' ? (
          <GroupNote>
            In-browser playback is DRM-protected, so only part of the chain can
            reach it. Capture mode filters the real audio.
          </GroupNote>
        ) : null}

        {dampen.inputMode === 'local' ? (
          <>
            <Group className="mt-1">
              <RowButton
                label="Choose an audio file"
                value={localName ?? undefined}
                onClick={() => fileRef.current?.click()}
              />
              <RowButton label="Play the demo track" onClick={() => void playElement('/audio/demo.m4a', 'Demo track')} />
            </Group>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void playElement(URL.createObjectURL(file), file.name);
              }}
            />
          </>
        ) : null}

        {sourceError ? <Warning>{sourceError}</Warning> : null}
      </section>

      {/* ---- Dampen ---- */}
      <section className="flex flex-col gap-2">
        <GroupLabel>Dampen</GroupLabel>
        <Group>
          <Row
            label="Bypass"
            detail="Hear the track untouched, without losing your settings."
            trailing={
              <Toggle
                label="Bypass the effect"
                checked={dampen.bypass}
                onChange={dampen.setBypass}
              />
            }
          />
          <div className="px-3.5 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] text-t1">Output level</span>
              <span className="num text-[12.5px] text-t3">{formatDb(dampen.params.outputGain)}</span>
            </div>
            <Slider
              className="mt-0.5"
              label="Output level"
              min={-24}
              max={12}
              step={0.5}
              bipolar
              value={dampen.params.outputGain}
              valueText={formatDb(dampen.params.outputGain)}
              onChange={(v) => dampen.setParam('outputGain', v)}
            />
          </div>
        </Group>
      </section>

      <AdvancedParams params={dampen.params} onParam={dampen.setParam} />

      {/* ---- Analysis ---- */}
      <section className="flex flex-col gap-2">
        <GroupLabel>Analysis</GroupLabel>
        <Group>
          <div className="p-3.5">
            <SpectrumScope
              analysers={dampen.analysers}
              filterResponse={dampen.filterResponse}
              amount={dampen.params.amount}
              className="h-[120px] w-full overflow-hidden rounded-[10px] bg-[#0b0b0c]"
            />
          </div>
          <Meters getMeters={getMeters} running={running} />
        </Group>
        <GroupNote>
          {running
            ? 'Input against output, live.'
            : 'Nothing is being processed yet.'}
        </GroupNote>
      </section>

      {/* ---- Playback ---- */}
      <section className="flex flex-col gap-2">
        <GroupLabel>Playback</GroupLabel>
        <Group>
          <Row
            label="Device"
            trailing={
              <Select
                label="Playback device"
                className="max-w-[190px]"
                placeholder="No devices"
                value={playback.devices.find((d) => d.isActive)?.id ?? ''}
                options={playback.devices
                  .filter((d): d is typeof d & { id: string } => d.id !== null)
                  .map((d) => ({ value: d.id, label: d.name }))}
                onChange={(id) => void playback.transferTo(id)}
              />
            }
          />
          <RowButton
            label="Refresh devices"
            onClick={() => void playback.refreshDevices()}
          />
        </Group>
      </section>

      {/* ---- Appearance ---- */}
      <section className="flex flex-col gap-2">
        <GroupLabel>Appearance</GroupLabel>
        <Group>
          <Row
            label="Theme"
            trailing={
              <Segmented
                label="Theme"
                className="w-[200px]"
                value={theme}
                options={THEMES}
                onChange={setTheme}
              />
            }
          />
        </Group>
      </section>

      {/* ---- Account ---- */}
      <section className="flex flex-col gap-2">
        <GroupLabel>Account</GroupLabel>
        <Group>
          {auth.status === 'authed' && auth.user ? (
            <>
              <Row
                label={auth.user.displayName}
                detail={auth.isPremium ? 'Spotify Premium' : 'Spotify'}
              />
              <RowButton label="Sign out" tone="danger" onClick={auth.logout} />
            </>
          ) : (
            <RowButton label="Connect Spotify" tone="action" onClick={auth.login} />
          )}
          <RowButton
            label="Keyboard shortcuts"
            chevron
            onClick={() => {
              setSettingsOpen(false);
              setShortcutsOpen(true);
            }}
          />
        </Group>
      </section>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 flex items-start gap-2.5 rounded-[12px] bg-fill-1 px-3.5 py-3">
      <TriangleAlert
        size={15}
        strokeWidth={2}
        aria-hidden
        className="mt-px shrink-0 text-danger"
      />
      <p className="text-[13px] leading-[1.5] text-t2">{children}</p>
    </div>
  );
}
