import { ReactNode, useCallback, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export default function Modal({ open, onClose, children, className }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Close on Escape
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return;
    }

    const { style } = document.body;
    const originalOverflow = style.overflow;
    style.overflow = 'hidden';

    return () => {
      style.overflow = originalOverflow;
    };
  }, [open]);

  // Save & restore focus, auto-focus first focusable element
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Delay to allow content to render
    const timer = setTimeout(() => {
      if (!modalRef.current) return;
      const first = modalRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (first) {
        first.focus();
      } else {
        modalRef.current.focus();
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  // Trap Tab / Shift+Tab inside the modal
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !modalRef.current) return;

    const focusable = modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  if (!open) return null;
  const contentClass = className ? `modal ${className}` : 'modal';
  const overlayClass = className?.includes('modal--dialog')
    ? 'modal-overlay modal-overlay--dialog'
    : 'modal-overlay';

  return (
    <div className={overlayClass} onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className={contentClass}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}