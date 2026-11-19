import { useState, type FormEvent } from 'react';
import { signIn } from '../../lib/auth';
import { Button } from '../ui/Button';
import { Field, TextInput } from '../ui/Field';
import { Spinner } from '../ui/Spinner';

/** Email + password sign-in for moderators and admins. */
export function AdminSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(await signIn(email, password));
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-sm space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div>
        <h2 className="text-lg font-bold">Staff sign-in</h2>
        <p className="mt-1 text-sm text-muted">For LAKBAY moderators and admins. Commuters don't need an account.</p>
      </div>
      <Field id="admin-email" label="Email">
        <TextInput id="admin-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field id="admin-password" label="Password">
        <TextInput id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {error && (
        <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy || !email || !password}>
        {busy ? <Spinner className="size-4 text-navy-950" /> : null} Sign in
      </Button>
    </form>
  );
}
