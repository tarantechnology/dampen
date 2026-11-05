/**
 * Numeric formatting + scale helpers shared by every readout in the app.
 *
 * Rule: readouts never change width while you drag. All of these return
 * fixed-decimal strings and are rendered with `font-variant-numeric:
 * tabular-nums` (the `.num` utility in globals.css).
 */

import { clamp } from './accent';

/** mm:ss, for track times. Negative values get a leading minus. */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const neg = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${neg ? '-' : ''}${m}:${s.toString().padStart(2, '0')}`;
}

/** 20 -> "20 Hz", 1240 -> "1.24 kHz". */
export function formatHz(hz: number): string {
  if (!Number.isFinite(hz)) return '--';
  if (hz >= 10000) return `${(hz / 1000).toFixed(1)} kHz`;
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
  return `${Math.round(hz)} Hz`;
}

/** Always signed, one decimal. -Infinity renders as the mute glyph. */
export function formatDb(db: number): string {
  if (db === Number.NEGATIVE_INFINITY) return '-∞ dB';
  if (!Number.isFinite(db)) return '--';
  const sign = db > 0 ? '+' : '';
  return `${sign}${db.toFixed(1)} dB`;
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '--';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
}

export function formatSeconds(s: number): string {
  return `${s.toFixed(2)} s`;
}

export function formatRatio(r: number): string {
  return `${r.toFixed(1)}:1`;
}

export function formatPercent(v: number, decimals = 0): string {
  return `${(v * 100).toFixed(decimals)}%`;
}

export function formatInt(v: number): string {
  return Math.round(v).toString();
}

/* ------------------------------------------------------------------ *
 * Logarithmic slider travel
 *
 * A linear Hz slider is useless: 20 Hz -> 20 kHz puts everything that
 * matters in the first 2% of the travel. Frequency controls map position
 * 0..1 through log space so an octave is always the same distance.
 * ------------------------------------------------------------------ */

export function logToPosition(value: number, min: number, max: number): number {
  const lo = Math.log(Math.max(min, 1e-6));
  const hi = Math.log(Math.max(max, 1e-6));
  const v = Math.log(clamp(value, Math.max(min, 1e-6), max));
  return hi === lo ? 0 : (v - lo) / (hi - lo);
}

export function positionToLog(position: number, min: number, max: number): number {
  const lo = Math.log(Math.max(min, 1e-6));
  const hi = Math.log(Math.max(max, 1e-6));
  return Math.exp(lerpUnit(lo, hi, clamp(position, 0, 1)));
}

function lerpUnit(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function linearToPosition(value: number, min: number, max: number): number {
  return max === min ? 0 : (clamp(value, min, max) - min) / (max - min);
}

export function positionToLinear(position: number, min: number, max: number): number {
  return min + (max - min) * clamp(position, 0, 1);
}

/** Snap to a step, keeping float noise out of the readout. */
export function quantize(value: number, step: number): number {
  if (!step) return value;
  const snapped = Math.round(value / step) * step;
  // step can be fractional (0.01); strip binary float dust.
  const decimals = (step.toString().split('.')[1] ?? '').length;
  return Number(snapped.toFixed(Math.min(decimals + 1, 6)));
}

/** dBFS -> 0..1 meter travel. -60 dB floor, with the top third expanded. */
export function dbToMeter(db: number, floor = -60): number {
  if (!Number.isFinite(db)) return 0;
  const n = clamp((db - floor) / -floor, 0, 1);
  return Math.pow(n, 0.72);
}
