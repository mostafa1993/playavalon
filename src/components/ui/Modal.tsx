'use client';

import { useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal title */
  title?: ReactNode;
  /** Modal content */
  children: ReactNode;
  /** Footer content (buttons) */
  footer?: ReactNode;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Whether clicking outside closes the modal */
  closeOnOverlayClick?: boolean;
  /** Whether pressing Escape closes the modal */
  closeOnEsc?: boolean;
  /** Show close button */
  showCloseButton?: boolean;
  /** Whether content should scroll */
  scrollable?: boolean;
}

/**
 * Modal component with Avalon theme styling
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnOverlayClick = true,
  closeOnEsc = true,
  showCloseButton = true,
  scrollable = true,
}: ModalProps) {
  // Handle escape key
  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, closeOnEsc, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleOverlayClick = useCallback(() => {
    if (closeOnOverlayClick) {
      onClose();
    }
  }, [closeOnOverlayClick, onClose]);

  const sizeStyles = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
        onClick={handleOverlayClick}
      />

      {/* Modal Content - anchored to top, not centered */}
      <div
        className={`
          relative w-full ${sizeStyles[size]}
          bg-avalon-navy border border-avalon-silver/30
          rounded-xl shadow-2xl
          animate-slide-up
          mb-8
          ${scrollable ? 'max-h-[85vh] flex flex-col' : ''}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between p-6 border-b border-avalon-silver/20 flex-shrink-0">
            {title && (
              <h2
                id="modal-title"
                className="text-xl font-display font-semibold text-avalon-gold"
              >
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1 text-avalon-silver hover:text-avalon-parchment transition-colors"
                aria-label="Close modal"
              >
                <CloseIcon />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className={`p-6 ${scrollable ? 'overflow-y-auto flex-grow overscroll-contain' : ''}`}
          style={{ overflowAnchor: 'auto' }}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-avalon-silver/20 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  // Use portal to render at document body
  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  return null;
}

/**
 * Close icon SVG
 */
function CloseIcon() {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
