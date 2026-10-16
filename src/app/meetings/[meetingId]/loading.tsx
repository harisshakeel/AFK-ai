import { Skeleton } from "@/components/ui/skeleton";

/** Shown while a meeting loads: the page's shape, so nothing jumps when it arrives. */
export default function Loading() {
  return (
    <div className="flex h-dvh flex-col" aria-busy="true" aria-label="Loading meeting">
      <div className="border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="flex items-start gap-3">
          <Skeleton className="size-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-6 w-72 max-w-full" />
            <Skeleton className="mt-2 h-3 w-48" />
            <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
          </div>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="border-border lg:border-r">
          <div className="flex gap-4 border-b border-border px-4 py-3">
            {[16, 24, 20, 20].map((width, index) => (
              <Skeleton key={index} className="h-4" style={{ width: `${width * 4}px` }} />
            ))}
          </div>
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-4" style={{ width: `${92 - index * 9}%` }} />
            ))}
          </div>
        </div>
        <div className="hidden lg:block">
          <div className="border-b border-border px-4 py-3">
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-4 p-5">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div key={index} className="flex gap-3">
                <Skeleton className="h-3 w-10 shrink-0" />
                <Skeleton className="h-10 flex-1" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="h-20 border-t border-border bg-surface" />
    </div>
  );
}
