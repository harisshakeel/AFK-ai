import { Skeleton } from "@/components/ui/skeleton";

/** The send form's shape while the viewer check runs. */
export default function Loading() {
  return (
    <main
      className="mx-auto max-w-xl px-4 pt-10 pb-16 sm:px-6"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="h-3 w-12" />
      <Skeleton className="mt-3 h-10 w-80 max-w-full" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-4/5" />
      <div className="mt-8 flex flex-col gap-5">
        <div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-11 w-full" />
        </div>
        <div>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="mt-2 h-11 w-full" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>
    </main>
  );
}
