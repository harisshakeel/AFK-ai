import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main
      className="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-6"
      aria-busy="true"
      aria-label="Loading memory"
    >
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-10 w-80 max-w-full" />
      <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
      <div className="mt-8 flex gap-4">
        {[16, 14, 16, 16, 18, 14].map((width, index) => (
          <Skeleton key={index} className="h-5" style={{ width: `${width * 4}px` }} />
        ))}
      </div>
      <div className="mt-5 rounded-xl border border-border bg-surface p-4 shadow-xs">
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-96 w-full" />
          <div className="hidden lg:block">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="mt-4 h-4 w-3/4" />
            <Skeleton className="mt-2 h-4 w-2/3" />
            <Skeleton className="mt-2 h-4 w-1/2" />
          </div>
        </div>
      </div>
    </main>
  );
}
