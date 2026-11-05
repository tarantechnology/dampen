'use client';

import { memo, useCallback } from 'react';
import type { AmbienceKind, DampenParams } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Select } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import {
  AMBIENCE_OPTIONS,
  PARAM_GROUPS,
  formatParam,
  readParam,
  type ParamSpec,
} from './paramSpec';

/* ------------------------------------------------------------------ *
 * One slider, bound to one dot path.
 *
 * `memo` plus a stable `onParam` means dragging a single slider re-renders
 * exactly one of the forty. Without this the whole tree thrashes at pointer
 * rate, which you can hear as well as see.
 * ------------------------------------------------------------------ */

const ParamSlider = memo(function ParamSlider({
  spec,
  value,
  onParam,
}: {
  spec: ParamSpec;
  value: number;
  onParam(path: string, value: number): void;
}) {
  const onChange = useCallback(
    (next: number) => onParam(spec.path, next),
    [onParam, spec.path],
  );

  return (
    <Slider
      label={spec.label}
      value={value}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      scale={spec.scale}
      bipolar={spec.bipolar}
      hint={spec.hint}
      format={(v) => formatParam(spec, v)}
      onChange={onChange}
    />
  );
});

/* ------------------------------------------------------------------ *
 * AdvancedPanel
 * ------------------------------------------------------------------ */

export interface AdvancedPanelProps {
  params: DampenParams;
  /** `setParam` from useDampen. Must be referentially stable. */
  onParam(path: string, value: number | string): void;
  className?: string;
}

export function AdvancedPanel({ params, onParam, className }: AdvancedPanelProps) {
  const onNumber = useCallback(
    (path: string, value: number) => onParam(path, value),
    [onParam],
  );
  const onAmbienceKind = useCallback(
    (kind: AmbienceKind) => onParam('ambience.kind', kind),
    [onParam],
  );

  return (
    <div className={cn('space-y-6', className)}>
      {PARAM_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`}>
          <div className="mb-3 border-b border-line pb-2">
            <h3 id={`group-${group.id}`} className="legend">
              {group.name}
            </h3>
            <p className="mt-1 text-[11.5px] leading-snug text-ink-4">{group.blurb}</p>
          </div>

          {group.id === 'ambience' ? (
            <div className="mb-4">
              <Select
                label="Bed"
                value={params.ambience.kind}
                options={AMBIENCE_OPTIONS}
                onChange={onAmbienceKind}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            {group.params.map((spec) => (
              <ParamSlider
                key={spec.path}
                spec={spec}
                value={readParam(params, spec.path)}
                onParam={onNumber}
              />
            ))}
          </div>
        </section>
      ))}

      <p className="text-[11px] leading-relaxed text-ink-4">
        Every value here is ramped rather than assigned, so you can drag anything while the
        music plays without hearing a step. Frequency sliders travel logarithmically &mdash; an
        octave is the same distance wherever you are.
      </p>
    </div>
  );
}
