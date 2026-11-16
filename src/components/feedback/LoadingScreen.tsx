import { Spinner } from '../ui/Spinner';

/** Shown while a page's code is downloading. */
export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
      <Spinner className="size-8" />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}
