import { isRouteErrorResponse, useRouteError } from 'react-router';
import { ErrorFallback } from './ErrorFallback';

/**
 * Shown by the router when a page fails to load or crashes.
 * A common real-world cause: a new version was deployed while the user had
 * the old one open, so an old page file no longer exists. Reloading fixes it.
 */
export function RouteError() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return <ErrorFallback title={`Error ${error.status}`} message={error.statusText || 'The page could not be loaded.'} />;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const isChunkError = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(err.message);

  return (
    <ErrorFallback
      title={isChunkError ? 'LAKBAY was updated' : 'Something went wrong'}
      message={
        isChunkError
          ? 'A newer version is available, or you may be offline. Reload to continue.'
          : 'This page hit an unexpected error. Reloading usually helps.'
      }
      details={err.stack ?? err.message}
    />
  );
}
