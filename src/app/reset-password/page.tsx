'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getSupabaseClient } from '@/lib/supabase/client';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    const code = searchParams.get('code');

    (async () => {
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setSessionReady(false);
          setError('Invalid or expired reset link. Request a new one.');
          return;
        }
        setSessionReady(true);
        return;
      }

      // No code in URL — check whether a session already exists (implicit flow
      // detected the hash at mount time, or user arrived here some other way).
      const { data: { session } } = await supabase.auth.getSession();
      setSessionReady(!!session);
      if (!session) {
        setError('Invalid or expired reset link. Request a new one.');
      }
    })();
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    const supabase = getSupabaseClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setIsSubmitting(false);
      return;
    }

    router.push('/');
    router.refresh();
  };

  if (sessionReady === null) {
    return <p className="text-avalon-text-muted text-center">Verifying reset link...</p>;
  }

  if (sessionReady === false) {
    return (
      <div className="bg-avalon-navy/50 border border-avalon-dark-border rounded-lg p-4 text-center space-y-2">
        <p className="text-avalon-crimson">{error ?? 'Invalid or expired reset link.'}</p>
        <Link href="/forgot-password" className="text-avalon-gold hover:underline text-sm">
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="New password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        required
        fullWidth
      />
      <Input
        label="Confirm new password"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
        required
        fullWidth
      />

      {error && <p className="text-avalon-crimson text-sm">{error}</p>}

      <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
        Update password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-display text-3xl font-bold text-avalon-gold">Set new password</h1>
        </div>

        <Suspense fallback={<div className="h-40" />}>
          <ResetPasswordForm />
        </Suspense>

        <div className="text-center text-sm text-avalon-text-muted">
          <Link href="/login" className="text-avalon-gold hover:underline">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
