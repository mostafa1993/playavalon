'use client';

import { LiveKitProvider } from '@/hooks/useLiveKit';

export function Providers({ children }: { children: React.ReactNode }) {
  return <LiveKitProvider>{children}</LiveKitProvider>;
}
