import { Skeleton } from "@/components/ui/skeleton";

/** The list's shape while it loads: a title block and four cards, so nothing jumps. */
export function MeetingListSkeleton({ label }: { label: string }) {
  return (
    <main className="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-6" aria-busy="true" aria-label={label}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-10 w-64 max-w-full" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 flex flex-col gap-3">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="rounded-xl border border-border bg-surface p-5 shadow-xs">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-5 w-2/3 max-w-sm" />
                <Skeleton className="mt-2.5 h-3 w-48" />
              </div>
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
            <Skeleton className="mt-4 h-4 w-full max-w-2xl" />
            <Skeleton className="mt-2 h-4 w-4/5 max-w-xl" />
          </div>
        ))}
      </div>
    </main>
  );
}
