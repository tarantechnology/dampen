'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Headphones,
  RotateCcw,
  TriangleExclamationPoint,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { clamp } from '@/components/ui/accent';
import { dbToMeter } from '@/components/ui/format';

/* ------------------------------------------------------------------ *
 * Types
 *
 * Mirrors `CaptureDevice` from lib/audio/capture.ts, including the
 * `passthrough` field the engine is adding. Declared structurally so this
 * component also compiles on the /design route with fixtures.
 * ------------------------------------------------------------------ */

export interface CaptureDeviceLike {
  deviceId: string;
  label: string;
  likelyVirtual: boolean;
  passthrough: 'none' | 'likely' | 'unknown';
}

export type Platform = 'mac' | 'windows' | 'linux';

interface Install {
  heading: string;
  /** The thing to copy. A shell command, or a URL where there isn't one. */
  snippet: string;
  snippetKind: 'command' | 'url';
  /** What they end up with. */
  product: string;
  help: string;
  helpLabel: string;
}

const INSTALL: Record<Platform, Install> = {
  mac: {
    heading: 'Install BlackHole',
    snippet: 'brew install blackhole-2ch',
    snippetKind: 'command',
    product: 'BlackHole 2ch',
    help: 'https://github.com/ExistentialAudio/BlackHole#installation-instructions',
    helpLabel: 'BlackHole install guide',
  },
  windows: {
    heading: 'Install VB-Cable',
    snippet: 'https://vb-audio.com/Cable/',
    snippetKind: 'url',
    product: 'CABLE Input / CABLE Output',
    help: 'https://vb-audio.com/Cable/',
    helpLabel: 'VB-Cable download and setup',
  },
  linux: {
    heading: 'Create a null sink',
    snippet: 'pactl load-module module-null-sink sink_name=dampen',
    snippetKind: 'command',
    product: 'Monitor of dampen',
    help: 'https://wiki.archlinux.org/title/PulseAudio/Examples#Creating_a_virtual_sink',
    helpLabel: 'PulseAudio virtual sink docs',
  },
};

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'mac';
  const ua = `${navigator.userAgent} ${navigator.platform ?? ''}`.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux') || ua.includes('android')) return 'linux';
  return 'mac';
}

/* ------------------------------------------------------------------ *
 * Copy button
 * ------------------------------------------------------------------ */

function CopyField({ value, kind }: { value: string; kind: 'command' | 'url' }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked by permissions policy. The text is selectable.
      setCopied(false);
    }
  };

  return (
    <div className="flex items-stretch gap-1.5">
      <code
        className={cn(
          'num min-w-0 flex-1 select-all truncate rounded-lg border border-line bg-black/35 px-2.5 py-2',
          'text-[12px] text-ink',
        )}
      >
        {kind === 'command' ? <span className="mr-1.5 text-ink-4">$</span> : null}
        {value}
      </code>
      <Button
        variant="outline"
        size="icon"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${kind}`}
        className="h-auto"
      >
        {copied ? (
          <Check className="size-3.5" style={{ color: 'var(--accent)' }} aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The input meter — load-bearing in capture mode. This is how you know
 * the audio actually arrived.
 * ------------------------------------------------------------------ */

type SignalState = 'closed' | 'no-signal' | 'silent' | 'live';

export interface CaptureInputMeterProps {
  /** Polled in rAF. Returns input peak in dBFS; -Infinity when truly nothing. */
  getInputPeak(): number;
  /** The capture stream is open. */
  open: boolean;
  onStateChange?(state: SignalState): void;
  className?: string;
}

const SIGNAL_COPY: Record<SignalState, { label: string; hint: string }> = {
  closed: { label: 'Input closed', hint: 'Nothing is being captured yet.' },
  'no-signal': {
    label: 'No signal',
    hint: 'The device is open but nothing is coming down it.',
  },
  silent: { label: 'Silent', hint: 'Signal path is live and sitting at the noise floor.' },
  live: { label: 'Signal', hint: 'Audio is arriving.' },
};

export function CaptureInputMeter({
  getInputPeak,
  open,
  onStateChange,
  className,
}: CaptureInputMeterProps) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const peakRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<SignalState>('closed');
  const stateRef = useRef<SignalState>('closed');

  useEffect(() => {
    if (!open) {
      stateRef.current = 'closed';
      setState('closed');
      onStateChange?.('closed');
      if (fillRef.current) fillRef.current.style.transform = 'scaleX(0)';
      if (peakRef.current) peakRef.current.style.opacity = '0';
      return;
    }

    let level = -90;
    let peak = -90;
    let peakAt = 0;
    let lastLoud = 0;
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const db = clamp(getInputPeak(), -90, 6);

      level = db >= level ? db : Math.max(db, level - 72 * dt);
      if (db >= peak) {
        peak = db;
        peakAt = now;
      } else if (now - peakAt > 1100) {
        peak = Math.max(db, peak - 24 * dt);
      }
      if (db > -58) lastLoud = now;

      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${dbToMeter(level, -60).toFixed(4)})`;
      }
      if (peakRef.current) {
        const p = dbToMeter(peak, -60);
        peakRef.current.style.left = `${(p * 100).toFixed(2)}%`;
        peakRef.current.style.opacity = p > 0.01 ? '1' : '0';
      }

      // "Silent" means the path works and the music is just quiet right now.
      // "No signal" means nothing has arrived for a second and a half — the
      // routing is wrong. The difference matters, so it is stated plainly.
      const next: SignalState =
        now - lastLoud < 1500 ? 'live' : db > -82 ? 'silent' : 'no-signal';
      if (next !== stateRef.current) {
        stateRef.current = next;
        setState(next);
        onStateChange?.(next);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getInputPeak, open, onStateChange]);

  const copy = SIGNAL_COPY[state];
  const dead = state === 'closed' || state === 'no-signal';

  return (
    <div className={cn('rounded-xl border border-line bg-black/25 p-3', className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="legend">Dampen input</span>
        <span
          className="flex items-center gap-1.5 text-[11px] font-semibold"
          style={{ color: dead ? 'var(--ink-4)' : 'var(--accent)' }}
        >
          <span
            aria-hidden
            className={cn('size-1.5 rounded-full', state === 'live' && 'animate-pulse')}
            style={{ background: dead ? 'var(--ink-4)' : 'var(--accent)' }}
          />
          {copy.label}
        </span>
      </div>

      <div
        className={cn(
          'relative h-4 overflow-hidden rounded-md ring-1 ring-inset',
          dead
            ? 'bg-[repeating-linear-gradient(135deg,oklch(1_0_0/0.05)_0_6px,transparent_6px_12px)] ring-white/[0.06]'
            : 'bg-white/[0.06] ring-white/[0.07]',
        )}
      >
        <div
          ref={fillRef}
          className="absolute inset-0 origin-left"
          style={{
            transform: 'scaleX(0)',
            background:
              'linear-gradient(90deg, var(--accent-hot) 0%, var(--accent) 65%, oklch(0.75 0.19 32) 100%)',
          }}
        />
        <div
          ref={peakRef}
          aria-hidden
          className="absolute inset-y-0 w-[2px] bg-ink/80"
          style={{ left: '0%', opacity: 0 }}
        />
        {/* Scale marks at -40, -20 and -6 dBFS. */}
        {[-40, -20, -6].map((db) => (
          <span
            key={db}
            aria-hidden
            className="absolute inset-y-0 w-px bg-black/40"
            style={{ left: `${dbToMeter(db, -60) * 100}%` }}
          />
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-snug text-ink-3" role="status">
        {copy.hint}
        {state === 'no-signal'
          ? ' Check that Spotify is playing and that its output is the virtual device.'
          : ''}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The checklist
 * ------------------------------------------------------------------ */

function StepMark({ done, index }: { done: boolean; index: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-[1px] flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
        'transition-colors duration-200',
      )}
      style={
        done
          ? {
              borderColor: 'var(--accent)',
              background: 'var(--accent-wash)',
              color: 'var(--accent)',
            }
          : { borderColor: 'var(--line-strong)', color: 'var(--ink-4)' }
      }
    >
      {done ? <Check className="size-3" strokeWidth={3} /> : index + 1}
    </span>
  );
}

function Step({
  index,
  done,
  title,
  children,
}: {
  index: number;
  done: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <StepMark done={done} index={index} />
      <div className="min-w-0 flex-1 pb-1">
        <p
          className={cn(
            'text-[13px] font-medium transition-colors',
            done ? 'text-ink-3 line-through decoration-ink-4/60' : 'text-ink',
          )}
        >
          {title}
        </p>
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * CaptureSetup
 * ------------------------------------------------------------------ */

export interface CaptureSetupProps {
  devices: CaptureDeviceLike[];
  selectedDeviceId: string | null;
  onSelectDevice(deviceId: string): void;
  onRescan(): void;
  isScanning?: boolean;
  /** The capture stream is open and feeding the engine. */
  isCapturing: boolean;
  /** Polled by the input meter. dBFS. */
  getInputPeak(): number;
  /** Measured end-to-end latency, ms. Null before the engine has a figure. */
  latencyMs: number | null;
  /** Engine flag: the capture device is also the output device. */
  feedbackRisk: boolean;
  /** getUserMedia was refused. */
  permissionDenied?: boolean;
  /** Must be wired to a real user gesture. */
  onStart(): void;
  platform?: Platform;
  className?: string;
}

export function CaptureSetup({
  devices,
  selectedDeviceId,
  onSelectDevice,
  onRescan,
  isScanning = false,
  isCapturing,
  getInputPeak,
  latencyMs,
  feedbackRisk,
  permissionDenied = false,
  onStart,
  platform,
  className,
}: CaptureSetupProps) {
  const [detected, setDetected] = useState<Platform>(platform ?? 'mac');
  useEffect(() => {
    if (!platform) setDetected(detectPlatform());
  }, [platform]);
  const os = platform ?? detected;
  const install = INSTALL[os];

  const [signal, setSignal] = useState<SignalState>('closed');
  const onSignalChange = useCallback((s: SignalState) => setSignal(s), []);

  const virtual = devices.filter((d) => d.likelyVirtual);
  const selected = devices.find((d) => d.deviceId === selectedDeviceId) ?? null;

  const hasVirtual = virtual.length > 0;
  const deviceChosen = selected !== null && selected.likelyVirtual;
  const signalPresent = signal === 'live' || signal === 'silent';
  const allDone = hasVirtual && deviceChosen && signal === 'live';

  const cleanAlternative = virtual.find((d) => d.passthrough === 'none');

  return (
    <div className={cn('space-y-5', className)}>
      {/* The honest sentence. Not an apology. */}
      <p className="text-[13px] leading-relaxed text-ink-2">
        Spotify&rsquo;s own web stream is DRM-locked, so a browser can never filter it. Route the
        Spotify <em className="not-italic text-ink">desktop app</em> through a virtual audio
        device and Dampen gets the real audio &mdash; full filter chain, nothing recorded, nothing
        leaving your machine.
      </p>

      <ol className="space-y-4">
        <Step index={0} done={hasVirtual} title={`${install.heading} — a silent audio device`}>
          {hasVirtual ? (
            <p className="text-[12px] text-ink-3">
              Found{' '}
              <span className="text-ink-2">{virtual.map((d) => d.label).join(', ')}</span>.
            </p>
          ) : (
            <div className="space-y-2.5">
              <p className="text-[12px] leading-relaxed text-ink-3">
                A virtual device is a cable that only exists in software. Audio goes in, nothing
                comes out of your speakers &mdash; which is exactly what we want, because Dampen
                does the playing.
              </p>
              <CopyField value={install.snippet} kind={install.snippetKind} />
              <a
                href={install.help}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-3 underline decoration-ink-4 underline-offset-2 hover:text-ink"
              >
                {install.helpLabel}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </div>
          )}
        </Step>

        <Step index={1} done={deviceChosen} title="Choose it as Dampen&rsquo;s input">
          <div className="space-y-2.5">
            <div className="flex items-end gap-2">
              <Select
                className="min-w-0 flex-1"
                label="Capture device"
                hideLabel
                value={selectedDeviceId ?? ''}
                options={
                  devices.length > 0
                    ? devices.map((d) => ({
                        value: d.deviceId,
                        label: d.label,
                        meta: d.likelyVirtual ? 'virtual' : 'hardware',
                      }))
                    : [{ value: '', label: 'No audio inputs found' }]
                }
                onChange={(id) => id && onSelectDevice(id)}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={onRescan}
                aria-label="Rescan audio devices"
                disabled={isScanning}
              >
                <RotateCcw className={cn('size-3.5', isScanning && 'animate-spin')} aria-hidden />
              </Button>
            </div>
            {selected && !selected.likelyVirtual ? (
              <p className="text-[11.5px] leading-snug text-ink-3">
                {selected.label} looks like real hardware, not a virtual cable. Dampen will
                capture whatever is plugged into it.
              </p>
            ) : null}
          </div>
        </Step>

        <Step
          index={2}
          done={signal === 'live'}
          title={`Send Spotify's audio into ${selected?.label ?? install.product}`}
        >
          <div className="space-y-3">
            <p className="text-[12px] leading-relaxed text-ink-3">
              {os === 'windows'
                ? 'Windows: Settings › System › Sound, set the output device to CABLE Input. Spotify follows the system default.'
                : os === 'linux'
                  ? 'Move Spotify’s stream onto the null sink in pavucontrol › Playback.'
                  : 'macOS: Option-click the volume icon in the menu bar and pick BlackHole 2ch as the output device. Spotify follows the system output.'}{' '}
              You will hear nothing at this point &mdash; that is correct. Dampen plays the
              filtered audio to your real speakers.
            </p>

            <CaptureInputMeter
              open={isCapturing}
              getInputPeak={getInputPeak}
              onStateChange={onSignalChange}
            />
          </div>
        </Step>
      </ol>

      {/* Warnings, in order of how badly they ruin the sound. */}
      {feedbackRisk ? (
        <Notice
          tone="caution"
          icon={<TriangleExclamationPoint className="size-4" />}
          title="Capture and output are the same device"
          action={
            cleanAlternative && cleanAlternative.deviceId !== selectedDeviceId ? (
              <Button size="sm" onClick={() => onSelectDevice(cleanAlternative.deviceId)}>
                Capture from {cleanAlternative.label} instead
              </Button>
            ) : null
          }
        >
          Dampen would be listening to its own output, which builds into a howl within a second
          or two. Point one of the two somewhere else before you start the audio.
        </Notice>
      ) : null}

      {selected?.passthrough === 'likely' ? (
        <Notice
          tone="caution"
          icon={<Headphones className="size-4" />}
          title={`${selected.label} also plays what it captures`}
          action={
            cleanAlternative ? (
              <Button size="sm" onClick={() => onSelectDevice(cleanAlternative.deviceId)}>
                Switch to {cleanAlternative.label}
              </Button>
            ) : (
              <a
                href={INSTALL[os].help}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[12px] text-ink-2 underline decoration-ink-4 underline-offset-2 hover:text-ink"
              >
                Install a silent device instead
              </a>
            )
          }
        >
          You would hear raw Spotify <em className="not-italic text-ink">and</em> Dampen&rsquo;s
          output about 8 ms apart. Two near-identical signals that close together comb-filter
          each other &mdash; it sounds hollow and broken rather than muffled. Use a device that
          captures silently.
        </Notice>
      ) : null}

      {permissionDenied ? (
        <Notice
          tone="caution"
          icon={<TriangleExclamationPoint className="size-4" />}
          title="Microphone permission is blocked"
        >
          Capturing a virtual device uses the same browser permission as a microphone. Allow it
          for this site, then rescan. Nothing is recorded or uploaded &mdash; the stream is
          processed in memory and thrown away.
        </Notice>
      ) : null}

      {allDone ? (
        <Notice tone="good" icon={<Zap className="size-4" />} title="Capture is live">
          Dampen is filtering Spotify&rsquo;s real output
          {latencyMs !== null ? (
            <>
              {' '}
              at <span className="num text-ink">{latencyMs.toFixed(1)} ms</span> end to end
            </>
          ) : null}
          . Reach for the dial.
        </Notice>
      ) : null}

      {!isCapturing ? (
        <Button
          variant="accent"
          size="lg"
          className="w-full"
          onClick={onStart}
          disabled={!selectedDeviceId}
        >
          Start capturing
          {selected ? ` from ${selected.label}` : ''}
        </Button>
      ) : null}

      {/* Progress summary for assistive tech — the visual checklist is a
          live thing, so mirror its state in words. */}
      <p className="sr-only" role="status">
        {hasVirtual ? 'Virtual device detected.' : 'No virtual audio device detected.'}{' '}
        {deviceChosen ? 'Capture device selected.' : 'Capture device not selected.'}{' '}
        {signalPresent ? 'Signal present on the input.' : 'No signal on the input.'}
      </p>
    </div>
  );
}
