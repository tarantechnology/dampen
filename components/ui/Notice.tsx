import { cn } from '@/lib/cn';

export type NoticeTone = 'info' | 'caution' | 'good';

/**
 * Deliberately not a red banner. A caution here means "this will sound wrong,
 * here is the better choice" — it should read like a studio engineer leaning
 * over, not like a browser error.
 */
const TONES: Record<NoticeTone, { rule: string; icon: string; bg: string }> = {
  info: { rule: 'oklch(0.72 0.02 265)', icon: 'var(--ink-2)', bg: 'oklch(1 0 0 / 0.035)' },
  caution: { rule: 'oklch(0.78 0.13 75)', icon: 'oklch(0.82 0.13 75)', bg: 'oklch(0.78 0.13 75 / 0.07)' },
  good: { rule: 'oklch(0.78 0.12 150)', icon: 'oklch(0.8 0.12 150)', bg: 'oklch(0.78 0.12 150 / 0.06)' },
};

export interface NoticeProps {
  tone?: NoticeTone;
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function Notice({ tone = 'info', icon, title, children, action, className }: NoticeProps) {
  const t = TONES[tone];
  return (
    <div
      role={tone === 'caution' ? 'status' : undefined}
      className={cn(
        'flex gap-3 rounded-xl border border-line px-3.5 py-3',
        'border-l-2',
        className,
      )}
      style={{ background: t.bg, borderLeftColor: t.rule }}
    >
      {icon ? (
        <span className="mt-[1px] shrink-0" style={{ color: t.icon }} aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-ink">{title}</p>
        {children ? (
          <div className="mt-1 text-[12px] leading-relaxed text-ink-2">{children}</div>
        ) : null}
        {action ? <div className="mt-2.5 flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
