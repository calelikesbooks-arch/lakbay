import { LinkButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';

export default function NotFoundPage() {
  return (
    <div className="py-6">
      <EmptyState icon="compass" title="Page not found">
        <p>This page doesn't exist. Ligaw ka ata!</p>
        <LinkButton to="/" className="mt-4">
          Back to Home
        </LinkButton>
      </EmptyState>
    </div>
  );
}
