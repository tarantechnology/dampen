'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DampenParams } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Group, GroupLabel, Row } from '@/components/ui/Rows';
import { Select } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import {
  AMBIENCE_OPTIONS,
  PARAM_GROUPS,
  formatParam,
  readParam,
  type ParamGroup,
  type ParamSpec,
} from './paramSpec';

export interface AdvancedParamsProps {
  params: DampenParams;
  onParam(path: string, value: number | string): void;
}

/**
 * The full `DampenParams` tree, one collapsed group at a time.
 *
 * Every parameter the engine exposes is reachable here, and nothing from
 * here appears on the player. The group's one-line description is the only
 * prose, and it sits under the group rather than inside it.
 */
export function AdvancedParams({ params, onParam }: AdvancedParamsProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <GroupLabel>Advanced</GroupLabel>
      {PARAM_GROUPS.map((group) => (
        <ParamGroupSection
          key={group.id}
          group={group}
          params={params}
          onParam={onParam}
          open={openId === group.id}
          onToggle={() => setOpenId((id) => (id === group.id ? null : group.id))}
        />
      ))}
    </div>
  );
}

function ParamGroupSection({
  group,
  params,
  onParam,
  open,
  onToggle,
}: {
  group: ParamGroup;
  params: DampenParams;
  onParam(path: string, value: number | string): void;
  open: boolean;
  onToggle(): void;
}) {
  return (
    <Group>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-100 hover:bg-fill-1"
      >
        <span className="flex-1 truncate text-[15px] text-t1">{group.name}</span>
        <span className="truncate text-[13px] text-t3">{group.blurb}</span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          aria-hidden
          className={cn(
            'shrink-0 text-t3 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <>
          {group.id === 'ambience' ? (
            <Row
              label="Bed"
              trailing={
                <Select
                  label="Ambience bed"
                  value={params.ambience.kind}
                  options={AMBIENCE_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  onChange={(value) => onParam('ambience.kind', value)}
                />
              }
            />
          ) : null}
          {group.params.map((spec) => (
            <ParamRow key={spec.path} spec={spec} params={params} onParam={onParam} />
          ))}
        </>
      ) : null}
    </Group>
  );
}

function ParamRow({
  spec,
  params,
  onParam,
}: {
  spec: ParamSpec;
  params: DampenParams;
  onParam(path: string, value: number | string): void;
}) {
  const value = readParam(params, spec.path);
  const formatted = formatParam(spec, value);
  return (
    <div className="px-3.5 py-2.5" title={spec.hint}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[14px] text-t1">{spec.label}</span>
        <span className="num shrink-0 text-[12.5px] text-t3">{formatted}</span>
      </div>
      <Slider
        className="mt-0.5"
        label={spec.label}
        valueText={formatted}
        value={value}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        scale={spec.scale}
        bipolar={spec.bipolar}
        onChange={(next) => onParam(spec.path, next)}
      />
    </div>
  );
}
