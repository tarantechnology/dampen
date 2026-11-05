'use client';

import { useId, useRef, useState } from 'react';
import {
  AudioWaveform,
  Cable,
  CircleQuestionMark,
  FileMusic,
  Gauge,
  Upload,
} from 'lucide-react';
import type { EngineStatus, InputMode } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Tooltip } from '@/components/ui/Tooltip';
import { CaptureSetup, type CaptureSetupProps } from './CaptureSetup';

/* ------------------------------------------------------------------ *
 * Mode definitions
 *
 * Capture comes first on purpose: it is the only path that puts the full
 * filter chain on real Spotify audio, so it is the product, not the
 * workaround.
 * ------------------------------------------------------------------ */

interface ModeDef {
  mode: InputMode;
  name: string;
  icon: React.ReactNode;
  tagline: string;
  recommended?: boolean;
}

const MODES: ModeDef[] = [
  {
    mode: 'capture',
    name: 'Capture',
    icon: <Cable className="size-4" aria-hidden />,
    tagline: 'Full chain on real Spotify audio',
    recommended: true,
  },
  {
    mode: 'spotify',
    name: 'Spotify',
    icon: <AudioWaveform className="size-4" aria-hidden />,
    tagline: 'In-browser, partial effect only',
  },
  {
    mode: 'local',
    name: 'Local',
    icon: <FileMusic className="size-4" aria-hidden />,
    tagline: 'Your own files, full chain',
  },
];

/* ------------------------------------------------------------------ *
 * Local drop zone
 * ------------------------------------------------------------------ */

function LocalSource({
  fileName,
  onFile,
  onUseDemo,
}: {
  fileName: string | null;
  onFile(file: File): void;
  onUseDemo(): void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const uid = useId();

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-ink-2">
        Drop in anything the browser can decode &mdash; MP3, M4A, FLAC, WAV. The whole filter
        chain applies, and the file never leaves this tab.
      </p>

      <label
        htmlFor={uid}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center transition-colors',
          over
            ? 'border-accent/60 bg-accent/[0.06]'
            : 'border-line-strong bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]',
        )}
      >
        <Upload className="size-5 text-ink-3" aria-hidden />
        <span className="text-[13px] font-medium text-ink">
          {fileName ?? 'Drop an audio file, or browse'}
        </span>
        <span className="text-[11px] text-ink-4">
          {fileName ? 'Drop another to replace it' : 'Nothing is uploaded'}
        </span>
        <input
          id={uid}
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>

      <Button variant="outline" size="sm" onClick={onUseDemo} className="w-full">
        Or load the demo track
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Status strip
 * ------------------------------------------------------------------ */

const STATUS_COPY: Record<EngineStatus, string> = {
  idle: 'Idle',
  initializing: 'Starting',
  running: 'Running',
  suspended: 'Suspended',
  error: 'Error',
};

function StatusStrip({
  status,
  latencyMs,
  sourceLabel,
}: {
  status: EngineStatus;
  latencyMs: number | null;
  sourceLabel: string | null;
}) {
  const live = status === 'running';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-4 py-2.5">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-1.5 rounded-full"
          style={{
            background: live ? 'var(--accent)' : status === 'error' ? 'var(--danger)' : 'var(--ink-4)',
            boxShadow: live ? '0 0 8px var(--accent-glow)' : undefined,
          }}
        />
        <span className="legend">{STATUS_COPY[status]}</span>
      </span>

      <Tooltip
        label="Measured time from the virtual device to your speakers"
        side="bottom"
      >
        <span className="flex items-center gap-1.5">
          <Gauge className="size-3 text-ink-4" aria-hidden />
          <span className="num text-[11px] tabular-nums text-ink-2">
            {latencyMs === null ? '—' : `${latencyMs.toFixed(1)} ms`}
          </span>
          <span className="legend">latency</span>
        </span>
      </Tooltip>

      {sourceLabel ? (
        <span className="num min-w-0 flex-1 truncate text-right text-[11px] text-ink-4">
          {sourceLabel}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * SourceSwitcher
 * ------------------------------------------------------------------ */

export interface SourceSwitcherProps {
  mode: InputMode;
  onModeChange(mode: InputMode): void;

  status: EngineStatus;
  latencyMs: number | null;

  /** Everything the capture flow needs. */
  capture: Omit<CaptureSetupProps, 'className'>;

  /** Path A is only possible with a Premium account on this browser. */
  spotifyAvailable: boolean;
  /** Plain-language reason Path A is unavailable, when it is. */
  spotifyUnavailableReason?: string;
  /** Hand playback to our in-browser device. */
  onTransferHere?(): void;

  localFileName?: string | null;
  onLocalFile(file: File): void;
  onUseDemo(): void;

  className?: string;
}

export function SourceSwitcher({
  mode,
  onModeChange,
  status,
  latencyMs,
  capture,
  spotifyAvailable,
  spotifyUnavailableReason,
  onTransferHere,
  localFileName = null,
  onLocalFile,
  onUseDemo,
  className,
}: SourceSwitcherProps) {
  const uid = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = (index + dir + MODES.length) % MODES.length;
    onModeChange(MODES[next].mode);
    refs.current[next]?.focus();
  };

  const sourceLabel =
    mode === 'capture'
      ? (capture.devices.find((d) => d.deviceId === capture.selectedDeviceId)?.label ?? 'No device')
      : mode === 'local'
        ? (localFileName ?? 'No file')
        : 'Spotify Web Playback';

  return (
    <section
      aria-label="Audio source"
      className={cn('panel overflow-hidden rounded-panel', className)}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <h2 className="legend">Audio source</h2>
        <Tooltip label="Why three sources?" side="left">
          <a
            href="https://github.com/ExistentialAudio/BlackHole#readme"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Why three sources? Read the setup help"
            className="rounded-md p-1 text-ink-4 transition-colors hover:bg-white/[0.06] hover:text-ink-2"
          >
            <CircleQuestionMark className="size-3.5" aria-hidden />
          </a>
        </Tooltip>
      </div>

      <div
        role="radiogroup"
        aria-label="Audio source"
        className="grid grid-cols-1 gap-2 p-4 pb-3 sm:grid-cols-3"
      >
        {MODES.map((m, i) => {
          const selected = m.mode === mode;
          const unavailable = m.mode === 'spotify' && !spotifyAvailable;
          return (
            <button
              key={m.mode}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-describedby={`${uid}-${m.mode}-tag`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onModeChange(m.mode)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'group relative flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-[background-color,border-color] duration-150',
                selected
                  ? 'border-accent/50 bg-accent/[0.07]'
                  : 'border-line bg-white/[0.025] hover:border-white/18 hover:bg-white/[0.05]',
                unavailable && 'opacity-55',
              )}
              style={selected ? { boxShadow: '0 0 24px -10px var(--accent-glow)' } : undefined}
            >
              <span className="flex w-full items-center gap-2">
                <span style={{ color: selected ? 'var(--accent)' : 'var(--ink-3)' }}>
                  {m.icon}
                </span>
                <span className="text-[13px] font-semibold text-ink">{m.name}</span>
                {m.recommended ? (
                  <span
                    className="ml-auto rounded-full border px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider"
                    style={{
                      borderColor: 'var(--accent-dim)',
                      color: 'var(--accent)',
                    }}
                  >
                    Best
                  </span>
                ) : null}
              </span>
              <span id={`${uid}-${m.mode}-tag`} className="text-[11px] leading-snug text-ink-3">
                {m.tagline}
              </span>
            </button>
          );
        })}
      </div>

      <div className="px-4 pb-4">
        {mode === 'capture' ? <CaptureSetup {...capture} /> : null}

        {mode === 'spotify' ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-ink-2">
              Dampen can play Spotify directly in this tab, but the stream is DRM-protected:
              the browser hands us zeroed samples, so there is nothing to filter. What still
              works is a volume contour and a masking ambience bed over the top &mdash; useful,
              but not the real thing.
            </p>
            <Notice
              tone="info"
              icon={<Cable className="size-4" />}
              title="Want the actual low-pass?"
              action={
                <Button size="sm" onClick={() => onModeChange('capture')}>
                  Set up capture
                </Button>
              }
            >
              Capture mode routes the Spotify desktop app through a virtual device and runs the
              complete chain on real audio. It takes one install and about a minute.
            </Notice>
            {!spotifyAvailable ? (
              <Notice tone="caution" title="In-browser playback is unavailable">
                {spotifyUnavailableReason ??
                  'The Web Playback SDK needs a Spotify Premium account signed in to this browser.'}
              </Notice>
            ) : onTransferHere ? (
              <Button variant="outline" size="sm" onClick={onTransferHere} className="w-full">
                Move playback to this browser
              </Button>
            ) : null}
          </div>
        ) : null}

        {mode === 'local' ? (
          <LocalSource fileName={localFileName} onFile={onLocalFile} onUseDemo={onUseDemo} />
        ) : null}
      </div>

      <StatusStrip status={status} latencyMs={latencyMs} sourceLabel={sourceLabel} />
    </section>
  );
}
