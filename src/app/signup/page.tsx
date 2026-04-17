'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function SignupPage() {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, displayName }),
      });

      const data = await res.json().catch(() => ({ error: 'Signup failed' }));

      if (!res.ok) {
        setError(data.error || 'Signup failed');
        return;
      }

      if (data.requiresEmailConfirmation) {
        setNeedsConfirmation(true);
        return;
      }

      if (data.autoLoginFailed) {
        window.location.href = '/login';
        return;
      }

      window.location.href = '/';
    } catch {
      setError('Network error — try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-display text-3xl font-bold text-avalon-gold">Create account</h1>
          <p className="text-avalon-text-muted text-sm mt-2">Join the realm of Avalon</p>
        </div>

        {needsConfirmation ? (
          <div className="bg-avalon-navy/50 border border-avalon-dark-border rounded-lg p-4 text-center space-y-2">
            <p className="text-avalon-text">
              Check your inbox at <span className="text-avalon-gold">{email}</span> to confirm your account.
            </p>
            <p className="text-avalon-text-muted text-sm">
              Click the link in the email, then log in.
            </p>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="3-20 chars, letters/numbers/_"
            autoComplete="username"
            required
            fullWidth
          />
          <Input
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Shown in game"
            required
            fullWidth
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            fullWidth
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 8 characters"
            autoComplete="new-password"
            required
            fullWidth
          />

          {error && (
            <p className="text-avalon-crimson text-sm">{error}</p>
          )}

          <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
            Sign up
          </Button>
        </form>
        )}

        <div className="text-center text-sm text-avalon-text-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-avalon-gold hover:underline">
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
