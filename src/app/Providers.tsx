'use client';

import { AuthProvider } from '@/hooks/useAuth';
import { LiveKitProvider } from '@/hooks/useLiveKit';
import { RemoteAudioSink } from '@/components/video/RemoteAudioSink';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <LiveKitProvider>
        <RemoteAudioSink />
        {children}
      </LiveKitProvider>
    </AuthProvider>
  );
}
