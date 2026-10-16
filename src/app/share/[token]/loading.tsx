import { Skeleton } from "@/components/ui/skeleton";

/** A shared clip's shape while the token resolves: title, player, the lines. */
export default function Loading() {
  return (
    <div className="min-h-dvh" aria-busy="true" aria-label="Loading the clip">
      <div className="h-14 border-b border-border bg-surface" />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-8 w-80 max-w-full" />
        <Skeleton className="mt-2 h-4 w-56" />
        <div className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="h-2 flex-1 rounded-full" />
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-3">
          {[0, 1, 2].map((index) => (
            <div key={index}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-1.5 h-4 w-full" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
