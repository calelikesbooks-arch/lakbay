import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

interface ErrorFallbackProps {
  title?: string;
  message?: string;
  /** Technical details, shown only in development. */
  details?: string;
  onRetry?: () => void;
}

export function ErrorFallback({
  title = 'Something went wrong',
  message = 'This part of LAKBAY could not be shown. Please try again.',
  details,
  onRetry = () => window.location.reload(),
}: ErrorFallbackProps) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-4 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
        <Icon name="alert" className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted">{message}</p>
      {import.meta.env.DEV && details && (
        <pre className="mt-4 max-h-48 w-full overflow-auto rounded-lg bg-surface-2 p-3 text-left text-xs text-muted">
          {details}
        </pre>
      )}
      <div className="mt-6 flex gap-2">
        <Button onClick={onRetry}>
          <Icon name="refresh" className="size-4" /> Try again
        </Button>
        <a href="/" className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
          Go to Home
        </a>
      </div>
    </div>
  );
}
