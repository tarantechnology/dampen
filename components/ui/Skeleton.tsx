'use client';

import { cn } from '@/lib/cn';

export interface SkeletonProps {
  className?: string;
}

/** A shape where content will be. Pulses once a second, nothing more. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-[6px] bg-fill-1', className)}
    />
  );
}

/** The placeholder for one `MediaRow`, at exactly its height. */
export function RowSkeleton() {
  return (
    <div className="flex h-[52px] items-center gap-2.5 px-2">
      <Skeleton className="size-9 shrink-0 rounded-[4px]" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="mt-1.5 h-2.5 w-2/5" />
      </div>
    </div>
  );
}
