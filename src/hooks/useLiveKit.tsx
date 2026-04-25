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
  /** If true, in split mode the video goes on the left and game on the right (default: false — game left, video right) */
  isLayoutSwapped: boolean;
  /** Toggle the split-mode layout swap */
  toggleLayoutSwap: () => void;
  /** True when the viewport is narrow (phone). Split mode is disabled in this case. */
  isNarrowViewport: boolean;
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
  /** Active emoji reactions keyed by participant identity */
  reactions: Map<string, { emoji: string; ts: number }>;
  /** Send an emoji reaction (broadcast to all). Rate-limited per user. */
  sendReaction: (emoji: string) => void;
  /** If true, reaction send is in cooldown */
  isReactionCoolingDown: boolean;
  /** Error message if connection failed */
  error: string | null;
  /** If true, mic/camera toggles are disabled and tracks are force-off (role-reveal window) */
  controlsLocked: boolean;
  /** Update local lock state only */
  setControlsLocked: (locked: boolean) => void;
  /** Broadcast a lock/unlock to everyone in the LiveKit room and apply locally */
  broadcastControlsLock: (locked: boolean) => void;
}

const LiveKitContext = createContext<LiveKitContextValue | null>(null);

const CHAT_TOPIC = 'chat';
const REACTION_TOPIC = 'reaction';
const CONTROLS_LOCK_TOPIC = 'controls-lock';
const REACTION_COOLDOWN_MS = 2000;
const REACTION_DURATION_MS = 3000;

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
  const [reactions, setReactions] = useState<Map<string, { emoji: string; ts: number }>>(new Map());
  const [isReactionCoolingDown, setIsReactionCoolingDown] = useState(false);
  const lastReactionSentRef = useRef(0);
  const reactionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [controlsLocked, setControlsLockedState] = useState(false);
  const controlsLockedRef = useRef(false);

  // Schedule clearing of a reaction after REACTION_DURATION_MS
  const scheduleReactionClear = useCallback((identity: string) => {
    const existing = reactionTimersRef.current.get(identity);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      setReactions((prev) => {
        const next = new Map(prev);
        next.delete(identity);
        return next;
      });
      reactionTimersRef.current.delete(identity);
    }, REACTION_DURATION_MS);
    reactionTimersRef.current.set(identity, t);
  }, []);

  // Narrow viewport (phone) — split panels don't fit, so we force a single-pane mode.
  const NARROW_QUERY = '(max-width: 767px)';
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(NARROW_QUERY).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // View mode — persisted in localStorage. On phones, never start in 'split'.
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'split';
    const saved = (localStorage.getItem('avalon-view-mode') as ViewMode) || 'split';
    if (saved === 'split' && window.matchMedia(NARROW_QUERY).matches) return 'video';
    return saved;
  });

  // If the viewport becomes narrow while in split mode, fall back to video (don't persist —
  // keep the user's split preference for when they're back on a wider screen).
  useEffect(() => {
    if (isNarrowViewport && viewMode === 'split') setViewModeState('video');
  }, [isNarrowViewport, viewMode]);

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem('avalon-view-mode', mode);
  }, []);

  // Split-mode layout swap — persisted in localStorage
  const [isLayoutSwapped, setIsLayoutSwapped] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('avalon-layout-swapped') === 'true';
  });

  const toggleLayoutSwap = useCallback(() => {
    setIsLayoutSwapped((prev) => {
      const next = !prev;
      localStorage.setItem('avalon-layout-swapped', String(next));
      return next;
    });
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
          const isNarrow = window.matchMedia(NARROW_QUERY).matches;
          const modes: ViewMode[] = isNarrow ? ['video', 'game'] : ['video', 'split', 'game'];
          const delta = isArrowRight ? 1 : -1;
          const idx = modes.indexOf(prev);
          // If current mode isn't in the available list (shouldn't happen, but safe), reset to first.
          const baseIdx = idx === -1 ? 0 : idx;
          const next = modes[(baseIdx + delta + modes.length) % modes.length];
          localStorage.setItem('avalon-view-mode', next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  const setControlsLocked = useCallback((locked: boolean) => {
    if (controlsLockedRef.current === locked) return;
    controlsLockedRef.current = locked;
    setControlsLockedState(locked);

    if (locked) {
      const room = roomRef.current;
      if (!room) return;
      room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      room.localParticipant.setCameraEnabled(false).catch(() => {});
      setIsMicEnabled(false);
      setIsCameraEnabled(false);
    }
  }, []);

  const broadcastControlsLock = useCallback(
    (locked: boolean) => {
      setControlsLocked(locked);
      const room = roomRef.current;
      if (!room) return;
      const payload = new TextEncoder().encode(locked ? '1' : '0');
      room.localParticipant.publishData(payload, { topic: CONTROLS_LOCK_TOPIC, reliable: true }).catch((err) => {
        console.warn('[livekit] controls-lock broadcast failed:', err);
      });
    },
    [setControlsLocked]
  );

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
      // Fetch token from our API (auth via cookies)
      const res = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
        // Mix all remote audio through a single Web Audio AudioContext instead
        // of one <audio> element per track. Bypasses the browser's concurrent
        // WebRTC-audio-element limit (~6 on Chrome) that would otherwise leave
        // the 7th+ participant unable to hear anyone.
        webAudioMix: true,
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

        if (topic === REACTION_TOPIC && participant) {
          const emoji = new TextDecoder().decode(payload).slice(0, 32);
          if (!emoji) return;
          setReactions((prev) => {
            const next = new Map(prev);
            next.set(participant.identity, { emoji, ts: Date.now() });
            return next;
          });
          scheduleReactionClear(participant.identity);
        }

        if (topic === CONTROLS_LOCK_TOPIC) {
          const locked = new TextDecoder().decode(payload) === '1';
          setControlsLocked(locked);
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

      // Enable camera/mic after connection is established (skipped if controls are locked)
      if (options?.enableCamera && !controlsLockedRef.current) {
        await room.localParticipant.setCameraEnabled(true);
        setIsCameraEnabled(true);
      }
      if (options?.enableMic && !controlsLockedRef.current) {
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
  }, [setControlsLocked, scheduleReactionClear]);

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
    setReactions(new Map());
    reactionTimersRef.current.forEach((t) => clearTimeout(t));
    reactionTimersRef.current.clear();
    controlsLockedRef.current = false;
    setControlsLockedState(false);
  }, []);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    if (controlsLockedRef.current) return;

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
    if (controlsLockedRef.current) return;

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

  const sendReaction = useCallback((emoji: string) => {
    const room = roomRef.current;
    if (!room || !emoji) return;
    const now = Date.now();
    if (now - lastReactionSentRef.current < REACTION_COOLDOWN_MS) return;
    lastReactionSentRef.current = now;

    const payload = new TextEncoder().encode(emoji.slice(0, 32));
    room.localParticipant.publishData(payload, { topic: REACTION_TOPIC }).catch(() => {});

    // Show on sender's own tile immediately (local echo)
    const identity = room.localParticipant.identity;
    setReactions((prev) => {
      const next = new Map(prev);
      next.set(identity, { emoji, ts: now });
      return next;
    });
    scheduleReactionClear(identity);

    // Cooldown UI feedback
    setIsReactionCoolingDown(true);
    setTimeout(() => setIsReactionCoolingDown(false), REACTION_COOLDOWN_MS);
  }, [scheduleReactionClear]);

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
      reactionTimersRef.current.forEach((t) => clearTimeout(t));
      reactionTimersRef.current.clear();
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
    isLayoutSwapped,
    toggleLayoutSwap,
    isNarrowViewport,
    chatMessages,
    sendChatMessage,
    unreadCount,
    markChatRead,
    setChatVisible,
    reactions,
    sendReaction,
    isReactionCoolingDown,
    error,
    controlsLocked,
    setControlsLocked,
    broadcastControlsLock,
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
