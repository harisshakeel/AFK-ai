import { Skeleton } from "@/components/ui/skeleton";

/** The landing page's shape while the viewer check runs: a bar, a title, two buttons, a card. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="h-14 border-b border-border/60" />
      <main className="mx-auto grid max-w-6xl gap-12 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-12 lg:pt-24">
        <div className="lg:col-span-6">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-6 h-14 w-64 max-w-full" />
          <Skeleton className="mt-3 h-14 w-full max-w-lg" />
          <Skeleton className="mt-8 h-5 w-full max-w-xl" />
          <Skeleton className="mt-2 h-5 w-5/6 max-w-xl" />
          <div className="mt-8 flex gap-3">
            <Skeleton className="h-11 w-56" />
            <Skeleton className="h-11 w-44" />
          </div>
        </div>
        <div className="hidden lg:col-span-6 lg:block">
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      </main>
    </div>
  );
}
