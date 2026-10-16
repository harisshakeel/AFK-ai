import { Skeleton } from "@/components/ui/skeleton";

/** Search results' shape while Postgres looks: a title and two grouped results. */
export default function Loading() {
  return (
    <main
      className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-6"
      aria-busy="true"
      aria-label="Searching"
    >
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-9 w-80 max-w-full" />
      <Skeleton className="mt-3 h-4 w-56" />
      <div className="mt-8 flex flex-col gap-5">
        {[0, 1].map((group) => (
          <div key={group} className="rounded-xl border border-border bg-surface p-5 shadow-xs">
            <Skeleton className="h-5 w-72 max-w-full" />
            <Skeleton className="mt-2 h-3 w-24" />
            <div className="mt-4 flex flex-col gap-3">
              {[0, 1, 2].map((hit) => (
                <div key={hit} className="flex gap-3">
                  <Skeleton className="size-4 shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="mt-1.5 h-4 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
