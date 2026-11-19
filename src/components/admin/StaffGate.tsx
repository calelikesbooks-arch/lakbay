import { useEffect, useState, type ReactNode } from 'react';
import { fetchMyRoles, useSession } from '../../lib/auth';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { AdminSignIn } from './AdminSignIn';

/**
 * Shows its children only to signed-in moderators/admins. The database
 * enforces the same rule; this only avoids showing screens that would fail.
 */
export function StaffGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const [roles, setRoles] = useState<string[] | null>(null);
  const userId = session.status === 'ready' ? session.session?.user.id : undefined;

  useEffect(() => {
    if (!userId) {
      setRoles(null);
      return;
    }
    fetchMyRoles(userId).then(setRoles);
  }, [userId]);

  if (session.status === 'loading') return <Spinner />;
  if (session.status === 'unavailable') return <EmptyState icon="alert" title="Database not connected" />;
  if (!session.session) return <AdminSignIn />;
  if (roles === null) return <Spinner />;
  if (!roles.includes('moderator') && !roles.includes('admin')) {
    return (
      <EmptyState icon="shieldCheck" title="No access">
        This account is not a moderator or admin. An admin can grant the role (see docs/database.md).
      </EmptyState>
    );
  }
  return <>{children}</>;
}

/** True when someone is signed in (for showing a sign-out button). */
export function useSignedIn(): boolean {
  const session = useSession();
  return session.status === 'ready' && !!session.session;
}
