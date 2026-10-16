import { Skeleton } from "@/components/ui/skeleton";
import { WaveLoader } from "@/components/ui/wave-loader";

/**
 * The quest log's shape while it loads: the title block, three quest cards on the left
 * and the player card on the right, so nothing jumps; the wave says it is working.
 */
export default function Loading() {
  return (
    <main
      className="w-full px-4 pt-8 pb-16 sm:px-6 lg:px-8"
      aria-busy="true"
      aria-label="Loading your quest log"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-3 w-28" />
        <WaveLoader className="h-3 text-accent" label={null} />
      </div>
      <Skeleton className="mt-3 h-10 w-56 max-w-full" />
      <Skeleton className="mt-3 h-3 w-80 max-w-full" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-16" />
          {[0, 1, 2].map((index) => (
            <div key={index} className="rounded-xl border border-border bg-surface p-5 shadow-xs">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-5 w-2/3 max-w-sm" />
                  <Skeleton className="mt-2.5 h-3 w-48" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <Skeleton className="mt-4 h-4 w-full max-w-2xl" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
          <Skeleton className="h-16 rounded-2xl" />
        </div>
      </div>
    </main>
  );
}
