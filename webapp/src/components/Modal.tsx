import { ReactNode, useEffect } from 'react';
import { cn } from '../utils/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
}

export default function Modal({ open, onClose, children, className, overlayClassName }: ModalProps) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return;
    }
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const overlayClass = cn(
    'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-8 backdrop-blur-sm transition dark:bg-slate-950/70',
    overlayClassName,
  );
  const contentClass = cn(
    'relative w-full max-w-xl rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-2xl shadow-slate-900/20 backdrop-blur-lg transition dark:border-slate-700/70 dark:bg-slate-900/80 dark:shadow-black/40',
    className,
  );

  return (
    <div className={overlayClass} onClick={onClose}>
      <div className={contentClass} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}