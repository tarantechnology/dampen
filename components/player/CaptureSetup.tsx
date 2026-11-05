'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Mirrors `CaptureDevice` from lib/audio/capture.ts structurally, so this
 * component also compiles on the /design route against fixtures.
 */
export interface CaptureDeviceLike {
  deviceId: string;
  label: string;
  likelyVirtual: boolean;
  passthrough: 'none' | 'likely' | 'unknown';
}

export type Platform = 'mac' | 'windows' | 'linux';

interface Install {
  /** The virtual device the user ends up with. */
  product: string;
  /** The thing to copy: a shell command, or a URL where there is none. */
  snippet: string;
  snippetKind: 'command' | 'url';
  help: string;
  helpLabel: string;
  /** How you point the system's audio output at it. */
  route: string;
}

const INSTALL: Record<Platform, Install> = {
  mac: {
    product: 'BlackHole 2ch',
    snippet: 'brew install blackhole-2ch',
    snippetKind: 'command',
    help: 'https://github.com/ExistentialAudio/BlackHole#installation-instructions',
    helpLabel: 'BlackHole install guide',
    route:
      'Option-click the volume icon in the menu bar and choose BlackHole 2ch as the output device.',
  },
  windows: {
    product: 'CABLE Input',
    snippet: 'https://vb-audio.com/Cable/',
    snippetKind: 'url',
    help: 'https://vb-audio.com/Cable/',
    helpLabel: 'VB-Cable setup',
    route: 'In Sound settings, set CABLE Input as the output device.',
  },
  linux: {
    product: 'Monitor of dampen',
    snippet: 'pactl load-module module-null-sink sink_name=dampen',
    snippetKind: 'command',
    help: 'https://wiki.archlinux.org/title/PulseAudio/Examples#Creating_a_virtual_sink',
    helpLabel: 'PulseAudio virtual sink docs',
    route: 'In pavucontrol, send your music player to the dampen sink.',
  },
};

/** `navigator` never changes under us, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};
const serverPlatform = (): Platform => 'mac';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'mac';
  const ua = `${navigator.userAgent} ${navigator.platform ?? ''}`.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux') || ua.includes('android')) return 'linux';
  return 'mac';
}

function usePlatform(): Platform {
  return useSyncExternalStore(subscribeNever, detectPlatform, serverPlatform);
}

function CopyField({ value, kind }: { value: string; kind: 'command' | 'url' }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

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
    <div className="mt-2 flex items-stretch gap-1.5">
      <code className="num min-w-0 flex-1 select-all truncate rounded-[9px] bg-fill-2 px-2.5 py-2 text-[12.5px] text-t1">
        {kind === 'command' ? <span className="mr-1.5 text-t3">$</span> : null}
        {value}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? 'Copied' : `Copy ${kind}`}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-fill-2 text-t2 transition-colors hover:bg-fill-3 hover:text-t1"
      >
        {copied ? <Check size={15} strokeWidth={2.2} /> : <Copy size={15} strokeWidth={2} />}
      </button>
    </div>
  );
}

export interface CaptureStepsProps {
  className?: string;
}

/**
 * The three things a user has to do once, on their own machine.
 *
 * It appears only when Capture mode is selected and no virtual device has
 * turned up — a walkthrough that is always on screen is a manual, and the
 * player is not a manual.
 */
export function CaptureSteps({ className }: CaptureStepsProps) {
  const platform = usePlatform();
  const install = INSTALL[platform];

  const steps: Array<{ title: string; body: React.ReactNode }> = [
    {
      title: `Install ${install.product}`,
      body: (
        <>
          <p className="text-[13px] leading-[1.5] text-t2">
            A virtual audio device is a cable that only exists in software.
          </p>
          <CopyField value={install.snippet} kind={install.snippetKind} />
          <a
            href={install.help}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[13px] text-accent underline-offset-2 hover:underline"
          >
            {install.helpLabel}
            <ExternalLink size={12} strokeWidth={2} aria-hidden />
          </a>
        </>
      ),
    },
    {
      title: 'Choose it as the input above',
      body: (
        <p className="text-[13px] leading-[1.5] text-t2">
          Scan again, then pick {install.product} in the Input device list.
        </p>
      ),
    },
    {
      title: 'Send your music into it',
      body: (
        <p className="text-[13px] leading-[1.5] text-t2">
          {install.route} You will hear nothing until Dampen starts playing —
          that is correct.
        </p>
      ),
    },
  ];

  return (
    <ol className={cn('flex flex-col', className)}>
      {steps.map((step, i) => (
        <li
          key={step.title}
          className="flex gap-3 px-3.5 py-3.5 [&+&]:border-t [&+&]:border-hairline"
        >
          <span
            aria-hidden
            className="num mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-fill-2 text-[11px] font-semibold text-t2"
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <h4 className="text-[14px] font-medium text-t1">{step.title}</h4>
            <div className="mt-1">{step.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
