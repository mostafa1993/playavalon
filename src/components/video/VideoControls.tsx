'use client';

/**
 * VideoControls — camera/mic toggle buttons + connection status
 */

import { Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react';
import { useLiveKit } from '@/hooks/useLiveKit';

export function VideoControls() {
  const {
    isConnected,
    isCameraEnabled,
    isMicEnabled,
    toggleCamera,
    toggleMic,
    disconnect,
  } = useLiveKit();

  if (!isConnected) return null;

  return (
    <div className="flex items-center justify-center gap-3 py-2 px-4 bg-avalon-navy border-t border-avalon-dark-border">
      <button
        onClick={toggleMic}
        className={`
          w-10 h-10 rounded-full flex items-center justify-center transition-colors
          ${isMicEnabled
            ? 'bg-avalon-dark-lighter text-avalon-text hover:bg-avalon-dark-border'
            : 'bg-red-500/80 text-white hover:bg-red-600'}
        `}
        title={isMicEnabled ? 'Mute mic' : 'Unmute mic'}
      >
        {isMicEnabled ? <Mic size={18} /> : <MicOff size={18} />}
      </button>

      <button
        onClick={toggleCamera}
        className={`
          w-10 h-10 rounded-full flex items-center justify-center transition-colors
          ${isCameraEnabled
            ? 'bg-avalon-dark-lighter text-avalon-text hover:bg-avalon-dark-border'
            : 'bg-red-500/80 text-white hover:bg-red-600'}
        `}
        title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
      >
        {isCameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
      </button>

      <button
        onClick={disconnect}
        className="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700 transition-colors"
        title="Leave video"
      >
        <PhoneOff size={18} />
      </button>
    </div>
  );
}
