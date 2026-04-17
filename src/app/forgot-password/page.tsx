'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const supabase = getSupabaseClient();
    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/reset-password`
        : undefined;

    await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    setSubmitted(true);
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-display text-3xl font-bold text-avalon-gold">Reset password</h1>
          <p className="text-avalon-text-muted text-sm mt-2">
            We&apos;ll email you a link to set a new password
          </p>
        </div>

        {submitted ? (
          <div className="bg-avalon-navy/50 border border-avalon-dark-border rounded-lg p-4 text-center space-y-2">
            <p className="text-avalon-text">
              If <span className="text-avalon-gold">{email}</span> is registered, a reset link is on its way.
            </p>
            <p className="text-avalon-text-muted text-sm">
              Check your inbox (and spam folder).
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              fullWidth
            />
            <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
              Send reset link
            </Button>
          </form>
        )}

        <div className="text-center text-sm text-avalon-text-muted">
          <Link href="/login" className="text-avalon-gold hover:underline">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
