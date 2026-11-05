'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PRESETS, useDampen } from '@/lib/audio/useDampen';
import { listCaptureDevices, openCapture } from '@/lib/audio/capture';
import type { EngineMeters, InputMode } from '@/lib/types';
import { SpectrumScope } from '@/components/viz/SpectrumScope';
import { SourceSwitcher } from '@/components/player/SourceSwitcher';
import type { CaptureDeviceLike } from '@/components/player/CaptureSetup';
import { clamp } from '@/components/ui/accent';
import { useUIStore } from '@/components/ui/store';
import { DampenConsole } from './DampenConsole';

/**
 * `CaptureDevice` as this island consumes it. `passthrough` is being added to
 * `lib/audio/capture.ts`; reading it optionally means this compiles against
 * both the old and the new shape, and the fallback ('unknown') is the honest
 * answer when the engine cannot tell.
 */
interface RawCaptureDevice {
  deviceId: string;
  label: string;
  likelyVirtual: boolean;
  passthrough?: 'none' | 'likely' | 'unknown';
}

/**
 * Engine-state fields the engine is adding alongside the documented contract.
 * Read through a narrow optional view so this island does not break whichever
 * side lands first.
 */
interface EngineExtras {
  latencyMs?: number | null;
  feedbackRisk?: boolean;
}

const IDLE_METERS: EngineMeters = {
  inputPeak: Number.NEGATIVE_INFINITY,
  outputPeak: Number.NEGATIVE_INFINITY,
  outputRms: Number.NEGATIVE_INFINITY,
  reduction: 0,
};

/**
 * The engine island.
 *
 * Everything that touches DSP state lives inside this one client boundary:
 * `useDampen()` publishes `meters` at roughly 20 Hz, so this component
 * re-renders 20 times a second — and that is fine, because it renders nothing
 * but two `memo`'d children whose props do not change on a meter tick. The
 * meters themselves are handed down as a *getter* reading a ref, so the bars
 * are driven inside `MeterBar`'s own rAF loop.
 *
 * It renders two grid items: the source panel and the console. They are not
 * adjacent on screen — the page places them by grid line, so DOM adjacency
 * costs nothing.
 */
export function EngineIsland() {
  const dampen = useDampen();
  const extras = dampen as unknown as EngineExtras;

  // The 20 Hz meter stream is parked in a ref rather than threaded through
  // props, and mirrored in an effect so render stays pure.
  const metersRef = useRef<EngineMeters>(IDLE_METERS);
  useEffect(() => {
    metersRef.current = dampen.meters ?? IDLE_METERS;
  }, [dampen.meters]);
  const getMeters = useCallback(() => metersRef.current, []);
  const getInputPeak = useCallback(() => metersRef.current.inputPeak, []);

  /* ---- capture devices ---- */
  const [devices, setDevices] = useState<CaptureDeviceLike[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [isScanning, setScanning] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      const raw = (await listCaptureDevices()) as unknown as RawCaptureDevice[];
      const mapped: CaptureDeviceLike[] = raw.map((d) => ({
        deviceId: d.deviceId,
        label: d.label,
        likelyVirtual: d.likelyVirtual,
        passthrough: d.passthrough ?? 'unknown',
      }));
      setDevices(mapped);
      setPermissionDenied(false);
      setSelectedDeviceId((current) => {
        if (current && mapped.some((d) => d.deviceId === current)) return current;
        // Prefer a virtual device that captures silently — that is the one
        // that actually sounds right.
        return (
          mapped.find((d) => d.likelyVirtual && d.passthrough === 'none')?.deviceId ??
          mapped.find((d) => d.likelyVirtual)?.deviceId ??
          mapped[0]?.deviceId ??
          null
        );
      });
    } catch {
      setPermissionDenied(true);
    } finally {
      setScanning(false);
    }
  }, []);

  // Capture is the primary path, so default into it and look for a device
  // immediately rather than waiting for the user to go hunting.
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    dampen.setInputMode('capture');
    void rescan();
  }, [dampen, rescan]);

  const startCapture = useCallback(async () => {
    if (!selectedDeviceId) return;
    try {
      await dampen.start();
      const stream = await openCapture(selectedDeviceId);
      await dampen.setSource({ kind: 'stream', stream });
      setPermissionDenied(false);
    } catch {
      setPermissionDenied(true);
    }
  }, [dampen, selectedDeviceId]);

  /* ---- local files ---- */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [localFileName, setLocalFileName] = useState<string | null>(null);

  const playElement = useCallback(
    async (src: string, name: string) => {
      await dampen.start();
      let el = audioRef.current;
      if (!el) {
        el = new Audio();
        el.crossOrigin = 'anonymous';
        el.loop = false;
        audioRef.current = el;
      }
      el.src = src;
      await dampen.setSource({ kind: 'element', el });
      setLocalFileName(name);
      try {
        await el.play();
      } catch {
        // Autoplay can still refuse; the transport play button will start it.
      }
    },
    [dampen],
  );

  const onLocalFile = useCallback(
    (file: File) => {
      void playElement(URL.createObjectURL(file), file.name);
    },
    [playElement],
  );

  const onUseDemo = useCallback(() => {
    void playElement('/audio/demo.m4a', 'Demo track');
  }, [playElement]);

  /* ---- keyboard + cross-island wiring ---- */
  const publishDampen = useUIStore((s) => s.publishDampen);
  const registerActions = useUIStore((s) => s.registerActions);

  const amount = dampen.params.amount;
  const bypass = dampen.bypass;

  useEffect(() => {
    publishDampen({ amount, bypass });
  }, [amount, bypass, publishDampen]);

  // Latest-value refs for the keyboard commands, which run outside render and
  // must not re-register every time the dial moves.
  const amountRef = useRef(amount);
  const bypassRef = useRef(bypass);
  useEffect(() => {
    amountRef.current = amount;
    bypassRef.current = bypass;
  }, [amount, bypass]);

  useEffect(() => {
    registerActions({
      nudgeAmount: (delta) => dampen.setAmount(clamp(amountRef.current + delta, 0, 1)),
      toggleBypass: () => dampen.setBypass(!bypassRef.current),
      selectPresetIndex: (index) => {
        const preset = PRESETS[index];
        if (preset) dampen.applyPreset(preset.id);
      },
    });
  }, [dampen, registerActions]);

  const onModeChange = useCallback(
    (mode: InputMode) => {
      dampen.setInputMode(mode);
      if (mode === 'capture') void rescan();
    },
    [dampen, rescan],
  );

  const running = dampen.status === 'running';

  return (
    <>
      <SourceSwitcher
        className="order-2 xl:col-start-2 xl:row-start-2"
        mode={dampen.inputMode}
        onModeChange={onModeChange}
        status={dampen.status}
        latencyMs={extras.latencyMs ?? null}
        capture={{
          devices,
          selectedDeviceId,
          onSelectDevice: setSelectedDeviceId,
          onRescan: () => void rescan(),
          isScanning,
          isCapturing: running && dampen.inputMode === 'capture',
          getInputPeak,
          latencyMs: extras.latencyMs ?? null,
          feedbackRisk: extras.feedbackRisk ?? false,
          permissionDenied,
          onStart: () => void startCapture(),
        }}
        spotifyAvailable
        onLocalFile={onLocalFile}
        onUseDemo={onUseDemo}
        localFileName={localFileName}
      />

      <DampenConsole
        className="order-4 xl:col-start-3 xl:row-start-2 xl:row-span-2"
        amount={amount}
        onAmount={dampen.setAmount}
        presets={PRESETS}
        presetId={dampen.presetId}
        onPreset={dampen.applyPreset}
        bypass={bypass}
        onBypass={dampen.setBypass}
        params={dampen.params}
        onParam={dampen.setParam}
        getMeters={getMeters}
        running={running}
        scope={
          <SpectrumScope
            analysers={dampen.analysers}
            filterResponse={dampen.filterResponse}
            className="h-[88px] w-full overflow-hidden rounded-xl border border-line bg-black/25"
          />
        }
      />
    </>
  );
}
