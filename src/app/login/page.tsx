'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

function safeReturnTo(raw: string | null): string {
  // Only allow internal paths — must start with `/` and not be protocol-relative.
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Login failed' }));
        setError(data.error || 'Invalid credentials');
        return;
      }

      // Full-page navigation ensures the auth cookie is applied cleanly
      // before middleware evaluates the next route.
      window.location.href = returnTo;
    } catch {
      setError('Network error — try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Username or email"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        autoComplete="username"
        required
        fullWidth
      />
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
        fullWidth
      />

      {error && <p className="text-avalon-crimson text-sm">{error}</p>}

      <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
        Log in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-display text-3xl font-bold text-avalon-gold">Welcome back</h1>
          <p className="text-avalon-text-muted text-sm mt-2">Log in to continue</p>
        </div>

        <Suspense fallback={<div className="h-40" />}>
          <LoginForm />
        </Suspense>

        <div className="text-center text-sm text-avalon-text-muted space-y-2">
          <div>
            <Link href="/forgot-password" className="text-avalon-gold hover:underline">
              Forgot password?
            </Link>
          </div>
          <div>
            Need an account?{' '}
            <Link href="/signup" className="text-avalon-gold hover:underline">
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
