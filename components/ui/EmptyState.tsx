import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  /** Say what to do next. Never "No data".  */
  body: string;
  action?: React.ReactNode;
  /** `inline` for inside a list, `panel` for a whole empty region. */
  size?: 'inline' | 'panel';
  className?: string;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  size = 'panel',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'panel' ? 'gap-3 px-6 py-14' : 'gap-2 px-4 py-9',
        className,
      )}
    >
      {icon ? (
        <div
          className="mb-1 flex items-center justify-center rounded-2xl border border-line bg-white/[0.035] text-ink-3"
          style={{ width: size === 'panel' ? 48 : 38, height: size === 'panel' ? 48 : 38 }}
        >
          {icon}
        </div>
      ) : null}
      <p className={cn('font-medium text-ink', size === 'panel' ? 'text-[14px]' : 'text-[13px]')}>
        {title}
      </p>
      <p className="max-w-[34ch] text-[12px] leading-relaxed text-ink-3">{body}</p>
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
