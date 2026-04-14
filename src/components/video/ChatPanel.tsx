'use client';

/**
 * ChatPanel — text chat via LiveKit data channels
 * Toggle open/close, shows unread badge when collapsed
 */

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { useLiveKit } from '@/hooks/useLiveKit';

export function ChatPanel() {
  const {
    isConnected,
    chatMessages,
    sendChatMessage,
    unreadCount,
    setChatVisible,
  } = useLiveKit();

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isOpen]);

  // Sync open/close state to provider so unread counting works correctly
  useEffect(() => {
    setChatVisible(isOpen);
  }, [isOpen, setChatVisible]);

  if (!isConnected) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendChatMessage(input);
    setInput('');
  };

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative px-3 py-1.5 rounded-md text-xs font-medium bg-avalon-navy border border-avalon-dark-border text-avalon-text-muted hover:text-avalon-text transition-colors"
      >
        <MessageSquare size={14} className="inline" /> Chat
        {!isOpen && unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed top-16 right-4 w-72 bg-avalon-navy border border-avalon-dark-border rounded-lg shadow-xl overflow-hidden z-50">
          {/* Header */}
          <div className="px-3 py-2 border-b border-avalon-dark-border flex items-center justify-between">
            <span className="text-xs font-medium text-avalon-text">Chat</span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-avalon-text-muted hover:text-avalon-text text-xs"
            >
              <X size={14} />
            </button>
          </div>

          {/* Messages */}
          <div className="h-48 overflow-y-auto px-3 py-2 space-y-1.5">
            {chatMessages.length === 0 && (
              <p className="text-avalon-text-muted text-xs text-center py-4">
                No messages yet
              </p>
            )}
            {chatMessages.map((msg) => (
              <div key={msg.id} className="text-xs">
                <span className="font-medium text-avalon-gold">{msg.senderName}: </span>
                <span className="text-avalon-text-secondary">{msg.text}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t border-avalon-dark-border p-2 flex gap-1.5">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-avalon-midnight border border-avalon-dark-border rounded px-2 py-1 text-xs text-avalon-text placeholder:text-avalon-text-muted focus:outline-none focus:border-avalon-gold"
              maxLength={500}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-2 py-1 bg-avalon-gold text-avalon-midnight rounded text-xs font-medium disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
