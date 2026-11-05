'use client';

import { useState } from 'react';
import {
  Cast,
  Check,
  Laptop,
  Monitor,
  MonitorSpeaker,
  RotateCcw,
  Smartphone,
  Speaker,
} from 'lucide-react';
import type { SpotifyDevice } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Panel';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';

function DeviceIcon({ type }: { type: string }) {
  const t = type.toLowerCase();
  const className = 'size-4';
  if (t.includes('computer')) return <Laptop className={className} aria-hidden />;
  if (t.includes('smartphone') || t.includes('tablet'))
    return <Smartphone className={className} aria-hidden />;
  if (t.includes('speaker')) return <Speaker className={className} aria-hidden />;
  if (t.includes('cast')) return <Cast className={className} aria-hidden />;
  if (t.includes('tv')) return <Monitor className={className} aria-hidden />;
  return <MonitorSpeaker className={className} aria-hidden />;
}

export interface DeviceListProps {
  devices: SpotifyDevice[];
  /** Our Web Playback SDK device, so it can be labelled "this browser". */
  localDeviceId: string | null;
  onTransfer(deviceId: string): void;
  isLoading?: boolean;
  className?: string;
}

export function DeviceList({
  devices,
  localDeviceId,
  onTransfer,
  isLoading = false,
  className,
}: DeviceListProps) {
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading devices" className={cn('space-y-1.5', className)}>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-3 px-2">
            <Skeleton shape="circle" className="size-7" delayMs={i * 80} />
            <Skeleton shape="text" className="w-40" delayMs={i * 80} />
          </div>
        ))}
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <EmptyState
        icon={<MonitorSpeaker className="size-5" aria-hidden />}
        title="No Spotify devices online"
        body="Open Spotify on a phone, desktop or speaker and it will appear here. Devices drop off this list a few minutes after they go idle."
        size="inline"
        className={className}
      />
    );
  }

  const local = devices.find((d) => d.id !== null && d.id === localDeviceId);

  return (
    <div className={className}>
      {local && !local.isActive ? (
        <Button
          variant="accent"
          size="md"
          className="mb-3 w-full"
          onClick={() => local.id && onTransfer(local.id)}
        >
          Play here instead
        </Button>
      ) : null}

      <ul className="space-y-1">
        {devices.map((device) => {
          const isLocal = device.id !== null && device.id === localDeviceId;
          return (
            <li key={device.id ?? device.name}>
              <button
                type="button"
                disabled={device.id === null || device.isActive}
                onClick={() => device.id && onTransfer(device.id)}
                aria-current={device.isActive || undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors',
                  device.isActive
                    ? 'bg-accent/[0.08] text-ink'
                    : 'text-ink-2 hover:bg-white/[0.06] hover:text-ink',
                  device.id === null && 'cursor-not-allowed opacity-45',
                )}
              >
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line"
                  style={{
                    color: device.isActive ? 'var(--accent)' : 'var(--ink-3)',
                    background: device.isActive ? 'var(--accent-wash)' : 'transparent',
                  }}
                >
                  <DeviceIcon type={device.type} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{device.name}</span>
                    {isLocal ? (
                      <span className="shrink-0 rounded border border-line px-1 text-[9px] font-semibold uppercase tracking-wider text-ink-4">
                        this tab
                      </span>
                    ) : null}
                  </span>
                  <span className="num mt-0.5 block text-[11px] text-ink-4">
                    {device.type}
                    {device.volumePercent !== null ? ` · ${device.volumePercent}%` : ''}
                  </span>
                </span>
                {device.isActive ? (
                  <Check className="size-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface DevicePickerProps extends DeviceListProps {
  activeDeviceName: string | null;
  onRefresh(): void;
}

/** Trigger plus modal. The trigger doubles as the "where is this playing" readout. */
export function DevicePicker({
  devices,
  localDeviceId,
  activeDeviceName,
  onTransfer,
  onRefresh,
  isLoading = false,
  className,
}: DevicePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip label="Spotify Connect devices" side="bottom">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onRefresh();
            setOpen(true);
          }}
          className={cn('max-w-[190px]', className)}
          aria-haspopup="dialog"
        >
          <MonitorSpeaker className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{activeDeviceName ?? 'No device'}</span>
        </Button>
      </Tooltip>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Where to play"
        description="Dampen reads Spotify metadata no matter which device is playing. Only capture and local modes can filter the audio."
      >
        <DeviceList
          devices={devices}
          localDeviceId={localDeviceId}
          onTransfer={(id) => {
            onTransfer(id);
            setOpen(false);
          }}
          isLoading={isLoading}
        />
        <Button variant="ghost" size="sm" onClick={onRefresh} className="mt-4 w-full">
          <RotateCcw className="size-3.5" aria-hidden />
          Rescan devices
        </Button>
      </Sheet>
    </>
  );
}
