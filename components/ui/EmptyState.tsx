'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}

/** Two lines in the middle of the space the content would have filled. */
export function EmptyState({ title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-[180px] flex-col items-center justify-center gap-1.5 px-6 text-center',
        className,
      )}
    >
      <p className="text-[14px] font-medium text-t2">{title}</p>
      {body ? <p className="max-w-[260px] text-[12.5px] leading-[1.5] text-t3">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
