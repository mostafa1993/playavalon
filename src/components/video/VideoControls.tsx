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
    <div className="flex items-center justify-center gap-1">
      <button
        onClick={toggleMic}
        className={`
          p-1.5 rounded-full flex items-center justify-center transition-colors
          ${isMicEnabled
            ? 'text-avalon-text hover:text-avalon-gold'
            : 'text-red-400 hover:text-red-300'}
        `}
        title={isMicEnabled ? 'Mute mic' : 'Unmute mic'}
      >
        {isMicEnabled ? <Mic size={18} /> : <MicOff size={18} />}
      </button>

      <button
        onClick={toggleCamera}
        className={`
          p-1.5 rounded-full flex items-center justify-center transition-colors
          ${isCameraEnabled
            ? 'text-avalon-text hover:text-avalon-gold'
            : 'text-red-400 hover:text-red-300'}
        `}
        title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
      >
        {isCameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
      </button>

      <button
        onClick={disconnect}
        className="p-1.5 rounded-full text-red-500 hover:text-red-400 transition-colors"
        title="Leave video"
      >
        <PhoneOff size={18} />
      </button>
    </div>
  );
}
