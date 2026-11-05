'use client';

import { useEffect, useRef } from 'react';
import type { EngineMeters } from '@/lib/types';
import { dbToMeter, formatDb } from '@/components/ui/format';
import { clamp } from '@/components/ui/accent';

export interface MetersProps {
  /** Read on each frame rather than passed as a prop — see below. */
  getMeters(): EngineMeters;
  running: boolean;
}

interface BarRefs {
  fill: HTMLDivElement | null;
  value: HTMLSpanElement | null;
}

/**
 * Input, output and gain reduction, as three hairline bars.
 *
 * This lives in the settings sheet, not on the player — instrumentation is a
 * debug view, and the main screen is not a debug view.
 *
 * The engine publishes meters at 20 Hz. Rather than re-render three React
 * components twenty times a second, the owning island hands down a *getter*
 * reading a ref and the bars drive their own `requestAnimationFrame` loop,
 * writing styles directly. Nothing above this component ever re-renders.
 */
export function Meters({ getMeters, running }: MetersProps) {
  const input = useRef<BarRefs>({ fill: null, value: null });
  const output = useRef<BarRefs>({ fill: null, value: null });
  const reduction = useRef<BarRefs>({ fill: null, value: null });

  useEffect(() => {
    if (!running) {
      for (const bar of [input, output, reduction]) {
        if (bar.current.fill) bar.current.fill.style.width = '0%';
        if (bar.current.value) bar.current.value.textContent = '--';
      }
      return;
    }

    let raf = 0;
    const tick = () => {
      const m = getMeters();
      const write = (bar: BarRefs, fraction: number, text: string) => {
        if (bar.fill) bar.fill.style.width = `${clamp(fraction, 0, 1) * 100}%`;
        if (bar.value) bar.value.textContent = text;
      };
      write(input.current, dbToMeter(m.inputPeak), formatDb(m.inputPeak));
      write(output.current, dbToMeter(m.outputPeak), formatDb(m.outputPeak));
      // Reduction is negative; show how much of a 24 dB span is being used.
      write(reduction.current, Math.min(1, -m.reduction / 24), formatDb(m.reduction));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getMeters, running]);

  return (
    <div className="flex flex-col gap-3 px-3.5 py-3.5">
      <Bar label="Input" refs={input} />
      <Bar label="Output" refs={output} />
      <Bar label="Gain reduction" refs={reduction} />
    </div>
  );
}

function Bar({
  label,
  refs,
}: {
  label: string;
  refs: React.RefObject<BarRefs>;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[108px] shrink-0 text-[13px] text-t2">{label}</span>
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-fill-2">
        <div
          ref={(el) => {
            refs.current.fill = el;
          }}
          className="h-full rounded-full bg-accent"
          style={{ width: '0%' }}
        />
      </div>
      <span
        ref={(el) => {
          refs.current.value = el;
        }}
        className="num w-[62px] shrink-0 text-right text-[12px] text-t3"
      >
        --
      </span>
    </div>
  );
}
