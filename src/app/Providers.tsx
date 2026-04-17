'use client';

import { AuthProvider } from '@/hooks/useAuth';
import { LiveKitProvider } from '@/hooks/useLiveKit';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <LiveKitProvider>{children}</LiveKitProvider>
    </AuthProvider>
  );
}
