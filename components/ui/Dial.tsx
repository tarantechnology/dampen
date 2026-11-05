'use client';

import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  type MotionValue,
} from 'motion/react';
import { cn } from '@/lib/cn';
import { clamp } from './accent';

const START_DEG = -135;
const END_DEG = 135;
const SWEEP = END_DEG - START_DEG;
/** Pixels of pointer travel for the full 0..1 range. */
const DRAG_TRAVEL = 240;
const TICKS = 25;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, fromDeg);
  const [x2, y2] = polar(cx, cy, r, toDeg);
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`;
}

export interface DialProps {
  /** 0..1 */
  value: number;
  onChange(value: number): void;
  /** Visible label above the readout. */
  label: string;
  /** Double-click target. Defaults to 0. */
  defaultValue?: number;
  /** Arrow-key increment. Defaults to 0.01 (0.05 with Shift, 0.1 with Page). */
  step?: number;
  /** Pixel size of the square control. */
  size?: number;
  disabled?: boolean;
  /** Small line under the number, e.g. the active preset name. */
  caption?: string;
  className?: string;
}

/**
 * The Dampen dial.
 *
 * Interaction: drag vertically or horizontally, scroll, arrow keys when
 * focused, double-click to reset. Hold Shift for fine control.
 *
 * Performance note — this component deliberately does **not** re-render while
 * you drag. The live value lives in a ref + MotionValue; the needle, the arc
 * sweep, the lit tick mask and the numeric readout are all driven straight
 * through the DOM. React only re-renders when the props change. That is why
 * dragging the dial cannot touch the library list.
 */
export function Dial({
  value,
  onChange,
  label,
  defaultValue = 0,
  step = 0.01,
  size = 272,
  disabled = false,
  caption,
  className,
}: DialProps) {
  const uid = useId().replace(/[:]/g, '');
  const reduce = useReducedMotion();

  const raw = useMotionValue(clamp(value, 0, 1));
  const smooth = useSpring(raw, { stiffness: 280, damping: 30, mass: 0.7 });
  const shown = reduce ? raw : smooth;

  const current = useRef(clamp(value, 0, 1));
  const emitted = useRef(current.current);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  const needleRef = useRef<SVGGElement | null>(null);
  const glowRef = useRef<SVGCircleElement | null>(null);

  const cx = size / 2;
  const rTickOut = size * 0.483;
  const rTickIn = size * 0.446;
  const rArc = size * 0.4;
  const arcW = size * 0.045;
  const rFace = size * 0.325;

  const sweepD = useMemo(
    () => arcPath(cx, cx, rArc, START_DEG, END_DEG),
    [cx, rArc],
  );

  const ticks = useMemo(() => {
    const out: Array<{ x1: number; y1: number; x2: number; y2: number; major: boolean }> = [];
    for (let i = 0; i < TICKS; i += 1) {
      const t = i / (TICKS - 1);
      const deg = START_DEG + SWEEP * t;
      const major = i % 6 === 0;
      const inner = major ? rTickIn - size * 0.012 : rTickIn;
      const [x1, y1] = polar(cx, cx, inner, deg);
      const [x2, y2] = polar(cx, cx, rTickOut, deg);
      out.push({ x1, y1, x2, y2, major });
    }
    return out;
  }, [cx, rTickIn, rTickOut, size]);

  /* ---- imperative render of the live value ---- */
  const paint = useCallback((v: number) => {
    if (readoutRef.current) readoutRef.current.textContent = Math.round(v * 100).toString();
    if (needleRef.current) {
      needleRef.current.setAttribute(
        'transform',
        `rotate(${(START_DEG + SWEEP * v).toFixed(3)} ${cx} ${cx})`,
      );
    }
    if (glowRef.current) {
      glowRef.current.setAttribute('opacity', (0.1 + v * 0.5).toFixed(3));
    }
    const el = sliderRef.current;
    if (el) {
      el.setAttribute('aria-valuenow', Math.round(v * 100).toString());
      el.setAttribute('aria-valuetext', `${Math.round(v * 100)} percent dampened`);
    }
  }, [cx]);

  useMotionValueEvent(shown, 'change', paint);
  useEffect(() => { paint(shown.get()); }, [paint, shown]);

  /* ---- external value changes (presets, keyboard shortcuts, bypass) ---- */
  useEffect(() => {
    const next = clamp(value, 0, 1);
    if (Math.abs(next - emitted.current) < 1e-4) return;
    current.current = next;
    emitted.current = next;
    raw.set(next);
  }, [value, raw]);

  const commit = useCallback(
    (next: number) => {
      const v = clamp(next, 0, 1);
      if (Math.abs(v - current.current) < 1e-5) return;
      current.current = v;
      emitted.current = v;
      raw.set(v);
      onChange(v);
    },
    [onChange, raw],
  );

  /* ---- drag ---- */
  const drag = useRef<{ id: number; x: number; y: number; from: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: current.current };
    sliderRef.current?.focus();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    // Vertical up and horizontal right both increase. Combining the two axes
    // means the grab never feels "wrong way round" wherever you started.
    const delta = d.y - e.clientY + (e.clientX - d.x);
    const scale = e.shiftKey ? 4 : 1;
    commit(d.from + delta / (DRAG_TRAVEL * scale));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  /* ---- wheel (non-passive, so we can stop the page scrolling) ---- */
  useEffect(() => {
    const el = rootRef.current;
    if (!el || disabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.shiftKey ? 0.005 : 0.02;
      commit(current.current - Math.sign(e.deltaY) * unit);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [commit, disabled]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const fine = e.shiftKey ? step : step * 5;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = current.current + fine;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = current.current - fine;
        break;
      case 'PageUp':
        next = current.current + 0.1;
        break;
      case 'PageDown':
        next = current.current - 0.1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    commit(next);
  };

  return (
    <div
      ref={rootRef}
      className={cn('relative select-none', disabled && 'opacity-40', className)}
      style={{ width: size, height: size }}
      onDoubleClick={() => !disabled && commit(defaultValue)}
    >
      {/* Bloom behind the dial. Grows with the value. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[12%] rounded-full blur-2xl"
        style={{ background: 'var(--accent-glow)', opacity: 0.55 }}
      />

      <div
        ref={sliderRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamp(value, 0, 1) * 100)}
        aria-valuetext={`${Math.round(clamp(value, 0, 1) * 100)} percent dampened`}
        aria-orientation="vertical"
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          'absolute inset-0 rounded-full outline-offset-4',
          disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
        )}
        style={{ touchAction: 'none' }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="overflow-visible"
          aria-hidden
        >
          <defs>
            <linearGradient id={`${uid}-arc`} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent-hot)" />
              <stop offset="55%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </linearGradient>

            <radialGradient id={`${uid}-face`} cx="50%" cy="22%" r="85%">
              <stop offset="0%" stopColor="oklch(0.28 0.009 265)" />
              <stop offset="60%" stopColor="oklch(0.2 0.008 265)" />
              <stop offset="100%" stopColor="oklch(0.145 0.006 265)" />
            </radialGradient>

            <linearGradient id={`${uid}-bezel`} x1="0.5" y1="0" x2="0.5" y2="1">
              <stop offset="0%" stopColor="oklch(1 0 0 / 0.16)" />
              <stop offset="45%" stopColor="oklch(1 0 0 / 0.03)" />
              <stop offset="100%" stopColor="oklch(1 0 0 / 0.08)" />
            </linearGradient>

            {/*
              The lit ticks are the same tick layer, revealed through a mask
              made of the sweep path stroked wide. Driving the mask's
              pathLength keeps the ticks exactly in step with the arc — and
              costs React nothing.
            */}
            <mask id={`${uid}-sweep`} maskUnits="userSpaceOnUse">
              <MaskArc d={sweepD} width={(rTickOut - rTickIn) * 3.4} progress={shown} />
            </mask>
          </defs>

          {/* bezel */}
          <circle
            cx={cx}
            cy={cx}
            r={size * 0.5 - 1}
            fill="none"
            stroke={`url(#${uid}-bezel)`}
            strokeWidth={1.5}
          />

          {/* tick bed */}
          <g strokeLinecap="round">
            {ticks.map((t, i) => (
              <line
                key={i}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke={t.major ? 'oklch(1 0 0 / 0.26)' : 'oklch(1 0 0 / 0.11)'}
                strokeWidth={t.major ? 2 : 1.25}
              />
            ))}
          </g>

          {/* lit ticks */}
          <g mask={`url(#${uid}-sweep)`} strokeLinecap="round">
            {ticks.map((t, i) => (
              <line
                key={i}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke="var(--accent)"
                strokeWidth={t.major ? 2.5 : 1.5}
              />
            ))}
          </g>

          {/* arc bed */}
          <path
            d={sweepD}
            fill="none"
            stroke="oklch(1 0 0 / 0.06)"
            strokeWidth={arcW}
            strokeLinecap="round"
          />

          {/* value arc */}
          <ArcValue
            d={sweepD}
            width={arcW}
            stroke={`url(#${uid}-arc)`}
            progress={shown}
          />

          {/* face */}
          <circle cx={cx} cy={cx} r={rFace} fill={`url(#${uid}-face)`} />
          <circle
            cx={cx}
            cy={cx}
            r={rFace}
            fill="none"
            stroke="oklch(1 0 0 / 0.08)"
            strokeWidth={1}
          />
          <circle
            ref={glowRef}
            cx={cx}
            cy={cx}
            r={rFace}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            opacity={0.2}
          />

          {/* needle */}
          <g ref={needleRef} transform={`rotate(${START_DEG} ${cx} ${cx})`}>
            <line
              x1={cx}
              y1={cx - rFace * 0.52}
              x2={cx}
              y2={cx - rArc + arcW * 0.1}
              stroke="var(--ink)"
              strokeWidth={size * 0.012}
              strokeLinecap="round"
              opacity={0.85}
            />
            <circle
              cx={cx}
              cy={cx - rArc + arcW * 0.1}
              r={size * 0.019}
              fill="var(--accent)"
            />
          </g>
        </svg>
      </div>

      {/* readout, centred over the face */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
        <span className="legend">{label}</span>
        <div className="num flex items-baseline" style={{ color: 'var(--ink)' }}>
          <span
            ref={readoutRef}
            className="font-semibold tracking-tight"
            style={{ fontSize: size * 0.27, lineHeight: 1 }}
          >
            0
          </span>
          <span
            className="ml-0.5 font-medium text-ink-3"
            style={{ fontSize: size * 0.085 }}
          >
            %
          </span>
        </div>
        {caption ? (
          <span className="max-w-[70%] truncate text-[11px] text-ink-3">{caption}</span>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tiny motion-bound SVG leaves. Split out so the MotionValue binding
 * lives on an element of its own and never widens a re-render.
 * ------------------------------------------------------------------ */

function ArcValue({
  d,
  width,
  stroke,
  progress,
}: {
  d: string;
  width: number;
  stroke: string;
  progress: MotionValue<number>;
}) {
  return (
    <motion.path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      style={{ pathLength: progress, filter: 'drop-shadow(0 0 8px var(--accent-glow))' }}
    />
  );
}

function MaskArc({
  d,
  width,
  progress,
}: {
  d: string;
  width: number;
  progress: MotionValue<number>;
}) {
  return (
    <motion.path
      d={d}
      fill="none"
      stroke="#fff"
      strokeWidth={width}
      strokeLinecap="butt"
      style={{ pathLength: progress }}
    />
  );
}
