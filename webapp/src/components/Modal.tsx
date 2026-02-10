import { ReactNode, useEffect } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export default function Modal({ open, onClose, children, className }: ModalProps) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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

  if (!open) return null;
  const contentClass = className ? `modal ${className}` : 'modal';
  const overlayClass = className?.includes('modal--dialog')
    ? 'modal-overlay modal-overlay--dialog'
    : 'modal-overlay';

  return (
    <div className={overlayClass} onClick={onClose}>
      <div className={contentClass} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}