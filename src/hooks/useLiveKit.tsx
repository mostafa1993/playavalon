'use client';

/**
 * LiveKit context provider and hook
 * Lives at the layout level so the connection persists across page transitions
 * (lobby → game page without reconnecting)
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import {
  Room,
  RoomEvent,
  ParticipantEvent,
  ConnectionState,
  type RemoteParticipant,
} from 'livekit-client';
import { getPlayerId } from '@/lib/utils/player-id';

export type ViewMode = 'video' | 'split' | 'game';

interface ChatMessage {
  id: string;
  sender: string;
  senderName: string;
  text: string;
  timestamp: number;
}

interface LiveKitContextValue {
  /** The LiveKit Room instance (null if not connected) */
  room: Room | null;
  /** Current connection state */
  connectionState: ConnectionState;
  /** Connect to a LiveKit room */
  connect: (roomCode: string, options?: { enableCamera?: boolean; enableMic?: boolean }) => Promise<void>;
  /** Disconnect from the current room */
  disconnect: () => void;
  /** Whether currently connected */
  isConnected: boolean;
  /** Toggle local camera on/off */
  toggleCamera: () => Promise<void>;
  /** Toggle local microphone on/off */
  toggleMic: () => Promise<void>;
  /** Whether local camera is enabled */
  isCameraEnabled: boolean;
  /** Whether local mic is enabled */
  isMicEnabled: boolean;
  /** Current view mode */
  viewMode: ViewMode;
  /** Set view mode */
  setViewMode: (mode: ViewMode) => void;
  /** Chat messages */
  chatMessages: ChatMessage[];
  /** Send a chat message */
  sendChatMessage: (text: string) => void;
  /** Unread chat message count (since last chat open) */
  unreadCount: number;
  /** Mark chat as read and set visibility */
  markChatRead: () => void;
  /** Set whether chat panel is currently visible (controls unread counting) */
  setChatVisible: (visible: boolean) => void;
  /** Error message if connection failed */
  error: string | null;
}

const LiveKitContext = createContext<LiveKitContextValue | null>(null);

const CHAT_TOPIC = 'chat';

export function LiveKitProvider({ children }: { children: ReactNode }) {
  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected
  );
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectingRef = useRef(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatVisibleRef = useRef(false);

  // View mode — persisted in localStorage
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'split';
    return (localStorage.getItem('avalon-view-mode') as ViewMode) || 'split';
  });

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem('avalon-view-mode', mode);
  }, []);

  // Keyboard shortcut: V to cycle view modes
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      const isArrowLeft = e.key === 'ArrowLeft';
      const isArrowRight = e.key === 'ArrowRight';
      if (
        (isArrowLeft || isArrowRight) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        setViewModeState((prev) => {
          const modes: ViewMode[] = ['video', 'split', 'game'];
          const delta = isArrowRight ? 1 : -1;
          const next = modes[(modes.indexOf(prev) + delta + modes.length) % modes.length];
          localStorage.setItem('avalon-view-mode', next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  const connect = useCallback(async (roomCode: string, options?: { enableCamera?: boolean; enableMic?: boolean }) => {
    setError(null);

    // If already connected to this room, skip
    if (roomRef.current?.name === roomCode.toUpperCase() && roomRef.current?.state === ConnectionState.Connected) {
      return;
    }

    // Prevent concurrent connect attempts (double-click guard)
    if (connectingRef.current) return;
    connectingRef.current = true;

    // Disconnect any existing connection
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
      setRoom(null);
    }

    try {
      const playerId = getPlayerId();
      if (!playerId) {
        setError('Not registered');
        return;
      }

      // Fetch token from our API
      const res = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Player-ID': playerId,
        },
        body: JSON.stringify({ roomCode: roomCode.toUpperCase() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.message || 'Failed to get video token');
        return;
      }

      const { data } = await res.json();

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      // Set up event listeners
      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        setConnectionState(state);
      });

      const MAX_CHAT_PAYLOAD = 2048; // 2KB max per chat message

      room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
        // Drop oversized payloads to prevent memory abuse
        if (payload.byteLength > MAX_CHAT_PAYLOAD) return;

        if (topic === CHAT_TOPIC && participant) {
          const text = new TextDecoder().decode(payload);
          const msg: ChatMessage = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${participant.identity}`,
            sender: participant.identity,
            senderName: participant.name || participant.identity,
            text: text.slice(0, 500),
            timestamp: Date.now(),
          };
          setChatMessages((prev) => [...prev, msg]);
          if (!chatVisibleRef.current) {
            setUnreadCount((prev) => prev + 1);
          }
        }
      });

      // Sync local mic/camera state whenever tracks change
      const syncLocalTracks = () => {
        setIsCameraEnabled(room.localParticipant.isCameraEnabled);
        setIsMicEnabled(room.localParticipant.isMicrophoneEnabled);
      };
      room.localParticipant.on(ParticipantEvent.TrackMuted, syncLocalTracks);
      room.localParticipant.on(ParticipantEvent.TrackUnmuted, syncLocalTracks);
      room.localParticipant.on(ParticipantEvent.TrackPublished, syncLocalTracks);
      room.localParticipant.on(ParticipantEvent.TrackUnpublished, syncLocalTracks);

      roomRef.current = room;
      setRoom(room);

      await room.connect(data.wsUrl, data.token);

      // Enable camera/mic after connection is established
      if (options?.enableCamera) {
        await room.localParticipant.setCameraEnabled(true);
        setIsCameraEnabled(true);
      }
      if (options?.enableMic) {
        await room.localParticipant.setMicrophoneEnabled(true);
        setIsMicEnabled(true);
      }

      setConnectionState(ConnectionState.Connected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to video');
      setConnectionState(ConnectionState.Disconnected);
    } finally {
      connectingRef.current = false;
    }
  }, []);

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    setRoom(null);
    setConnectionState(ConnectionState.Disconnected);
    setIsCameraEnabled(false);
    setIsMicEnabled(false);
    setChatMessages([]);
    setUnreadCount(0);
  }, []);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    try {
      const enabled = room.localParticipant.isCameraEnabled;
      await room.localParticipant.setCameraEnabled(!enabled);
      setIsCameraEnabled(!enabled);
    } catch (err) {
      // Sync state with actual device state on failure
      setIsCameraEnabled(room.localParticipant.isCameraEnabled);
      setError(err instanceof Error ? err.message : 'Failed to toggle camera');
    }
  }, []);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    try {
      const enabled = room.localParticipant.isMicrophoneEnabled;
      await room.localParticipant.setMicrophoneEnabled(!enabled);
      setIsMicEnabled(!enabled);
    } catch (err) {
      // Sync state with actual device state on failure
      setIsMicEnabled(room.localParticipant.isMicrophoneEnabled);
      setError(err instanceof Error ? err.message : 'Failed to toggle microphone');
    }
  }, []);

  const sendChatMessage = useCallback(async (text: string) => {
    const room = roomRef.current;
    if (!room || !text.trim()) return;

    const trimmed = text.trim();
    const payload = new TextEncoder().encode(trimmed);

    try {
      await room.localParticipant.publishData(payload, { topic: CHAT_TOPIC });

      // Only add to local state after successful send
      const msg: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-local`,
        sender: room.localParticipant.identity,
        senderName: room.localParticipant.name || room.localParticipant.identity,
        text: trimmed,
        timestamp: Date.now(),
      };
      setChatMessages((prev) => [...prev, msg]);
    } catch {
      setError('Failed to send message');
    }
  }, []);

  const markChatRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const setChatVisible = useCallback((visible: boolean) => {
    chatVisibleRef.current = visible;
    if (visible) {
      setUnreadCount(0);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
    };
  }, []);

  const value: LiveKitContextValue = {
    room,
    connectionState,
    connect,
    disconnect,
    isConnected: connectionState === ConnectionState.Connected,
    toggleCamera,
    toggleMic,
    isCameraEnabled,
    isMicEnabled,
    viewMode,
    setViewMode,
    chatMessages,
    sendChatMessage,
    unreadCount,
    markChatRead,
    setChatVisible,
    error,
  };

  return (
    <LiveKitContext.Provider value={value}>{children}</LiveKitContext.Provider>
  );
}

/**
 * Hook to access LiveKit context
 * Must be used within a LiveKitProvider
 */
export function useLiveKit(): LiveKitContextValue {
  const ctx = useContext(LiveKitContext);
  if (!ctx) {
    throw new Error('useLiveKit must be used within a LiveKitProvider');
  }
  return ctx;
}
