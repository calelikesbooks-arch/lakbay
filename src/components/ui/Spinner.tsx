export function Spinner({ className = 'size-6' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent text-brand-600 dark:text-brand-300 ${className}`}
    />
  );
}
