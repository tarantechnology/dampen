'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { EngineMeters } from '@/lib/types';
import { dbToMeter, formatDb } from '@/components/ui/format';
import { clamp } from '@/components/ui/accent';

export interface MetersProps {
  /** Read on each frame rather than passed as a prop — see below. */
  getMeters(): EngineMeters;
  running: boolean;
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
  const inputFill = useRef<HTMLDivElement>(null);
  const inputValue = useRef<HTMLSpanElement>(null);
  const outputFill = useRef<HTMLDivElement>(null);
  const outputValue = useRef<HTMLSpanElement>(null);
  const reductionFill = useRef<HTMLDivElement>(null);
  const reductionValue = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const write = (
      fill: RefObject<HTMLDivElement | null>,
      value: RefObject<HTMLSpanElement | null>,
      fraction: number,
      text: string,
    ) => {
      if (fill.current) fill.current.style.width = `${clamp(fraction, 0, 1) * 100}%`;
      if (value.current) value.current.textContent = text;
    };

    if (!running) {
      write(inputFill, inputValue, 0, '--');
      write(outputFill, outputValue, 0, '--');
      write(reductionFill, reductionValue, 0, '--');
      return;
    }

    let raf = 0;
    const tick = () => {
      const m = getMeters();
      write(inputFill, inputValue, dbToMeter(m.inputPeak), formatDb(m.inputPeak));
      write(outputFill, outputValue, dbToMeter(m.outputPeak), formatDb(m.outputPeak));
      // Reduction is negative; show how much of a 24 dB span is in use.
      write(
        reductionFill,
        reductionValue,
        Math.min(1, -m.reduction / 24),
        formatDb(m.reduction),
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getMeters, running]);

  return (
    <div className="flex flex-col gap-3 px-3.5 py-3.5">
      <Bar label="Input" fillRef={inputFill} valueRef={inputValue} />
      <Bar label="Output" fillRef={outputFill} valueRef={outputValue} />
      <Bar label="Gain reduction" fillRef={reductionFill} valueRef={reductionValue} />
    </div>
  );
}

function Bar({
  label,
  fillRef,
  valueRef,
}: {
  label: string;
  fillRef: RefObject<HTMLDivElement | null>;
  valueRef: RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[108px] shrink-0 text-[13px] text-t2">{label}</span>
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-fill-2">
        <div ref={fillRef} className="h-full rounded-full bg-[var(--text-2)]" style={{ width: 0 }} />
      </div>
      <span ref={valueRef} className="num w-[62px] shrink-0 text-right text-[12px] text-t3">
        --
      </span>
    </div>
  );
}
