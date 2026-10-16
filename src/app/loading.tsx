import { WaveLoader } from "@/components/ui/wave-loader";

/**
 * The fallback for routes without their own (search, a shared clip, send). The meetings
 * list has its own skeleton in (home)/loading.tsx; this one promises nothing specific.
 */
export default function Loading() {
  return (
    <main
      className="mx-auto flex max-w-3xl items-center justify-center px-4 pt-32 text-sm text-fg-muted"
      aria-busy="true"
      aria-label="Loading"
    >
      <WaveLoader className="mr-2 h-4" label={null} />
      Loading…
    </main>
  );
}
