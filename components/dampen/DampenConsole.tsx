'use client';

import { memo, useState } from 'react';
import { Power, SlidersHorizontal } from 'lucide-react';
import type { DampenParams, EngineMeters, Preset } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Disclosure } from '@/components/ui/Panel';
import { Dial } from '@/components/ui/Dial';
import { Tooltip } from '@/components/ui/Tooltip';
import { AdvancedPanel } from './AdvancedPanel';
import { MeterBar } from './MeterBar';
import { PresetRack } from './PresetRack';
import { summariseParams } from './paramSpec';

export interface DampenConsoleProps {
  /** Macro, 0..1. */
  amount: number;
  onAmount(amount: number): void;

  presets: Preset[];
  presetId: string;
  onPreset(id: string): void;

  bypass: boolean;
  onBypass(bypass: boolean): void;

  params: DampenParams;
  /** Stable reference, please — the advanced sliders memo against it. */
  onParam(path: string, value: number | string): void;

  /** Polled in a rAF loop by the meters. Never a value. */
  getMeters(): EngineMeters;
  running: boolean;

  /**
   * Slot for `components/viz/SpectrumScope`, which needs live AnalyserNodes
   * and is owned by another module. The console only reserves the space.
   */
  scope?: React.ReactNode;

  className?: string;
}

/**
 * The console.
 *
 * `memo` is load-bearing: the island above this calls `useDampen()`, whose
 * `meters` field updates about twenty times a second. Those re-renders stop
 * here, because none of the props below change on a meter tick.
 */
export const DampenConsole = memo(function DampenConsole({
  amount,
  onAmount,
  presets,
  presetId,
  onPreset,
  bypass,
  onBypass,
  params,
  onParam,
  getMeters,
  running,
  scope,
  className,
}: DampenConsoleProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const active = presets.find((p) => p.id === presetId) ?? null;

  return (
    <section
      aria-label="Dampen console"
      className={cn('panel flex flex-col rounded-panel', className)}
    >
      {/* Header: the bypass is the second-most important control in the app,
          so it lives at the top and never moves. */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="legend">Dampen</h2>
        <Tooltip label={bypass ? 'Re-engage the chain' : 'Hear it raw'} shortcut="B" side="left">
          <button
            type="button"
            role="switch"
            aria-checked={bypass}
            aria-label="Bypass the dampen chain"
            onClick={() => onBypass(!bypass)}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors duration-150',
              bypass
                ? 'border-white/30 bg-white/[0.14] text-ink'
                : 'border-line text-ink-3 hover:border-white/20 hover:text-ink-2',
            )}
          >
            <Power className="size-3.5" aria-hidden />
            {bypass ? 'Bypassed' : 'Bypass'}
            <kbd className="num rounded border border-line-strong bg-black/25 px-1 text-[9.5px]">
              B
            </kbd>
          </button>
        </Tooltip>
      </div>

      {/* The dial. */}
      <div className="flex flex-col items-center px-4 pt-6 pb-2">
        <Dial
          value={amount}
          onChange={onAmount}
          label="Dampen"
          caption={active ? active.name : undefined}
          disabled={bypass}
          size={248}
          className="max-w-full"
        />
        <p
          className="mt-3 h-4 text-center text-[11px] transition-colors"
          style={{ color: bypass ? 'var(--ink-3)' : 'var(--ink-4)' }}
        >
          {bypass
            ? 'Bypassed — you are hearing the raw signal'
            : 'Drag, scroll or use ↑↓. Double-click to open up.'}
        </p>
      </div>

      {/* Spectrum slot. Owned by components/viz. */}
      <div className="px-4 pb-4">
        {scope ?? (
          <div
            className="flex h-[88px] items-center justify-center rounded-xl border border-dashed border-line-strong bg-black/20"
            aria-hidden
          >
            <span className="legend">Spectrum</span>
          </div>
        )}
      </div>

      {/* Meters. */}
      <div className="border-t border-line px-4 py-4">
        <MeterBar getMeters={getMeters} running={running} />
      </div>

      {/* Preset rack. */}
      <div className="border-t border-line px-4 py-4">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h3 className="legend">Presets</h3>
          <span className="legend">1 &ndash; 8</span>
        </div>
        <PresetRack
          presets={presets}
          selectedId={presetId}
          onSelect={onPreset}
          muted={bypass}
        />
      </div>

      {/* Advanced. */}
      <div className="border-t border-line p-2">
        <Disclosure
          label="Advanced"
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          summary={summariseParams(params)}
        >
          <div className="scroll-slim max-h-[52vh] overflow-y-auto px-2 pb-2 pt-3">
            <AdvancedPanel params={params} onParam={onParam} />
          </div>
        </Disclosure>
      </div>

      {!advancedOpen ? (
        <p className="flex items-center gap-1.5 px-4 pb-4 text-[11px] text-ink-4">
          <SlidersHorizontal className="size-3" aria-hidden />
          {active?.blurb ?? 'Pick a preset to start from, then open Advanced to shape it.'}
        </p>
      ) : null}
    </section>
  );
});
