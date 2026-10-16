import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main
      className="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-6"
      aria-busy="true"
      aria-label="Loading tasks"
    >
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-10 w-80 max-w-full" />
      <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
      <div className="mt-8 flex flex-col gap-2.5">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-28 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-4 w-3/4 max-w-xl" />
          </div>
        ))}
      </div>
    </main>
  );
}
